import assert from "node:assert/strict";
import test from "node:test";
import { portfolioDecision } from "../lib/risk.ts";

const position=(overrides={})=>({gameId:1,gameDate:"2026-07-24",market:"moneyline",selectionKey:"home",line:null,stakeUnits:0.005,...overrides});

test("portfolio gate rejects duplicates and correlated game overexposure",()=>{
  assert.equal(portfolioDecision([position()],position()).qualifies,false);
  const other=position({market:"over",selectionKey:"over",line:8.5});
  assert.equal(portfolioDecision([position(),other],position({market:"nrfi",selectionKey:"nrfi"})).qualifies,false);
});

test("portfolio gate enforces daily exposure across games",()=>{
  const open=[1,2,3,4].map(gameId=>position({gameId,market:"moneyline",selectionKey:gameId%2?"home":"away"}));
  const decision=portfolioDecision(open,position({gameId:5}));
  assert.equal(decision.qualifies,false);
  assert.match(decision.reason,/Daily exposure/);
});
