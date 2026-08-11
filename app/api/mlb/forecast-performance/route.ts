import { prospectiveMetrics, type ScoredForecast } from "@/lib/prospective";
import { gradeBet } from "@/lib/settlement";
import { finalGameFromFeed, type Feed } from "@/lib/feed-grading";
import { getDatabase } from "@/lib/db";

// API routes are always dynamic: they read the database and live MLB feeds
// and must never be baked into the build as static responses.
export const dynamic="force-dynamic";

type OpenForecast={id:string;game_id:number;market:string;selection_key:string;line:number|null;probability:number};
type ScoredRow={market:string;probability:number;outcome:number;brier:number};

export async function GET(){
  try{
  const db=getDatabase(),openQuery=await db.prepare("SELECT id,game_id,market,selection_key,line,probability FROM forecast_snapshots WHERE status = 'OPEN' AND starts_at < ? ORDER BY starts_at LIMIT 240").bind(new Date().toISOString()).all<OpenForecast>(),open=openQuery.results??[],feeds=new Map<number,Feed>(),gameIds=[...new Set(open.map(row=>row.game_id))];
  await Promise.all(gameIds.map(async gameId=>{try{const response=await fetch(`https://statsapi.mlb.com/api/v1.1/game/${gameId}/feed/live`,{headers:{accept:"application/json"}});if(response.ok)feeds.set(gameId,await response.json() as Feed);}catch{/* A later request retries unsettled games. */}}));
  const updates=[];for(const row of open){const feed=feeds.get(row.game_id),finalGame=feed?finalGameFromFeed(feed):null;if(!finalGame)continue;const grade=gradeBet({market:row.market,selectionKey:row.selection_key,subjectId:null,line:row.line,americanOdds:100,stakeUnits:1},finalGame);if(!grade)continue;const outcome=grade.result==="WON"?1:grade.result==="LOST"?0:null,brier=outcome==null?null:(row.probability-outcome)**2;updates.push(db.prepare("UPDATE forecast_snapshots SET status = ?, outcome = ?, brier = ?, settled_at = ? WHERE id = ? AND status = 'OPEN'").bind(grade.result,outcome,brier,new Date().toISOString(),row.id));}
  if(updates.length)await db.batch(updates);
  const scoredQuery=await db.prepare("SELECT market,probability,outcome,brier FROM forecast_snapshots WHERE status IN ('WON','LOST') ORDER BY game_date DESC LIMIT 10000").all<ScoredRow>(),statusQuery=await db.prepare("SELECT status, COUNT(*) AS count FROM forecast_snapshots GROUP BY status").all<{status:string;count:number}>(),rows=(scoredQuery.results??[]) as ScoredForecast[],status=Object.fromEntries((statusQuery.results??[]).map(row=>[row.status,row.count]));
  return Response.json({retrievedAt:new Date().toISOString(),issued:Object.values(status).reduce((sum,count)=>sum+count,0),status,settledNow:updates.length,...prospectiveMetrics(rows)},{headers:{"cache-control":"no-store"}});
  }catch(error){const detail=error instanceof Error?error.message:"Unknown database error";return Response.json({error:"Prospective tracking is initializing.",detail},{status:503,headers:{"cache-control":"no-store"}});}
}
