import { bullpenFatigueAdjustment, clamp, empiricalParkFactor, fairAmerican, firstInningMarkets, hitterHitProjection, inningsToDecimal, opponentAdjustedStrikeouts, platoonAdjustedHitProjection, projectPeriod, projectScore, starterRunAdjustment, strikeoutExpectation } from "@/lib/modeling";
import { applyProbabilityCalibration, type CalibrationModel } from "@/lib/backtest";
import { projectionUncertainty, slateQualityScore } from "@/lib/data-quality";
import { currentInjuredList, type InjuryTransaction } from "@/lib/availability";
import { persistForecastSnapshots, persistProjectionArchives } from "@/lib/prospective";
import { MODEL_VERSION } from "@/lib/model-version";
import { logSystemEvent } from "@/lib/system-events";
import { computeSlateContext, type SlateContext } from "@/lib/slate-context";
import { getOrCompute } from "@/lib/computed-cache";
import { VALIDATION_EPOCH } from "@/lib/epoch";
import { getDatabase } from "@/lib/db";

// API routes are always dynamic: they read the database and live MLB feeds
// and must never be baked into the build as static responses.
export const dynamic="force-dynamic";

type TeamRecord = {
  team?: { id?: number; name?: string };
  gamesPlayed?: number;
  runsScored?: number;
  runsAllowed?: number;
  wins?: number;
  losses?: number;
  winningPercentage?: string;
};

