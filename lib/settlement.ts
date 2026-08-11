export type SettlementInput={market:string;selectionKey:string|null;subjectId:number|null;line:number|null;americanOdds:number;stakeUnits:number};
export type FinalGame={awayRuns:number;homeRuns:number;innings:Array<{num:number;awayRuns:number;homeRuns:number}>;players:Record<number,{hits:number;strikeOuts:number;plateAppearances?:number;outsPitched?:number}>};

export function gradeBet(bet:SettlementInput,game:FinalGame){
  let result:"WON"|"LOST"|"PUSH"|"VOID"|null=null;
  if(bet.market==="moneyline") result=game.awayRuns===game.homeRuns?"PUSH":(bet.selectionKey==="away"?game.awayRuns>game.homeRuns:game.homeRuns>game.awayRuns)?"WON":"LOST";
  else if(bet.market==="over"||bet.market==="under"){if(bet.line==null)return null;const total=game.awayRuns+game.homeRuns;result=total===bet.line?"PUSH":bet.market==="over"?(total>bet.line?"WON":"LOST"):(total<bet.line?"WON":"LOST");}
  else if(bet.market==="f5"){const innings=game.innings.filter(i=>i.num>=1&&i.num<=5);if(new Set(innings.map(inning=>inning.num)).size<5)result="VOID";else{const firstFive=innings.reduce((sum,i)=>({away:sum.away+i.awayRuns,home:sum.home+i.homeRuns}),{away:0,home:0});result=firstFive.away===firstFive.home?"PUSH":(bet.selectionKey==="away"?firstFive.away>firstFive.home:firstFive.home>firstFive.away)?"WON":"LOST";}}
  else if(bet.market==="nrfi"||bet.market==="yrfi"){const first=game.innings.find(i=>i.num===1);if(!first)result="VOID";else{const run=(first.awayRuns+first.homeRuns)>0;result=(bet.market==="yrfi"?run:!run)?"WON":"LOST";}}
  // Player props VOID (like sportsbooks) when the player is absent from the
  // boxscore OR recorded but did not actually participate (0 PA / 0 outs).
  else if(bet.market==="awayK"||bet.market==="homeK"){if(bet.subjectId==null||bet.line==null)return null;const player=game.players[bet.subjectId];result=player==null||player.outsPitched===0?"VOID":player.strikeOuts===bet.line?"PUSH":player.strikeOuts>bet.line?"WON":"LOST";}
  else if(bet.market==="hit"){if(bet.subjectId==null)return null;const player=game.players[bet.subjectId];result=player==null||player.plateAppearances===0?"VOID":player.hits>=1?"WON":"LOST";}
  if(!result)return null;
  const payout=bet.americanOdds>0?bet.americanOdds/100:100/Math.abs(bet.americanOdds);
  const profitUnits=result==="WON"?bet.stakeUnits*payout:result==="LOST"?-bet.stakeUnits:0;
  return {result,profitUnits};
}
