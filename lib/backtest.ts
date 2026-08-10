import { clamp, firstInningMarkets, projectPeriod, projectScore } from "./modeling.ts";

export type HistoricalGame = { id:number; playedAt:string; awayId:number; homeId:number; awayScore:number; homeScore:number; firstInningAway?:number; firstInningHome?:number; firstFiveAway?:number; firstFiveHome?:number };
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

function calibrationEvaluation(rows:Array<{probability:number;calibratedProbability:number|null;outcome:number}>){const calibratedRows=rows.filter((row):row is typeof row&{calibratedProbability:number}=>row.calibratedProbability!=null);if(!calibratedRows.length)return null;const candidateBrier=calibratedRows.reduce((sum,row)=>sum+(row.calibratedProbability-row.outcome)**2,0)/calibratedRows.length,rawBrier=calibratedRows.reduce((sum,row)=>sum+(row.probability-row.outcome)**2,0)/calibratedRows.length,candidateLogLoss=calibratedRows.reduce((sum,row)=>{const probability=clamp(row.calibratedProbability,0.001,0.999);return sum-(row.outcome*Math.log(probability)+(1-row.outcome)*Math.log(1-probability));},0)/calibratedRows.length,rawLogLoss=calibratedRows.reduce((sum,row)=>{const probability=clamp(row.probability,0.001,0.999);return sum-(row.outcome*Math.log(probability)+(1-row.outcome)*Math.log(1-probability));},0)/calibratedRows.length;let weightedError=0;for(let index=0;index<10;index++){const low=index/10,high=(index+1)/10,bucket=calibratedRows.filter(row=>row.probability>=low&&(index===9?row.probability<=high:row.probability<high));if(bucket.length){const predicted=bucket.reduce((sum,row)=>sum+row.probability,0)/bucket.length,actual=bucket.reduce((sum,row)=>sum+row.outcome,0)/bucket.length;weightedError+=bucket.length*Math.abs(predicted-actual);}}const rawEce=weightedError/calibratedRows.length,candidateImproves=rawBrier-candidateBrier>=0.002,selectedMethod=candidateImproves?"regularized-platt":"identity",selectedBrier=candidateImproves?candidateBrier:rawBrier,selectedLogLoss=candidateImproves?candidateLogLoss:rawLogLoss,verified=calibratedRows.length>=500&&selectedBrier<0.25&&(candidateImproves||rawEce<=0.025);return{count:calibratedRows.length,brier:candidateBrier,logLoss:candidateLogLoss,rawBrier,rawLogLoss,rawEce,selectedMethod,selectedBrier,selectedLogLoss,verified};}

