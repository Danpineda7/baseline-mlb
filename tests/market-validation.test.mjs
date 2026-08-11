import assert from "node:assert/strict";
import test from "node:test";
import { marketValidation } from "../lib/market-validation.ts";

const START="2026-08-01T20:00:00Z";
const at=(minutesBeforeStart)=>new Date(Date.parse(START)-minutesBeforeStart*60*1000).toISOString();
const observation=(overrides)=>({game_id:1,market:"raw",selection:"raw",line:null,american_odds:-110,observed_at:at(15),sportsbook:"Pinnacle",metadata_json:"{}",...overrides});
const canonical=(market,selection,extra={})=>observation({metadata_json:JSON.stringify({canonicalMarket:market,canonicalSelection:selection}),...extra});
const forecast=(overrides)=>({game_id:1,market:"moneyline",selection_key:"home",line:null,probability:.6,outcome:1,starts_at:START,...overrides});

test("NRFI forecasts pair with YRFI observations in the same canonical market",()=>{
  const result=marketValidation(
    [forecast({market:"nrfi",selection_key:"nrfi"})],
    [canonical("nrfi","nrfi",{observed_at:at(20)}),canonical("nrfi","yrfi",{observed_at:at(19)})],
  );
  assert.equal(result.pricedForecasts,1);
  assert.equal(result.closingPriced,1);
});

test("two sides observed far apart never form a price",()=>{
  const result=marketValidation(
    [forecast()],
    [canonical("moneyline","home",{observed_at:at(120)}),canonical("moneyline","away",{observed_at:at(80)})],
  );
  assert.equal(result.pricedForecasts,0);
});

test("free-text selections without canonical metadata are ignored",()=>{
  const result=marketValidation(
    [forecast({market:"over",selection_key:"over",line:8.5})],
    [observation({market:"over",selection:"Over 8.5",line:8.5}),observation({market:"over",selection:"Opposite of Over 8.5",line:8.5})],
  );
  assert.equal(result.pricedForecasts,0);
});

test("line markets require an exact line match and reject null lines",()=>{
  const rows=(line)=>[canonical("over","over",{line,observed_at:at(20)}),canonical("over","under",{line,observed_at:at(19)})];
  assert.equal(marketValidation([forecast({market:"over",selection_key:"over",line:8.5})],rows(9.5)).pricedForecasts,0);
  assert.equal(marketValidation([forecast({market:"over",selection_key:"over",line:8.5})],rows(null)).pricedForecasts,0);
  assert.equal(marketValidation([forecast({market:"over",selection_key:"over",line:8.5})],rows(8.5)).pricedForecasts,1);
});

test("ROI is simulated at the entry price and CLV measures movement toward the close",()=>{
  const result=marketValidation(
    [forecast()],
    [
      canonical("moneyline","home",{american_odds:100,observed_at:at(240)}),
      canonical("moneyline","away",{american_odds:-120,observed_at:at(239)}),
      canonical("moneyline","home",{american_odds:-120,observed_at:at(10)}),
      canonical("moneyline","away",{american_odds:100,observed_at:at(9)}),
    ],
  );
  assert.equal(result.pricedForecasts,1);
  const row=result.evaluated[0];
  assert.ok(row.qualifies);
  assert.ok(row.closingClass);
  assert.equal(row.profit,1); // won at the +100 entry price
  assert.ok(row.clv>0); // market moved toward the selection by close
  assert.ok(row.entryProbability<row.closeProbability);
});

test("summaries report coverage, closing counts and a CI once plays exist",()=>{
  const odds=[
    canonical("moneyline","home",{american_odds:100,observed_at:at(240)}),
    canonical("moneyline","away",{american_odds:-120,observed_at:at(239)}),
  ];
  const result=marketValidation([forecast(),forecast({game_id:2,outcome:0})],[...odds,...odds.map(row=>({...row,game_id:2}))]);
  assert.equal(result.forecasts,2);
  assert.equal(result.pricedForecasts,2);
  assert.equal(result.qualifying,2);
  assert.ok(result.roiCi95==null||result.roiCi95[0]<=result.roi);
});
