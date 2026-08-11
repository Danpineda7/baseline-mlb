import assert from "node:assert/strict";
import test from "node:test";
import { dailyPicks } from "../lib/daily-picks.ts";

const side=(name,abbreviation,winProbability)=>({name,abbreviation,expectedRuns:4.8,winProbability,fairPrice:"-150",starter:{expectedStrikeouts:6.4}});
const game=(validatedMarkets)=>({
  id:1,startsAt:"2026-08-01T20:00:00Z",uncertainty:35,
  away:side("Away Club","AWY",.25),home:side("Home Club","HME",.75),
  total:{line:8.5,expectedRuns:9.6,overProbability:.72,underProbability:.28,overFairPrice:"-257",underFairPrice:"+257"},
  firstFive:{expectedRuns:5.4,awayWinProbability:.3,homeWinProbability:.7,awayFairPrice:"+233",homeFairPrice:"-233"},
  firstInning:{nrfiProbability:.42,yrfiProbability:.58,nrfiFairPrice:"+138",yrfiFairPrice:"-138"},
  lineups:{away:[],home:[],confirmed:false},
  quality:{teamRecords:true,starterStats:true,lineups:false,bullpen:true,weather:true,parkSample:true,validatedMarkets:{moneyline:false,total:false,firstFive:false,firstInning:false,pitcherStrikeouts:false,hitterHits:false,...validatedMarkets}},
});

test("nothing is recommended while no market is validated, even at high probability",()=>{
  const board=dailyPicks([game({})]);
  assert.ok(board.all.length>0);
  assert.ok(board.all.some(pick=>pick.probability>=.55));
  assert.equal(board.recommended.length,0);
  assert.ok(board.all.every(pick=>!pick.recommended));
});

test("a validated market with sufficient probability becomes a recommended pick",()=>{
  const board=dailyPicks([game({moneyline:true})]);
  assert.ok(board.recommended.length>0);
  assert.ok(board.recommended.every(pick=>pick.validated&&pick.probability>=.55));
  assert.equal(board.recommended[0].market,"SIDE");
});

test("run line and team total stay research-only regardless of probability",()=>{
  const board=dailyPicks([game({moneyline:true,total:true,firstFive:true,firstInning:true,pitcherStrikeouts:true,hitterHits:true})]);
  for(const pick of board.all.filter(row=>row.market==="RUN LINE"||row.market==="TEAM TOTAL")){
    assert.ok(!pick.validated);
    assert.ok(!pick.recommended);
  }
});
