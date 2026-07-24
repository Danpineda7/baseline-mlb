"use client";

import { useMemo, useState } from "react";
import { games, modelChecks, recommendations, sources, type Market } from "@/lib/demo-data";

const markets: Array<"All" | Market> = ["All", "Moneyline", "Total", "First 5", "Player prop"];

function Logo() {
  return <div className="logo" aria-label="Baseline home"><span className="logo-mark">B</span><span>BASELINE</span></div>;
}

function ConfidenceRing({ value }: { value: number }) {
  return <span className="confidence" style={{ "--score": `${value * 3.6}deg` } as React.CSSProperties}><span>{value}</span></span>;
}

export function Dashboard() {
  const [market, setMarket] = useState<(typeof markets)[number]>("All");
  const [selected, setSelected] = useState(recommendations[0].id);
  const [navOpen, setNavOpen] = useState(false);
  const visible = useMemo(() => market === "All" ? recommendations : recommendations.filter((pick) => pick.market === market), [market]);
  const active = recommendations.find((pick) => pick.id === selected) ?? recommendations[0];
  const game = games.find((item) => item.id === active.gameId)!;

  return (
    <main className="app-shell">
      <aside className={`sidebar ${navOpen ? "open" : ""}`}>
        <Logo />
        <nav aria-label="Primary navigation">
          <a className="nav-link active" href="#slate"><span>◫</span>Today</a>
          <a className="nav-link" href="#models"><span>⌁</span>Models</a>
          <a className="nav-link" href="#data"><span>◉</span>Data health</a>
          <a className="nav-link" href="#performance"><span>↗</span>Performance</a>
        </nav>
        <div className="sidebar-foot">
          <div className="system-dot"><i /> System ready</div>
          <button className="user-chip"><span>DB</span><small>Daniel’s workspace</small></button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <button className="menu" onClick={() => setNavOpen(!navOpen)} aria-label="Toggle navigation">☰</button>
          <div><p className="eyebrow">FRIDAY · JUL 24</p><h1>Today’s slate</h1></div>
          <div className="top-actions"><button className="ghost-button">Backtest</button><button className="primary-button"><span>↻</span> Refresh data</button></div>
        </header>

        <div className="notice" role="status"><span>✓</span><div><strong>Foundation mode</strong><p>Interface uses representative data while ingestion, odds and model services are connected.</p></div><button aria-label="Dismiss notice">×</button></div>

        <section className="hero-grid" id="slate">
          <article className="slate-card">
            <div className="section-head"><div><p className="eyebrow">DECISION BOARD</p><h2>Highest-quality edges</h2></div><div className="segmented" role="group" aria-label="Market filter">{markets.map((item) => <button key={item} onClick={() => setMarket(item)} className={market === item ? "active" : ""}>{item}</button>)}</div></div>
            <div className="pick-table" role="table" aria-label="Recommended bets">
              <div className="table-row table-header" role="row"><span>Selection</span><span>Market</span><span>Model</span><span>Price</span><span>Edge</span></div>
              {visible.map((pick) => (
                <button className={`table-row ${selected === pick.id ? "selected" : ""}`} key={pick.id} onClick={() => setSelected(pick.id)} role="row">
                  <span className="selection"><i className={`team-badge ${pick.color}`}>{pick.badge}</i><span><strong>{pick.selection}</strong><small>{pick.matchup}</small></span></span>
                  <span><em className="market-pill">{pick.market}</em></span><span className="mono">{pick.modelProbability}%</span><span className="mono">{pick.price}</span><span className="edge">+{pick.edge}%</span>
                </button>
              ))}
            </div>
            <div className="table-foot"><span><i className="quality-dot" /> Only edges above 2.5% are surfaced</span><button>View full slate →</button></div>
          </article>

          <aside className="explain-card" aria-live="polite">
            <div className="explain-top"><div><p className="eyebrow">WHY THIS BET</p><h3>{active.selection}</h3><p>{game.away} at {game.home} · {game.time}</p></div><ConfidenceRing value={active.quality} /></div>
            <div className="price-grid"><div><small>MODEL</small><strong>{active.modelProbability}%</strong></div><div><small>MARKET</small><strong>{active.marketProbability}%</strong></div><div><small>FAIR PRICE</small><strong>{active.fairPrice}</strong></div></div>
            <div className="driver-list">{active.drivers.map((driver, index) => <div key={driver.label}><span>{index + 1}</span><div><strong>{driver.label}</strong><p>{driver.detail}</p></div></div>)}</div>
            <div className="caution"><span>!</span><p><strong>Watch item</strong>{active.caution}</p></div>
            <button className="detail-button">Open full matchup <span>→</span></button>
          </aside>
        </section>

        <section className="metric-row" id="performance">
          <article><div><p className="eyebrow">30-DAY CLV</p><strong>+2.8%</strong></div><span className="spark positive">▂▃▂▄▅▄▆▇</span><small>Closing-line value</small></article>
          <article><div><p className="eyebrow">CALIBRATION</p><strong>0.94</strong></div><span className="spark">▅▅▆▅▆▇▆▇</span><small>Expected calibration index</small></article>
          <article><div><p className="eyebrow">TODAY’S COVERAGE</p><strong>12 / 15</strong></div><span className="progress"><i /></span><small>Games ready to price</small></article>
          <article><div><p className="eyebrow">OPEN EXPOSURE</p><strong>2.4u</strong></div><span className="exposure">LOW</span><small>Across 4 independent games</small></article>
        </section>

        <section className="lower-grid">
          <article className="panel" id="models"><div className="section-head"><div><p className="eyebrow">MODEL CONTROL</p><h2>Readiness checks</h2></div><button className="text-button">View audit log</button></div><div className="check-list">{modelChecks.map((check) => <div key={check.label}><span className={`check-icon ${check.status}`}>{check.status === "good" ? "✓" : "!"}</span><div><strong>{check.label}</strong><p>{check.detail}</p></div><em>{check.value}</em></div>)}</div></article>
          <article className="panel" id="data"><div className="section-head"><div><p className="eyebrow">DATA LINEAGE</p><h2>Source health</h2></div><span className="live-tag"><i /> LIVE</span></div><div className="source-list">{sources.map((source) => <div key={source.name}><span className="source-icon">{source.icon}</span><div><strong>{source.name}</strong><p>{source.coverage}</p></div><time>{source.updated}</time><span className={`source-state ${source.state}`}>{source.state}</span></div>)}</div></article>
        </section>

        <footer><span>Baseline v0.1 · Analysis foundation</span><span>Probabilities are estimates, not guarantees. Bet responsibly.</span></footer>
      </section>
    </main>
  );
}
