import assert from "node:assert/strict";
import test from "node:test";
import { walkForwardBacktest } from "../lib/backtest.ts";

function game(id, day, awayId, homeId, awayScore, homeScore) { return {id,playedAt:`2026-04-${String(day).padStart(2,"0")}T18:00:00Z`,awayId,homeId,awayScore,homeScore}; }

test("walk-forward predictions begin only after prior-game threshold", () => {
  const games=[];
  for(let day=1;day<=6;day++) games.push(game(day,day,1,2,day%4,3));
  const result=walkForwardBacktest(games,3);
  assert.equal(result.metrics.count,3);
  assert.equal(result.predictions[0].id,4);
});

test("future score changes cannot alter an earlier prediction", () => {
  const games=[];
  for(let day=1;day<=5;day++) games.push(game(day,day,1,2,2,4));
  const original=walkForwardBacktest(games,2);
  const changed=walkForwardBacktest([...games.slice(0,4),{...games[4],homeScore:40}],2);
  assert.equal(original.predictions[0].probability,changed.predictions[0].probability);
  assert.equal(original.predictions[1].probability,changed.predictions[1].probability);
  assert.equal(original.predictions[2].probability,changed.predictions[2].probability);
});
