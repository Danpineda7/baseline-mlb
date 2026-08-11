import type { EvaluatedForecast } from "./market-validation.ts";

// The complete Phase 6 activation contract. Real-money activation stays locked
// until EVERY gate passes on post-epoch evidence. CLV is the primary evidence;
// simulated ROI is reported with its confidence interval so that noise at
// small sample sizes is visible instead of persuasive.
export const ACTIVATION_REQUIREMENTS={
  minimumPriced:500,
  minimumPerMarket:100,
  maximumEce:0.05,
  minimumClvSamples:50,
  minimumStabilityRows:30,
  minimumStabilityClvSamples:10,
  minimumOddsDayCoverage:0.8,
} as const;

export type ActivationGate={id:string;label:string;passed:boolean;detail:string};

const mean=(values:number[])=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;

/** 10-bin expected calibration error, weighted by bin occupancy. */
export function expectedCalibrationError(rows:Array<{probability:number;outcome:number}>){
  if(!rows.length)return null;
  let weighted=0;
  for(let index=0;index<10;index++){
    const low=index/10,high=(index+1)/10;
    const bucket=rows.filter(row=>row.probability>=low&&(index===9?row.probability<=high:row.probability<high));
    if(!bucket.length)continue;
    const predicted=bucket.reduce((sum,row)=>sum+row.probability,0)/bucket.length;
    const actual=bucket.reduce((sum,row)=>sum+row.outcome,0)/bucket.length;
    weighted+=bucket.length*Math.abs(predicted-actual);
  }
  return weighted/rows.length;
}

const brierOf=(rows:Array<{probability:number;outcome:number}>)=>mean(rows.map(row=>(row.probability-row.outcome)**2));
// Brier of always predicting the observed base rate — the honest naive baseline.
const baseRateBrier=(rows:Array<{outcome:number}>)=>{const rate=mean(rows.map(row=>row.outcome));return rate==null?null:rate*(1-rate);};

const percent=(value:number|null|undefined)=>value==null?"—":`${(value*100).toFixed(1)}%`;

export function computeActivation(input:{evaluated:EvaluatedForecast[];criticalEvents:number;forecastDays:number;pricedDays:number}){
  const R=ACTIVATION_REQUIREMENTS;
  const rows=input.evaluated;
  const markets=[...new Set(rows.map(row=>row.market))];
  const gates:ActivationGate[]=[];

  gates.push({id:"volume",label:`At least ${R.minimumPriced} priced and settled forecasts`,passed:rows.length>=R.minimumPriced,detail:`${rows.length} of ${R.minimumPriced}`});

  const perMarket=markets.map(market=>({market,n:rows.filter(row=>row.market===market).length}));
  gates.push({id:"per-market-volume",label:`At least ${R.minimumPerMarket} priced forecasts in every market`,passed:markets.length>0&&perMarket.every(entry=>entry.n>=R.minimumPerMarket),detail:markets.length?perMarket.map(entry=>`${entry.market} ${entry.n}`).join(" · "):"no priced markets"});

  const eceByMarket=markets.map(market=>({market,ece:expectedCalibrationError(rows.filter(row=>row.market===market))}));
  gates.push({id:"calibration",label:`Calibration error at most ${percent(R.maximumEce)} in every market`,passed:markets.length>0&&eceByMarket.every(entry=>entry.ece!=null&&entry.ece<=R.maximumEce),detail:markets.length?eceByMarket.map(entry=>`${entry.market} ${percent(entry.ece)}`).join(" · "):"no data"});

  const brierByMarket=markets.map(market=>{const marketRows=rows.filter(row=>row.market===market);return{market,brier:brierOf(marketRows),baseline:baseRateBrier(marketRows)};});
  gates.push({id:"brier",label:"Brier score better than the base-rate baseline in every market",passed:markets.length>0&&brierByMarket.every(entry=>entry.brier!=null&&entry.baseline!=null&&entry.brier<entry.baseline),detail:markets.length?brierByMarket.map(entry=>`${entry.market} ${entry.brier?.toFixed(3)??"—"} vs ${entry.baseline?.toFixed(3)??"—"}`).join(" · "):"no data"});

  const clvRows=rows.filter(row=>row.qualifies&&row.closingClass);
  const averageClv=mean(clvRows.map(row=>row.clv));
  gates.push({id:"clv",label:`Positive average CLV over at least ${R.minimumClvSamples} closing-class plays`,passed:clvRows.length>=R.minimumClvSamples&&averageClv!=null&&averageClv>0,detail:`${percent(averageClv)} over ${clvRows.length} plays`});

  const plays=rows.filter(row=>row.qualifies);
  const roi=mean(plays.map(row=>row.profit));
  let roiHalf:number|null=null;
  if(roi!=null&&plays.length>=2){const variance=plays.reduce((sum,row)=>sum+(row.profit-roi)**2,0)/(plays.length-1);roiHalf=1.96*Math.sqrt(variance/plays.length);}
  gates.push({id:"roi",label:"Positive simulated ROI at entry prices (CI reported)",passed:roi!=null&&roi>0,detail:roi==null?"no qualifying plays":`${percent(roi)} ±${percent(roiHalf)} over ${plays.length} plays`});

  const ordered=[...rows].sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
  const third=Math.floor(ordered.length/3);
  const windows=third>0?[ordered.slice(0,third),ordered.slice(third,2*third),ordered.slice(2*third)]:[];
  const windowChecks=windows.map((windowRows,index)=>{
    const windowClv=windowRows.filter(row=>row.qualifies&&row.closingClass).map(row=>row.clv);
    const windowBrier=brierOf(windowRows),windowBaseline=baseRateBrier(windowRows);
    const clvOk=windowClv.length>=R.minimumStabilityClvSamples&&(mean(windowClv)??-1)>=0;
    const brierOk=windowBrier!=null&&windowBaseline!=null&&windowBrier<=windowBaseline;
    return{index:index+1,n:windowRows.length,passed:windowRows.length>=R.minimumStabilityRows&&clvOk&&brierOk};
  });
  gates.push({id:"stability",label:"Non-negative CLV and baseline-beating Brier in 3 independent periods",passed:windowChecks.length===3&&windowChecks.every(check=>check.passed),detail:windowChecks.length?windowChecks.map(check=>`P${check.index} n=${check.n} ${check.passed?"pass":"fail"}`).join(" · "):"insufficient history"});

  const dayCoverage=input.forecastDays?input.pricedDays/input.forecastDays:0;
  gates.push({id:"data-quality",label:"No critical data-quality failures and ≥80% of forecast days priced",passed:input.criticalEvents===0&&dayCoverage>=R.minimumOddsDayCoverage,detail:`${input.criticalEvents} critical events · ${percent(dayCoverage)} day coverage`});

  return{ready:gates.every(gate=>gate.passed),gates,requirements:R};
}
