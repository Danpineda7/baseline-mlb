type ForecastGame={id:number;startsAt:string|null;quality:{teamRecords:boolean;starterStats:boolean;validatedMarkets:{moneyline:boolean;total:boolean;firstFive:boolean;firstInning:boolean}};home:{winProbability:number};total:{line:number;overProbability:number};firstFive:{homeWinProbability:number};firstInning:{nrfiProbability:number}};
export type ForecastCandidate={id:string;gameId:number;gameDate:string;startsAt:string;modelVersion:string;market:string;selectionKey:string;line:number|null;probability:number};
export type ScoredForecast={market:string;probability:number;outcome:number;brier:number};

export function forecastCandidates(games:ForecastGame[],gameDate:string,modelVersion:string,now=Date.now()){
  const rows:ForecastCandidate[]=[];
  for(const game of games){if(!game.startsAt||Date.parse(game.startsAt)<=now||!game.quality.teamRecords||!game.quality.starterStats)continue;const markets=[game.quality.validatedMarkets.moneyline?{market:"moneyline",selectionKey:"home",line:null,probability:game.home.winProbability}:null,game.quality.validatedMarkets.total?{market:"over",selectionKey:"over",line:game.total.line,probability:game.total.overProbability}:null,game.quality.validatedMarkets.firstFive?{market:"f5",selectionKey:"home",line:null,probability:game.firstFive.homeWinProbability}:null,game.quality.validatedMarkets.firstInning?{market:"nrfi",selectionKey:"nrfi",line:null,probability:game.firstInning.nrfiProbability}:null].filter((market):market is NonNullable<typeof market>=>Boolean(market));for(const market of markets)rows.push({id:`${gameDate}:${game.id}:${market.market}:${market.selectionKey}:${market.line??"na"}`,gameId:game.id,gameDate,startsAt:game.startsAt,modelVersion,market:market.market,selectionKey:market.selectionKey,line:market.line,probability:market.probability});}
  return rows;
}

export async function persistForecastSnapshots(games:ForecastGame[],gameDate:string,modelVersion:string){
  const rows=forecastCandidates(games,gameDate,modelVersion);if(!rows.length)return 0;
  const {env}=await import("cloudflare:workers"),createdAt=new Date().toISOString();
  await env.DB.batch(rows.map(row=>env.DB.prepare("INSERT OR IGNORE INTO forecast_snapshots (id,game_id,game_date,starts_at,model_version,market,selection_key,line,probability,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,'OPEN',?)").bind(row.id,row.gameId,row.gameDate,row.startsAt,row.modelVersion,row.market,row.selectionKey,row.line,row.probability,createdAt)));
  return rows.length;
}

export function prospectiveMetrics(rows:ScoredForecast[]){
  const summarize=(items:ScoredForecast[])=>({count:items.length,accuracy:items.length?items.filter(row=>(row.probability>=.5)===(row.outcome===1)).length/items.length:null,brier:items.length?items.reduce((sum,row)=>sum+row.brier,0)/items.length:null});
  const markets=[...new Set(rows.map(row=>row.market))].map(market=>({market,...summarize(rows.filter(row=>row.market===market))}));
  return{total:summarize(rows),markets};
}
