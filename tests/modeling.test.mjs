import assert from "node:assert/strict";
import test from "node:test";
import { bullpenFatigueAdjustment, closingLineValue, countOverProbability, empiricalParkFactor, fairAmerican, firstInningMarkets, hitterHitProjection, impliedProbability, inningsToDecimal, noVigProbability, opponentAdjustedStrikeouts, priceDecision, projectPeriod, projectScore, starterRunAdjustment, strikeoutExpectation } from "../lib/modeling.ts";

test("converts American prices and model probability consistently", () => {
  assert.equal(impliedProbability(-110)?.toFixed(4), "0.5238");
  assert.equal(impliedProbability(150)?.toFixed(4), "0.4000");
  assert.equal(impliedProbability(50), null);
  assert.equal(fairAmerican(0.6), "-150");
});

test("hitter one-plus hit model regresses rate and returns valid probability",()=>{
  const projection=hitterHitProjection(75,250,280,70);
  assert.ok(projection!=null);
  assert.ok(projection.hitRate>0.245&&projection.hitRate<0.3);
  assert.ok(projection.onePlusProbability>0&&projection.onePlusProbability<1);
  assert.equal(hitterHitProjection(0,0,0,0),null);
});

test("strikeout prop regresses workload and prices count lines",()=>{
  const small=strikeoutExpectation(14,2);
  const established=strikeoutExpectation(140,20);
  assert.ok(small!=null&&established!=null&&Math.abs(small-5.2)<Math.abs(established-5.2));
  const over=countOverProbability(6,5.5);
  assert.ok(over!=null&&over>0&&over<1);
  assert.ok((countOverProbability(7,5.5)??0)>over);
});

test("opponent strikeout adjustment is regressed and capped",()=>{
  const neutral=opponentAdjustedStrikeouts(6,900,4000,0.225);
  const high=opponentAdjustedStrikeouts(6,1200,4000,0.225);
  const low=opponentAdjustedStrikeouts(6,500,4000,0.225);
  assert.ok(neutral!=null&&high!=null&&low!=null&&high>neutral&&neutral>low);
  assert.ok(high<=6*1.12&&low>=6*0.88);
  assert.equal(opponentAdjustedStrikeouts(null,900,4000,0.225),null);
});

test("first-five push and NRFI/YRFI markets normalize",()=>{
  const f5=projectPeriod(2.4,2.1);
  assert.ok(Math.abs(f5.awayWin+f5.homeWin+f5.tie-1)<1e-8);
  assert.ok(Math.abs(f5.awayNoPush+f5.homeNoPush-1)<1e-8);
  const first=firstInningMarkets(4.2,4.6,0.115);
  assert.ok(Math.abs(first.nrfi+first.yrfi-1)<1e-12);
  assert.ok(first.nrfi>0&&first.nrfi<1);
});

test("starter adjustment regresses small samples and understands baseball innings", () => {
  assert.equal(inningsToDecimal("12.2").toFixed(3), "12.667");
  assert.equal(inningsToDecimal("12.3"), 0);
  const smallSample=starterRunAdjustment(2,10);
  const largeSample=starterRunAdjustment(2,100);
  assert.ok(Math.abs(smallSample)<Math.abs(largeSample));
  assert.ok(largeSample<0);
  assert.equal(starterRunAdjustment(null,100),0);
});

test("bullpen fatigue is conservative and increases with concentrated recent workload",()=>{
  assert.equal(bullpenFatigueAdjustment([]),0);
  assert.equal(bullpenFatigueAdjustment([10,12,14,15]),0);
  const moderate=bullpenFatigueAdjustment([35,25,10,0]);
  const heavy=bullpenFatigueAdjustment([60,52,45,38]);
  assert.ok(moderate>0&&heavy>moderate);
  assert.ok(heavy<=0.18);
});

test("score distribution is normalized", () => {
  const result = projectScore(4.2, 4.6, 8.5);
  assert.ok(Math.abs(result.awayWin + result.homeWin - 1) < 1e-8);
  assert.ok(Math.abs(result.over + result.under + result.push - 1) < 1e-8);
});

test("risk gate rejects small edge and sizes qualifying edge conservatively", () => {
  assert.equal(priceDecision(0.54, -110, 0.4)?.qualifies, false);
  const decision = priceDecision(0.62, -110, 0.4);
  assert.equal(decision?.qualifies, true);
  assert.ok((decision?.stakeFraction ?? 0) > 0 && (decision?.stakeFraction ?? 1) <= 0.005);
});

test("removes two-sided sportsbook vig before calculating edge", () => {
  assert.equal(noVigProbability(-110,-110)?.toFixed(4),"0.5000");
  const decision=priceDecision(0.54,-110,0.4,-110);
  assert.equal(decision?.vigRemoved,true);
  assert.equal(decision?.marketProbability.toFixed(4),"0.5000");
  assert.equal(decision?.edge.toFixed(4),"0.0400");
});

test("measures CLV from two-sided no-vig closing probability",()=>{
  const clv=closingLineValue(0.5,-130,110);
  assert.ok(clv);
  assert.ok(clv.value>0);
  assert.equal(clv.value.toFixed(4),(clv.closingProbability-0.5).toFixed(4));
});

test("park factor regresses small samples and remains bounded",()=>{
  const small=empiricalParkFactor(24,2,18,2,9);
  const large=empiricalParkFactor(300,25,225,25,9);
  assert.ok(Math.abs(small-1)<Math.abs(large-1));
  assert.equal(empiricalParkFactor(1000,10,0,10,9),1.1);
  assert.equal(empiricalParkFactor(0,10,1000,10,9),0.9);
});
