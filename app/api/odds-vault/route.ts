type Env={DB:{prepare:(sql:string)=>{bind:(...values:unknown[])=>{run:()=>Promise<unknown>};first:<T=unknown>()=>Promise<T|null>;all:<T=unknown>()=>Promise<{results:T[]}>}}};
const validOdds=(value:unknown)=>Number.isInteger(value)&&((Number(value)>=100&&Number(value)<=5000)||(Number(value)<=-100&&Number(value)>=-5000));

export async function GET(){
  const {env}=await import("cloudflare:workers") as unknown as {env:Env};
  const summary=await env.DB.prepare(`SELECT COUNT(*) AS observations, COUNT(DISTINCT game_id) AS games, MIN(observed_at) AS first_observed_at, MAX(observed_at) AS last_observed_at FROM market_odds_observations`).first<{observations:number;games:number;first_observed_at:string|null;last_observed_at:string|null}>();
  const sources=await env.DB.prepare(`SELECT provider, source_tier, COUNT(*) AS observations FROM market_odds_observations GROUP BY provider,source_tier ORDER BY observations DESC`).all<{provider:string;source_tier:string;observations:number}>();
  const runtime=env as unknown as Record<string,unknown>;
  return Response.json({summary:summary??{observations:0,games:0,first_observed_at:null,last_observed_at:null},sources:sources.results,providers:{oddsPapi:{configured:Boolean(runtime.ODDS_PAPI_KEY),historicalFrom:"2026-01-01",status:runtime.ODDS_PAPI_KEY?"ready":"free key required"},theOddsApi:{configured:Boolean(runtime.ODDS_API_KEY),status:runtime.ODDS_API_KEY?"collecting current odds":"optional"}},cost:"$0"});
}

export async function POST(request:Request){
  const {env}=await import("cloudflare:workers") as unknown as {env:Env};
  const body=await request.json() as Record<string,unknown>;const selectedOdds=Number(body.selectedOdds),oppositeOdds=Number(body.oppositeOdds),gameId=Number(body.gameId),line=body.line==null?null:Number(body.line);
  if(!Number.isInteger(gameId)||!String(body.gameDate||"").match(/^\d{4}-\d{2}-\d{2}$/)||!body.awayTeam||!body.homeTeam||!body.market||!body.selection||!body.oppositeSelection||!validOdds(selectedOdds)||!validOdds(oppositeOdds)||Number.isNaN(line))return Response.json({error:"A game, market, both selections and valid American odds are required."},{status:400});
  const observedAt=new Date().toISOString(),sportsbook=String(body.sportsbook||"Manual entry").slice(0,80),base=[gameId,body.market,line,observedAt],metadata=JSON.stringify({paired:true});
  const insert=`INSERT INTO market_odds_observations (id,game_id,provider_event_id,game_date,starts_at,away_team,home_team,provider,sportsbook,market,selection,line,american_odds,observed_at,source_tier,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
  await Promise.all([[body.selection,selectedOdds],[body.oppositeSelection,oppositeOdds]].map(async ([selection,odds],index)=>env.DB.prepare(insert).bind(`manual|${base.join("|")}|${index}`,gameId,null,body.gameDate,body.startsAt??null,body.awayTeam,body.homeTeam,"Manual",sportsbook,body.market,selection,line,odds,observedAt,"manual",metadata).run()));
  return Response.json({saved:2,observedAt});
}
