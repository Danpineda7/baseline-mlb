import { clamp, projectScore } from "./modeling.ts";

export type HistoricalGame = { id:number; playedAt:string; awayId:number; homeId:number; awayScore:number; homeScore:number };
type TeamState = { games:number; scored:number; allowed:number };
export type CalibrationModel={intercept:number;slope:number;count:number};
const logit=(probability:number)=>Math.log(clamp(probability,0.001,0.999)/(1-clamp(probability,0.001,0.999)));
const logistic=(value:number)=>1/(1+Math.exp(-value));

export function fitProbabilityCalibration(rows:Array<{probability:number;outcome:number}>,minimumRows=200):CalibrationModel|null {
  if(rows.length<minimumRows)return null;
  // Regularized Platt scaling. The penalty is centered on the identity map (0 + 1*logit(p)).
  let intercept=0,slope=1;const ridge=12;
  for(let iteration=0;iteration<12;iteration++){
    let g0=-ridge*intercept,g1=-ridge*(slope-1),h00=ridge,h01=0,h11=ridge;
    for(const row of rows){const x=logit(row.probability),fitted=logistic(intercept+slope*x),weight=Math.max(fitted*(1-fitted),1e-6),error=row.outcome-fitted;g0+=error;g1+=error*x;h00+=weight;h01+=weight*x;h11+=weight*x*x;}
    const determinant=h00*h11-h01*h01;if(Math.abs(determinant)<1e-9)break;
    const delta0=(g0*h11-g1*h01)/determinant,delta1=(g1*h00-g0*h01)/determinant;
    intercept=clamp(intercept+delta0,-2,2);slope=clamp(slope+delta1,0.1,3);
    if(Math.abs(delta0)+Math.abs(delta1)<1e-7)break;
  }
  return {intercept,slope,count:rows.length};
}

export function applyProbabilityCalibration(probability:number,model:CalibrationModel|null){return model?clamp(logistic(model.intercept+model.slope*logit(probability)),0.03,0.97):probability;}

export function walkForwardBacktest(games: HistoricalGame[], minimumPriorGames = 10) {
  const teams = new Map<number, TeamState>();
  const predictions: Array<{id:number; probability:number; calibratedProbability:number|null; outcome:number; correct:boolean; expectedTotal:number; actualTotal:number}> = [];
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
      const calibration=fitProbabilityCalibration(predictions.map(row=>({probability:row.probability,outcome:row.outcome})),200);
      const calibratedProbability=calibration?applyProbabilityCalibration(probability,calibration):null;
      predictions.push({ id:game.id, probability, calibratedProbability, outcome, correct:(probability>=0.5)===(outcome===1), expectedTotal:awayRuns+homeRuns, actualTotal:game.awayScore+game.homeScore });
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
  const calibratedRows=predictions.filter((row):row is typeof row&{calibratedProbability:number}=>row.calibratedProbability!=null);
  const calibratedMetrics=calibratedRows.length?(()=>{const candidateBrier=calibratedRows.reduce((sum,row)=>sum+(row.calibratedProbability-row.outcome)**2,0)/calibratedRows.length,rawBrier=calibratedRows.reduce((sum,row)=>sum+(row.probability-row.outcome)**2,0)/calibratedRows.length,candidateLogLoss=calibratedRows.reduce((sum,row)=>{const probability=clamp(row.calibratedProbability,0.001,0.999);return sum-(row.outcome*Math.log(probability)+(1-row.outcome)*Math.log(1-probability));},0)/calibratedRows.length,rawLogLoss=calibratedRows.reduce((sum,row)=>{const probability=clamp(row.probability,0.001,0.999);return sum-(row.outcome*Math.log(probability)+(1-row.outcome)*Math.log(1-probability));},0)/calibratedRows.length;let weightedError=0;for(let index=0;index<10;index++){const low=index/10,high=(index+1)/10,rows=calibratedRows.filter(row=>row.probability>=low&&(index===9?row.probability<=high:row.probability<high));if(rows.length){const predicted=rows.reduce((sum,row)=>sum+row.probability,0)/rows.length,actual=rows.reduce((sum,row)=>sum+row.outcome,0)/rows.length;weightedError+=rows.length*Math.abs(predicted-actual);}}const rawEce=weightedError/calibratedRows.length,candidateImproves=candidateBrier<rawBrier;return{count:calibratedRows.length,brier:candidateBrier,logLoss:candidateLogLoss,rawBrier,rawLogLoss,rawEce,selectedMethod:candidateImproves?"regularized-platt":"identity",selectedBrier:candidateImproves?candidateBrier:rawBrier,selectedLogLoss:candidateImproves?candidateLogLoss:rawLogLoss,verified:candidateImproves||rawEce<=0.03};})():null;
  const buckets = Array.from({length:5},(_,index)=>{
    const low=index*0.2, high=(index+1)*0.2;
    const rows=predictions.filter(p=>p.probability>=low&&(index===4?p.probability<=high:p.probability<high));
    return { low, high, count:rows.length, predicted:rows.length?rows.reduce((sum,p)=>sum+p.probability,0)/rows.length:null, actual:rows.length?rows.reduce((sum,p)=>sum+p.outcome,0)/rows.length:null };
  });
  const liveCalibration=fitProbabilityCalibration(predictions.map(row=>({probability:row.probability,outcome:row.outcome})),200);
  return { predictions, metrics:{count,accuracy,brier,logLoss,totalMae},calibratedMetrics,calibration:buckets,liveCalibration };
}
