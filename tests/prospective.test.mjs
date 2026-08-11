import assert from "node:assert/strict";
import test from "node:test";
import {forecastCandidates,prospectiveMetrics} from "../lib/prospective.ts";

const game={id:10,startsAt:"2026-07-25T20:00:00Z",quality:{teamRecords:true,starterStats:true,validatedMarkets:{moneyline:true,total:true,firstFive:true,firstInning:true}},home:{winProbability:.6},total:{line:8.5,overProbability:.55},firstFive:{homeWinProbability:.57},firstInning:{nrfiProbability:.53}};

test("freezes every eligible core market in shadow mode",()=>{
  const rows=forecastCandidates([game],"2026-07-25","v1",Date.parse("2026-07-25T19:00:00Z"));
  assert.deepEqual(rows.map(row=>row.market),["moneyline","over","f5","nrfi"]);
  assert.equal(new Set(rows.map(row=>row.id)).size,4);
  assert.ok(rows.every(row=>row.id.startsWith("v1:")));
  assert.equal(forecastCandidates([{...game,startsAt:"2026-07-25T18:00:00Z"}],"2026-07-25","v1",Date.parse("2026-07-25T19:00:00Z")).length,0);
  assert.equal(forecastCandidates([{...game,quality:{...game.quality,starterStats:false}}],"2026-07-25","v1",Date.parse("2026-07-25T19:00:00Z")).length,0);
});

test("prospective metrics summarize only scored forecasts by market",()=>{
  const rows=[{market:"moneyline",probability:.7,outcome:1,brier:.09},{market:"moneyline",probability:.6,outcome:0,brier:.36},{market:"nrfi",probability:.4,outcome:0,brier:.16}];
  const result=prospectiveMetrics(rows);
  assert.equal(result.total.count,3);
  assert.equal(result.total.accuracy,2/3);
  assert.equal(result.markets.find(row=>row.market==="moneyline").count,2);
  assert.equal(result.bands.reduce((sum,row)=>sum+row.count,0),3);
});

test("forecasts freeze only inside the six-hour pre-pitch window",()=>{
  const farOut=forecastCandidates([game],"2026-07-25","v1",Date.parse("2026-07-25T08:00:00Z"));
  assert.equal(farOut.length,0);
  const inWindow=forecastCandidates([game],"2026-07-25","v1",Date.parse("2026-07-25T15:00:00Z"));
  assert.equal(inWindow.length,4);
});
