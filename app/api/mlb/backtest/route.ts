import { walkForwardBacktest, type HistoricalGame } from "@/lib/backtest";

type Feed = { dates?:Array<{games?:Array<{gamePk?:number;gameDate?:string;status?:{abstractGameState?:string};teams?:{away?:{team?:{id?:number};score?:number};home?:{team?:{id?:number};score?:number}}}>}> };
const DATE=/^\d{4}-\d{2}-\d{2}$/;

export async function GET(request:Request) {
  const url=new URL(request.url);
  const through=url.searchParams.get("through")??new Date(Date.now()-86400000).toISOString().slice(0,10);
  if(!DATE.test(through)) return Response.json({error:"Invalid through date."},{status:400});
  const season=Number(through.slice(0,4));
  const endpoint=new URL("https://statsapi.mlb.com/api/v1/schedule");
  endpoint.searchParams.set("sportId","1"); endpoint.searchParams.set("startDate",`${season}-03-15`); endpoint.searchParams.set("endDate",through); endpoint.searchParams.set("gameType","R");
  try {
    const response=await fetch(endpoint,{headers:{accept:"application/json"}});
    if(!response.ok) throw new Error(`MLB responded ${response.status}`);
    const feed=await response.json() as Feed;
    const games:HistoricalGame[]=(feed.dates??[]).flatMap(day=>day.games??[]).filter(game=>game.status?.abstractGameState==="Final").map(game=>({id:game.gamePk??0,playedAt:game.gameDate??"",awayId:game.teams?.away?.team?.id??0,homeId:game.teams?.home?.team?.id??0,awayScore:game.teams?.away?.score??0,homeScore:game.teams?.home?.score??0})).filter(game=>game.id>0&&game.awayId>0&&game.homeId>0&&game.playedAt);
    const result=walkForwardBacktest(games,10);
    return Response.json({season,through,retrievedAt:new Date().toISOString(),source:"MLB Stats API",method:{name:"Expanding-window walk-forward",minimumPriorGames:10,featureRule:"Only final games strictly earlier in iteration order update team state",marketDataIncluded:false},gamesIngested:games.length,...result},{headers:{"cache-control":"public, max-age=1800, stale-while-revalidate=3600"}});
  } catch(error) { return Response.json({error:"Historical validation is temporarily unavailable.",detail:error instanceof Error?error.message:"Unknown source error"},{status:502}); }
}
