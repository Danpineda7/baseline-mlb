export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function poissonPmf(k: number, lambda: number) {
  let factorial = 1;
  for (let index = 2; index <= k; index += 1) factorial *= index;
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial;
}

export function fairAmerican(probability: number) {
  const p = clamp(probability, 0.01, 0.99);
  const price = p >= 0.5 ? -(p / (1 - p)) * 100 : ((1 - p) / p) * 100;
  return `${price > 0 ? "+" : ""}${Math.round(price)}`;
}

export function impliedProbability(americanOdds: number) {
  if (!Number.isFinite(americanOdds) || americanOdds === 0 || Math.abs(americanOdds) < 100) return null;
  return americanOdds < 0
    ? Math.abs(americanOdds) / (Math.abs(americanOdds) + 100)
    : 100 / (americanOdds + 100);
}

export function priceDecision(modelProbability: number, americanOdds: number, uncertainty = 0.4) {
  const marketProbability = impliedProbability(americanOdds);
  if (marketProbability == null) return null;
  const decimalOdds = americanOdds > 0 ? 1 + americanOdds / 100 : 1 + 100 / Math.abs(americanOdds);
  const edge = modelProbability - marketProbability;
  const expectedValue = modelProbability * (decimalOdds - 1) - (1 - modelProbability);
  const fullKelly = expectedValue / (decimalOdds - 1);
  // High uncertainty means smaller stakes; never recommend more than 0.5% of bankroll.
  const stakeFraction = clamp(fullKelly * 0.25 * (1 - uncertainty), 0, 0.005);
  const qualifies = edge >= 0.025 && expectedValue > 0.02 && uncertainty <= 0.55;
  return { marketProbability, edge, expectedValue, stakeFraction: qualifies ? stakeFraction : 0, qualifies };
}

export function projectScore(awayRuns: number, homeRuns: number, totalLine = 8.5) {
  let awayWin = 0;
  let homeWin = 0;
  let tie = 0;
  let over = 0;
  let under = 0;
  let push = 0;

  for (let away = 0; away <= 18; away += 1) {
    for (let home = 0; home <= 18; home += 1) {
      const mass = poissonPmf(away, awayRuns) * poissonPmf(home, homeRuns);
      if (away > home) awayWin += mass;
      else if (home > away) homeWin += mass;
      else tie += mass;
      if (away + home > totalLine) over += mass;
      else if (away + home < totalLine) under += mass;
      else push += mass;
    }
  }

  // Regulation ties are split using each club's non-tie win share as a neutral
  // approximation. Extra-inning roster and bullpen information is not modeled yet.
  const decisiveShare = awayWin + homeWin;
  const awayExtraShare = decisiveShare > 0 ? awayWin / decisiveShare : 0.5;
  awayWin += tie * awayExtraShare;
  homeWin += tie * (1 - awayExtraShare);
  const totalMass = awayWin + homeWin;

  return {
    awayWin: awayWin / totalMass,
    homeWin: homeWin / totalMass,
    over: over / (over + under + push),
    under: under / (over + under + push),
    push: push / (over + under + push),
  };
}
