import { COMPLETED_SEASON_TTL, CURRENT_SEASON_TTL, fetchMlb } from "./mlb-fetch.ts";
import { walkForwardBacktest, type CalibrationModel, type HistoricalGame } from "./backtest.ts";
import { clamp } from "./modeling.ts";

type ContextPayload={dates?:Array<{games?:Array<{gamePk?:number;gameDate?:string;venue?:{id?:number};status?:{abstractGameState?:string};teams?:{away?:{team?:{id?:number};score?:number};home?:{team?:{id?:number};score?:number}};linescore?:{innings?:Array<{num?:number;away?:{runs?:number};home?:{runs?:number}}>} }>}>};

export type CalibrationSlot={model:CalibrationModel|null;qualified:boolean;method:string};
export type SlateContext={
  cutoffDate:string;
  firstInningShare:number;firstFiveShare:number;contextGames:number;historicalFinals:number;
  moneyline:CalibrationSlot;totalOver85:CalibrationSlot;firstFiveHome:CalibrationSlot;nrfi:CalibrationSlot;
  teamRates:Array<{teamId:number;games:number;scored:number;allowed:number}>;
  leagueAverage:number|null;
  teamEnvironments:Array<{teamId:number;homeGames:number;homeRuns:number;roadGames:number;roadRuns:number}>;
};

const PENDING_SLOT:CalibrationSlot={model:null,qualified:false,method:"pending"};

function extractHistoricalGames(payload:ContextPayload){return(payload.dates??[]).flatMap(day=>day.games??[]).filter(game=>game.status?.abstractGameState==="Final").map(game=>{const innings=game.linescore?.innings??[],first=innings.find(inning=>inning.num===1),firstFive=innings.filter(inning=>(inning.num??0)<=5);return{id:game.gamePk??0,playedAt:game.gameDate??"",awayId:game.teams?.away?.team?.id??0,homeId:game.teams?.home?.team?.id??0,awayScore:game.teams?.away?.score??0,homeScore:game.teams?.home?.score??0,firstInningAway:first?.away?.runs,firstInningHome:first?.home?.runs,firstFiveAway:innings.length?firstFive.reduce((sum,inning)=>sum+(inning.away?.runs??0),0):undefined,firstFiveHome:innings.length?firstFive.reduce((sum,inning)=>sum+(inning.home?.runs??0),0):undefined}}).filter(game=>game.id>0&&game.awayId>0&&game.homeId>0&&game.playedAt) satisfies HistoricalGame[];}

/**
 * The expensive, per-day slate context: three seasons of finals, walk-forward
 * calibration for every market family, current-season team run rates (the same
 * estimator the calibration is fitted on), park run environments, and
 * empirical inning shares. Designed to be cached per cutoff date via
 * computed-cache — the underlying data is final and cannot change.
 */
