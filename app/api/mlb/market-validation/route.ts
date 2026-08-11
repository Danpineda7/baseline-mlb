import { marketValidation, type Forecast, type Observation } from "@/lib/market-validation";
import { computeActivation } from "@/lib/activation";
import { VALIDATION_EPOCH } from "@/lib/epoch";

export async function GET(){
  try{
    const {env}=await import("cloudflare:workers");
    // Phase 6 evidence starts at the validation epoch: earlier rows predate the
    // canonical-mapping fixes and admin-locked writes and are not trustworthy.
    const forecastQuery=await env.DB.prepare("SELECT game_id,market,selection_key,line,probability,outcome,starts_at FROM forecast_snapshots WHERE status IN ('WON','LOST') AND created_at >= ? ORDER BY game_date DESC LIMIT 5000").bind(VALIDATION_EPOCH).all<Forecast>();
    const oddsQuery=await env.DB.prepare("SELECT o.game_id,o.market,o.selection,o.line,o.american_odds,o.observed_at,o.sportsbook,o.metadata_json FROM market_odds_observations o WHERE o.game_id IS NOT NULL AND EXISTS (SELECT 1 FROM forecast_snapshots f WHERE f.game_id=o.game_id AND f.status IN ('WON','LOST') AND f.created_at >= ?) ORDER BY o.observed_at DESC LIMIT 50000").bind(VALIDATION_EPOCH).all<Observation>();
    const criticalQuery=await env.DB.prepare("SELECT COUNT(*) AS count FROM system_events WHERE severity='critical' AND created_at >= ?").bind(VALIDATION_EPOCH).first<{count:number}>();
    const result=marketValidation(forecastQuery.results??[],oddsQuery.results??[]);
    const{evaluated,...summary}=result;
    const activation=computeActivation({evaluated,criticalEvents:criticalQuery?.count??0,forecastDays:result.forecastDays,pricedDays:result.pricedDays});
    return Response.json({retrievedAt:new Date().toISOString(),epoch:VALIDATION_EPOCH,...summary,activation},{headers:{"cache-control":"no-store"}});
  }catch(error){
    return Response.json({error:"Market validation is initializing.",detail:error instanceof Error?error.message:"Unknown database error"},{status:503});
  }
}
