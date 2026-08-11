import { walkForwardBacktest, type HistoricalGame } from "@/lib/backtest";
import { CURRENT_SEASON_TTL, fetchMlb } from "@/lib/mlb-fetch";
import { getOrCompute } from "@/lib/computed-cache";
import { getDatabase } from "@/lib/db";
import { priorSeasonGames } from "@/lib/slate-context";

// API routes are always dynamic: they read the database and live MLB feeds
// and must never be baked into the build as static responses.
export const dynamic="force-dynamic";

type Feed = { dates?:Array<{games?:Array<{gamePk?:number;gameDate?:string;status?:{abstractGameState?:string};teams?:{away?:{team?:{id?:number};score?:number};home?:{team?:{id?:number};score?:number}};linescore?:{innings?:Array<{num?:number;away?:{runs?:number};home?:{runs?:number}}>}}>}> };
const DATE=/^\d{4}-\d{2}-\d{2}$/;

function endpoint(startDate:string,endDate:string){const url=new URL("https://statsapi.mlb.com/api/v1/schedule");url.searchParams.set("sportId","1");url.searchParams.set("startDate",startDate);url.searchParams.set("endDate",endDate);url.searchParams.set("gameType","R");url.searchParams.set("hydrate","linescore");return url;}
function historicalGames(feed:Feed){return(feed.dates??[]).flatMap(day=>day.games??[]).filter(game=>game.status?.abstractGameState==="Final").map(game=>{const innings=game.linescore?.innings??[],first=innings.find(inning=>inning.num===1),firstFive=innings.filter(inning=>(inning.num??0)<=5);return{id:game.gamePk??0,playedAt:game.gameDate??"",awayId:game.teams?.away?.team?.id??0,homeId:game.teams?.home?.team?.id??0,awayScore:game.teams?.away?.score??0,homeScore:game.teams?.home?.score??0,firstInningAway:first?.away?.runs,firstInningHome:first?.home?.runs,firstFiveAway:innings.length?firstFive.reduce((sum,inning)=>sum+(inning.away?.runs??0),0):undefined,firstFiveHome:innings.length?firstFive.reduce((sum,inning)=>sum+(inning.home?.runs??0),0):undefined}}).filter(game=>game.id>0&&game.awayId>0&&game.homeId>0&&game.playedAt) satisfies HistoricalGame[];}

const EARLIEST_THROUGH="2021-01-01";
const BACKTEST_TTL_SECONDS=7*24*60*60;

export async function GET(request:Request){
  const url=new URL(request.url),yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10),through=url.searchParams.get("through")??yesterday;
  if(!DATE.test(through)||through<EARLIEST_THROUGH||through>yesterday)return Response.json({error:`Invalid through date. Use YYYY-MM-DD between ${EARLIEST_THROUGH} and ${yesterday}.`},{status:400});
  const season=Number(through.slice(0,4)),seasons=[season-2,season-1,season];
  try{
    // The three-season walk-forward is CPU-heavy and depends only on finished
    // games, so it computes once per `through` date and is shared by everyone.
    const compute=async()=>{
      // Prior seasons come from immutable cached artifacts (shared with the
      // projections slate context) so a cold call stays inside free-tier
      // serverless timeouts; only the in-progress season is fetched fresh.
      const [currentResponse,priorTwo,priorOne]=await Promise.all([fetchMlb(endpoint(`${season}-03-15`,through),CURRENT_SEASON_TTL),priorSeasonGames(season-2),priorSeasonGames(season-1)]);
      if(!currentResponse.ok)throw new Error(`MLB responded ${currentResponse.status}`);
      const games=[...priorTwo,...priorOne,...historicalGames(await currentResponse.json() as Feed)],result=walkForwardBacktest(games,10);
      // Per-prediction rows and live models stay server-side; the response
      // carries only the summary metrics the dashboard renders.
      const {predictions:_predictions,teamRates:_teamRates,liveLeagueAverage:_liveLeagueAverage,liveCalibration:_liveCalibration,liveMarketCalibrations:_liveMarketCalibrations,...summary}=result;
      return {season,seasons,through,source:"MLB Stats API",method:{name:"Three-season, date-batched expanding-window walk-forward",minimumPriorGames:10,featureRule:"Every date uses one prior-day snapshot; team and run-environment features reset each season while calibration uses only earlier predictions",marketDataIncluded:false},gamesIngested:games.length,...summary};
    };
    let payload:Record<string,unknown>;
    try{
      const cached=await getOrCompute(getDatabase(),`backtest:${through}`,"backtest",BACKTEST_TTL_SECONDS,compute);
      payload={...cached.value,retrievedAt:cached.computedAt,cached:cached.cached};
    }catch{
      payload={...await compute(),retrievedAt:new Date().toISOString(),cached:false};
    }
    return Response.json(payload,{headers:{"cache-control":"public, max-age=1800, stale-while-revalidate=3600"}});
  }catch(error){return Response.json({error:"Historical validation is temporarily unavailable.",detail:error instanceof Error?error.message:"Unknown source error"},{status:502});}
}
