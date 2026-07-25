export type InjuryTransaction={id?:number;date?:string;description?:string;person?:{id?:number;fullName?:string};toTeam?:{id?:number;name?:string}};
export type InjuredPlayer={playerId:number;name:string;teamId:number;teamName:string;since:string;description:string};

export function currentInjuredList(transactions:InjuryTransaction[]){
  const state=new Map<number,InjuredPlayer>();
  const sorted=[...transactions].sort((a,b)=>(a.date??"").localeCompare(b.date??"")||(a.id??0)-(b.id??0));
  for(const transaction of sorted){const description=transaction.description??"",playerId=transaction.person?.id??0;if(!playerId||!/injured list/i.test(description))continue;if(/\b(activated|reinstated)\b/i.test(description)){state.delete(playerId);continue;}if(!/\b(placed|transferred)\b/i.test(description))continue;const teamId=transaction.toTeam?.id??0;if(!teamId)continue;state.set(playerId,{playerId,name:transaction.person?.fullName??"Unknown player",teamId,teamName:transaction.toTeam?.name??"Unknown team",since:transaction.date??"",description});}
  return [...state.values()].sort((a,b)=>a.teamName.localeCompare(b.teamName)||a.name.localeCompare(b.name));
}
