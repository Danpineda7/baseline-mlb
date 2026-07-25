import assert from "node:assert/strict";
import test from "node:test";
import {verifyRecommendation} from "../lib/recommendation.ts";

const game={id:1,startsAt:"2099-01-01T00:00:00Z",uncertainty:40,away:{name:"Away",abbreviation:"AWY",winProbability:.38,starter:{playerId:10,expectedStrikeouts:6.2}},home:{name:"Home",abbreviation:"HME",winProbability:.62,starter:{playerId:11,expectedStrikeouts:5.8}},total:{line:8.5,overProbability:.58,underProbability:.42},firstFive:{awayWinProbability:.4,homeWinProbability:.6},firstInning:{nrfiProbability:.62,yrfiProbability:.38},lineups:{confirmed:true,away:[{id:20,name:"Hitter",onePlusHitProbability:.68,platoonAdjusted:true}],home:[]},quality:{teamRecords:true,starterStats:true,awayStarter:true,homeStarter:true,opponentStrikeouts:true}};

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
  const badLine=verifyRecommendation(game,{market:"over",selectionKey:"over",subjectId:null,line:9.5,americanOdds:110,oppositeOdds:-130});
  assert.match(badLine.error,/Unsupported/);
});

test("server recommendation resolver enforces critical data gates",()=>{
  const incomplete={...game,quality:{...game.quality,starterStats:false}};
  const result=verifyRecommendation(incomplete,{market:"moneyline",selectionKey:"home",subjectId:null,line:null,americanOdds:-110,oppositeOdds:-110});
  assert.match(result.error,/Both probable starters/);
});