export function walkForwardBacktest(games: HistoricalGame[], minimumPriorGames = 10) {
  const teams = new Map<number, TeamState>();
  const predictions: Array<{id:number; probability:number; calibratedProbability:number|null; outcome:number; correct:boolean; expectedTotal:number; actualTotal:number; overProbability:number;calibratedOverProbability:number|null;overOutcome:number;f5HomeProbability:number;calibratedF5HomeProbability:number|null;f5HomeOutcome:number|null;nrfiProbability:number;calibratedNrfiProbability:number|null;nrfiOutcome:number|null}> = [];
  let leagueRuns = 0;
  let leagueTeamGames = 0;
  let observedInningRuns=0,observedFirstFiveRuns=0,observedRunsForShares=0;
  const sorted = [...games].sort((a,b)=>a.playedAt.localeCompare(b.playedAt)||a.id-b.id);
  const dateGroups=new Map<string,HistoricalGame[]>();
  for(const game of sorted){const date=game.playedAt.slice(0,10);dateGroups.set(date,[...(dateGroups.get(date)??[]),game]);}

  let activeSeason="";
  for (const dayGames of dateGroups.values()) {
    const season=dayGames[0]?.playedAt.slice(0,4)??"";
    if(activeSeason&&season!==activeSeason){teams.clear();leagueRuns=0;leagueTeamGames=0;observedInningRuns=0;observedFirstFiveRuns=0;observedRunsForShares=0;}
    activeSeason=season;
    const priorPredictions=[...predictions];
    // Every game on a date must use the same prior-day calibration. Fit these
    // models once per date instead of repeating the identical CPU-heavy work
    // for every game on the slate.
    const dayCalibration=fitProbabilityCalibration(priorPredictions.map(row=>({probability:row.probability,outcome:row.outcome})),200);
    const dayOverCalibration=fitProbabilityCalibration(priorPredictions.map(row=>({probability:row.overProbability,outcome:row.overOutcome})),200);
    const dayF5Calibration=fitProbabilityCalibration(priorPredictions.filter(row=>row.f5HomeOutcome!=null).map(row=>({probability:row.f5HomeProbability,outcome:row.f5HomeOutcome as number})),200);
    const dayNrfiCalibration=fitProbabilityCalibration(priorPredictions.filter(row=>row.nrfiOutcome!=null).map(row=>({probability:row.nrfiProbability,outcome:row.nrfiOutcome as number})),200);
    for(const game of dayGames){
      const away = teams.get(game.awayId) ?? { games:0, scored:0, allowed:0 };
      const home = teams.get(game.homeId) ?? { games:0, scored:0, allowed:0 };
      if (away.games >= minimumPriorGames && home.games >= minimumPriorGames && leagueTeamGames > 0) {
        const leagueAverage = leagueRuns / leagueTeamGames;
        const awayRaw = Math.sqrt((away.scored/away.games) * (home.allowed/home.games));
        const homeRaw = Math.sqrt((home.scored/home.games) * (away.allowed/away.games));
        const awayRuns = clamp(0.65*awayRaw + 0.35*leagueAverage - 0.08,2.2,7.2);
        const homeRuns = clamp(0.65*homeRaw + 0.35*leagueAverage + 0.08,2.2,7.2);
        const probability = projectScore(awayRuns,homeRuns).homeWin;
        const scoreDistribution=projectScore(awayRuns,homeRuns,8.5);
        const firstInningShare=observedRunsForShares>0?clamp(observedInningRuns/observedRunsForShares,0.08,0.16):0.115;
        const firstFiveShare=observedRunsForShares>0?clamp(observedFirstFiveRuns/observedRunsForShares,0.45,0.68):0.56;
        const f5=projectPeriod(awayRuns*firstFiveShare,homeRuns*firstFiveShare),nrfi=firstInningMarkets(awayRuns,homeRuns,firstInningShare);
        const outcome = game.homeScore > game.awayScore ? 1 : 0;
        const calibratedProbability=dayCalibration?applyProbabilityCalibration(probability,dayCalibration):null;
        const calibratedOverProbability=dayOverCalibration?applyProbabilityCalibration(scoreDistribution.over,dayOverCalibration):null,calibratedF5HomeProbability=dayF5Calibration?applyProbabilityCalibration(f5.homeNoPush,dayF5Calibration):null,calibratedNrfiProbability=dayNrfiCalibration?applyProbabilityCalibration(nrfi.nrfi,dayNrfiCalibration):null;
        const f5Outcome=game.firstFiveAway==null||game.firstFiveHome==null||game.firstFiveAway===game.firstFiveHome?null:Number(game.firstFiveHome>game.firstFiveAway),nrfiOutcome=game.firstInningAway==null||game.firstInningHome==null?null:Number(game.firstInningAway+game.firstInningHome===0);
        predictions.push({ id:game.id, probability, calibratedProbability, outcome, correct:(probability>=0.5)===(outcome===1), expectedTotal:awayRuns+homeRuns, actualTotal:game.awayScore+game.homeScore,overProbability:scoreDistribution.over,calibratedOverProbability,overOutcome:Number(game.awayScore+game.homeScore>8.5),f5HomeProbability:f5.homeNoPush,calibratedF5HomeProbability,f5HomeOutcome:f5Outcome,nrfiProbability:nrfi.nrfi,calibratedNrfiProbability,nrfiOutcome });
      }
    }
    for(const game of dayGames){
      const away = teams.get(game.awayId) ?? { games:0, scored:0, allowed:0 };
      const home = teams.get(game.homeId) ?? { games:0, scored:0, allowed:0 };
      teams.set(game.awayId,{games:away.games+1,scored:away.scored+game.awayScore,allowed:away.allowed+game.homeScore});
      teams.set(game.homeId,{games:home.games+1,scored:home.scored+game.homeScore,allowed:home.allowed+game.awayScore});
      leagueRuns += game.awayScore + game.homeScore;
      leagueTeamGames += 2;
      if(game.firstInningAway!=null&&game.firstInningHome!=null&&game.firstFiveAway!=null&&game.firstFiveHome!=null){observedInningRuns+=game.firstInningAway+game.firstInningHome;observedFirstFiveRuns+=game.firstFiveAway+game.firstFiveHome;observedRunsForShares+=game.awayScore+game.homeScore;}
    }
  }

  const count = predictions.length;
  const brier = count ? predictions.reduce((sum,p)=>sum+(p.probability-p.outcome)**2,0)/count : null;
  const logLoss = count ? predictions.reduce((sum,p)=>{const probability=clamp(p.probability,0.001,0.999);return sum-(p.outcome*Math.log(probability)+(1-p.outcome)*Math.log(1-probability));},0)/count : null;
  const accuracy = count ? predictions.filter(p=>p.correct).length/count : null;
  const totalMae = count ? predictions.reduce((sum,p)=>sum+Math.abs(p.expectedTotal-p.actualTotal),0)/count : null;
  const binaryMetrics=(rows:Array<{probability:number;outcome:number}>)=>{const n=rows.length;if(!n)return{count:0,accuracy:null,brier:null,logLoss:null};return{count:n,accuracy:rows.filter(row=>(row.probability>=0.5)===(row.outcome===1)).length/n,brier:rows.reduce((sum,row)=>sum+(row.probability-row.outcome)**2,0)/n,logLoss:rows.reduce((sum,row)=>{const probability=clamp(row.probability,0.001,0.999);return sum-(row.outcome*Math.log(probability)+(1-row.outcome)*Math.log(1-probability));},0)/n};};
  const marketMetrics={moneyline:binaryMetrics(predictions.map(row=>({probability:row.probability,outcome:row.outcome}))),totalOver85:binaryMetrics(predictions.map(row=>({probability:row.overProbability,outcome:row.overOutcome}))),firstFiveHome:binaryMetrics(predictions.filter(row=>row.f5HomeOutcome!=null).map(row=>({probability:row.f5HomeProbability,outcome:row.f5HomeOutcome as number}))),nrfi:binaryMetrics(predictions.filter(row=>row.nrfiOutcome!=null).map(row=>({probability:row.nrfiProbability,outcome:row.nrfiOutcome as number})))};
  const calibratedMetrics=calibrationEvaluation(predictions.map(row=>({probability:row.probability,calibratedProbability:row.calibratedProbability,outcome:row.outcome})));
  const marketCalibratedMetrics={totalOver85:calibrationEvaluation(predictions.map(row=>({probability:row.overProbability,calibratedProbability:row.calibratedOverProbability,outcome:row.overOutcome}))),firstFiveHome:calibrationEvaluation(predictions.filter(row=>row.f5HomeOutcome!=null).map(row=>({probability:row.f5HomeProbability,calibratedProbability:row.calibratedF5HomeProbability,outcome:row.f5HomeOutcome as number}))),nrfi:calibrationEvaluation(predictions.filter(row=>row.nrfiOutcome!=null).map(row=>({probability:row.nrfiProbability,calibratedProbability:row.calibratedNrfiProbability,outcome:row.nrfiOutcome as number})))};
  const buckets = Array.from({length:5},(_,index)=>{
    const low=index*0.2, high=(index+1)*0.2;
    const rows=predictions.filter(p=>p.probability>=low&&(index===4?p.probability<=high:p.probability<high));
    return { low, high, count:rows.length, predicted:rows.length?rows.reduce((sum,p)=>sum+p.probability,0)/rows.length:null, actual:rows.length?rows.reduce((sum,p)=>sum+p.outcome,0)/rows.length:null };
  });
  const liveCalibration=fitProbabilityCalibration(predictions.map(row=>({probability:row.probability,outcome:row.outcome})),200);
  const liveMarketCalibrations={totalOver85:fitProbabilityCalibration(predictions.map(row=>({probability:row.overProbability,outcome:row.overOutcome})),200),firstFiveHome:fitProbabilityCalibration(predictions.filter(row=>row.f5HomeOutcome!=null).map(row=>({probability:row.f5HomeProbability,outcome:row.f5HomeOutcome as number})),200),nrfi:fitProbabilityCalibration(predictions.filter(row=>row.nrfiOutcome!=null).map(row=>({probability:row.nrfiProbability,outcome:row.nrfiOutcome as number})),200)};
  return { predictions, metrics:{count,accuracy,brier,logLoss,totalMae},marketMetrics,calibratedMetrics,marketCalibratedMetrics,calibration:buckets,liveCalibration,liveMarketCalibrations };
}
