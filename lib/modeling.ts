export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function poissonPmf(k: number, lambda: number) {
  let factorial = 1;
  for (let index = 2; index <= k; index += 1) factorial *= index;
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial;
}

export function projectPeriod(awayRuns: number, homeRuns: number) {
  let awayWin=0,homeWin=0,tie=0;
  for(let away=0;away<=14;away+=1) for(let home=0;home<=14;home+=1){
    const mass=poissonPmf(away,awayRuns)*poissonPmf(home,homeRuns);
    if(away>home)awayWin+=mass; else if(home>away)homeWin+=mass; else tie+=mass;
  }
  const total=awayWin+homeWin+tie;
  return {awayWin:awayWin/total,homeWin:homeWin/total,tie:tie/total,awayNoPush:awayWin/(awayWin+homeWin),homeNoPush:homeWin/(awayWin+homeWin)};
}

export function firstInningMarkets(awayRuns:number,homeRuns:number,firstInningShare:number){
  const expectedRuns=(awayRuns+homeRuns)*firstInningShare;
  const nrfi=Math.exp(-expectedRuns);
  return {expectedRuns,nrfi,yrfi:1-nrfi};
}

export function strikeoutExpectation(strikeouts:number,gamesStarted:number,leaguePerStart=5.2){
  if(gamesStarted<=0||strikeouts<0)return null;
  const reliability=gamesStarted/(gamesStarted+5);
  return clamp(reliability*(strikeouts/gamesStarted)+(1-reliability)*leaguePerStart,1.5,10.5);
}

export function opponentAdjustedStrikeouts(expected:number|null,strikeouts:number,plateAppearances:number,leagueRate:number){
  if(expected==null||expected<=0||strikeouts<0||plateAppearances<=0||leagueRate<=0)return expected;
  const reliability=plateAppearances/(plateAppearances+600);
  const regressedRate=reliability*(strikeouts/plateAppearances)+(1-reliability)*leagueRate;
  return clamp(expected*clamp(regressedRate/leagueRate,0.88,1.12),1.5,11.5);
}

export function countOverProbability(expectedCount:number,line:number){
  if(!Number.isFinite(expectedCount)||expectedCount<=0||!Number.isFinite(line)||line<0)return null;
  const minimum=Math.floor(line)+1;
  let underOrEqual=0;
  for(let count=0;count<minimum;count+=1)underOrEqual+=poissonPmf(count,expectedCount);
  return clamp(1-underOrEqual,0,1);
}

// 1+ hit is a per-at-bat event: binomial over expected at-bats. The previous
// Poisson form (1-exp(-expectedHits)) overweighted multi-hit games and
// systematically underestimated 1+ hit probability by ~4-7 points.
const onePlusHitProbability=(hitRate:number,expectedAtBats:number)=>1-Math.pow(1-hitRate,expectedAtBats);

export function hitterHitProjection(hits:number,atBats:number,plateAppearances:number,gamesPlayed:number,leagueAverage=0.245){
  if(atBats<=0||gamesPlayed<=0||hits<0)return null;
  const reliability=atBats/(atBats+100);
  const hitRate=clamp(reliability*(hits/atBats)+(1-reliability)*leagueAverage,0.12,0.4);
  const expectedAtBats=clamp((plateAppearances/gamesPlayed)*0.91,2.8,4.6);
  const expectedHits=hitRate*expectedAtBats;
  return {hitRate,expectedAtBats,expectedHits,onePlusProbability:onePlusHitProbability(hitRate,expectedAtBats)};
}

export function platoonAdjustedHitProjection(base:{hitRate:number;expectedAtBats:number;expectedHits:number;onePlusProbability:number}|null,splitHits:number,splitAtBats:number){
  if(!base||splitHits<0||splitAtBats<=0)return base;
  const reliability=splitAtBats/(splitAtBats+80);
  const adjustedRate=clamp(reliability*(splitHits/splitAtBats)+(1-reliability)*base.hitRate,base.hitRate*0.8,base.hitRate*1.2);
  const expectedHits=adjustedRate*base.expectedAtBats;
  return {...base,hitRate:adjustedRate,expectedHits,onePlusProbability:onePlusHitProbability(adjustedRate,base.expectedAtBats)};
}

