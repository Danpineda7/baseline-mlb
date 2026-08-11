import { syncOddsPapiDate } from "@/lib/oddspapi";
import { requireAdmin } from "@/lib/admin-auth";
import { getDatabase } from "@/lib/db";

// API routes are always dynamic: they read the database and live MLB feeds
// and must never be baked into the build as static responses.
export const dynamic="force-dynamic";

type ScheduleGames={dates?:Array<{games?:Array<{gamePk?:number;teams?:{away?:{team?:{name?:string}};home?:{team?:{name?:string}}}}>}>};

// The scheduled automation function calls this without a games list; fetching
// the official schedule here keeps fixture-to-game matching self-contained.
async function scheduleGamesFor(date:string){
  const url=new URL("https://statsapi.mlb.com/api/v1/schedule");
  url.searchParams.set("sportId","1");url.searchParams.set("date",date);url.searchParams.set("hydrate","team");
  const response=await fetch(url,{headers:{accept:"application/json"}});
  if(!response.ok)return [];
  const payload=await response.json() as ScheduleGames;
  return (payload.dates??[]).flatMap(day=>day.games??[]).map(game=>({id:game.gamePk??0,awayTeam:game.teams?.away?.team?.name??"",homeTeam:game.teams?.home?.team?.name??""})).filter(game=>game.id>0&&game.awayTeam&&game.homeTeam);
}

export async function POST(request:Request){const admin=await requireAdmin(request);if(!admin.ok)return admin.response;const key=process.env.ODDS_PAPI_KEY;if(typeof key!=="string"||!key)return Response.json({error:"The free OddsPapi key is not configured."},{status:503});try{const body=await request.json() as {date?:string;limit?:number;games?:Array<{id:number;awayTeam:string;homeTeam:string}>};if(!body.date?.match(/^\d{4}-\d{2}-\d{2}$/))return Response.json({error:"A valid slate date is required."},{status:400});let games=(body.games??[]).filter(game=>Number.isInteger(game.id)&&game.awayTeam&&game.homeTeam);if(!games.length)games=await scheduleGamesFor(body.date);const result=await syncOddsPapiDate(getDatabase(),key,body.date,games,body.limit);return Response.json(result);}catch(error){return Response.json({error:error instanceof Error?error.message:"Odds import failed."},{status:502});}}
