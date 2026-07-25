import assert from "node:assert/strict";
import test from "node:test";
import {CLOSING_WINDOW_MS,closingWindow,validAmericanOdds} from "../lib/ledger-validation.ts";

test("American odds must be finite bounded integers",()=>{
  for(const value of [-110,100,275,-10000])assert.equal(validAmericanOdds(value),true);
  for(const value of [99,-99,110.5,Infinity,NaN,10001])assert.equal(validAmericanOdds(value),false);
});

test("closing prices are accepted only in the final 30 pregame minutes",()=>{
  const start=Date.parse("2026-07-24T20:00:00Z"),startsAt=new Date(start).toISOString();
  assert.equal(closingWindow(startsAt,start-CLOSING_WINDOW_MS-1).open,false);
  assert.equal(closingWindow(startsAt,start-CLOSING_WINDOW_MS).open,true);
  assert.equal(closingWindow(startsAt,start-1).open,true);
  assert.equal(closingWindow(startsAt,start).open,false);
});
