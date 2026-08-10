import type { OddsEvent } from "@/lib/odds";

type D1Like={prepare:(sql:string)=>{bind:(...values:unknown[])=>unknown};batch:(statements:unknown[])=>Promise<unknown>};

const key=(parts:Array<string|number|null|undefined>)=>parts.map(part=>String(part??"").replaceAll("|","-")).join("|");

export async function archiveOddsApiEvents(db:D1Like,events:OddsEvent[]){
  const statements=[] as unknown[];
  for(const event of events)for(const book of event.bookmakers)for(const market of book.markets)for(const outcome of market.outcomes){
    const observedAt=book.last_update||new Date().toISOString(),gameDate=event.commence_time.slice(0,10),line=outcome.point??null;
    statements.push(db.prepare(`INSERT OR IGNORE INTO market_odds_observations (id,game_id,provider_event_id,game_date,starts_at,away_team,home_team,provider,sportsbook,market,selection,line,american_odds,observed_at,source_tier,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(key(["the-odds-api",event.id,book.key,market.key,outcome.name,line,observedAt]),null,event.id,gameDate,event.commence_time,event.away_team,event.home_team,"The Odds API",book.title,market.key,outcome.name,line,Math.round(outcome.price),observedAt,"automatic",JSON.stringify({bookmakerKey:book.key})));
  }
  for(let i=0;i<statements.length;i+=75)await db.batch(statements.slice(i,i+75));
  return statements.length;
}
