import { gradeBet } from "@/lib/settlement";
import { closingLineValue, impliedProbability } from "@/lib/modeling";
import { portfolioDecision, type PortfolioPosition } from "@/lib/risk";
import { verifyRecommendation, type RecommendationGame } from "@/lib/recommendation";
import { GET as getProjections } from "@/app/api/mlb/projections/route";
import { closingWindow, validAmericanOdds, CLOSING_WINDOW_MS } from "@/lib/ledger-validation";
import { PAIR_WINDOW_MS } from "@/lib/market-validation";
import { finalGameFromFeed, type Feed } from "@/lib/feed-grading";
import { getDatabase } from "@/lib/db";

type BetInput={ownerKey:string;gameId:number;gameDate:string;startsAt:string|null;matchup:string;market:string;selection:string;selectionKey:string;subjectId:number|null;line:number|null;americanOdds:number;oppositeOdds:number;maxPlayableOdds?:number|null;modelProbability:number;marketProbability:number;edge:number;expectedValue:number;stakeUnits:number;paperMode?:boolean;evidence?:Record<string,unknown>};
const ownerPattern=/^[a-zA-Z0-9-]{20,80}$/;
function valid(input:BetInput){return typeof input?.ownerKey==="string"&&ownerPattern.test(input.ownerKey)&&Number.isInteger(input.gameId)&&input.gameId>0&&typeof input.gameDate==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(input.gameDate)&&(input.startsAt==null||typeof input.startsAt==="string"&&Number.isFinite(Date.parse(input.startsAt)))&&typeof input.matchup==="string"&&input.matchup.length<=100&&typeof input.market==="string"&&input.market.length<=30&&typeof input.selection==="string"&&input.selection.length<=120&&typeof input.selectionKey==="string"&&input.selectionKey.length<=20&&validAmericanOdds(input.americanOdds)&&validAmericanOdds(input.oppositeOdds)&&[input.modelProbability,input.marketProbability,input.edge,input.expectedValue,input.stakeUnits].every(Number.isFinite);}
// API routes are always dynamic: they read the database and live MLB feeds
// and must never be baked into the build as static responses.
export const dynamic="force-dynamic";
async function database(){return getDatabase();}
// The owner key is a bearer secret: prefer the header so it stays out of URL
// logs; the query parameter remains as a fallback.
const ownerKeyFrom=(request:Request,url:URL)=>request.headers.get("x-owner-key")??url.searchParams.get("ownerKey")??"";

// Ledger market/selection -> the odds vault's canonical market and selection.
function canonicalForMarket(market:string,selectionKey:string):{market:string;selection:string}|null{
  if(market==="moneyline"&&(selectionKey==="home"||selectionKey==="away"))return{market:"moneyline",selection:selectionKey};
  if(market==="over"||market==="under")return{market:"over",selection:market};
  if(market==="f5"&&(selectionKey==="home"||selectionKey==="away"))return{market:"f5",selection:selectionKey};
  if(market==="nrfi"||market==="yrfi")return{market:"nrfi",selection:market};
  return null;
}

type ObservationRow={sportsbook:string;selection:string;line:number|null;american_odds:number;observed_at:string;metadata_json:string};
type CanonicalRow=ObservationRow&{canonicalSelection:string;time:number};

async function canonicalObservations(db:Awaited<ReturnType<typeof database>>,gameId:number,market:string,line:number|null,from:string,to:string){
  const query=await db.prepare("SELECT sportsbook,selection,line,american_odds,observed_at,metadata_json FROM market_odds_observations WHERE game_id=? AND observed_at>=? AND observed_at<? ORDER BY observed_at DESC LIMIT 500").bind(gameId,from,to).all<ObservationRow>();
  const rows:CanonicalRow[]=[];
  for(const row of query.results??[]){
    let meta:Record<string,unknown>={};try{meta=JSON.parse(row.metadata_json) as Record<string,unknown>;}catch{continue;}
    if(meta.canonicalMarket!==market||typeof meta.canonicalSelection!=="string")continue;
    if(market==="over"&&(line==null||row.line==null||Math.abs(row.line-line)>=.01))continue;
    const time=Date.parse(row.observed_at);
    if(!Number.isFinite(time))continue;
    rows.push({...row,canonicalSelection:meta.canonicalSelection,time});
  }
  return rows;
}

