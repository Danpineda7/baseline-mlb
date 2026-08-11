type NextRequestInit=RequestInit&{next?:{revalidate?:number}};

// Next.js data-cache fetch: completed-season history is effectively immutable
// (long TTL); the current season refreshes every 15 minutes.
export function fetchMlb(url:string|URL,cacheTtl:number){
  return fetch(url,{headers:{accept:"application/json"},next:{revalidate:cacheTtl}} as NextRequestInit);
}

export const COMPLETED_SEASON_TTL=7*24*60*60;
export const CURRENT_SEASON_TTL=15*60;
