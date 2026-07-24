import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("renders the Baseline analysis cockpit", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Baseline — MLB Intelligence<\/title>/i);
  assert.match(html, /Daily slate/);
  assert.match(html, /Official schedule/i);
  assert.match(html, /Model leans/);
  assert.match(html, /Source health/i);
  assert.match(html, /CALIBRATION PENDING/);
  assert.match(html, /No wager qualifies/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});
