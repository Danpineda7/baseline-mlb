"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { games, modelChecks, recommendations, sources, type Market } from "@/lib/demo-data";

const markets: Array<"All" | Market> = ["All", "Moneyline", "Total", "First 5", "Player prop"];

type LiveGame = {
  id: number;
  startsAt: string | null;
  status: string;
  state: string;
  inning: number | null;
  inningState: string | null;
  venue: string;
  away: { name: string; abbreviation: string; score: number | null; probablePitcher: string | null };
  home: { name: string; abbreviation: string; score: number | null; probablePitcher: string | null };
};

type ScheduleResponse = { date: string; games: LiveGame[]; count: number; source: string; retrievedAt: string; error?: string };

function formatGameTime(value: string | null) {
  if (!value) return "Time TBD";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
}

function shiftDate(date: string, amount: number) {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + amount);
  return next.toISOString().slice(0, 10);
}

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
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [liveGames, setLiveGames] = useState<LiveGame[]>([]);
  const [retrievedAt, setRetrievedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveError, setLiveError] = useState<string | null>(null);
  const visible = useMemo(() => market === "All" ? recommendations : recommendations.filter((pick) => pick.market === market), [market]);
  const active = recommendations.find((pick) => pick.id === selected) ?? recommendations[0];
  const game = games.find((item) => item.id === active.gameId)!;
  const loadSchedule = useCallback(async () => {
    setLoading(true);
    setLiveError(null);
    try {
      const response = await fetch(`/api/mlb/schedule?date=${date}`, { cache: "no-store" });
      const payload = (await response.json()) as ScheduleResponse;
      if (!response.ok || payload.error) throw new Error(payload.error ?? "Unable to load schedule");
      setLiveGames(payload.games);
      setRetrievedAt(payload.retrievedAt);
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "Unable to load the MLB schedule");
      setLiveGames([]);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { void loadSchedule(); }, [loadSchedule]);

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
          <div><p className="eyebrow">LIVE MLB WORKSPACE</p><h1>Daily slate</h1></div>
          <div className="top-actions"><button className="ghost-button">Backtest</button><button className="primary-button" onClick={() => void loadSchedule()} disabled={loading}><span>↻</span> {loading ? "Refreshing…" : "Refresh data"}</button></div>
        </header>

        <div className="notice" role="status"><span>✓</span><div><strong>Live schedule connected</strong><p>Games and probable pitchers come from MLB. Recommendations below remain a model-interface preview until calibration is complete.</p></div></div>

        <section className="live-slate" aria-labelledby="live-slate-heading">
          <div className="section-head live-head"><div><p className="eyebrow">OFFICIAL SCHEDULE</p><h2 id="live-slate-heading">Games for {date}</h2></div><div className="date-controls"><button onClick={() => setDate(shiftDate(date, -1))} aria-label="Previous day">←</button><input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Schedule date"/><button onClick={() => setDate(shiftDate(date, 1))} aria-label="Next day">→</button></div></div>
          {loading ? <div className="slate-state"><i className="loading-mark" />Loading official MLB schedule…</div> : liveError ? <div className="slate-state error"><strong>Live source unavailable</strong><span>{liveError}</span><button onClick={() => void loadSchedule()}>Try again</button></div> : liveGames.length === 0 ? <div className="slate-state">No MLB games are scheduled for this date.</div> : <div className="game-strip">{liveGames.map((liveGame) => <article className="game-tile" key={liveGame.id}><div className="game-status"><span className={liveGame.state === "Live" ? "live" : ""}>{liveGame.status}</span><time>{formatGameTime(liveGame.startsAt)}</time></div><div className="club-row"><strong>{liveGame.away.abbreviation}</strong><span>{liveGame.away.name}</span><em>{liveGame.away.score ?? "—"}</em></div><div className="club-row"><strong>{liveGame.home.abbreviation}</strong><span>{liveGame.home.name}</span><em>{liveGame.home.score ?? "—"}</em></div><div className="pitchers"><span>{liveGame.away.probablePitcher ?? "Starter TBD"}</span><b>vs</b><span>{liveGame.home.probablePitcher ?? "Starter TBD"}</span></div><small>{liveGame.venue}</small></article>)}</div>}
          <div className="live-foot"><span><i /> MLB Stats API · validated game IDs</span><span>{retrievedAt ? `Updated ${new Date(retrievedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Waiting for source"}</span></div>
        </section>

        <section className="hero-grid" id="slate">
          <article className="slate-card">
            <div className="section-head"><div><p className="eyebrow">MODEL INTERFACE PREVIEW</p><h2>How priced edges will appear</h2></div><div className="segmented" role="group" aria-label="Market filter">{markets.map((item) => <button key={item} onClick={() => setMarket(item)} className={market === item ? "active" : ""}>{item}</button>)}</div></div>
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
