export const CLOSING_WINDOW_MS=30*60*1000;

export function validAmericanOdds(value:number){
  return Number.isInteger(value)&&Math.abs(value)>=100&&Math.abs(value)<=10000;
}

export function closingWindow(startsAt:string|null,now=Date.now()){
  if(!startsAt)return{open:false,reason:"Scheduled first pitch is required."} as const;
  const start=Date.parse(startsAt);
  if(!Number.isFinite(start))return{open:false,reason:"Scheduled first pitch is invalid."} as const;
  if(now>=start)return{open:false,reason:"Closing prices are locked after scheduled first pitch."} as const;
  if(now<start-CLOSING_WINDOW_MS)return{open:false,reason:"Closing prices open 30 minutes before scheduled first pitch."} as const;
  return{open:true,reason:"Closing-price capture window is open."} as const;
}
