import assert from "node:assert/strict";
import test from "node:test";
import { fairAmerican, impliedProbability, priceDecision, projectScore } from "../lib/modeling.ts";

test("converts American prices and model probability consistently", () => {
  assert.equal(impliedProbability(-110)?.toFixed(4), "0.5238");
  assert.equal(impliedProbability(150)?.toFixed(4), "0.4000");
  assert.equal(impliedProbability(50), null);
  assert.equal(fairAmerican(0.6), "-150");
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