type StandingsPayload = { records?: Array<{ teamRecords?: TeamRecord[] }> };
type SchedulePayload = {
  dates?: Array<{ games?: Array<{
    gamePk?: number; gameDate?: string;
    status?: { abstractGameState?: string; detailedState?: string };
    venue?: { id?:number; name?: string };
    teams?: {
      away?: { team?: { id?: number; name?: string; abbreviation?: string }; probablePitcher?: { id?:number; fullName?: string } };
      home?: { team?: { id?: number; name?: string; abbreviation?: string }; probablePitcher?: { id?:number; fullName?: string } };
    };
    lineups?:{awayPlayers?:Array<{id?:number;fullName?:string}>;homePlayers?:Array<{id?:number;fullName?:string}>};
  }> }>;
};
type PitchingStat = { era?: string; inningsPitched?: string; gamesStarted?: number; strikeOuts?:number };
type PeoplePayload = { people?: Array<{ id?: number; pitchHand?:{code?:string}; stats?: Array<{ splits?: Array<{ stat?: PitchingStat }> }> }> };
type HittingStat={gamesPlayed?:number;hits?:number;atBats?:number;plateAppearances?:number;avg?:string;ops?:string};
type HitterPayload={people?:Array<{id?:number;fullName?:string;stats?:Array<{splits?:Array<{stat?:HittingStat}>}>}>};
type PlatoonPayload={people?:Array<{id?:number;stats?:Array<{splits?:Array<{split?:{code?:string;description?:string};stat?:HittingStat}>}>}>};
type LiveFeed={gameData?:{weather?:{condition?:string;temp?:string;wind?:string};venue?:{fieldInfo?:{roofType?:string}}}};
type RecentPitchingPayload={stats?:Array<{splits?:Array<{team?:{id?:number};stat?:{numberOfPitches?:number;gamesStarted?:number}}>;totalSplits?:number}>};
type TeamHittingPayload={stats?:Array<{splits?:Array<{team?:{id?:number};stat?:{strikeOuts?:number;plateAppearances?:number}}>;totalSplits?:number}>};
type TransactionsPayload={transactions?:InjuryTransaction[]};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EARLIEST_DATE="2021-01-01";
const SLATE_CONTEXT_TTL_SECONDS=7*24*60*60;

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const latestDate=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
  if (!DATE_PATTERN.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || date<EARLIEST_DATE || date>latestDate) {
    return Response.json({ error: `Invalid date. Use YYYY-MM-DD between ${EARLIEST_DATE} and ${latestDate}.` }, { status: 400 });
  }
  const season = Number(date.slice(0, 4));
  const cutoff=new Date(`${date}T12:00:00Z`);cutoff.setUTCDate(cutoff.getUTCDate()-1);const cutoffDate=cutoff.toISOString().slice(0,10);
  const scheduleUrl = new URL("https://statsapi.mlb.com/api/v1/schedule");
  scheduleUrl.searchParams.set("sportId", "1");
  scheduleUrl.searchParams.set("date", date);
  scheduleUrl.searchParams.set("hydrate", "probablePitcher,team,venue,lineups");
  const standingsUrl = new URL("https://statsapi.mlb.com/api/v1/standings");
  standingsUrl.searchParams.set("leagueId", "103,104");
  standingsUrl.searchParams.set("season", String(season));
  standingsUrl.searchParams.set("date", cutoffDate);
  standingsUrl.searchParams.set("hydrate", "team");
  const workloadStart=new Date(`${cutoffDate}T12:00:00Z`);workloadStart.setUTCDate(workloadStart.getUTCDate()-1);
  const bullpenUrl=new URL("https://statsapi.mlb.com/api/v1/stats");bullpenUrl.searchParams.set("stats","byDateRange");bullpenUrl.searchParams.set("group","pitching");bullpenUrl.searchParams.set("startDate",workloadStart.toISOString().slice(0,10));bullpenUrl.searchParams.set("endDate",cutoffDate);bullpenUrl.searchParams.set("sportIds","1");bullpenUrl.searchParams.set("hydrate","team");bullpenUrl.searchParams.set("limit","1000");
  const teamHittingUrl=new URL("https://statsapi.mlb.com/api/v1/teams/stats");teamHittingUrl.searchParams.set("stats","byDateRange");teamHittingUrl.searchParams.set("group","hitting");teamHittingUrl.searchParams.set("startDate",`${season}-03-15`);teamHittingUrl.searchParams.set("endDate",cutoffDate);teamHittingUrl.searchParams.set("sportIds","1");
  const transactionsUrl=new URL("https://statsapi.mlb.com/api/v1/transactions");transactionsUrl.searchParams.set("startDate",`${season}-01-01`);transactionsUrl.searchParams.set("endDate",cutoffDate);transactionsUrl.searchParams.set("sportId","1");

  try {
    // The three-season walk-forward calibration is the CPU-heavy part of this
    // route; it depends only on finished games through the cutoff date, so it
    // is computed once per date and shared by every visitor.
    const slateContextPromise:Promise<SlateContext>=(async()=>{
      try{
        const cached=await getOrCompute(getDatabase(),`slate-context:${cutoffDate}`,"slate-context",SLATE_CONTEXT_TTL_SECONDS,()=>computeSlateContext(season,cutoffDate));
        return cached.value;
      }catch{
        return computeSlateContext(season,cutoffDate);
      }
    })();
    const [scheduleResponse, standingsResponse, bullpenResponse, teamHittingResponse, transactionsResponse, slateContext] = await Promise.all([
      fetch(scheduleUrl, { headers: { accept: "application/json" } }),
      fetch(standingsUrl, { headers: { accept: "application/json" } }),
      fetch(bullpenUrl,{headers:{accept:"application/json"}}),
      fetch(teamHittingUrl,{headers:{accept:"application/json"}}),
      fetch(transactionsUrl,{headers:{accept:"application/json"}}),
      slateContextPromise,
    ]);
    if (!scheduleResponse.ok || !standingsResponse.ok) throw new Error("One or more MLB feeds did not respond successfully");
    const schedule = await scheduleResponse.json() as SchedulePayload;
    const standings = await standingsResponse.json() as StandingsPayload;
    const bullpenPitches=new Map<number,number[]>();
    if(bullpenResponse.ok){const payload=await bullpenResponse.json() as RecentPitchingPayload;for(const split of payload.stats?.[0]?.splits??[]){const teamId=split.team?.id??0,pitches=split.stat?.numberOfPitches??0;if(!teamId||(split.stat?.gamesStarted??0)>0)continue;bullpenPitches.set(teamId,[...(bullpenPitches.get(teamId)??[]),pitches]);}}
    const teamStrikeouts=new Map<number,{strikeouts:number;plateAppearances:number}>();
    if(teamHittingResponse.ok){const payload=await teamHittingResponse.json() as TeamHittingPayload;for(const split of payload.stats?.[0]?.splits??[]){const teamId=split.team?.id??0,strikeouts=split.stat?.strikeOuts??0,plateAppearances=split.stat?.plateAppearances??0;if(teamId&&plateAppearances>0)teamStrikeouts.set(teamId,{strikeouts,plateAppearances});}}
    const leagueStrikeouts=[...teamStrikeouts.values()].reduce((sum,value)=>sum+value.strikeouts,0),leaguePlateAppearances=[...teamStrikeouts.values()].reduce((sum,value)=>sum+value.plateAppearances,0),leagueStrikeoutRate=leaguePlateAppearances?leagueStrikeouts/leaguePlateAppearances:0.225;
    const injuriesByTeam=new Map<number,ReturnType<typeof currentInjuredList>>();
    if(transactionsResponse.ok){const payload=await transactionsResponse.json() as TransactionsPayload;for(const player of currentInjuredList(payload.transactions??[]))injuriesByTeam.set(player.teamId,[...(injuriesByTeam.get(player.teamId)??[]),player]);}

    const {firstInningShare,firstFiveShare,contextGames}=slateContext;
    const calibrationModel:CalibrationModel|null=slateContext.moneyline.model,calibrationQualified=slateContext.moneyline.qualified,calibrationMethod=slateContext.moneyline.method;
    const marketCalibrationModels={totalOver85:slateContext.totalOver85.model,firstFiveHome:slateContext.firstFiveHome.model,nrfi:slateContext.nrfi.model};
    const marketCalibrationMethods={totalOver85:slateContext.totalOver85.method,firstFiveHome:slateContext.firstFiveHome.method,nrfi:slateContext.nrfi.method};
    const marketCalibrationQualified={totalOver85:slateContext.totalOver85.qualified,firstFiveHome:slateContext.firstFiveHome.qualified,nrfi:slateContext.nrfi.qualified};
    const teamEnvironments=new Map(slateContext.teamEnvironments.map(environment=>[environment.teamId,environment]));
    const teamRates=new Map(slateContext.teamRates.map(rate=>[rate.teamId,rate]));

    const scheduledGames=(schedule.dates ?? []).flatMap((day) => day.games ?? []);
    const gameConditions=new Map<number,{condition:string|null;temperature:number|null;wind:string|null;roof:string|null}>();
    await Promise.all(scheduledGames.map(async game=>{const gameId=game.gamePk??0;if(!gameId)return;try{const response=await fetch(`https://statsapi.mlb.com/api/v1.1/game/${gameId}/feed/live`,{headers:{accept:"application/json"}});if(!response.ok)return;const feed=await response.json() as LiveFeed,temperature=Number(feed.gameData?.weather?.temp);gameConditions.set(gameId,{condition:feed.gameData?.weather?.condition??null,temperature:Number.isFinite(temperature)?temperature:null,wind:feed.gameData?.weather?.wind??null,roof:feed.gameData?.venue?.fieldInfo?.roofType??null});}catch{/* Weather context is optional and never fabricated. */}}));

    // Market total lines observed in the odds vault (post-epoch, canonical
    // totals). Games without an observed line fall back to the 8.5 reference.
    const totalLines=new Map<number,number>();
    try{
      const gameIds=scheduledGames.map(game=>game.gamePk??0).filter(id=>id>0);
      if(gameIds.length){
        const query=await getDatabase().prepare(`SELECT game_id,line FROM market_odds_observations WHERE game_id IN (${gameIds.map(()=>"?").join(",")}) AND line IS NOT NULL AND observed_at >= ? AND json_extract(metadata_json,'$.canonicalMarket')='over' ORDER BY observed_at ASC`).bind(...gameIds,VALIDATION_EPOCH).all<{game_id:number;line:number}>();
        for(const row of query.results??[])if(row.line>=5.5&&row.line<=13.5)totalLines.set(row.game_id,row.line);
      }
    }catch{/* Reference-line totals remain valid without the vault. */}

    const pitcherIds=[...new Set(scheduledGames.flatMap(game=>[game.teams?.away?.probablePitcher?.id,game.teams?.home?.probablePitcher?.id]).filter((id):id is number=>Boolean(id)))];
    const hitterIds=[...new Set(scheduledGames.flatMap(game=>[...(game.lineups?.awayPlayers??[]),...(game.lineups?.homePlayers??[])]).map(player=>player.id).filter((id):id is number=>Boolean(id)))];
    const pitcherStats=new Map<number,{era:number;innings:number;gamesStarted:number;strikeOuts:number;expectedStrikeouts:number|null;hand:string|null}>();
    if(pitcherIds.length){
      const peopleUrl=new URL("https://statsapi.mlb.com/api/v1/people");
      peopleUrl.searchParams.set("personIds",pitcherIds.join(","));
      peopleUrl.searchParams.set("hydrate",`stats(group=[pitching],type=[season],season=${season})`);
      try { const peopleResponse=await fetch(peopleUrl,{headers:{accept:"application/json"}}); if(peopleResponse.ok){const people=await peopleResponse.json() as PeoplePayload; for(const person of people.people??[]){const stat=person.stats?.[0]?.splits?.[0]?.stat;const era=Number(stat?.era),gamesStarted=stat?.gamesStarted??0,strikeOuts=stat?.strikeOuts??0;if(person.id&&Number.isFinite(era))pitcherStats.set(person.id,{era,innings:inningsToDecimal(stat?.inningsPitched),gamesStarted,strikeOuts,expectedStrikeouts:strikeoutExpectation(strikeOuts,gamesStarted),hand:person.pitchHand?.code??null});}} } catch { /* Team-only fallback remains valid and is disclosed. */ }
    }
    const hitterStats=new Map<number,{gamesPlayed:number;hits:number;atBats:number;plateAppearances:number;avg:string;ops:string;projection:ReturnType<typeof hitterHitProjection>}>();
    const platoonStats=new Map<number,Map<string,{hits:number;atBats:number}>>();
    if(hitterIds.length){const hitterUrl=new URL("https://statsapi.mlb.com/api/v1/people"),platoonUrl=new URL("https://statsapi.mlb.com/api/v1/people");hitterUrl.searchParams.set("personIds",hitterIds.join(","));hitterUrl.searchParams.set("hydrate",`stats(group=[hitting],type=[season],season=${season})`);platoonUrl.searchParams.set("personIds",hitterIds.join(","));platoonUrl.searchParams.set("hydrate",`stats(group=[hitting],type=[statSplits],season=${season},sitCodes=[vl,vr])`);try{const [hitterResponse,platoonResponse]=await Promise.all([fetch(hitterUrl,{headers:{accept:"application/json"}}),fetch(platoonUrl,{headers:{accept:"application/json"}})]);if(hitterResponse.ok){const hitters=await hitterResponse.json() as HitterPayload;for(const person of hitters.people??[]){const stat=person.stats?.[0]?.splits?.[0]?.stat;if(!person.id||!stat)continue;const gamesPlayed=stat.gamesPlayed??0,hits=stat.hits??0,atBats=stat.atBats??0,plateAppearances=stat.plateAppearances??0;hitterStats.set(person.id,{gamesPlayed,hits,atBats,plateAppearances,avg:stat.avg??"—",ops:stat.ops??"—",projection:hitterHitProjection(hits,atBats,plateAppearances,gamesPlayed)});}}
      if(platoonResponse.ok){const players=await platoonResponse.json() as PlatoonPayload;for(const person of players.people??[]){if(!person.id)continue;const splits=new Map<string,{hits:number;atBats:number}>();for(const split of person.stats?.[0]?.splits??[]){const code=split.split?.code,atBats=split.stat?.atBats??0;if(code&&atBats>0)splits.set(code,{hits:split.stat?.hits??0,atBats});}if(splits.size)platoonStats.set(person.id,splits);}}}catch{/* Confirmed lineup remains visible without a prop projection. */}}
    const records = (standings.records ?? []).flatMap((record) => record.teamRecords ?? []).filter((record) => (record.gamesPlayed ?? 0) > 0);
    const byTeam = new Map(records.map((record) => [record.team?.id ?? 0, record]));
    const leagueRuns = records.reduce((sum, record) => sum + (record.runsScored ?? 0), 0);
    const leagueGames = records.reduce((sum, record) => sum + (record.gamesPlayed ?? 0), 0);
    const standingsLeagueAverage = leagueGames > 0 ? leagueRuns / leagueGames : 4.5;
    // Modeling uses the walk-forward league rate so live baselines match the
    // estimator the calibration was fitted on; standings stay for W-L display.
    const leagueAverage=slateContext.leagueAverage??standingsLeagueAverage;
    const MINIMUM_RATE_GAMES=10;

    const games = scheduledGames.map((game) => {
      const awayId = game.teams?.away?.team?.id ?? 0;
      const homeId = game.teams?.home?.team?.id ?? 0;
      const away = byTeam.get(awayId);
      const home = byTeam.get(homeId);
      const awayRate=teamRates.get(awayId);
      const homeRate=teamRates.get(homeId);
      const awayOffense = awayRate&&awayRate.games>=MINIMUM_RATE_GAMES ? awayRate.scored/awayRate.games : leagueAverage;
      const awayDefense = awayRate&&awayRate.games>=MINIMUM_RATE_GAMES ? awayRate.allowed/awayRate.games : leagueAverage;
      const homeOffense = homeRate&&homeRate.games>=MINIMUM_RATE_GAMES ? homeRate.scored/homeRate.games : leagueAverage;
      const homeDefense = homeRate&&homeRate.games>=MINIMUM_RATE_GAMES ? homeRate.allowed/homeRate.games : leagueAverage;
      const parkSample=teamEnvironments.get(homeId)??{homeGames:0,homeRuns:0,roadGames:0,roadRuns:0};
      const parkFactor=empiricalParkFactor(parkSample.homeRuns,parkSample.homeGames,parkSample.roadRuns,parkSample.roadGames,leagueAverage*2);
      const conditions=gameConditions.get(game.gamePk??0)??{condition:null,temperature:null,wind:null,roof:null};
      const totalLine=totalLines.get(game.gamePk??0)??8.5;
      // The over/under calibration model was fitted at the 8.5 reference line;
      // it is only applied when this game's market line is also 8.5.
      const totalCalibrationApplies=Math.abs(totalLine-8.5)<1e-9;
      // Multiplicative offense/defense blend, regressed 35% to league average.
      const awayRaw = Math.sqrt(awayOffense * homeDefense);
      const homeRaw = Math.sqrt(homeOffense * awayDefense);
      const awayBaseRuns=clamp(0.65*awayRaw+0.35*leagueAverage-0.08,2.2,7.2),homeBaseRuns=clamp(0.65*homeRaw+0.35*leagueAverage+0.08,2.2,7.2),baseDistribution=projectScore(awayBaseRuns,homeBaseRuns,totalLine);
      const awayStarter=pitcherStats.get(game.teams?.away?.probablePitcher?.id??0);
      const homeStarter=pitcherStats.get(game.teams?.home?.probablePitcher?.id??0);
      const awayOpponent=teamStrikeouts.get(homeId),homeOpponent=teamStrikeouts.get(awayId);
      const awayExpectedStrikeouts=awayOpponent?opponentAdjustedStrikeouts(awayStarter?.expectedStrikeouts??null,awayOpponent.strikeouts,awayOpponent.plateAppearances,leagueStrikeoutRate):awayStarter?.expectedStrikeouts??null;
      const homeExpectedStrikeouts=homeOpponent?opponentAdjustedStrikeouts(homeStarter?.expectedStrikeouts??null,homeOpponent.strikeouts,homeOpponent.plateAppearances,leagueStrikeoutRate):homeStarter?.expectedStrikeouts??null;
      const awayStarterAdjustment=starterRunAdjustment(awayStarter?.era??null,awayStarter?.innings??0);
      const homeStarterAdjustment=starterRunAdjustment(homeStarter?.era??null,homeStarter?.innings??0);
      const awayBullpenPitches=bullpenPitches.get(awayId)??[],homeBullpenPitches=bullpenPitches.get(homeId)??[];
      const awayBullpenAdjustment=bullpenFatigueAdjustment(awayBullpenPitches),homeBullpenAdjustment=bullpenFatigueAdjustment(homeBullpenPitches);
      const awayRunsBeforeBullpen = clamp((0.65 * awayRaw + 0.35 * leagueAverage - 0.08 + homeStarterAdjustment)*parkFactor, 2.2, 7.2);
      const homeRunsBeforeBullpen = clamp((0.65 * homeRaw + 0.35 * leagueAverage + 0.08 + awayStarterAdjustment)*parkFactor, 2.2, 7.2);
      const awayRuns=clamp(awayRunsBeforeBullpen+homeBullpenAdjustment,2.2,7.2),homeRuns=clamp(homeRunsBeforeBullpen+awayBullpenAdjustment,2.2,7.2);
      const rawDistribution = projectScore(awayRuns, homeRuns, totalLine);
      const logit=(probability:number)=>Math.log(clamp(probability,0.001,0.999)/(1-clamp(probability,0.001,0.999))),logistic=(value:number)=>1/(1+Math.exp(-value));
      const calibratedBaseHome=calibrationQualified&&calibrationMethod==="regularized-platt"?applyProbabilityCalibration(baseDistribution.homeWin,calibrationModel):baseDistribution.homeWin;
      const calibratedDelta=(base:number,adjusted:number,model:CalibrationModel|null,qualified:boolean,method:string)=>qualified&&method==="regularized-platt"?clamp(logistic(logit(applyProbabilityCalibration(base,model))+(logit(adjusted)-logit(base))),0.03,0.97):adjusted;
      const homeWin=calibrationQualified?clamp(logistic(logit(calibratedBaseHome)+(logit(rawDistribution.homeWin)-logit(baseDistribution.homeWin))),0.03,0.97):rawDistribution.homeWin,awayWin=1-homeWin;
      const calibratedOver=totalCalibrationApplies?calibratedDelta(baseDistribution.over,rawDistribution.over,marketCalibrationModels.totalOver85,marketCalibrationQualified.totalOver85,marketCalibrationMethods.totalOver85):rawDistribution.over,distribution={...rawDistribution,over:calibratedOver,under:clamp(1-calibratedOver-rawDistribution.push,0,1)};
      const baseFirstFive=projectPeriod(awayBaseRuns*firstFiveShare,homeBaseRuns*firstFiveShare),rawFirstFive=projectPeriod(awayRunsBeforeBullpen*firstFiveShare,homeRunsBeforeBullpen*firstFiveShare),calibratedF5Home=calibratedDelta(baseFirstFive.homeNoPush,rawFirstFive.homeNoPush,marketCalibrationModels.firstFiveHome,marketCalibrationQualified.firstFiveHome,marketCalibrationMethods.firstFiveHome),firstFive={...rawFirstFive,homeNoPush:calibratedF5Home,awayNoPush:1-calibratedF5Home};
      const baseFirstInning=firstInningMarkets(awayBaseRuns,homeBaseRuns,firstInningShare),rawFirstInning=firstInningMarkets(awayRunsBeforeBullpen,homeRunsBeforeBullpen,firstInningShare),calibratedNrfi=calibratedDelta(baseFirstInning.nrfi,rawFirstInning.nrfi,marketCalibrationModels.nrfi,marketCalibrationQualified.nrfi,marketCalibrationMethods.nrfi),firstInning={...rawFirstInning,nrfi:calibratedNrfi,yrfi:1-calibratedNrfi};
      const missingTeams = Number(!away) + Number(!home);
      const lineupsConfirmed=Boolean(game.lineups?.awayPlayers?.length&&game.lineups?.homePlayers?.length);
      const missingStarters=Number(!awayStarter)+Number(!homeStarter);
      const uncertainty = projectionUncertainty({missingTeams,missingStarters,lineupsConfirmed,weatherAvailable:conditions.temperature!=null,bullpenAvailable:bullpenResponse.ok,parkGames:parkSample.homeGames+parkSample.roadGames,parkFactor,historicalSeason:season!==new Date().getUTCFullYear()});
      const awayName = game.teams?.away?.team?.name ?? "Away TBD";
      const homeName = game.teams?.home?.team?.name ?? "Home TBD";
      const lineup=(players:Array<{id?:number;fullName?:string}>,opposingHand:string|null)=>players.slice(0,9).map((player,index)=>{const stats=hitterStats.get(player.id??0),base=stats?.projection,splitCode=opposingHand==="L"?"vl":opposingHand==="R"?"vr":null,split=splitCode?platoonStats.get(player.id??0)?.get(splitCode):null,projection=split?platoonAdjustedHitProjection(base??null,split.hits,split.atBats):base;return{id:player.id??0,name:player.fullName??"Unknown hitter",battingOrder:index+1,confirmed:true,avg:stats?.avg??null,ops:stats?.ops??null,expectedHits:projection?Number(projection.expectedHits.toFixed(3)):null,onePlusHitProbability:projection?Number(projection.onePlusProbability.toFixed(4)):null,fairPrice:projection?fairAmerican(projection.onePlusProbability):null,opposingHand,platoonAtBats:split?.atBats??null,platoonAdjusted:Boolean(split&&base)};});
      const awayLineup=lineup(game.lineups?.awayPlayers??[],homeStarter?.hand??null),homeLineup=lineup(game.lineups?.homePlayers??[],awayStarter?.hand??null);
      return {
        id: game.gamePk ?? 0,
        startsAt: game.gameDate ?? null,
        status: game.status?.detailedState ?? "Unknown",
        state: game.status?.abstractGameState ?? "Preview",
        venue: game.venue?.name ?? "Venue TBD",
        park:{factor:Number(parkFactor.toFixed(3)),priorGames:parkSample.homeGames+parkSample.roadGames,homeGames:parkSample.homeGames,roadGames:parkSample.roadGames,sourceCutoff:cutoffDate},
        weather:conditions,
        records:{away:{wins:away?.wins??0,losses:away?.losses??0,pct:away?.winningPercentage??null},home:{wins:home?.wins??0,losses:home?.losses??0,pct:home?.winningPercentage??null}},
        away: { id: awayId, name: awayName, abbreviation: game.teams?.away?.team?.abbreviation ?? "AWY", probablePitcher: game.teams?.away?.probablePitcher?.fullName ?? null, starter:awayStarter?{playerId:game.teams?.away?.probablePitcher?.id??null,era:awayStarter.era,innings:Number(awayStarter.innings.toFixed(1)),gamesStarted:awayStarter.gamesStarted,runAdjustment:Number(awayStarterAdjustment.toFixed(2)),strikeOuts:awayStarter.strikeOuts,expectedStrikeouts:awayExpectedStrikeouts==null?null:Number(awayExpectedStrikeouts.toFixed(2))}:null,injuries:[...(injuriesByTeam.get(awayId)??[])].sort((a,b)=>b.since.localeCompare(a.since)),opponentStrikeoutRate:awayOpponent?Number((awayOpponent.strikeouts/awayOpponent.plateAppearances).toFixed(4)):null,bullpen:{recentPitches:awayBullpenPitches.reduce((sum,value)=>sum+value,0),taxedRelievers:awayBullpenPitches.filter(value=>value>=30).length,runAdjustment:Number(awayBullpenAdjustment.toFixed(3)),sourceWindow:`${workloadStart.toISOString().slice(0,10)} to ${cutoffDate}`}, expectedRuns: Number(awayRuns.toFixed(2)), winProbability: Number(awayWin.toFixed(4)), fairPrice: fairAmerican(awayWin) },
        home: { id: homeId, name: homeName, abbreviation: game.teams?.home?.team?.abbreviation ?? "HME", probablePitcher: game.teams?.home?.probablePitcher?.fullName ?? null, starter:homeStarter?{playerId:game.teams?.home?.probablePitcher?.id??null,era:homeStarter.era,innings:Number(homeStarter.innings.toFixed(1)),gamesStarted:homeStarter.gamesStarted,runAdjustment:Number(homeStarterAdjustment.toFixed(2)),strikeOuts:homeStarter.strikeOuts,expectedStrikeouts:homeExpectedStrikeouts==null?null:Number(homeExpectedStrikeouts.toFixed(2))}:null,injuries:[...(injuriesByTeam.get(homeId)??[])].sort((a,b)=>b.since.localeCompare(a.since)),opponentStrikeoutRate:homeOpponent?Number((homeOpponent.strikeouts/homeOpponent.plateAppearances).toFixed(4)):null,bullpen:{recentPitches:homeBullpenPitches.reduce((sum,value)=>sum+value,0),taxedRelievers:homeBullpenPitches.filter(value=>value>=30).length,runAdjustment:Number(homeBullpenAdjustment.toFixed(3)),sourceWindow:`${workloadStart.toISOString().slice(0,10)} to ${cutoffDate}`}, expectedRuns: Number(homeRuns.toFixed(2)), winProbability: Number(homeWin.toFixed(4)), fairPrice: fairAmerican(homeWin) },
        total: { line: totalLine, lineSource: totalLines.has(game.gamePk??0)?"market":"reference", expectedRuns: Number((awayRuns + homeRuns).toFixed(2)), overProbability: Number(distribution.over.toFixed(4)), underProbability: Number(distribution.under.toFixed(4)), pushProbability: Number(rawDistribution.push.toFixed(4)), overFairPrice: fairAmerican(distribution.over), underFairPrice: fairAmerican(distribution.under) },
        firstFive:{expectedRuns:Number(((awayRuns+homeRuns)*firstFiveShare).toFixed(2)),awayWinProbability:Number(firstFive.awayNoPush.toFixed(4)),homeWinProbability:Number(firstFive.homeNoPush.toFixed(4)),pushProbability:Number(firstFive.tie.toFixed(4)),awayFairPrice:fairAmerican(firstFive.awayNoPush),homeFairPrice:fairAmerican(firstFive.homeNoPush)},
        firstInning:{expectedRuns:Number(firstInning.expectedRuns.toFixed(2)),nrfiProbability:Number(firstInning.nrfi.toFixed(4)),yrfiProbability:Number(firstInning.yrfi.toFixed(4)),nrfiFairPrice:fairAmerican(firstInning.nrfi),yrfiFairPrice:fairAmerican(firstInning.yrfi)},
        lineups:{away:awayLineup,home:homeLineup,confirmed:lineupsConfirmed},
        quality:{teamRecords:Boolean(away&&home),starterStats:missingStarters===0,awayStarter:Boolean(awayStarter),homeStarter:Boolean(homeStarter),bullpen:Boolean(bullpenResponse.ok),opponentStrikeouts:Boolean(awayOpponent&&homeOpponent),rosterAvailability:transactionsResponse.ok,platoon:Boolean([...awayLineup,...homeLineup].length&&[...awayLineup,...homeLineup].every(hitter=>hitter.platoonAdjusted)),lineups:lineupsConfirmed,weather:conditions.temperature!=null,parkSample:parkSample.homeGames>=20&&parkSample.roadGames>=20,validatedMarkets:{moneyline:false,total:false,firstFive:false,firstInning:false,pitcherStrikeouts:false,hitterHits:false},blockingReasons:["Complete live feature stack has not passed end-to-end prospective validation",!away||!home?"Team season record missing":null,missingStarters?"One or more probable-starter stat lines missing":null].filter((reason):reason is string=>Boolean(reason))},
        uncertainty,
        recommendation: { status: "NO_BET", reason: "A verified sportsbook price is required to calculate edge." },
        drivers: [
          `${awayName}: ${awayOffense.toFixed(2)} runs scored per game (walk-forward rate through ${cutoffDate})`,
          `${homeName}: ${homeOffense.toFixed(2)} runs scored per game (walk-forward rate through ${cutoffDate})`,
          `League environment: ${leagueAverage.toFixed(2)} runs per team-game`,
          awayStarter&&homeStarter?`Starter adjustment: ${game.teams?.away?.probablePitcher?.fullName} ${awayStarter.era.toFixed(2)} ERA · ${game.teams?.home?.probablePitcher?.fullName} ${homeStarter.era.toFixed(2)} ERA`:`Starter statistics unavailable or probable starter pending`,
          awayOpponent&&homeOpponent?`Opponent K tendency through ${cutoffDate}: ${homeName} ${((awayOpponent.strikeouts/awayOpponent.plateAppearances)*100).toFixed(1)}% K/PA vs ${game.teams?.away?.probablePitcher?.fullName??"away starter"} · ${awayName} ${((homeOpponent.strikeouts/homeOpponent.plateAppearances)*100).toFixed(1)}% vs ${game.teams?.home?.probablePitcher?.fullName??"home starter"} · league ${((leagueStrikeoutRate)*100).toFixed(1)}%`:"Opponent strikeout tendency unavailable; pitcher K projection remains pitcher-only",
          [...awayLineup,...homeLineup].some(hitter=>hitter.platoonAdjusted)?`Hitter platoon context: ${[...awayLineup,...homeLineup].filter(hitter=>hitter.platoonAdjusted).length}/${[...awayLineup,...homeLineup].length} confirmed hitters adjusted for the opposing starter’s throwing hand, with split samples regressed and capped`:"Confirmed handedness splits unavailable; hitter projections remain season-regressed",
          transactionsResponse.ok?`Roster availability through ${cutoffDate}: ${awayName} ${injuriesByTeam.get(awayId)?.length??0} players on an MLB injured list · ${homeName} ${injuriesByTeam.get(homeId)?.length??0}; displayed as context only, with no unsupported player-value adjustment`:"Official roster-availability context unavailable; no injury assumptions applied",
          bullpenResponse.ok?`Bullpen workload (${workloadStart.toISOString().slice(0,10)}–${cutoffDate}): ${awayName} ${awayBullpenPitches.reduce((sum,value)=>sum+value,0)} relief pitches / ${awayBullpenPitches.filter(value=>value>=30).length} taxed arms · ${homeName} ${homeBullpenPitches.reduce((sum,value)=>sum+value,0)} / ${homeBullpenPitches.filter(value=>value>=30).length}`:"Recent bullpen workload unavailable; no fatigue adjustment applied",
          `Park factor: ${parkFactor.toFixed(3)} from the home club’s ${parkSample.homeGames} home vs ${parkSample.roadGames} road run environments, each regressed with 60 league-average games`,
          conditions.temperature!=null?`Official game weather: ${conditions.temperature}°F · ${conditions.condition??"condition unavailable"} · ${conditions.wind??"wind unavailable"}${conditions.roof?` · ${conditions.roof} roof`:""} (display only)`:"Official game weather not yet posted; no weather adjustment applied",
          totalLines.has(game.gamePk??0)?`Total priced at the observed market line ${totalLine}`:`No market total observed yet; probabilities use the 8.5 reference line`,
          calibrationQualified?`Team baseline verified with leakage-safe calibration tests; ${calibrationMethod==="identity"?"identity mapping retained":"regularized Platt mapping selected"}`:`Calibration pending because the historical verification threshold was not met`,
        ],
      };
    }).filter((game) => game.id > 0);
    // Persistence failures are surfaced, never swallowed: a freeze that did not
    // happen must be visible instead of silently missing from the record.
    let persistence:{ok:boolean;forecasts:number;archives:number;error:string|null};
    try{
      const [forecastCount,archiveCount]=await Promise.all([persistForecastSnapshots(games,date,MODEL_VERSION),persistProjectionArchives(games,date,MODEL_VERSION)]);
      persistence={ok:true,forecasts:forecastCount,archives:archiveCount,error:null};
    }catch(error){
      const detail=error instanceof Error?error.message:"Unknown persistence error";
      persistence={ok:false,forecasts:0,archives:0,error:detail};
      await logSystemEvent("forecast-persist-failure","critical",{date,detail});
    }

    const currentTeamIds=[...new Set(scheduledGames.flatMap(game=>[game.teams?.away?.team?.id,game.teams?.home?.team?.id]).filter((id):id is number=>Boolean(id)))];
    const coverage={
      teams:{available:currentTeamIds.filter(id=>byTeam.has(id)).length,expected:currentTeamIds.length},
      starters:{available:games.reduce((sum,game)=>sum+Number(game.quality.awayStarter)+Number(game.quality.homeStarter),0),expected:games.length*2},
      lineups:{available:games.filter(game=>game.lineups.confirmed).length,expected:games.length},
      hitters:{available:games.flatMap(game=>[...game.lineups.away,...game.lineups.home]).filter(hitter=>hitter.onePlusHitProbability!=null).length,expected:games.length*18},
      weather:{available:games.filter(game=>game.weather.temperature!=null).length,expected:games.length},
      parks:{available:games.filter(game=>game.quality.parkSample).length,expected:games.length},
      bullpens:{available:bullpenResponse.ok?currentTeamIds.length:0,expected:currentTeamIds.length},
      opponentStrikeouts:{available:currentTeamIds.filter(id=>teamStrikeouts.has(id)).length,expected:currentTeamIds.length},
      platoonSplits:{available:games.flatMap(game=>[...game.lineups.away,...game.lineups.home]).filter(hitter=>hitter.platoonAdjusted).length,expected:games.length*18},
      rosterStatuses:{available:transactionsResponse.ok?currentTeamIds.length:0,expected:currentTeamIds.length},
    };
    const dataHealth={score:slateQualityScore({...coverage,calibrated:false}),coverage,featureCutoff:cutoffDate,historicalFinals:slateContext.historicalFinals,calibrated:false,retrievedAt:new Date().toISOString()};

    return Response.json({
      date, season, games, count: games.length, retrievedAt: dataHealth.retrievedAt,dataHealth,persistence,
      model: { name: `Multi-market Research Model (${MODEL_VERSION})`, calibrated:false, calibrationScope:"Historical checks cover the simpler team-run baseline only. The complete live stack—starters, bullpen, park, weather and lineup adjustments—is not yet prospectively qualified.",calibrationMethod,calibrationPoints:calibrationModel?.count??0,marketCalibration:{totalOver85:{qualified:false,method:marketCalibrationMethods.totalOver85},firstFiveHome:{qualified:false,method:marketCalibrationMethods.firstFiveHome},nrfi:{qualified:false,method:marketCalibrationMethods.nrfi}},featureCutoff:cutoffDate, inputs: ["walk-forward season run rates through prior day (same estimator the calibration is fitted on)", "confirmed batting orders", "official injured-list transaction state through the prior day (context only)", "batter vs left/right hit splits regressed to season rate and capped", "hitter hit rate regressed by at-bats (binomial 1+ hit)", "probable-starter ERA regressed by innings", "starter strikeouts per start regressed by starts (binomial over batters faced)", "opponent team strikeouts per plate appearance through the prior day, regressed and capped", "official two-day relief-pitch workload with conservative fatigue adjustment", "empirical first-inning and first-five run shares", "home-field adjustment", "prior-day home-versus-road run-environment park factor, with 60 league-average games of regression per side", "observed market total line when the odds vault has one (8.5 reference otherwise)", "Poisson distributions", "baseline-only calibration"], omissions: ["end-to-end live-feature validation", "pitch-level repertoire and individual matchup history", "calibrated weather effects", "market odds"],inningContext:{games:contextGames,firstInningShare:Number(firstInningShare.toFixed(4)),firstFiveShare:Number(firstFiveShare.toFixed(4))} },
      source: "MLB Stats API",
    }, { headers: { "cache-control": "public, max-age=60, stale-while-revalidate=180" } });
  } catch (error) {
    return Response.json({ error: "Experimental projections are temporarily unavailable.", detail: error instanceof Error ? error.message : "Unknown source error", date }, { status: 502 });
  }
}
