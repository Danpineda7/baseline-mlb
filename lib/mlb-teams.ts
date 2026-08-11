// Explicit alias table for the 30 MLB clubs. Odds providers name teams
// inconsistently ("NY Yankees", "St Louis Cardinals", …); fuzzy substring
// matching risks pairing the wrong club or reversing home/away, so team
// resolution only succeeds on a known alias and never guesses.

const normalize = (value: string) => value.toLowerCase().replace(/baseball club|club/g, "").replace(/[^a-z0-9]/g, "");

// Canonical key -> aliases (already normalized-compatible strings).
// City-only aliases are included only where unambiguous (not New York,
// Los Angeles, Chicago).
const TEAM_ALIASES: Record<string, string[]> = {
  "arizona diamondbacks": ["arizona diamondbacks", "az diamondbacks", "diamondbacks", "d-backs", "arizona"],
  "atlanta braves": ["atlanta braves", "braves", "atlanta"],
  "baltimore orioles": ["baltimore orioles", "orioles", "baltimore"],
  "boston red sox": ["boston red sox", "red sox", "boston"],
  "chicago cubs": ["chicago cubs", "cubs", "chi cubs"],
  "chicago white sox": ["chicago white sox", "white sox", "chi white sox"],
  "cincinnati reds": ["cincinnati reds", "reds", "cincinnati"],
  "cleveland guardians": ["cleveland guardians", "guardians", "cleveland"],
  "colorado rockies": ["colorado rockies", "rockies", "colorado"],
  "detroit tigers": ["detroit tigers", "tigers", "detroit"],
  "houston astros": ["houston astros", "astros", "houston"],
  "kansas city royals": ["kansas city royals", "royals", "kansas city", "kc royals"],
  "los angeles angels": ["los angeles angels", "la angels", "angels", "los angeles angels of anaheim", "anaheim angels"],
  "los angeles dodgers": ["los angeles dodgers", "la dodgers", "dodgers"],
  "miami marlins": ["miami marlins", "marlins", "miami"],
  "milwaukee brewers": ["milwaukee brewers", "brewers", "milwaukee"],
  "minnesota twins": ["minnesota twins", "twins", "minnesota"],
  "new york mets": ["new york mets", "ny mets", "mets"],
  "new york yankees": ["new york yankees", "ny yankees", "yankees"],
  "athletics": ["athletics", "oakland athletics", "sacramento athletics", "las vegas athletics", "oakland"],
  "philadelphia phillies": ["philadelphia phillies", "phillies", "philadelphia"],
  "pittsburgh pirates": ["pittsburgh pirates", "pirates", "pittsburgh"],
  "san diego padres": ["san diego padres", "padres", "san diego", "sd padres"],
  "san francisco giants": ["san francisco giants", "sf giants", "giants", "san francisco"],
  "seattle mariners": ["seattle mariners", "mariners", "seattle"],
  "st. louis cardinals": ["st louis cardinals", "saint louis cardinals", "stl cardinals", "cardinals", "st louis"],
  "tampa bay rays": ["tampa bay rays", "rays", "tampa bay", "tampa"],
  "texas rangers": ["texas rangers", "rangers", "texas"],
  "toronto blue jays": ["toronto blue jays", "blue jays", "toronto"],
  "washington nationals": ["washington nationals", "nationals", "washington"],
};

const ALIAS_TO_TEAM = new Map<string, string>();
for (const [team, aliases] of Object.entries(TEAM_ALIASES)) for (const alias of aliases) ALIAS_TO_TEAM.set(normalize(alias), team);

/** Resolves any provider or MLB team name to its canonical club key, or null when unknown. */
export function resolveMlbTeam(name: string): string | null {
  return ALIAS_TO_TEAM.get(normalize(name)) ?? null;
}

/** True only when both names resolve to the same known MLB club. */
export function sameMlbTeam(left: string, right: string): boolean {
  const a = resolveMlbTeam(left);
  return a != null && a === resolveMlbTeam(right);
}
