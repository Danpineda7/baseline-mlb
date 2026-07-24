import { clamp, projectScore } from "./modeling.ts";

export type HistoricalGame = { id:number; playedAt:string; awayId:number; homeId:number; awayScore:number; homeScore:number };
type TeamState = { games:number; scored:number; allowed:number };

export function walkForwardBacktest(games: HistoricalGame[], minimumPriorGames = 10) {
  const teams = new Map<number, TeamState>();
  const predictions: Array<{id:number; probability:number; outcome:number; correct:boolean; expectedTotal:number; actualTotal:number}> = [];
  let leagueRuns = 0;
  let leagueTeamGames = 0;
  const sorted = [...games].sort((a,b)=>a.playedAt.localeCompare(b.playedAt)||a.id-b.id);

  for (const game of sorted) {
    const away = teams.get(game.awayId) ?? { games:0, scored:0, allowed:0 };
    const home = teams.get(game.homeId) ?? { games:0, scored:0, allowed:0 };
    if (away.games >= minimumPriorGames && home.games >= minimumPriorGames && leagueTeamGames > 0) {
      const leagueAverage = leagueRuns / leagueTeamGames;
      const awayRaw = Math.sqrt((away.scored/away.games) * (home.allowed/home.games));
      const homeRaw = Math.sqrt((home.scored/home.games) * (away.allowed/away.games));
      const awayRuns = clamp(0.65*awayRaw + 0.35*leagueAverage - 0.08,2.2,7.2);
      const homeRuns = clamp(0.65*homeRaw + 0.35*leagueAverage + 0.08,2.2,7.2);
      const probability = projectScore(awayRuns,homeRuns).homeWin;
      const outcome = game.homeScore > game.awayScore ? 1 : 0;
      predictions.push({ id:game.id, probability, outcome, correct:(probability>=0.5)===(outcome===1), expectedTotal:awayRuns+homeRuns, actualTotal:game.awayScore+game.homeScore });
    }
    teams.set(game.awayId,{games:away.games+1,scored:away.scored+game.awayScore,allowed:away.allowed+game.homeScore});
    teams.set(game.homeId,{games:home.games+1,scored:home.scored+game.homeScore,allowed:home.allowed+game.awayScore});
    leagueRuns += game.awayScore + game.homeScore;
    leagueTeamGames += 2;
  }

  const count = predictions.length;
  const brier = count ? predictions.reduce((sum,p)=>sum+(p.probability-p.outcome)**2,0)/count : null;
  const logLoss = count ? predictions.reduce((sum,p)=>{const probability=clamp(p.probability,0.001,0.999);return sum-(p.outcome*Math.log(probability)+(1-p.outcome)*Math.log(1-probability));},0)/count : null;
  const accuracy = count ? predictions.filter(p=>p.correct).length/count : null;
  const totalMae = count ? predictions.reduce((sum,p)=>sum+Math.abs(p.expectedTotal-p.actualTotal),0)/count : null;
  const buckets = Array.from({length:5},(_,index)=>{
    const low=index*0.2, high=(index+1)*0.2;
    const rows=predictions.filter(p=>p.probability>=low&&(index===4?p.probability<=high:p.probability<high));
    return { low, high, count:rows.length, predicted:rows.length?rows.reduce((sum,p)=>sum+p.probability,0)/rows.length:null, actual:rows.length?rows.reduce((sum,p)=>sum+p.outcome,0)/rows.length:null };
  });
  return { predictions, metrics:{count,accuracy,brier,logLoss,totalMae},calibration:buckets };
}
