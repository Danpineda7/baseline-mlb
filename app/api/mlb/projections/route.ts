import { clamp, fairAmerican, projectScore } from "@/lib/modeling";

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
      away?: { team?: { id?: number; name?: string; abbreviation?: string }; probablePitcher?: { fullName?: string } };
      home?: { team?: { id?: number; name?: string; abbreviation?: string }; probablePitcher?: { fullName?: string } };
    };
  }> }>;
};

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

  try {
    const [scheduleResponse, standingsResponse] = await Promise.all([
      fetch(scheduleUrl, { headers: { accept: "application/json" } }),
      fetch(standingsUrl, { headers: { accept: "application/json" } }),
    ]);
    if (!scheduleResponse.ok || !standingsResponse.ok) throw new Error("One or more MLB feeds did not respond successfully");
    const schedule = await scheduleResponse.json() as SchedulePayload;
    const standings = await standingsResponse.json() as StandingsPayload;
    const records = (standings.records ?? []).flatMap((record) => record.teamRecords ?? []).filter((record) => (record.gamesPlayed ?? 0) > 0);
    const byTeam = new Map(records.map((record) => [record.team?.id ?? 0, record]));
    const leagueRuns = records.reduce((sum, record) => sum + (record.runsScored ?? 0), 0);
    const leagueGames = records.reduce((sum, record) => sum + (record.gamesPlayed ?? 0), 0);
    const leagueAverage = leagueGames > 0 ? leagueRuns / leagueGames : 4.5;

    const games = (schedule.dates ?? []).flatMap((day) => day.games ?? []).map((game) => {
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
      const awayRuns = clamp(0.65 * awayRaw + 0.35 * leagueAverage - 0.08, 2.2, 7.2);
      const homeRuns = clamp(0.65 * homeRaw + 0.35 * leagueAverage + 0.08, 2.2, 7.2);
      const distribution = projectScore(awayRuns, homeRuns);
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
        away: { id: awayId, name: awayName, abbreviation: game.teams?.away?.team?.abbreviation ?? "AWY", probablePitcher: game.teams?.away?.probablePitcher?.fullName ?? null, expectedRuns: Number(awayRuns.toFixed(2)), winProbability: Number(distribution.awayWin.toFixed(4)), fairPrice: fairAmerican(distribution.awayWin) },
        home: { id: homeId, name: homeName, abbreviation: game.teams?.home?.team?.abbreviation ?? "HME", probablePitcher: game.teams?.home?.probablePitcher?.fullName ?? null, expectedRuns: Number(homeRuns.toFixed(2)), winProbability: Number(distribution.homeWin.toFixed(4)), fairPrice: fairAmerican(distribution.homeWin) },
        total: { line: 8.5, expectedRuns: Number((awayRuns + homeRuns).toFixed(2)), overProbability: Number(distribution.over.toFixed(4)), underProbability: Number(distribution.under.toFixed(4)), overFairPrice: fairAmerican(distribution.over), underFairPrice: fairAmerican(distribution.under) },
        uncertainty,
        recommendation: { status: "NO_BET", reason: "A verified sportsbook price is required to calculate edge." },
        drivers: [
          `${awayName}: ${awayOffense.toFixed(2)} runs scored per game`,
          `${homeName}: ${homeOffense.toFixed(2)} runs scored per game`,
          `League environment: ${leagueAverage.toFixed(2)} runs per team-game`,
        ],
      };
    }).filter((game) => game.id > 0);

    return Response.json({
      date, season, games, count: games.length, retrievedAt: new Date().toISOString(),
      model: { name: "Team Run Baseline v0.1", calibrated: false, inputs: ["season runs scored", "season runs allowed", "home-field adjustment", "Poisson score distribution"], omissions: ["confirmed lineups", "starter quality", "bullpen availability", "weather", "park factors", "market odds"] },
      source: "MLB Stats API",
    }, { headers: { "cache-control": "public, max-age=60, stale-while-revalidate=180" } });
  } catch (error) {
    return Response.json({ error: "Experimental projections are temporarily unavailable.", detail: error instanceof Error ? error.message : "Unknown source error", date }, { status: 502 });
  }
}
