type CloudflareRequestInit=RequestInit&{cf?:{cacheEverything?:boolean;cacheTtl?:number}};

export function fetchMlb(url:string|URL,cacheTtl:number){
  return fetch(url,{headers:{accept:"application/json"},cf:{cacheEverything:true,cacheTtl}} as CloudflareRequestInit);
}

export const COMPLETED_SEASON_TTL=7*24*60*60;
export const CURRENT_SEASON_TTL=15*60;
