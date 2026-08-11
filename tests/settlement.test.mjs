import assert from "node:assert/strict";
import test from "node:test";
import { gradeBet } from "../lib/settlement.ts";

const game={awayRuns:4,homeRuns:5,innings:[{num:1,awayRuns:0,homeRuns:0},{num:2,awayRuns:1,homeRuns:2},{num:3,awayRuns:0,homeRuns:0},{num:4,awayRuns:1,homeRuns:0},{num:5,awayRuns:0,homeRuns:0},{num:6,awayRuns:2,homeRuns:3}],players:{10:{hits:2,strikeOuts:0},20:{hits:0,strikeOuts:7}}};
const base={selectionKey:"home",subjectId:null,line:null,americanOdds:-110,stakeUnits:0.005};
test("grades core markets and pushes correctly",()=>{
  assert.equal(gradeBet({...base,market:"moneyline"},game)?.result,"WON");
  assert.equal(gradeBet({...base,market:"over",line:9},game)?.result,"PUSH");
  assert.equal(gradeBet({...base,market:"under",line:8.5},game)?.result,"LOST");
  assert.equal(gradeBet({...base,market:"f5",selectionKey:"away"},game)?.result,"PUSH");
  assert.equal(gradeBet({...base,market:"nrfi",selectionKey:"nrfi"},game)?.result,"WON");
});
test("grades player props and computes offered-price profit",()=>{
  const hit=gradeBet({...base,market:"hit",subjectId:10,selectionKey:"onePlus",americanOdds:150},game);
  assert.equal(hit?.result,"WON");assert.equal(hit?.profitUnits,0.0075);
  assert.equal(gradeBet({...base,market:"awayK",subjectId:20,line:6.5,selectionKey:"over"},game)?.result,"WON");
});
test("voids F5 when five innings are incomplete",()=>{
  const shortened={...game,innings:game.innings.filter(inning=>inning.num<=4)};
  const grade=gradeBet({...base,market:"f5",selectionKey:"home"},shortened);
  assert.equal(grade?.result,"VOID");
  assert.equal(grade?.profitUnits,0);
});
test("voids missing player participation and pushes an official tie",()=>{
  assert.equal(gradeBet({...base,market:"hit",subjectId:999,selectionKey:"onePlus"},game)?.result,"VOID");
  assert.equal(gradeBet({...base,market:"moneyline"},{...game,awayRuns:5,homeRuns:5})?.result,"PUSH");
});
test("voids player props for recorded non-participants and keeps legacy stats gradable",()=>{
  const withScratch={...game,players:{...game.players,30:{hits:0,strikeOuts:0,plateAppearances:0,outsPitched:0}}};
  assert.equal(gradeBet({...base,market:"hit",subjectId:30,selectionKey:"onePlus"},withScratch)?.result,"VOID");
  assert.equal(gradeBet({...base,market:"awayK",subjectId:30,line:5.5,selectionKey:"over"},withScratch)?.result,"VOID");
  // Rows without participation fields (older data) still grade from raw stats.
  assert.equal(gradeBet({...base,market:"hit",subjectId:10,selectionKey:"onePlus"},withScratch)?.result,"WON");
});