// Strikeouts are bounded by batters faced and underdispersed relative to
// Poisson; a binomial over a typical start's batters faced keeps tail lines
// (e.g. over 7.5) from being overestimated.
export const TYPICAL_BATTERS_FACED=25;
export function strikeoutOverProbability(expectedStrikeouts:number,line:number){
  if(!Number.isFinite(expectedStrikeouts)||expectedStrikeouts<=0||!Number.isFinite(line)||line<0)return null;
  const n=TYPICAL_BATTERS_FACED,p=clamp(expectedStrikeouts/n,0.01,0.65);
  const minimum=Math.floor(line)+1;
  if(minimum>n)return 0;
  let underOrEqual=0,pmf=Math.pow(1-p,n);
  for(let count=0;count<minimum;count+=1){underOrEqual+=pmf;pmf*=((n-count)/(count+1))*(p/(1-p));}
  return clamp(1-underOrEqual,0,1);
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

export function noVigProbability(primaryOdds: number, opposingOdds: number) {
  const primary = impliedProbability(primaryOdds);
  const opposing = impliedProbability(opposingOdds);
  if (primary == null || opposing == null) return null;
  return primary / (primary + opposing);
}

export function closingLineValue(openingProbability:number, closingOdds:number, closingOpposingOdds:number){
  const closingProbability=noVigProbability(closingOdds,closingOpposingOdds);
  return closingProbability==null?null:{closingProbability,value:closingProbability-openingProbability};
}

export function empiricalParkFactor(homeRuns:number,homeGames:number,roadRuns:number,roadGames:number,leagueRunsPerGame:number,priorGames=60){
  if(!Number.isFinite(leagueRunsPerGame)||leagueRunsPerGame<=0||homeGames<0||roadGames<0||homeRuns<0||roadRuns<0)return 1;
  const homeEnvironment=(homeRuns+priorGames*leagueRunsPerGame)/(homeGames+priorGames),roadEnvironment=(roadRuns+priorGames*leagueRunsPerGame)/(roadGames+priorGames);
  return clamp(homeEnvironment/roadEnvironment,0.9,1.1);
}

export function priceDecision(modelProbability: number, americanOdds: number, uncertainty = 0.4, opposingOdds?: number, pushProbability=0) {
  const rawImpliedProbability = impliedProbability(americanOdds);
  if (rawImpliedProbability == null||!Number.isFinite(modelProbability)||modelProbability<=0||!Number.isFinite(pushProbability)||pushProbability<0||modelProbability+pushProbability>=1) return null;
  const noVig = opposingOdds == null ? null : noVigProbability(americanOdds, opposingOdds);
  const marketProbability = noVig ?? rawImpliedProbability;
  const decimalOdds = americanOdds > 0 ? 1 + americanOdds / 100 : 1 + 100 / Math.abs(americanOdds);
  const conditionalProbability=modelProbability/(1-pushProbability);
  const edge = conditionalProbability - marketProbability;
  const expectedValue = modelProbability * (decimalOdds - 1) - (1-modelProbability-pushProbability);
  const fullKelly = (conditionalProbability*(decimalOdds-1)-(1-conditionalProbability))/(decimalOdds-1);
  // High uncertainty means smaller stakes; never recommend more than 0.5% of bankroll.
  const stakeFraction = clamp(fullKelly * 0.25 * (1 - uncertainty), 0, 0.005);
  const qualifies = edge >= 0.025 && expectedValue > 0.02 && uncertainty <= 0.55;
  return { marketProbability, rawImpliedProbability, vigRemoved: noVig != null, modelProbability:conditionalProbability, pushProbability, edge, expectedValue, stakeFraction: qualifies ? stakeFraction : 0, qualifies };
}

export function playablePriceThreshold(modelProbability:number,opposingOdds:number,uncertainty=0.4,pushProbability=0){
  const candidates:number[]=[];for(let odds=-1000;odds<=-100;odds++)candidates.push(odds);for(let odds=100;odds<=1000;odds++)candidates.push(odds);
  const decimal=(odds:number)=>odds>0?1+odds/100:1+100/Math.abs(odds);
  const qualifying=candidates.filter(odds=>priceDecision(modelProbability,odds,uncertainty,opposingOdds,pushProbability)?.qualifies).sort((left,right)=>decimal(left)-decimal(right));
  return qualifying[0]??null;
}

export function inningsToDecimal(value: string | number | null | undefined) {
  if (typeof value === "number") return value;
  if (!value) return 0;
  const [whole, outs = "0"] = value.split(".");
  const parsedWhole = Number(whole);
  const parsedOuts = Number(outs);
  return Number.isFinite(parsedWhole) && parsedOuts >= 0 && parsedOuts <= 2 ? parsedWhole + parsedOuts / 3 : 0;
}

export function starterRunAdjustment(era: number | null, innings: number, leagueEra = 4.3) {
  if (era == null || !Number.isFinite(era) || innings <= 0) return 0;
  const reliability = innings / (innings + 40);
  const regressedEra = reliability * era + (1 - reliability) * leagueEra;
  return clamp((regressedEra - leagueEra) * (5.5 / 9), -0.75, 0.75);
}

export function bullpenFatigueAdjustment(recentReliefPitches:number[]){
  const valid=recentReliefPitches.filter(value=>Number.isFinite(value)&&value>=0).sort((a,b)=>b-a).slice(0,4);
  if(!valid.length)return 0;
  const fatigue=valid.reduce((sum,pitches)=>sum+clamp((pitches-15)/35,0,1),0)/4;
  return clamp(fatigue*0.18,0,0.18);
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
