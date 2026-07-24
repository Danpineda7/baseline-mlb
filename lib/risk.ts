export type PortfolioPosition={gameId:number;gameDate:string;market:string;selectionKey:string|null;line:number|null;stakeUnits:number};
export const DAILY_EXPOSURE_CAP=0.02;
export const GAME_EXPOSURE_CAP=0.01;
export const OPEN_POSITION_CAP=8;

const sameLine=(left:number|null,right:number|null)=>left==null&&right==null||left!=null&&right!=null&&Math.abs(left-right)<1e-9;

export function portfolioDecision(open:PortfolioPosition[],candidate:PortfolioPosition){
  const dailyExposure=open.filter(position=>position.gameDate===candidate.gameDate).reduce((sum,position)=>sum+position.stakeUnits,0);
  const gameExposure=open.filter(position=>position.gameId===candidate.gameId).reduce((sum,position)=>sum+position.stakeUnits,0);
  const duplicate=open.some(position=>position.gameId===candidate.gameId&&position.market===candidate.market&&position.selectionKey===candidate.selectionKey&&sameLine(position.line,candidate.line));
  if(duplicate)return{qualifies:false,reason:"This exact recommendation is already open.",dailyExposure,gameExposure};
  if(open.length>=OPEN_POSITION_CAP)return{qualifies:false,reason:`Open-position cap reached (${OPEN_POSITION_CAP}).`,dailyExposure,gameExposure};
  if(gameExposure+candidate.stakeUnits>GAME_EXPOSURE_CAP+1e-9)return{qualifies:false,reason:"Per-game exposure would exceed 1.0% of bankroll.",dailyExposure,gameExposure};
  if(dailyExposure+candidate.stakeUnits>DAILY_EXPOSURE_CAP+1e-9)return{qualifies:false,reason:"Daily exposure would exceed 2.0% of bankroll.",dailyExposure,gameExposure};
  return{qualifies:true,reason:"Portfolio exposure gates passed.",dailyExposure,gameExposure};
}
