import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";

// The dashboard renders client-side on Next.js; real rendering is exercised by
// `next build` and the browser. These checks pin the honest-labeling contract
// at the source level so a refactor cannot silently drop it.

test("dashboard keeps its honest-labeling sections", async () => {
  const source = await readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8");
  for (const marker of [
    "Model leans—not recommendations",
    "Highest conservative probabilities",
    "Anonymous paper-testing results",
    "Research workspace",
    "MARKET-AWARE VALIDATION",
    "activation.gates",
    "price-verified",
    "Freeze paper decision",
  ]) assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), marker);
  assert.doesNotMatch(source, /RecommendationBoard|saveRecommendation|canSave/);
});

test("data-health UI lists every modeled source family", async () => {
  const source = await readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8");
  for (const label of ["Bullpen workload", "Opponent K rates", "Hitter platoon splits", "Roster statuses"]) assert.match(source, new RegExp(label));
});

test("layout metadata stays intact", async () => {
  const source = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(source, /Baseline — MLB Intelligence/);
  assert.match(source, /generateMetadata/);
});
