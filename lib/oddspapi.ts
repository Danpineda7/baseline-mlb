type D1Like={prepare:(sql:string)=>{bind:(...values:unknown[])=>unknown};batch:(statements:unknown[])=>Promise<unknown>};
type Fixture={fixtureId:string;sportId:number;tournamentId:number;startTime:string;participant1Name:string;participant2Name:string;tournamentName:string;statusId:number};
type Market={marketId:number;marketName:string;playerProp:boolean;sportId:number;handicap:number|null;period:string;marketType:string;outcomes:Array<{outcomeId:number;outcomeName:string}>};
type GameRef={id:number;awayTeam:string;homeTeam:string};
import { sameMlbTeam } from "./mlb-teams.ts";

const api="https://api.oddspapi.io/v4";
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const american=(decimal:number)=>Math.round(decimal>=2?(decimal-1)*100:-100/(decimal-1));
// Canonical mapping is deliberately conservative: anything not confidently
// recognized returns {market:null} and is archived raw but never validated.
export const canonical=(market:Market|undefined,outcomeName:string,participant1Role:"home"|"away"|null):{market:string|null;selection:string|null}=>{
  if(!market||market.playerProp)return{market:null,selection:null};
  const label=`${market.marketName??""} ${market.marketType??""} ${market.period??""}`.toLowerCase(),outcome=outcomeName.toLowerCase();
  const inningLabel=/inning/.test(label);
  const firstInning=/(first|1st)/.test(label)&&inningLabel&&!/(five|5)/.test(label);
  const teamScoped=/\bteam\b|home total|away total/.test(label);
  const totalsType=market.marketType==="totals"||/over under|total/.test(label);
  // First-inning total at exactly 0.5: NRFI/YRFI are two sides of ONE market
  // so validation can pair them. Any other first-inning line is not NRFI.
  if(firstInning&&totalsType){
    if(market.handicap!==0.5)return{market:null,selection:null};
    const selection=outcome.includes("under")?"nrfi":outcome.includes("over")?"yrfi":null;
    return{market:selection?"nrfi":null,selection};
  }
  const firstFive=/(first|1st)\s*(five|5)|(first|1st)\s*half|5\s*inning/.test(label);
  const moneylineType=market.marketType==="moneyline"||market.marketType==="1x2"||/moneyline|match winner|full time result|winner/.test(label);
  const roleFor=(value:string)=>value==="1"?participant1Role:value==="2"?(participant1Role==="home"?"away":participant1Role==="away"?"home":null):value.includes("home")?"home":value.includes("away")?"away":null;
  if(firstFive&&moneylineType&&!totalsType)return{market:"f5",selection:roleFor(outcome)};
  if(moneylineType&&!inningLabel&&!firstFive&&!totalsType)return{market:"moneyline",selection:roleFor(outcome)};
  if(totalsType&&!inningLabel&&!firstFive&&!teamScoped){const selection=outcome.includes("over")?"over":outcome.includes("under")?"under":null;return{market:selection?"over":null,selection};}
  return{market:null,selection:null};
};
async function get<T>(path:string,key:string,params:Record<string,string>={}){const url=new URL(`${api}/${path}`);url.searchParams.set("apiKey",key);for(const [name,value] of Object.entries(params))url.searchParams.set(name,value);const response=await fetch(url,{headers:{accept:"application/json"}});if(!response.ok){const detail=(await response.text()).slice(0,180);throw new Error(`OddsPapi ${path} returned ${response.status}${detail?`: ${detail}`:""}`);}return response.json() as Promise<T>;}

