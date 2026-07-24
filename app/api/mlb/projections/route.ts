import { clamp, fairAmerican, firstInningMarkets, inningsToDecimal, projectPeriod, projectScore, starterRunAdjustment, strikeoutExpectation } from "@/lib/modeling";

type TeamRecord = {
  team?: { id?: number; name?: string };
  gamesPlayed?: number;
  runsScored?: number;
  runsAllowed?: number;
};

type StandingsPayload = { records?: Array<{ teamRecords?: TeamRecord[] }> };
type SchedulePayload = {
  dates?: Array<{ games?: Array<{
    gamePk?: number; gameDate?: string;
    status?: { abstractGameState?: string; detailedState?: string };
    venue?: { name?: string };
    teams?: {
      away?: { team?: { id?: number; name?: string; abbreviation?: string }; probablePitcher?: { id?:number; fullName?: string } };
      home?: { team?: { id?: number; name?: string; abbreviation?: string }; probablePitcher?: { id?:number; fullName?: string } };
    };
  }> }>;
};
type PitchingStat = { era?: string; inningsPitched?: string; gamesStarted?: number; strikeOuts?:number };
type PeoplePayload = { people?: Array<{ id?: number; stats?: Array<{ splits?: Array<{ stat?: PitchingStat }> }> }> };
type ContextPayload={dates?:Array<{games?:Array<{status?:{abstractGameState?:string};teams?:{away?:{score?:number};home?:{score?:number}};linescore?:{innings?:Array<{num?:number;away?:{runs?:number};home?:{runs?:number}}>} }>}>};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  if (!DATE_PATTERN.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return Response.json({ error: "Invalid date. Use YYYY-MM-DD." }, { status: 400 });
  }
  const season = Number(date.slice(0, 4));
  const scheduleUrl = new URL("https://statsapi.mlb.com/api/v1/schedule");
  scheduleUrl.searchParams.set("sportId", "1");
  scheduleUrl.searchParams.set("date", date);
  scheduleUrl.searchParams.set("hydrate", "probablePitcher,team,venue");
  const standingsUrl = new URL("https://statsapi.mlb.com/api/v1/standings");
  standingsUrl.searchParams.set("leagueId", "103,104");
  standingsUrl.searchParams.set("season", String(season));
  standingsUrl.searchParams.set("date", date);
  standingsUrl.searchParams.set("hydrate", "team");
  const contextUrl=new URL("https://statsapi.mlb.com/api/v1/schedule");
  contextUrl.searchParams.set("sportId","1"); contextUrl.searchParams.set("startDate",`${season}-03-15`); contextUrl.searchParams.set("endDate",date); contextUrl.searchParams.set("gameType","R"); contextUrl.searchParams.set("hydrate","linescore");

  try {
    const [scheduleResponse, standingsResponse, contextResponse] = await Promise.all([
      fetch(scheduleUrl, { headers: { accept: "application/json" } }),
      fetch(standingsUrl, { headers: { accept: "application/json" } }),
      fetch(contextUrl,{headers:{accept:"application/json"}}),
    ]);
    if (!scheduleResponse.ok || !standingsResponse.ok) throw new Error("One or more MLB feeds did not respond successfully");
    const schedule = await scheduleResponse.json() as SchedulePayload;
    const standings = await standingsResponse.json() as StandingsPayload;
    let firstInningShare=0.115,firstFiveShare=0.56,contextGames=0;
    if(contextResponse.ok){const context=await contextResponse.json() as ContextPayload;let allRuns=0,firstRuns=0,firstFiveRuns=0;for(const game of (context.dates??[]).flatMap(day=>day.games??[])){if(game.status?.abstractGameState!=="Final")continue;const innings=game.linescore?.innings??[];const total=(game.teams?.away?.score??0)+(game.teams?.home?.score??0);if(!innings.length||total<=0)continue;allRuns+=total;firstRuns+=(innings[0]?.away?.runs??0)+(innings[0]?.home?.runs??0);firstFiveRuns+=innings.filter(inning=>(inning.num??0)<=5).reduce((sum,inning)=>sum+(inning.away?.runs??0)+(inning.home?.runs??0),0);contextGames+=1;}if(allRuns>0){firstInningShare=clamp(firstRuns/allRuns,0.08,0.16);firstFiveShare=clamp(firstFiveRuns/allRuns,0.45,0.68);}}
    const scheduledGames=(schedule.dates ?? []).flatMap((day) => day.games ?? []);
    const pitcherIds=[...new Set(scheduledGames.flatMap(game=>[game.teams?.away?.probablePitcher?.id,game.teams?.home?.probablePitcher?.id]).filter((id):id is number=>Boolean(id)))];
    const pitcherStats=new Map<number,{era:number;innings:number;gamesStarted:number;strikeOuts:number;expectedStrikeouts:number|null}>();
    if(pitcherIds.length){
      const peopleUrl=new URL("https://statsapi.mlb.com/api/v1/people");
      peopleUrl.searchParams.set("personIds",pitcherIds.join(","));
      peopleUrl.searchParams.set("hydrate",`stats(group=[pitching],type=[season],season=${season})`);
      try { const peopleResponse=await fetch(peopleUrl,{headers:{accept:"application/json"}}); if(peopleResponse.ok){const people=await peopleResponse.json() as PeoplePayload; for(const person of people.people??[]){const stat=person.stats?.[0]?.splits?.[0]?.stat;const era=Number(stat?.era),gamesStarted=stat?.gamesStarted??0,strikeOuts=stat?.strikeOuts??0;if(person.id&&Number.isFinite(era))pitcherStats.set(person.id,{era,innings:inningsToDecimal(stat?.inningsPitched),gamesStarted,strikeOuts,expectedStrikeouts:strikeoutExpectation(strikeOuts,gamesStarted)});}} } catch { /* Team-only fallback remains valid and is disclosed. */ }
    }
    const records = (standings.records ?? []).flatMap((record) => record.teamRecords ?? []).filter((record) => (record.gamesPlayed ?? 0) > 0);
    const byTeam = new Map(records.map((record) => [record.team?.id ?? 0, record]));
    const leagueRuns = records.reduce((sum, record) => sum + (record.runsScored ?? 0), 0);
    const leagueGames = records.reduce((sum, record) => sum + (record.gamesPlayed ?? 0), 0);
    const leagueAverage = leagueGames > 0 ? leagueRuns / leagueGames : 4.5;

    const games = scheduledGames.map((game) => {
      const awayId = game.teams?.away?.team?.id ?? 0;
      const homeId = game.teams?.home?.team?.id ?? 0;
      const away = byTeam.get(awayId);
      const home = byTeam.get(homeId);
      const awayGames = away?.gamesPlayed ?? 0;
      const homeGames = home?.gamesPlayed ?? 0;
      const awayOffense = awayGames ? (away?.runsScored ?? 0) / awayGames : leagueAverage;
      const awayDefense = awayGames ? (away?.runsAllowed ?? 0) / awayGames : leagueAverage;
      const homeOffense = homeGames ? (home?.runsScored ?? 0) / homeGames : leagueAverage;
      const homeDefense = homeGames ? (home?.runsAllowed ?? 0) / homeGames : leagueAverage;
      // Multiplicative offense/defense blend, regressed 35% to league average.
      const awayRaw = Math.sqrt(awayOffense * homeDefense);
      const homeRaw = Math.sqrt(homeOffense * awayDefense);
      const awayStarter=pitcherStats.get(game.teams?.away?.probablePitcher?.id??0);
      const homeStarter=pitcherStats.get(game.teams?.home?.probablePitcher?.id??0);
      const awayStarterAdjustment=starterRunAdjustment(awayStarter?.era??null,awayStarter?.innings??0);
      const homeStarterAdjustment=starterRunAdjustment(homeStarter?.era??null,homeStarter?.innings??0);
      const awayRuns = clamp(0.65 * awayRaw + 0.35 * leagueAverage - 0.08 + homeStarterAdjustment, 2.2, 7.2);
      const homeRuns = clamp(0.65 * homeRaw + 0.35 * leagueAverage + 0.08 + awayStarterAdjustment, 2.2, 7.2);
      const distribution = projectScore(awayRuns, homeRuns);
      const firstFive=projectPeriod(awayRuns*firstFiveShare,homeRuns*firstFiveShare);
      const firstInning=firstInningMarkets(awayRuns,homeRuns,firstInningShare);
      const missingTeams = Number(!away) + Number(!home);
      const uncertainty = clamp(42 + missingTeams * 25 + (season === new Date().getUTCFullYear() ? 0 : 8), 35, 95);
      const awayName = game.teams?.away?.team?.name ?? "Away TBD";
      const homeName = game.teams?.home?.team?.name ?? "Home TBD";
      return {
        id: game.gamePk ?? 0,
        startsAt: game.gameDate ?? null,
        status: game.status?.detailedState ?? "Unknown",
        state: game.status?.abstractGameState ?? "Preview",
        venue: game.venue?.name ?? "Venue TBD",
        away: { id: awayId, name: awayName, abbreviation: game.teams?.away?.team?.abbreviation ?? "AWY", probablePitcher: game.teams?.away?.probablePitcher?.fullName ?? null, starter:awayStarter?{era:awayStarter.era,innings:Number(awayStarter.innings.toFixed(1)),gamesStarted:awayStarter.gamesStarted,runAdjustment:Number(awayStarterAdjustment.toFixed(2)),strikeOuts:awayStarter.strikeOuts,expectedStrikeouts:awayStarter.expectedStrikeouts==null?null:Number(awayStarter.expectedStrikeouts.toFixed(2))}:null, expectedRuns: Number(awayRuns.toFixed(2)), winProbability: Number(distribution.awayWin.toFixed(4)), fairPrice: fairAmerican(distribution.awayWin) },
        home: { id: homeId, name: homeName, abbreviation: game.teams?.home?.team?.abbreviation ?? "HME", probablePitcher: game.teams?.home?.probablePitcher?.fullName ?? null, starter:homeStarter?{era:homeStarter.era,innings:Number(homeStarter.innings.toFixed(1)),gamesStarted:homeStarter.gamesStarted,runAdjustment:Number(homeStarterAdjustment.toFixed(2)),strikeOuts:homeStarter.strikeOuts,expectedStrikeouts:homeStarter.expectedStrikeouts==null?null:Number(homeStarter.expectedStrikeouts.toFixed(2))}:null, expectedRuns: Number(homeRuns.toFixed(2)), winProbability: Number(distribution.homeWin.toFixed(4)), fairPrice: fairAmerican(distribution.homeWin) },
        total: { line: 8.5, expectedRuns: Number((awayRuns + homeRuns).toFixed(2)), overProbability: Number(distribution.over.toFixed(4)), underProbability: Number(distribution.under.toFixed(4)), overFairPrice: fairAmerican(distribution.over), underFairPrice: fairAmerican(distribution.under) },
        firstFive:{expectedRuns:Number(((awayRuns+homeRuns)*firstFiveShare).toFixed(2)),awayWinProbability:Number(firstFive.awayNoPush.toFixed(4)),homeWinProbability:Number(firstFive.homeNoPush.toFixed(4)),pushProbability:Number(firstFive.tie.toFixed(4)),awayFairPrice:fairAmerican(firstFive.awayNoPush),homeFairPrice:fairAmerican(firstFive.homeNoPush)},
        firstInning:{expectedRuns:Number(firstInning.expectedRuns.toFixed(2)),nrfiProbability:Number(firstInning.nrfi.toFixed(4)),yrfiProbability:Number(firstInning.yrfi.toFixed(4)),nrfiFairPrice:fairAmerican(firstInning.nrfi),yrfiFairPrice:fairAmerican(firstInning.yrfi)},
        uncertainty,
        recommendation: { status: "NO_BET", reason: "A verified sportsbook price is required to calculate edge." },
        drivers: [
          `${awayName}: ${awayOffense.toFixed(2)} runs scored per game`,
          `${homeName}: ${homeOffense.toFixed(2)} runs scored per game`,
          `League environment: ${leagueAverage.toFixed(2)} runs per team-game`,
          awayStarter&&homeStarter?`Starter adjustment: ${game.teams?.away?.probablePitcher?.fullName} ${awayStarter.era.toFixed(2)} ERA · ${game.teams?.home?.probablePitcher?.fullName} ${homeStarter.era.toFixed(2)} ERA`:`Starter statistics unavailable or probable starter pending`,
        ],
      };
    }).filter((game) => game.id > 0);

    return Response.json({
      date, season, games, count: games.length, retrievedAt: new Date().toISOString(),
      model: { name: "Multi-market Baseline v0.4", calibrated: false, inputs: ["season runs scored", "season runs allowed", "probable-starter ERA regressed by innings", "starter strikeouts per start regressed by starts", "empirical first-inning and first-five run shares", "home-field adjustment", "Poisson distributions"], omissions: ["confirmed lineups", "opponent strikeout tendency", "bullpen availability", "weather", "park factors", "market odds"],inningContext:{games:contextGames,firstInningShare:Number(firstInningShare.toFixed(4)),firstFiveShare:Number(firstFiveShare.toFixed(4))} },
      source: "MLB Stats API",
    }, { headers: { "cache-control": "public, max-age=60, stale-while-revalidate=180" } });
  } catch (error) {
    return Response.json({ error: "Experimental projections are temporarily unavailable.", detail: error instanceof Error ? error.message : "Unknown source error", date }, { status: 502 });
  }
}
