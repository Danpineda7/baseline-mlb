import assert from "node:assert/strict";
import test from "node:test";
import { projectionUncertainty, slateQualityScore } from "../lib/data-quality.ts";

test("slate quality weights exact source coverage",()=>{
  const full={available:10,expected:10};
  assert.equal(slateQualityScore({teams:full,starters:full,lineups:full,hitters:full,weather:full,parks:full,bullpens:full,calibrated:true}),100);
  assert.ok(slateQualityScore({teams:full,starters:{available:0,expected:10},lineups:full,hitters:full,weather:full,parks:full,bullpens:full,calibrated:true})<100);
});

test("missing critical inputs increase projection uncertainty",()=>{
  const complete=projectionUncertainty({missingTeams:0,missingStarters:0,lineupsConfirmed:true,weatherAvailable:true,parkGames:50,parkFactor:1,historicalSeason:false});
  const incomplete=projectionUncertainty({missingTeams:1,missingStarters:2,lineupsConfirmed:false,weatherAvailable:false,parkGames:0,parkFactor:1.08,historicalSeason:false});
  assert.ok(incomplete>complete);
});