export async function syncOddsPapiDate(db:D1Like,key:string,date:string,games:GameRef[],limit=3){
  const sports=await get<Array<{sportId:number;sportName:string}>>("sports",key,{language:"en"});const baseball=sports.find(item=>item.sportName.toLowerCase()==="baseball");if(!baseball)throw new Error("OddsPapi did not return its Baseball sport.");
  const fixtures=await get<Fixture[]>("fixtures",key,{sportId:String(baseball.sportId),from:`${date}T00:00:00Z`,to:`${date}T23:59:59Z`,hasOdds:"true",language:"en"});
  const mlbFixtures=fixtures.filter(item=>/major league|\bmlb\b/i.test(item.tournamentName));
  const marketList=await get<Market[]>("markets",key,{language:"en"}),markets=new Map(marketList.filter(item=>item.sportId===baseball.sportId).map(item=>[String(item.marketId),item]));
  const imported=await (db.prepare(`SELECT DISTINCT provider_event_id AS id FROM market_odds_observations WHERE provider='OddsPapi' AND game_date=?`).bind(date) as {all:()=>Promise<{results:Array<{id:string}>}>}).all();const done=new Set(imported.results.map(row=>row.id));
  const queue=mlbFixtures.filter(item=>!done.has(item.fixtureId)).slice(0,Math.max(1,Math.min(4,limit)));let observations=0,matched=0,unmappedMarkets=0;const unmatchedFixtures:string[]=[];
  for(let fixtureIndex=0;fixtureIndex<queue.length;fixtureIndex++){
    if(fixtureIndex)await delay(5100);
    const fixture=queue[fixtureIndex],game=games.find(item=>(sameMlbTeam(item.awayTeam,fixture.participant1Name)&&sameMlbTeam(item.homeTeam,fixture.participant2Name))||(sameMlbTeam(item.awayTeam,fixture.participant2Name)&&sameMlbTeam(item.homeTeam,fixture.participant1Name))),participant1Role=game?(sameMlbTeam(game.homeTeam,fixture.participant1Name)?"home":"away") as "home"|"away":null;if(game)matched++;else unmatchedFixtures.push(`${fixture.participant1Name} vs ${fixture.participant2Name}`);
    const history=await get<{bookmakers:Record<string,{markets:Record<string,{outcomes:Record<string,{players:Record<string,Array<{createdAt:string;price:number;limit:number|null;active:boolean}>>}>}>}>}>("historical-odds",key,{fixtureId:fixture.fixtureId,bookmakers:"pinnacle,draftkings,fanduel"});const statements=[] as unknown[];
    for(const [book,bookData] of Object.entries(history.bookmakers??{}))for(const [marketId,marketData] of Object.entries(bookData.markets??{}))for(const [outcomeId,outcomeData] of Object.entries(marketData.outcomes??{}))for(const [playerId,snapshots] of Object.entries(outcomeData.players??{}))for(const snapshot of snapshots){if(!Number.isFinite(snapshot.price)||snapshot.price<=1)continue;const market=markets.get(marketId),outcome=market?.outcomes.find(item=>String(item.outcomeId)===outcomeId),outcomeName=outcome?.outcomeName??`Outcome ${outcomeId}`,selection=`${outcomeName}${playerId!=="0"?` · player ${playerId}`:""}`,line=market?.handicap??null,id=["oddspapi",fixture.fixtureId,book,marketId,outcomeId,playerId,snapshot.createdAt].join("|"),mapped=canonical(market,outcomeName,participant1Role);if(!mapped.market)unmappedMarkets++;statements.push(db.prepare(`INSERT OR IGNORE INTO market_odds_observations (id,game_id,provider_event_id,game_date,starts_at,away_team,home_team,provider,sportsbook,market,selection,line,american_odds,observed_at,source_tier,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,game?.id??null,fixture.fixtureId,date,fixture.startTime,game?.awayTeam??fixture.participant1Name,game?.homeTeam??fixture.participant2Name,"OddsPapi",book,market?.marketName??`Market ${marketId}`,selection,line,american(snapshot.price),snapshot.createdAt,"historical",JSON.stringify({marketId,outcomeId,playerId,period:market?.period,marketType:market?.marketType,playerProp:market?.playerProp,limit:snapshot.limit,active:snapshot.active,canonicalMarket:mapped.market,canonicalSelection:mapped.selection,participant1Role})));
    }
    for(let i=0;i<statements.length;i+=75)await db.batch(statements.slice(i,i+75));observations+=statements.length;
  }
  return{date,fixturesFound:mlbFixtures.length,fixturesImported:queue.length,fixturesRemaining:Math.max(0,mlbFixtures.length-done.size-queue.length),matchedGames:matched,unmatchedFixtures,unmappedMarkets,observations};
}
