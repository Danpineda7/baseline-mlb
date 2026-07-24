import assert from "node:assert/strict";
import test from "node:test";
import { countOverProbability, fairAmerican, firstInningMarkets, impliedProbability, inningsToDecimal, noVigProbability, priceDecision, projectPeriod, projectScore, starterRunAdjustment, strikeoutExpectation } from "../lib/modeling.ts";

test("converts American prices and model probability consistently", () => {
  assert.equal(impliedProbability(-110)?.toFixed(4), "0.5238");
  assert.equal(impliedProbability(150)?.toFixed(4), "0.4000");
  assert.equal(impliedProbability(50), null);
  assert.equal(fairAmerican(0.6), "-150");
});

test("strikeout prop regresses workload and prices count lines",()=>{
  const small=strikeoutExpectation(14,2);
  const established=strikeoutExpectation(140,20);
  assert.ok(small!=null&&established!=null&&Math.abs(small-5.2)<Math.abs(established-5.2));
  const over=countOverProbability(6,5.5);
  assert.ok(over!=null&&over>0&&over<1);
  assert.ok((countOverProbability(7,5.5)??0)>over);
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
