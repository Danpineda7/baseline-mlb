import type { OddsEvent } from "@/lib/odds";

type D1Like={prepare:(sql:string)=>{bind:(...values:unknown[])=>unknown};batch:(statements:unknown[])=>Promise<unknown>};

const key=(parts:Array<string|number|null|undefined>)=>parts.map(part=>String(part??"").replaceAll("|","-")).join("|");

export async function archiveOddsApiEvents(db:D1Like,events:OddsEvent[]){
  const statements=[] as unknown[];
  for(const event of events)for(const book of event.bookmakers)for(const market of book.markets)for(const outcome of market.outcomes){
    // Provider timestamp only: a wall-clock fallback would mint a duplicate
    // observation on every poll because the timestamp is part of the row key.
    const observedAt=market.last_update||book.last_update;if(!observedAt)continue;
    const gameDate=event.commence_time.slice(0,10),line=outcome.point??null;
    const canonicalMarket=market.key==="h2h"?"moneyline":market.key==="totals"?"over":null;
    const canonicalSelection=market.key==="h2h"?(outcome.name===event.home_team?"home":outcome.name===event.away_team?"away":null):market.key==="totals"?(outcome.name.toLowerCase()==="over"?"over":outcome.name.toLowerCase()==="under"?"under":null):null;
    statements.push(db.prepare(`INSERT OR IGNORE INTO market_odds_observations (id,game_id,provider_event_id,game_date,starts_at,away_team,home_team,provider,sportsbook,market,selection,line,american_odds,observed_at,source_tier,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(key(["the-odds-api",event.id,book.key,market.key,outcome.name,line,observedAt]),null,event.id,gameDate,event.commence_time,event.away_team,event.home_team,"The Odds API",book.title,market.key,outcome.name,line,Math.round(outcome.price),observedAt,"automatic",JSON.stringify({bookmakerKey:book.key,canonicalMarket:canonicalSelection?canonicalMarket:null,canonicalSelection})));
  }
  for(let i=0;i<statements.length;i+=75)await db.batch(statements.slice(i,i+75));
  return statements.length;
}
