import assert from "node:assert/strict";
import test from "node:test";
import {verifyRecommendation} from "../lib/recommendation.ts";

const game={id:1,startsAt:"2099-01-01T00:00:00Z",uncertainty:40,away:{name:"Away",abbreviation:"AWY",expectedRuns:3.8,winProbability:.38,starter:{playerId:10,expectedStrikeouts:6.2}},home:{name:"Home",abbreviation:"HME",expectedRuns:4.7,winProbability:.62,starter:{playerId:11,expectedStrikeouts:5.8}},total:{line:8.5,overProbability:.58,underProbability:.42},firstFive:{awayWinProbability:.4,homeWinProbability:.6},firstInning:{nrfiProbability:.62,yrfiProbability:.38},lineups:{confirmed:true,away:[{id:20,name:"Hitter",onePlusHitProbability:.68,platoonAdjusted:true}],home:[]},quality:{teamRecords:true,starterStats:true,awayStarter:true,homeStarter:true,opponentStrikeouts:true,validatedMarkets:{moneyline:true,total:true,firstFive:true,firstInning:true,pitcherStrikeouts:true,hitterHits:true}}};

test("server recommendation resolver ignores client calculations and derives its own",()=>{
  const result=verifyRecommendation(game,{market:"moneyline",selectionKey:"home",subjectId:null,line:null,americanOdds:-110,oppositeOdds:-110});
  assert.equal(result.error,undefined);
  assert.equal(result.probability,.62);
  assert.ok(result.edge>0);
  assert.ok(result.stakeUnits<=.005);
  assert.ok(result.maxPlayableOdds!=null);
});

test("server recommendation resolver rejects mismatched props",()=>{
  const badPitcher=verifyRecommendation(game,{market:"awayK",selectionKey:"over",subjectId:999,line:5.5,americanOdds:120,oppositeOdds:-140});
  assert.match(badPitcher.error,/identifiers/);
  const badLine=verifyRecommendation(game,{market:"over",selectionKey:"over",subjectId:null,line:9.3,americanOdds:110,oppositeOdds:-130});
  assert.match(badLine.error,/Unsupported/);
});

test("server prices the exact offered half-run total line",()=>{
  const result=verifyRecommendation(game,{market:"over",selectionKey:"over",subjectId:null,line:7.5,americanOdds:120,oppositeOdds:-140});
  assert.equal(result.error,undefined);
  assert.match(result.selection,/Over 7\.5/);
  assert.notEqual(result.probability,game.total.overProbability);
});

test("server recommendation resolver enforces critical data gates",()=>{
  const incomplete={...game,quality:{...game.quality,starterStats:false}};
  const result=verifyRecommendation(incomplete,{market:"moneyline",selectionKey:"home",subjectId:null,line:null,americanOdds:-110,oppositeOdds:-110});
  assert.match(result.error,/Both probable starters/);
});

test("server recommendation resolver blocks markets without their own validation",()=>{
  const unvalidated={...game,quality:{...game.quality,validatedMarkets:{...game.quality.validatedMarkets,pitcherStrikeouts:false,hitterHits:false}}};
  const pitcher=verifyRecommendation(unvalidated,{market:"awayK",selectionKey:"over",subjectId:10,line:5.5,americanOdds:120,oppositeOdds:-140});
  const hitter=verifyRecommendation(unvalidated,{market:"hit",selectionKey:"onePlus",subjectId:20,line:null,americanOdds:-110,oppositeOdds:-110});
  assert.match(pitcher.error,/market-specific walk-forward validation/);
  assert.match(hitter.error,/market-specific walk-forward validation/);
});
