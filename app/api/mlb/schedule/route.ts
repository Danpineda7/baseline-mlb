
// API routes are always dynamic: they read the database and live MLB feeds
// and must never be baked into the build as static responses.
export const dynamic="force-dynamic";
type MlbTeamSide = {
  score?: number;
  team?: { id?: number; name?: string; abbreviation?: string };
  probablePitcher?: { id?: number; fullName?: string };
};

type MlbGame = {
  gamePk?: number;
  gameDate?: string;
  status?: { abstractGameState?: string; detailedState?: string; statusCode?: string };
  teams?: { away?: MlbTeamSide; home?: MlbTeamSide };
  venue?: { id?: number; name?: string };
  linescore?: { currentInning?: number; inningState?: string };
};

type MlbSchedule = {
  dates?: Array<{ date?: string; games?: MlbGame[] }>;
  totalGames?: number;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeGame(game: MlbGame) {
  const away = game.teams?.away;
  const home = game.teams?.home;
  return {
    id: game.gamePk ?? 0,
    startsAt: game.gameDate ?? null,
    status: game.status?.detailedState ?? "Unknown",
    state: game.status?.abstractGameState ?? "Preview",
    statusCode: game.status?.statusCode ?? null,
    inning: game.linescore?.currentInning ?? null,
    inningState: game.linescore?.inningState ?? null,
    venue: game.venue?.name ?? "Venue TBD",
    away: {
      id: away?.team?.id ?? 0,
      name: away?.team?.name ?? "Away TBD",
      abbreviation: away?.team?.abbreviation ?? "AWY",
      score: away?.score ?? null,
      probablePitcher: away?.probablePitcher?.fullName ?? null,
    },
    home: {
      id: home?.team?.id ?? 0,
      name: home?.team?.name ?? "Home TBD",
      abbreviation: home?.team?.abbreviation ?? "HME",
      score: home?.score ?? null,
      probablePitcher: home?.probablePitcher?.fullName ?? null,
    },
  };
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const date = requestUrl.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  if (!DATE_PATTERN.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return Response.json({ error: "Invalid date. Use YYYY-MM-DD." }, { status: 400 });
  }

  const endpoint = new URL("https://statsapi.mlb.com/api/v1/schedule");
  endpoint.searchParams.set("sportId", "1");
  endpoint.searchParams.set("date", date);
  endpoint.searchParams.set("hydrate", "probablePitcher,team,venue,linescore");

  try {
    const response = await fetch(endpoint, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`MLB responded ${response.status}`);
    const payload = (await response.json()) as MlbSchedule;
    const games = (payload.dates ?? []).flatMap((day) => day.games ?? []).map(normalizeGame).filter((game) => game.id > 0);
    return Response.json({
      date,
      games,
      count: games.length,
      source: "MLB Stats API",
      retrievedAt: new Date().toISOString(),
      validation: {
        responseOk: true,
        expectedCountMatches: payload.totalGames == null || payload.totalGames === games.length,
        uniqueGameIds: new Set(games.map((game) => game.id)).size === games.length,
      },
    }, { headers: { "cache-control": "public, max-age=30, stale-while-revalidate=90" } });
  } catch (error) {
    return Response.json({
      error: "Live MLB data is temporarily unavailable.",
      detail: error instanceof Error ? error.message : "Unknown source error",
      date,
    }, { status: 502 });
  }
}