// A typed price counts as "verified" only when some stored observation of the
// same game/market/line within the prior 24h implies a probability within 2%.
// Unverified bets stay in the private ledger but are excluded from public
// evidence aggregates.
async function verifyEnteredPrice(db:Awaited<ReturnType<typeof database>>,input:{gameId:number;market:string;selectionKey:string;line:number|null;startsAt:string|null;americanOdds:number}){
  const canonical=canonicalForMarket(input.market,input.selectionKey);
  const entered=impliedProbability(input.americanOdds);
  const start=input.startsAt?Date.parse(input.startsAt):NaN;
  if(!canonical||entered==null||!Number.isFinite(start))return false;
  try{
    const rows=await canonicalObservations(db,input.gameId,canonical.market,input.line,new Date(start-24*60*60*1000).toISOString(),new Date(Math.min(Date.now(),start)).toISOString());
    return rows.some(row=>{if(row.canonicalSelection!==canonical.selection)return false;const observed=impliedProbability(row.american_odds);return observed!=null&&Math.abs(observed-entered)<=0.02;});
  }catch{return false;}
}

// Latest same-book two-sided pair observed inside the closing window; used to
// auto-fill CLV at settlement when the visitor did not capture a close.
async function findClosingPair(db:Awaited<ReturnType<typeof database>>,gameId:number,market:string,selectionKey:string,line:number|null,startsAt:string|null){
  const canonical=canonicalForMarket(market,selectionKey);
  const start=startsAt?Date.parse(startsAt):NaN;
  if(!canonical||!Number.isFinite(start))return null;
  const opposite={home:"away",away:"home",over:"under",under:"over",nrfi:"yrfi",yrfi:"nrfi"}[canonical.selection]??"";
  try{
    const rows=await canonicalObservations(db,gameId,canonical.market,line,new Date(start-CLOSING_WINDOW_MS).toISOString(),new Date(start).toISOString());
    let best:{selectedOdds:number;oppositeOdds:number;time:number}|null=null;
    for(const book of new Set(rows.map(row=>row.sportsbook))){
      const bookRows=rows.filter(row=>row.sportsbook===book);
      for(const selectedRow of bookRows.filter(row=>row.canonicalSelection===canonical.selection)){
        for(const otherRow of bookRows.filter(row=>row.canonicalSelection===opposite)){
          if(Math.abs(otherRow.time-selectedRow.time)>PAIR_WINDOW_MS)continue;
          const time=Math.max(selectedRow.time,otherRow.time);
          if(!best||time>best.time)best={selectedOdds:selectedRow.american_odds,oppositeOdds:otherRow.american_odds,time};
        }
      }
    }
    return best;
  }catch{return null;}
}

export async function GET(request:Request){const url=new URL(request.url),ownerKey=ownerKeyFrom(request,url);if(!ownerPattern.test(ownerKey))return Response.json({error:"Invalid ledger key."},{status:400});const db=await database();const result=await db.prepare("SELECT * FROM tracked_bets WHERE owner_key = ? ORDER BY created_at DESC LIMIT 100").bind(ownerKey).all();return Response.json({bets:result.results});}

