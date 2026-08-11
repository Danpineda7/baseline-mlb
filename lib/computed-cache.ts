type D1Like={prepare:(sql:string)=>{bind:(...values:unknown[])=>{run:()=>Promise<{meta?:{changes?:number}}>;first:<T=unknown>()=>Promise<T|null>}}};

const LOCK_TTL_MS=120_000;

export type CachedResult<T>={value:T;computedAt:string;cached:boolean;stale:boolean};

/**
 * Lazily computed, D1-backed artifact cache. The hosting platform offers no
 * cron, so expensive work (three-season walk-forward calibration, provider
 * odds fetches) is computed at most once per key and shared by every visitor.
 * A lock row prevents a stampede: while one request computes, others get the
 * previous (stale) artifact if present, or compute inline without storing.
 */
export async function getOrCompute<T>(db:D1Like,id:string,kind:string,ttlSeconds:number,compute:()=>Promise<T>):Promise<CachedResult<T>>{
  const nowIso=new Date().toISOString();
  const row=await db.prepare("SELECT payload_json,computed_at,expires_at FROM computed_artifacts WHERE id=?").bind(id).first<{payload_json:string;computed_at:string;expires_at:string}>();
  if(row&&row.expires_at>nowIso)return{value:JSON.parse(row.payload_json) as T,computedAt:row.computed_at,cached:true,stale:false};
  const lockId=`lock:${id}`;
  await db.prepare("DELETE FROM computed_artifacts WHERE id=? AND expires_at<=?").bind(lockId,nowIso).run();
  const lock=await db.prepare("INSERT OR IGNORE INTO computed_artifacts (id,kind,payload_json,computed_at,expires_at) VALUES (?,?,'{}',?,?)").bind(lockId,"lock",nowIso,new Date(Date.now()+LOCK_TTL_MS).toISOString()).run();
  const acquired=(lock.meta?.changes??0)>0;
  if(!acquired&&row)return{value:JSON.parse(row.payload_json) as T,computedAt:row.computed_at,cached:true,stale:true};
  try{
    const value=await compute();
    const computedAt=new Date().toISOString();
    if(acquired)await db.prepare("INSERT OR REPLACE INTO computed_artifacts (id,kind,payload_json,computed_at,expires_at) VALUES (?,?,?,?,?)").bind(id,kind,JSON.stringify(value),computedAt,new Date(Date.now()+ttlSeconds*1000).toISOString()).run();
    return{value,computedAt,cached:false,stale:false};
  }finally{
    if(acquired)try{await db.prepare("DELETE FROM computed_artifacts WHERE id=?").bind(lockId).run();}catch{/* an expired lock is cleaned up on the next request */}
  }
}
