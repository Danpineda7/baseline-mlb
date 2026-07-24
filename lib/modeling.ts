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

