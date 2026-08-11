// Scheduled automation (free on all Netlify plans). Every 20 minutes it:
//  1. loads today's projections — which freezes forecasts whenever games are
//     inside the 6-hour pre-pitch window (cheap after the first run of the day
//     thanks to the slate-context cache);
//  2. settles finished games against official MLB finals;
//  3. once per hour in the afternoon/evening window, imports one fixture's
//     historical odds from OddsPapi (gentle on the free-tier rate limits).
// Without this function the app still works — it just needs a daily visitor.

export default async () => {
  const base = process.env.URL;
  if (!base) return Response.json({ error: "Netlify URL env var missing" }, { status: 500 });
  const now = new Date();
  // MLB slates are US Eastern days; en-CA gives YYYY-MM-DD.
  const slateDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
  const results: Record<string, unknown> = { slateDate, ranAt: now.toISOString() };

  try {
    const response = await fetch(`${base}/api/mlb/projections?date=${slateDate}`, { headers: { accept: "application/json" } });
    const payload = (await response.json()) as { count?: number; persistence?: unknown };
    results.projections = { status: response.status, count: payload.count ?? 0, persistence: payload.persistence ?? null };
  } catch (error) {
    results.projections = { error: String(error) };
  }

  try {
    const response = await fetch(`${base}/api/mlb/forecast-performance`, { headers: { accept: "application/json" } });
    const payload = (await response.json()) as { settledNow?: number };
    results.settlement = { status: response.status, settledNow: payload.settledNow ?? 0 };
  } catch (error) {
    results.settlement = { error: String(error) };
  }

  const hourUtc = now.getUTCHours();
  const inImportWindow = hourUtc >= 16 || hourUtc < 2; // ~noon to 10pm US Eastern
  const firstSlotOfHour = now.getUTCMinutes() < 20; // one import run per hour
  if (process.env.ADMIN_KEY && process.env.ODDS_PAPI_KEY && inImportWindow && firstSlotOfHour) {
    try {
      const response = await fetch(`${base}/api/odds-papi`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-key": process.env.ADMIN_KEY },
        body: JSON.stringify({ date: slateDate, limit: 1 }),
      });
      results.oddsImport = { status: response.status, ...((await response.json()) as Record<string, unknown>) };
    } catch (error) {
      results.oddsImport = { error: String(error) };
    }
  } else {
    results.oddsImport = "skipped (outside window, already this hour, or keys missing)";
  }

  console.log(JSON.stringify(results));
  return Response.json(results);
};

export const config = { schedule: "*/20 * * * *" };
