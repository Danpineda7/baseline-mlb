export type SettlementInput={market:string;selectionKey:string|null;subjectId:number|null;line:number|null;americanOdds:number;stakeUnits:number};
export type FinalGame={awayRuns:number;homeRuns:number;innings:Array<{num:number;awayRuns:number;homeRuns:number}>;players:Record<number,{hits:number;strikeOuts:number}>};

export function gradeBet(bet:SettlementInput,game:FinalGame){
  let result:"WON"|"LOST"|"PUSH"|null=null;
  if(bet.market==="moneyline") result=(bet.selectionKey==="away"?game.awayRuns>game.homeRuns:game.homeRuns>game.awayRuns)?"WON":"LOST";
  else if(bet.market==="over"||bet.market==="under"){if(bet.line==null)return null;const total=game.awayRuns+game.homeRuns;result=total===bet.line?"PUSH":bet.market==="over"?(total>bet.line?"WON":"LOST"):(total<bet.line?"WON":"LOST");}
  else if(bet.market==="f5"){const firstFive=game.innings.filter(i=>i.num<=5).reduce((sum,i)=>({away:sum.away+i.awayRuns,home:sum.home+i.homeRuns}),{away:0,home:0});result=firstFive.away===firstFive.home?"PUSH":(bet.selectionKey==="away"?firstFive.away>firstFive.home:firstFive.home>firstFive.away)?"WON":"LOST";}
  else if(bet.market==="nrfi"||bet.market==="yrfi"){const first=game.innings.find(i=>i.num===1);if(!first)return null;const run=(first.awayRuns+first.homeRuns)>0;result=(bet.market==="yrfi"?run:!run)?"WON":"LOST";}
  else if(bet.market==="awayK"||bet.market==="homeK"){if(bet.subjectId==null||bet.line==null)return null;const value=game.players[bet.subjectId]?.strikeOuts;if(value==null)return null;result=value===bet.line?"PUSH":value>bet.line?"WON":"LOST";}
  else if(bet.market==="hit"){if(bet.subjectId==null)return null;const value=game.players[bet.subjectId]?.hits;if(value==null)return null;result=value>=1?"WON":"LOST";}
  if(!result)return null;
  const payout=bet.americanOdds>0?bet.americanOdds/100:100/Math.abs(bet.americanOdds);
  const profitUnits=result==="WON"?bet.stakeUnits*payout:result==="LOST"?-bet.stakeUnits:0;
  return {result,profitUnits};
}
