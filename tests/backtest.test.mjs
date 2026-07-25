import assert from "node:assert/strict";
import test from "node:test";
import { applyProbabilityCalibration, fitProbabilityCalibration, walkForwardBacktest } from "../lib/backtest.ts";

function game(id, day, awayId, homeId, awayScore, homeScore) { return {id,playedAt:`2026-04-${String(day).padStart(2,"0")}T18:00:00Z`,awayId,homeId,awayScore,homeScore,firstInningAway:day%3===0?1:0,firstInningHome:day%4===0?1:0,firstFiveAway:Math.min(awayScore,2),firstFiveHome:Math.min(homeScore,3)}; }

test("walk-forward predictions begin only after prior-game threshold", () => {
  const games=[];
  for(let day=1;day<=6;day++) games.push(game(day,day,1,2,day%4,3));
  const result=walkForwardBacktest(games,3);
  assert.equal(result.metrics.count,3);
  assert.equal(result.predictions[0].id,4);
});

test("future score changes cannot alter an earlier prediction", () => {
  const games=[];
  for(let day=1;day<=5;day++) games.push(game(day,day,1,2,2,4));
  const original=walkForwardBacktest(games,2);
  const changed=walkForwardBacktest([...games.slice(0,4),{...games[4],homeScore:40}],2);
  assert.equal(original.predictions[0].probability,changed.predictions[0].probability);
  assert.equal(original.predictions[1].probability,changed.predictions[1].probability);
  assert.equal(original.predictions[2].probability,changed.predictions[2].probability);
});

test("same-day results cannot influence another game on that date",()=>{
  const warmup=[game(1,1,1,2,2,4),game(2,2,1,2,3,5),game(3,3,1,2,1,4)];
  const first={...game(4,4,1,2,0,1),playedAt:"2026-04-04T17:00:00Z"};
  const second={...game(5,4,1,2,2,3),playedAt:"2026-04-04T23:00:00Z"};
  const original=walkForwardBacktest([...warmup,first,second],2);
  const changed=walkForwardBacktest([...warmup,{...first,awayScore:25,homeScore:0},second],2);
  assert.equal(original.predictions.find(row=>row.id===5).probability,changed.predictions.find(row=>row.id===5).probability);
  assert.equal(original.predictions.find(row=>row.id===5).expectedTotal,changed.predictions.find(row=>row.id===5).expectedTotal);
});

test("team feature state resets at each season boundary",()=>{
  const prior=[1,2,3].map(day=>game(day,day,1,2,8,1));
  const current=[{...game(10,1,1,2,1,8),playedAt:"2027-04-01T18:00:00Z"},{...game(11,2,1,2,1,8),playedAt:"2027-04-02T18:00:00Z"}];
  const result=walkForwardBacktest([...prior,...current],2);
  assert.deepEqual(result.predictions.map(row=>row.id),[3]);
});

test("walk-forward validation reports core market families",()=>{
  const games=[];
  for(let day=1;day<=8;day++)games.push(game(day,day,1,2,day%4,3));
  const result=walkForwardBacktest(games,3);
  assert.equal(result.marketMetrics.moneyline.count,5);
  assert.equal(result.marketMetrics.totalOver85.count,5);
  assert.ok(result.marketMetrics.firstFiveHome.count>0);
  assert.equal(result.marketMetrics.nrfi.count,5);
  for(const metrics of Object.values(result.marketMetrics)){assert.ok(metrics.brier==null||(metrics.brier>=0&&metrics.brier<=1));}
});

test("Platt calibration is monotonic and refuses small samples",()=>{
  const rows=Array.from({length:240},(_,index)=>({probability:0.3+index/600,outcome:index%3===0?1:0}));
  assert.equal(fitProbabilityCalibration(rows.slice(0,199)),null);
  const model=fitProbabilityCalibration(rows);
  assert.ok(model);
  let previous=0;
  for(let probability=0.05;probability<0.96;probability+=0.01){const calibrated=applyProbabilityCalibration(probability,model);assert.ok(calibrated>=previous-1e-12);previous=calibrated;}
});

test("calibrated predictions never learn from a future result",()=>{
  const games=Array.from({length:230},(_,index)=>({id:index+1,playedAt:`2026-${String(index+1).padStart(4,"0")}`,awayId:1,homeId:2,awayScore:index%2,homeScore:(index+1)%2}));
  const original=walkForwardBacktest(games,2),changed=walkForwardBacktest([...games.slice(0,-1),{...games.at(-1),homeScore:20}],2);
  assert.equal(original.predictions.at(-2).calibratedProbability,changed.predictions.at(-2).calibratedProbability);
  assert.equal(original.predictions.at(-2).calibratedOverProbability,changed.predictions.at(-2).calibratedOverProbability);
});

test("market calibration selection uses only prior predictions",()=>{
  const games=[];for(let index=0;index<240;index++)games.push({...game(index+1,(index%28)+1,1,2,index%5,(index+2)%6),playedAt:`2026-${String(index+1).padStart(4,"0")}`});
  const result=walkForwardBacktest(games,2);
  assert.ok(result.marketCalibratedMetrics.totalOver85);
  assert.ok(result.liveMarketCalibrations.totalOver85);
  assert.ok(["identity","regularized-platt"].includes(result.marketCalibratedMetrics.totalOver85.selectedMethod));
});