export async function POST(request:Request){
  let input:BetInput;try{input=await request.json() as BetInput;}catch{return Response.json({error:"Invalid JSON."},{status:400});}
  if(!valid(input))return Response.json({error:"Recommendation failed structural validation."},{status:400});
  const paperMode=input.paperMode===true,projectionResponse=await getProjections(new Request(`${new URL(request.url).origin}/api/mlb/projections?date=${encodeURIComponent(input.gameDate)}`,{headers:{accept:"application/json"}}));
  if(!projectionResponse.ok)return Response.json({error:"Authoritative projections are unavailable; decision was not saved."},{status:503});
  const projectionPayload=await projectionResponse.json() as {games?:RecommendationGame[]};
  const game=projectionPayload.games?.find(candidate=>candidate.id===input.gameId);
  if(!game)return Response.json({error:"Game is not present in the authoritative slate."},{status:409});
  const verified=verifyRecommendation(game,{market:input.market,selectionKey:input.selectionKey,subjectId:input.subjectId,line:input.line,americanOdds:input.americanOdds,oppositeOdds:input.oppositeOdds},paperMode?{requireValidated:false,requireQualifies:false}:undefined);
  if("error" in verified)return Response.json({error:verified.error},{status:409});
  const decision=paperMode?(verified.qualifies?"PAPER_BET":verified.probability>=.5&&verified.edge>0?"WATCH":"PASS"):"BET";
  input={...input,startsAt:game.startsAt,matchup:`${game.away.abbreviation} @ ${game.home.abbreviation}`,selection:verified.selection,modelProbability:verified.probability,marketProbability:verified.marketProbability,edge:verified.edge,expectedValue:verified.expectedValue,stakeUnits:decision==="PAPER_BET"?Math.min(.005,verified.stakeUnits):0,maxPlayableOdds:verified.maxPlayableOdds};
  if(input.startsAt&&Date.now()>=Date.parse(input.startsAt))return Response.json({error:"Decisions lock at scheduled first pitch."},{status:409});
  const db=await database();
  const priceVerified=await verifyEnteredPrice(db,{gameId:input.gameId,market:input.market,selectionKey:input.selectionKey,line:input.line,startsAt:input.startsAt,americanOdds:input.americanOdds});
  const query=await db.prepare("SELECT game_id, game_date, market, selection_key, line, stake_units FROM tracked_bets WHERE owner_key = ? AND status = 'OPEN' AND mode='REAL'").bind(input.ownerKey).all<{game_id:number;game_date:string;market:string;selection_key:string|null;line:number|null;stake_units:number}>(),open:PortfolioPosition[]=(query.results??[]).map(row=>({gameId:row.game_id,gameDate:row.game_date,market:row.market,selectionKey:row.selection_key,line:row.line,stakeUnits:row.stake_units})),portfolio=portfolioDecision(open,{gameId:input.gameId,gameDate:input.gameDate,market:input.market,selectionKey:input.selectionKey,line:input.line,stakeUnits:input.stakeUnits});
  if(!paperMode&&!portfolio.qualifies)return Response.json({error:portfolio.reason,portfolio},{status:409});
  const id=crypto.randomUUID(),createdAt=new Date().toISOString(),evidence=JSON.stringify({...input.evidence,marketValidated:verified.marketValidated,uncertainty:game.uncertainty,phase:5});
  try{
    await db.prepare("INSERT INTO tracked_bets (id,owner_key,game_id,game_date,starts_at,matchup,market,selection,selection_key,subject_id,line,american_odds,opposite_odds,max_playable_odds,model_probability,market_probability,edge,expected_value,stake_units,mode,decision,evidence_json,status,price_verified,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,input.ownerKey,input.gameId,input.gameDate,input.startsAt,input.matchup,input.market,input.selection,input.selectionKey,input.subjectId,input.line,input.americanOdds,input.oppositeOdds,input.maxPlayableOdds,input.modelProbability,input.marketProbability,input.edge,input.expectedValue,input.stakeUnits,paperMode?"PAPER":"REAL",decision,evidence,"OPEN",priceVerified?1:0,createdAt).run();
  }catch(error){
    // The unique open-position index makes the duplicate check race-proof.
    const detail=error instanceof Error?error.message:"";
    if(/unique|constraint/i.test(detail))return Response.json({error:"This decision is already frozen."},{status:409});
    throw error;
  }
  return Response.json({bet:{id,...input,mode:paperMode?"PAPER":"REAL",decision,status:"OPEN",priceVerified,createdAt},portfolio},{status:201});
}

export async function DELETE(request:Request){
  const url=new URL(request.url),ownerKey=ownerKeyFrom(request,url),id=url.searchParams.get("id")??"";
  if(!ownerPattern.test(ownerKey)||!id)return Response.json({error:"Invalid request."},{status:400});
  const db=await database(),row=await db.prepare("SELECT starts_at FROM tracked_bets WHERE id = ? AND owner_key = ? AND status = 'OPEN'").bind(id,ownerKey).first<{starts_at:string|null}>();
  if(!row)return Response.json({error:"Open recommendation not found."},{status:404});
  if(row.starts_at&&Date.now()>=Date.parse(row.starts_at))return Response.json({error:"Recommendations cannot be retracted after scheduled first pitch."},{status:409});
  // Retraction, not deletion: the row stays in the table so public aggregates
  // can report how many frozen decisions were withdrawn before first pitch.
  await db.prepare("UPDATE tracked_bets SET status = 'RETRACTED', retracted_at = ? WHERE id = ? AND owner_key = ? AND status = 'OPEN'").bind(new Date().toISOString(),id,ownerKey).run();
  return Response.json({ok:true,status:"RETRACTED"});
}

export async function PUT(request:Request){let input:{ownerKey?:string;id?:string;closingOdds?:number;closingOppositeOdds?:number};try{input=await request.json() as typeof input;}catch{return Response.json({error:"Invalid JSON."},{status:400});}const ownerKey=input.ownerKey??"",id=input.id??"",closingOdds=Number(input.closingOdds),closingOppositeOdds=Number(input.closingOppositeOdds);if(!ownerPattern.test(ownerKey)||!id||!validAmericanOdds(closingOdds)||!validAmericanOdds(closingOppositeOdds))return Response.json({error:"Enter valid two-sided American closing odds."},{status:400});const db=await database(),row=await db.prepare("SELECT market_probability, starts_at FROM tracked_bets WHERE id = ? AND owner_key = ?").bind(id,ownerKey).first<{market_probability:number;starts_at:string|null}>();if(!row)return Response.json({error:"Recommendation not found."},{status:404});const window=closingWindow(row.starts_at);if(!window.open)return Response.json({error:window.reason},{status:409});const clv=closingLineValue(row.market_probability,closingOdds,closingOppositeOdds);if(!clv)return Response.json({error:"Unable to remove vig from those prices."},{status:400});const capturedAt=new Date().toISOString();await db.prepare("UPDATE tracked_bets SET closing_odds = ?, closing_opposite_odds = ?, closing_probability = ?, closing_line_value = ?, closing_captured_at = ? WHERE id = ? AND owner_key = ?").bind(closingOdds,closingOppositeOdds,clv.closingProbability,clv.value,capturedAt,id,ownerKey).run();return Response.json({closingProbability:clv.closingProbability,closingLineValue:clv.value,capturedAt});}

type OpenRow={id:string;game_id:number;market:string;selection_key:string|null;subject_id:number|null;line:number|null;american_odds:number;stake_units:number;market_probability:number;starts_at:string|null;closing_odds:number|null};
export async function PATCH(request:Request){
  let ownerKey="";try{ownerKey=((await request.json()) as {ownerKey?:string}).ownerKey??"";}catch{return Response.json({error:"Invalid JSON."},{status:400});}
  if(!ownerPattern.test(ownerKey))return Response.json({error:"Invalid ledger key."},{status:400});
  const db=await database();
  const query=await db.prepare("SELECT id,game_id,market,selection_key,subject_id,line,american_odds,stake_units,market_probability,starts_at,closing_odds FROM tracked_bets WHERE owner_key = ? AND status = 'OPEN' AND selection_key IS NOT NULL").bind(ownerKey).all<OpenRow>();
  const rows=query.results??[],gameIds=[...new Set(rows.map(row=>row.game_id))],feeds=new Map<number,Feed>();
  await Promise.all(gameIds.map(async gameId=>{try{const response=await fetch(`https://statsapi.mlb.com/api/v1.1/game/${gameId}/feed/live`,{headers:{accept:"application/json"}});if(response.ok)feeds.set(gameId,await response.json() as Feed);}catch{/* A later request retries unsettled games. */}}));
  const updates=[];let autoClosed=0;
  for(const row of rows){
    const feed=feeds.get(row.game_id);
    const finalGame=feed?finalGameFromFeed(feed):null;
    if(!finalGame)continue;
    const grade=gradeBet({market:row.market,selectionKey:row.selection_key,subjectId:row.subject_id,line:row.line,americanOdds:row.american_odds,stakeUnits:row.stake_units},finalGame);
    if(!grade)continue;
    // Auto-fill CLV from the odds vault's closing-class pair when the visitor
    // did not capture one manually; coverage is reported, never assumed.
    let closing:{selectedOdds:number;oppositeOdds:number}|null=null,clv:ReturnType<typeof closingLineValue>=null;
    if(row.closing_odds==null&&row.selection_key){
      closing=await findClosingPair(db,row.game_id,row.market,row.selection_key,row.line,row.starts_at);
      if(closing)clv=closingLineValue(row.market_probability,closing.selectedOdds,closing.oppositeOdds);
      if(closing&&clv)autoClosed++;
    }
    if(closing&&clv)updates.push(db.prepare("UPDATE tracked_bets SET status = ?, profit_units = ?, settled_at = ?, closing_odds = ?, closing_opposite_odds = ?, closing_probability = ?, closing_line_value = ?, closing_captured_at = ? WHERE id = ? AND owner_key = ? AND status = 'OPEN'").bind(grade.result,grade.profitUnits,new Date().toISOString(),closing.selectedOdds,closing.oppositeOdds,clv.closingProbability,clv.value,new Date().toISOString(),row.id,ownerKey));
    else updates.push(db.prepare("UPDATE tracked_bets SET status = ?, profit_units = ?, settled_at = ? WHERE id = ? AND owner_key = ? AND status = 'OPEN'").bind(grade.result,grade.profitUnits,new Date().toISOString(),row.id,ownerKey));
  }
  if(updates.length)await db.batch(updates);
  return Response.json({checked:rows.length,settled:updates.length,autoClosed});
}
