import assert from "node:assert/strict";
import test from "node:test";
import { canonical } from "../lib/oddspapi.ts";
import { resolveMlbTeam, sameMlbTeam } from "../lib/mlb-teams.ts";

const market=(overrides)=>({marketId:1,marketName:"",playerProp:false,sportId:6,handicap:null,period:"",marketType:"",outcomes:[],...overrides});

test("NRFI and YRFI are two selections of ONE canonical market",()=>{
  const firstInningTotal=market({marketName:"1st Inning Total",marketType:"totals",handicap:0.5});
  assert.deepEqual(canonical(firstInningTotal,"Under 0.5",null),{market:"nrfi",selection:"nrfi"});
  assert.deepEqual(canonical(firstInningTotal,"Over 0.5",null),{market:"nrfi",selection:"yrfi"});
});

test("first-inning totals at any other line are NOT NRFI",()=>{
  const wrongLine=market({marketName:"1st Inning Total",marketType:"totals",handicap:1.5});
  assert.deepEqual(canonical(wrongLine,"Under 1.5",null),{market:null,selection:null});
});

test("a first-inning winner market is never stored as the game moneyline",()=>{
  const inningWinner=market({marketName:"1st Inning Winner",marketType:"moneyline"});
  assert.deepEqual(canonical(inningWinner,"1","home"),{market:null,selection:null});
});

test("game moneyline maps participant order through the home/away role",()=>{
  const moneyline=market({marketName:"Moneyline",marketType:"moneyline"});
  assert.deepEqual(canonical(moneyline,"1","home"),{market:"moneyline",selection:"home"});
  assert.deepEqual(canonical(moneyline,"2","home"),{market:"moneyline",selection:"away"});
  assert.deepEqual(canonical(moneyline,"1",null),{market:"moneyline",selection:null});
});

test("first-half moneyline maps to F5",()=>{
  const firstHalf=market({marketName:"1st Half Moneyline",marketType:"moneyline"});
  assert.deepEqual(canonical(firstHalf,"1","away"),{market:"f5",selection:"away"});
});

test("full-game totals map; team totals and player props do not",()=>{
  const totals=market({marketName:"Total Runs",marketType:"totals",handicap:8.5});
  assert.deepEqual(canonical(totals,"Over 8.5",null),{market:"over",selection:"over"});
  assert.deepEqual(canonical(totals,"Under 8.5",null),{market:"over",selection:"under"});
  const teamTotal=market({marketName:"Home Team Total",marketType:"totals",handicap:4.5});
  assert.deepEqual(canonical(teamTotal,"Over 4.5",null),{market:null,selection:null});
  const prop=market({marketName:"Player Strikeouts",marketType:"totals",handicap:5.5,playerProp:true});
  assert.deepEqual(canonical(prop,"Over 5.5",null),{market:null,selection:null});
});

test("team resolution only succeeds on known aliases and never guesses",()=>{
  assert.ok(sameMlbTeam("New York Yankees","NY Yankees"));
  assert.ok(sameMlbTeam("St. Louis Cardinals","St Louis Cardinals"));
  assert.ok(!sameMlbTeam("New York Yankees","New York Mets"));
  assert.ok(!sameMlbTeam("Chicago Cubs","Chicago White Sox"));
  assert.equal(resolveMlbTeam("Random Baseball Club"),null);
  assert.equal(resolveMlbTeam("New York"),null);
});
