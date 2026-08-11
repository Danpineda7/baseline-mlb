import assert from "node:assert/strict";
import test from "node:test";
import { computeActivation, expectedCalibrationError } from "../lib/activation.ts";

// 600 rows, 150 per market, spread over 60 days. Within every market, half the
// rows are predicted at 70% with a ~72% outcome rate and half at 30% with a
// ~32% rate: well calibrated (ECE ~2%), Brier ~0.21 against a ~0.25 base-rate
// baseline, positive CLV, and positive entry-price ROI.
function goodRows(){
  const rows=[];
  for(const market of ["moneyline","over","f5","nrfi"]){
    for(let index=0;index<150;index++){
      const high=index%2===0,groupIndex=Math.floor(index/2);
      const outcome=high?(groupIndex%10<7?1:0):(groupIndex%10<3?1:0);
      const probability=high?.7:.3;
      const dayIndex=Math.floor(index*60/150);
      const startsAt=dayIndex<30?`2026-06-${String(dayIndex+1).padStart(2,"0")}T20:00:00Z`:`2026-07-${String(dayIndex-29).padStart(2,"0")}T20:00:00Z`;
      rows.push({
        market,startsAt,probability,outcome,book:"Pinnacle",
        entryProbability:probability-.04,closeProbability:probability-.02,
        closingClass:true,
        edge:.04,closeEdge:.02,clv:.02,
        qualifies:true,
        profit:outcome===1?1.1:-1,
        brier:(probability-outcome)**2,
      });
    }
  }
  return rows;
}
const inputs=(rows,overrides={})=>({evaluated:rows,criticalEvents:0,forecastDays:10,pricedDays:9,...overrides});
const gate=(result,id)=>result.gates.find(entry=>entry.id===id);

test("a well-calibrated, well-covered evidence set passes every gate",()=>{
  const result=computeActivation(inputs(goodRows()));
  for(const entry of result.gates)assert.ok(entry.passed,`${entry.id}: ${entry.detail}`);
  assert.ok(result.ready);
});

test("each gate fails independently",()=>{
  const base=goodRows();

  const lowVolume=computeActivation(inputs(base.slice(0,400)));
  assert.ok(!lowVolume.ready);
  assert.ok(!gate(lowVolume,"volume").passed);
  assert.ok(gate(lowVolume,"per-market-volume").passed); // still 100 per market

  const thinMarket=computeActivation(inputs(base.filter((row,index)=>row.market!=="nrfi"||index<500))); // nrfi kept at 50 rows

  assert.ok(!gate(thinMarket,"per-market-volume").passed);

  const miscalibrated=computeActivation(inputs(base.map(row=>({...row,probability:.5+(row.probability-.5)*1.8,brier:(.5+(row.probability-.5)*1.8-row.outcome)**2}))));
  assert.ok(!gate(miscalibrated,"calibration").passed);

  const negativeClv=computeActivation(inputs(base.map(row=>({...row,clv:-.01}))));
  assert.ok(!gate(negativeClv,"clv").passed);
  assert.ok(!gate(negativeClv,"stability").passed);

  const losingRoi=computeActivation(inputs(base.map(row=>({...row,profit:row.outcome===1?.5:-1}))));
  assert.ok(!gate(losingRoi,"roi").passed);

  const criticalEvents=computeActivation(inputs(base,{criticalEvents:1}));
  assert.ok(!gate(criticalEvents,"data-quality").passed);

  const thinCoverage=computeActivation(inputs(base,{forecastDays:10,pricedDays:5}));
  assert.ok(!gate(thinCoverage,"data-quality").passed);
});

test("expected calibration error is zero for perfectly calibrated bins and large when systematically off",()=>{
  const calibrated=Array.from({length:100},(_,index)=>({probability:.7,outcome:index<70?1:0}));
  assert.ok((expectedCalibrationError(calibrated)??1)<1e-9);
  const off=Array.from({length:100},(_,index)=>({probability:.9,outcome:index<50?1:0}));
  assert.ok((expectedCalibrationError(off)??0)>.3);
  assert.equal(expectedCalibrationError([]),null);
});