export async function computeSlateContext(season:number,cutoffDate:string):Promise<SlateContext>{
  const contextUrl=new URL("https://statsapi.mlb.com/api/v1/schedule");
  contextUrl.searchParams.set("sportId","1");contextUrl.searchParams.set("startDate",`${season}-03-15`);contextUrl.searchParams.set("endDate",cutoffDate);contextUrl.searchParams.set("gameType","R");contextUrl.searchParams.set("hydrate","linescore");
  const priorContextUrls=[season-2,season-1].map(year=>{const url=new URL("https://statsapi.mlb.com/api/v1/schedule");url.searchParams.set("sportId","1");url.searchParams.set("startDate",`${year}-03-15`);url.searchParams.set("endDate",`${year}-10-31`);url.searchParams.set("gameType","R");url.searchParams.set("hydrate","linescore");return url;});
  const [contextResponse,...priorContextResponses]=await Promise.all([fetchMlb(contextUrl,CURRENT_SEASON_TTL),...priorContextUrls.map(url=>fetchMlb(url,COMPLETED_SEASON_TTL))]);

  const historicalGames:HistoricalGame[]=[];
  for(const response of priorContextResponses){if(response.ok)historicalGames.push(...extractHistoricalGames(await response.json() as ContextPayload));}

  let firstInningShare=0.115,firstFiveShare=0.56,contextGames=0;
  const teamEnvironments=new Map<number,{homeGames:number;homeRuns:number;roadGames:number;roadRuns:number}>();
  let slots={moneyline:PENDING_SLOT,totalOver85:PENDING_SLOT,firstFiveHome:PENDING_SLOT,nrfi:PENDING_SLOT};
  let teamRates:SlateContext["teamRates"]=[],leagueAverage:number|null=null;

  if(contextResponse.ok){
    const context=await contextResponse.json() as ContextPayload;
    historicalGames.push(...extractHistoricalGames(context));
    let allRuns=0,firstRuns=0,firstFiveRuns=0;
    for(const game of (context.dates??[]).flatMap(day=>day.games??[])){
      if(game.status?.abstractGameState!=="Final")continue;
      const innings=game.linescore?.innings??[];
      const awayScore=game.teams?.away?.score??0,homeScore=game.teams?.home?.score??0,total=awayScore+homeScore,awayId=game.teams?.away?.team?.id??0,homeId=game.teams?.home?.team?.id??0;
      if(!innings.length||total<=0)continue;
      const homeEnvironment=teamEnvironments.get(homeId)??{homeGames:0,homeRuns:0,roadGames:0,roadRuns:0},awayEnvironment=teamEnvironments.get(awayId)??{homeGames:0,homeRuns:0,roadGames:0,roadRuns:0};
      teamEnvironments.set(homeId,{...homeEnvironment,homeGames:homeEnvironment.homeGames+1,homeRuns:homeEnvironment.homeRuns+total});
      teamEnvironments.set(awayId,{...awayEnvironment,roadGames:awayEnvironment.roadGames+1,roadRuns:awayEnvironment.roadRuns+total});
      allRuns+=total;
      firstRuns+=(innings[0]?.away?.runs??0)+(innings[0]?.home?.runs??0);
      firstFiveRuns+=innings.filter(inning=>(inning.num??0)<=5).reduce((sum,inning)=>sum+(inning.away?.runs??0)+(inning.home?.runs??0),0);
      contextGames+=1;
    }
    if(allRuns>0){firstInningShare=clamp(firstRuns/allRuns,0.08,0.16);firstFiveShare=clamp(firstFiveRuns/allRuns,0.45,0.68);}
    const validation=walkForwardBacktest(historicalGames,10);
    slots={
      moneyline:{model:validation.liveCalibration,qualified:Boolean(validation.liveCalibration&&validation.calibratedMetrics?.verified),method:validation.calibratedMetrics?.selectedMethod??"pending"},
      totalOver85:{model:validation.liveMarketCalibrations.totalOver85,qualified:Boolean(validation.liveMarketCalibrations.totalOver85&&validation.marketCalibratedMetrics.totalOver85?.verified),method:validation.marketCalibratedMetrics.totalOver85?.selectedMethod??"pending"},
      firstFiveHome:{model:validation.liveMarketCalibrations.firstFiveHome,qualified:Boolean(validation.liveMarketCalibrations.firstFiveHome&&validation.marketCalibratedMetrics.firstFiveHome?.verified),method:validation.marketCalibratedMetrics.firstFiveHome?.selectedMethod??"pending"},
      nrfi:{model:validation.liveMarketCalibrations.nrfi,qualified:Boolean(validation.liveMarketCalibrations.nrfi&&validation.marketCalibratedMetrics.nrfi?.verified),method:validation.marketCalibratedMetrics.nrfi?.selectedMethod??"pending"},
    };
    teamRates=validation.teamRates;
    leagueAverage=validation.liveLeagueAverage;
  }

  return{
    cutoffDate,firstInningShare,firstFiveShare,contextGames,historicalFinals:historicalGames.length,
    ...slots,
    teamRates,leagueAverage,
    teamEnvironments:[...teamEnvironments.entries()].map(([teamId,environment])=>({teamId,...environment})),
  };
}
