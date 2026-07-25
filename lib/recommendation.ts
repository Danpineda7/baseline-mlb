import {countOverProbability,playablePriceThreshold,priceDecision} from "./modeling.ts";

type MarketInput={market:string;selectionKey:string;subjectId:number|null;line:number|null;americanOdds:number;oppositeOdds:number};
type Side={name:string;abbreviation:string;winProbability:number;starter:{playerId:number|null;expectedStrikeouts:number|null}|null};
type Hitter={id:number;name:string;onePlusHitProbability:number|null;platoonAdjusted:boolean};
type ValidatedMarkets={moneyline:boolean;total:boolean;firstFive:boolean;firstInning:boolean;pitcherStrikeouts:boolean;hitterHits:boolean};
export type RecommendationGame={id:number;startsAt:string|null;uncertainty:number;away:Side;home:Side;total:{line:number;overProbability:number;underProbability:number};firstFive:{awayWinProbability:number;homeWinProbability:number};firstInning:{nrfiProbability:number;yrfiProbability:number};lineups:{away:Hitter[];home:Hitter[];confirmed:boolean};quality:{teamRecords:boolean;starterStats:boolean;awayStarter:boolean;homeStarter:boolean;opponentStrikeouts:boolean;validatedMarkets:ValidatedMarkets}};

export function verifyRecommendation(game:RecommendationGame,input:MarketInput){
  if(!game.quality.teamRecords)return{error:"Both team season records are required."} as const;
  const validationKey=input.market==="moneyline"?"moneyline":input.market==="over"||input.market==="under"?"total":input.market==="f5"?"firstFive":input.market==="nrfi"||input.market==="yrfi"?"firstInning":input.market==="awayK"||input.market==="homeK"?"pitcherStrikeouts":input.market==="hit"?"hitterHits":null;
  if(validationKey&&!game.quality.validatedMarkets[validationKey])return{error:"This market has a projection, but its probability model has not passed market-specific walk-forward validation."} as const;
  if(["moneyline","over","under","f5","nrfi","yrfi"].includes(input.market)&&!game.quality.starterStats)return{error:"Both probable starters need official season statistics."} as const;
  let probability:number|null=null,selection="";
  if(input.market==="moneyline"&&(input.selectionKey==="home"||input.selectionKey==="away")){const side=input.selectionKey==="home"?game.home:game.away;probability=side.winProbability;selection=`${side.name} moneyline`;}
  else if((input.market==="over"||input.market==="under")&&input.selectionKey===input.market&&input.line!=null&&Math.abs(input.line-game.total.line)<1e-9){probability=input.market==="over"?game.total.overProbability:game.total.underProbability;selection=`${input.market==="over"?"Over":"Under"} ${game.total.line}`;}
  else if(input.market==="f5"&&(input.selectionKey==="home"||input.selectionKey==="away")){if(!game.quality.starterStats)return{error:"Both probable starters need official season statistics."} as const;const side=input.selectionKey==="home"?game.home:game.away;probability=input.selectionKey==="home"?game.firstFive.homeWinProbability:game.firstFive.awayWinProbability;selection=`${side.name} F5 ML`;}
  else if((input.market==="nrfi"||input.market==="yrfi")&&input.selectionKey===input.market){if(!game.quality.starterStats)return{error:"Both probable starters need official season statistics."} as const;probability=input.market==="nrfi"?game.firstInning.nrfiProbability:game.firstInning.yrfiProbability;selection=input.market.toUpperCase();}
  else if(input.market==="awayK"||input.market==="homeK"){const side=input.market==="awayK"?game.away:game.home,starterReady=input.market==="awayK"?game.quality.awayStarter:game.quality.homeStarter;if(!starterReady||!game.quality.opponentStrikeouts)return{error:"Verified starter and opponent strikeout data are required."} as const;if(input.selectionKey!=="over"||input.line==null||input.line<0.5||input.subjectId!==side.starter?.playerId)return{error:"Pitcher prop identifiers or line do not match the official projection."} as const;probability=side.starter?.expectedStrikeouts==null?null:countOverProbability(side.starter.expectedStrikeouts,input.line);selection=`${side.name} starter over ${input.line} Ks`;}
  else if(input.market==="hit"){const hitter=[...game.lineups.away,...game.lineups.home].find(player=>player.id===input.subjectId);if(!game.lineups.confirmed||input.selectionKey!=="onePlus"||!hitter?.platoonAdjusted)return{error:"Confirmed lineup and matching platoon split are required."} as const;probability=hitter.onePlusHitProbability;selection=`${hitter.name} 1+ hit`;}
  else return{error:"Unsupported or inconsistent market selection."} as const;
  if(probability==null)return{error:"The selected market has no authoritative projection."} as const;
  const decision=priceDecision(probability,input.americanOdds,game.uncertainty/100,input.oppositeOdds);
  if(!decision?.qualifies)return{error:"The authoritative projection does not clear every price and uncertainty gate."} as const;
  return{probability,selection,marketProbability:decision.marketProbability,edge:decision.edge,expectedValue:decision.expectedValue,stakeUnits:decision.stakeFraction,maxPlayableOdds:playablePriceThreshold(probability,input.oppositeOdds,game.uncertainty/100)} as const;
}
