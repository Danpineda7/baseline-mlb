export type Market = "Moneyline" | "Total" | "First 5" | "Player prop";

export const games = [
  { id: "nyy-bos", away: "New York Yankees", home: "Boston Red Sox", time: "7:10 PM ET" },
  { id: "phi-wsh", away: "Philadelphia Phillies", home: "Washington Nationals", time: "6:45 PM ET" },
  { id: "chc-nym", away: "Chicago Cubs", home: "New York Mets", time: "7:10 PM ET" },
  { id: "tex-tor", away: "Texas Rangers", home: "Toronto Blue Jays", time: "7:07 PM ET" },
];

export const recommendations = [
  { id: "nyy-ml", gameId: "nyy-bos", badge: "NYY", color: "navy", selection: "Yankees ML", matchup: "NYY @ BOS", market: "Moneyline" as Market, modelProbability: 61.8, marketProbability: 56.1, price: "-128", fairPrice: "-162", edge: 5.7, quality: 84, drivers: [{ label: "Starter advantage", detail: "Projected starter run prevention is 0.54 runs better through six innings." }, { label: "Lineup quality", detail: "Confirmed top six project 11% above league average against right-handed pitching." }, { label: "Bullpen availability", detail: "Three highest-leverage relievers are rested; Boston has one key arm unavailable." }], caution: "Wind is forecast toward the Green Monster. Reprice if the total moves by a full run." },
  { id: "phi-f5", gameId: "phi-wsh", badge: "PHI", color: "red", selection: "Phillies F5 -0.5", matchup: "PHI @ WSH", market: "First 5" as Market, modelProbability: 58.2, marketProbability: 53.5, price: "+102", fairPrice: "-139", edge: 4.7, quality: 78, drivers: [{ label: "First-five matchup", detail: "The starting-pitcher projection creates a 0.71 run gap before bullpen entry." }, { label: "Platoon fit", detail: "Philadelphia’s projected lineup gains contact quality against this pitch mix." }, { label: "Defense", detail: "Infield range reduces Washington’s expected singles on ground balls." }], caution: "Lineup is projected, not confirmed. Hold if either top-three hitter rests." },
  { id: "chc-over", gameId: "chc-nym", badge: "8.5", color: "green", selection: "Over 8.5", matchup: "CHC @ NYM", market: "Total" as Market, modelProbability: 57.4, marketProbability: 52.4, price: "-110", fairPrice: "-135", edge: 5.0, quality: 76, drivers: [{ label: "Run environment", detail: "Weather and park model add 0.38 expected runs versus neutral conditions." }, { label: "Contact profile", detail: "Both lineups match well against the scheduled starters’ primary pitches." }, { label: "Middle relief", detail: "Available relievers project below average after heavy workloads yesterday." }], caution: "Rain delay risk could shorten both starters and change the bullpen distribution." },
  { id: "gore-k", gameId: "tex-tor", badge: "K", color: "blue", selection: "Gore over 5.5 Ks", matchup: "TEX @ TOR", market: "Player prop" as Market, modelProbability: 59.6, marketProbability: 54.3, price: "-112", fairPrice: "-148", edge: 5.3, quality: 72, drivers: [{ label: "Batters faced", detail: "Median workload projects to 24.1 batters with a 91-pitch expectation." }, { label: "Matchup strikeouts", detail: "Toronto’s projected lineup carries a 24.8% adjusted strikeout rate." }, { label: "Whiff arsenal", detail: "Two primary pitches own above-average swinging-strike rates in this matchup." }], caution: "Umpire and final lineup are pending. The play requires at least seven expected right-handed batters." },
];

export const modelChecks = [
  { label: "No future-data leakage", detail: "Feature timestamps precede every first pitch", value: "PASS", status: "good" },
  { label: "Probability calibration", detail: "Last 500 predictions · Brier 0.211", value: "ON TRACK", status: "good" },
  { label: "Lineup confirmation", detail: "12 of 15 games have official orders", value: "3 PENDING", status: "warn" },
  { label: "Correlation guard", detail: "No game exceeds 24% of open risk", value: "PASS", status: "good" },
];

export const sources = [
  { name: "MLB game feed", coverage: "Schedule · lineups · results", updated: "2m ago", icon: "MLB", state: "healthy" },
  { name: "Statcast", coverage: "Pitch · contact · expected stats", updated: "8m ago", icon: "SC", state: "healthy" },
  { name: "Market consensus", coverage: "7 books · 412 active prices", updated: "34s ago", icon: "$", state: "healthy" },
  { name: "Weather & parks", coverage: "15 venues · roof status", updated: "12m ago", icon: "°", state: "review" },
];
