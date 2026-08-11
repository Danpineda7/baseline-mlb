type ForecastGame={id:number;startsAt:string|null;quality:{teamRecords:boolean;starterStats:boolean;validatedMarkets:{moneyline:boolean;total:boolean;firstFive:boolean;firstInning:boolean}};home:{winProbability:number};total:{line:number;overProbability:number};firstFive:{homeWinProbability:number};firstInning:{nrfiProbability:number}};
export type ForecastCandidate={id:string;gameId:number;gameDate:string;startsAt:string;modelVersion:string;market:string;selectionKey:string;line:number|null;probability:number};
export type ScoredForecast={market:string;probability:number;outcome:number;brier:number};

// Forecasts freeze only inside this pre-pitch window. Without it, anyone
// browsing a future date froze that slate days early with sparse features,
// and first-write-wins kept the stale version forever.
export const FREEZE_WINDOW_MS=6*60*60*1000;

export function forecastCandidates(games:ForecastGame[],gameDate:string,modelVersion:string,now=Date.now()){
  const rows:ForecastCandidate[]=[];
  for(const game of games){if(!game.startsAt)continue;const lead=Date.parse(game.startsAt)-now;if(!Number.isFinite(lead)||lead<=0||lead>FREEZE_WINDOW_MS||!game.quality.teamRecords||!game.quality.starterStats)continue;const markets=[{market:"moneyline",selectionKey:"home",line:null,probability:game.home.winProbability},{market:"over",selectionKey:"over",line:game.total.line,probability:game.total.overProbability},{market:"f5",selectionKey:"home",line:null,probability:game.firstFive.homeWinProbability},{market:"nrfi",selectionKey:"nrfi",line:null,probability:game.firstInning.nrfiProbability}];for(const market of markets)rows.push({id:`${modelVersion}:${gameDate}:${game.id}:${market.market}:${market.selectionKey}:${market.line??"na"}`,gameId:game.id,gameDate,startsAt:game.startsAt,modelVersion,market:market.market,selectionKey:market.selectionKey,line:market.line,probability:market.probability});}
  return rows;
}

export async function persistForecastSnapshots(games:ForecastGame[],gameDate:string,modelVersion:string){
  const rows=forecastCandidates(games,gameDate,modelVersion);if(!rows.length)return 0;
  const {env}=await import("cloudflare:workers"),createdAt=new Date().toISOString();
  await env.DB.batch(rows.map(row=>env.DB.prepare("INSERT OR IGNORE INTO forecast_snapshots (id,game_id,game_date,starts_at,model_version,market,selection_key,line,probability,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,'OPEN',?)").bind(row.id,row.gameId,row.gameDate,row.startsAt,row.modelVersion,row.market,row.selectionKey,row.line,row.probability,createdAt)));
  return rows.length;
}

export async function persistProjectionArchives(games:unknown[],gameDate:string,modelVersion:string){
  const {env}=await import("cloudflare:workers"),createdAt=new Date().toISOString(),now=Date.now(),rows=games.filter((game):game is {id:number;startsAt:string}=>{if(!game||typeof game!=="object"||!("id" in game)||!("startsAt" in game)||typeof game.id!=="number"||typeof game.startsAt!=="string")return false;const lead=Date.parse(game.startsAt)-now;return Number.isFinite(lead)&&lead>0&&lead<=FREEZE_WINDOW_MS;});if(!rows.length)return 0;
  await env.DB.batch(rows.map(game=>env.DB.prepare("INSERT OR IGNORE INTO projection_archives (id,game_id,game_date,starts_at,model_version,payload_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(`${modelVersion}:${gameDate}:${game.id}`,game.id,gameDate,game.startsAt,modelVersion,JSON.stringify(game),createdAt)));
  return rows.length;
}

export function prospectiveMetrics(rows:ScoredForecast[]){
  const summarize=(items:ScoredForecast[])=>({count:items.length,accuracy:items.length?items.filter(row=>(row.probability>=.5)===(row.outcome===1)).length/items.length:null,brier:items.length?items.reduce((sum,row)=>sum+row.brier,0)/items.length:null});
  const markets=[...new Set(rows.map(row=>row.market))].map(market=>({market,...summarize(rows.filter(row=>row.market===market))}));
  const ranges=[{label:"50–54%",low:.5,high:.55},{label:"55–59%",low:.55,high:.6},{label:"60–64%",low:.6,high:.65},{label:"65%+",low:.65,high:1.01}],bands=ranges.map(range=>{const items=rows.filter(row=>{const confidence=Math.max(row.probability,1-row.probability);return confidence>=range.low&&confidence<range.high});return{label:range.label,...summarize(items)}});
  return{total:summarize(rows),markets,bands};
}
