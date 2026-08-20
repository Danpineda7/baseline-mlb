import { requireAdmin } from "@/lib/admin-auth";
import { getDatabase } from "@/lib/db";
import { oddsPapiCooldown } from "@/lib/oddspapi";

const STALE_AFTER_MS=36*60*60*1000;

// API routes are always dynamic: they read the database and live MLB feeds
// and must never be baked into the build as static responses.
export const dynamic="force-dynamic";

const validOdds=(value:unknown)=>Number.isInteger(value)&&((Number(value)>=100&&Number(value)<=5000)||(Number(value)<=-100&&Number(value)>=-5000));
// Manual captures must arrive pre-normalized so the validation pipeline can
// pair the two sides without guessing from display text.
const CANONICAL_SELECTIONS:Record<string,readonly [string,string]>={moneyline:["home","away"],over:["over","under"],f5:["home","away"],nrfi:["nrfi","yrfi"]};

export async function GET(){
  const db=getDatabase();
  const summary=await db.prepare(`SELECT COUNT(*) AS observations, COUNT(DISTINCT game_id) AS games, MIN(observed_at) AS first_observed_at, MAX(observed_at) AS last_observed_at FROM market_odds_observations`).first<{observations:number;games:number;first_observed_at:string|null;last_observed_at:string|null}>();
  const sources=await db.prepare(`SELECT provider, source_tier, COUNT(*) AS observations FROM market_odds_observations GROUP BY provider,source_tier ORDER BY observations DESC`).all<{provider:string;source_tier:string;observations:number}>();
  // Surface the import health here instead of only in server logs: a
  // provider quota outage should be visible in the app, not a silent stall.
  const cooldown=await oddsPapiCooldown(db).catch(()=>({active:false,reason:null,until:null}));
  const lastObservedAt=summary?.last_observed_at??null;
  const stale=Boolean(lastObservedAt&&Date.now()-Date.parse(lastObservedAt)>STALE_AFTER_MS);
  return Response.json({summary:summary??{observations:0,games:0,first_observed_at:null,last_observed_at:null},sources:sources.results,health:{stale,cooldown},providers:{oddsPapi:{configured:Boolean(process.env.ODDS_PAPI_KEY),historicalFrom:"2026-01-01",status:process.env.ODDS_PAPI_KEY?"ready":"free key required"},theOddsApi:{configured:Boolean(process.env.ODDS_API_KEY),status:process.env.ODDS_API_KEY?"collecting current odds":"optional"}},cost:"$0"});
}

export async function POST(request:Request){
  const admin=await requireAdmin(request);if(!admin.ok)return admin.response;
  const db=getDatabase();
  const body=await request.json() as Record<string,unknown>;const selectedOdds=Number(body.selectedOdds),oppositeOdds=Number(body.oppositeOdds),gameId=Number(body.gameId),line=body.line==null?null:Number(body.line);
  const canonicalMarket=String(body.canonicalMarket??""),canonicalSelection=String(body.canonicalSelection??""),canonicalOpposite=String(body.canonicalOppositeSelection??"");
  const selectionPair=CANONICAL_SELECTIONS[canonicalMarket];
  const validPair=Boolean(selectionPair&&selectionPair.includes(canonicalSelection)&&selectionPair.includes(canonicalOpposite)&&canonicalSelection!==canonicalOpposite);
  if(!Number.isInteger(gameId)||!String(body.gameDate||"").match(/^\d{4}-\d{2}-\d{2}$/)||!body.awayTeam||!body.homeTeam||!validPair||!validOdds(selectedOdds)||!validOdds(oppositeOdds)||Number.isNaN(line))return Response.json({error:"A game, canonical market, both canonical selections and valid American odds are required."},{status:400});
  if(canonicalMarket==="over"&&(line==null||line<3.5||line>15.5))return Response.json({error:"Totals snapshots need a line between 3.5 and 15.5."},{status:400});
  const observedAt=new Date().toISOString(),sportsbook=String(body.sportsbook||"Manual entry").slice(0,80),base=[gameId,canonicalMarket,line,observedAt];
  const insert=`INSERT INTO market_odds_observations (id,game_id,provider_event_id,game_date,starts_at,away_team,home_team,provider,sportsbook,market,selection,line,american_odds,observed_at,source_tier,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
  await Promise.all([[canonicalSelection,selectedOdds],[canonicalOpposite,oppositeOdds]].map(async ([selection,odds],index)=>db.prepare(insert).bind(`manual|${base.join("|")}|${index}`,gameId,null,body.gameDate,body.startsAt??null,body.awayTeam,body.homeTeam,"Manual",sportsbook,canonicalMarket,selection,line,odds,observedAt,"manual",JSON.stringify({paired:true,canonicalMarket,canonicalSelection:selection})).run()));
  return Response.json({saved:2,observedAt});
}
