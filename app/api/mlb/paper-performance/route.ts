import { VALIDATION_EPOCH } from "@/lib/epoch";

// Public paper scoreboard. Evidence rules:
// - only post-epoch rows count (earlier data predates the trust fixes);
// - ROI, Brier and CLV aggregate ONLY price-verified paper bets (typed prices
//   matched against a stored odds observation), so fabricated prices cannot
//   move the public numbers;
// - retracted and unverified counts are reported so the denominator is honest.
type GroupRow={bucket:string;issued:number;settled:number;wins:number;retracted:number;verified_bets:number;verified_stake:number;verified_profit:number;verified_brier_sum:number;verified_settled:number};

const summarize=(row:GroupRow)=>({
  issued:row.issued,
  settled:row.settled,
  accuracy:row.settled?row.wins/row.settled:null,
  paperBets:row.verified_bets,
  brier:row.verified_settled?row.verified_brier_sum/row.verified_settled:null,
  roi:row.verified_stake?row.verified_profit/row.verified_stake:null,
  profitUnits:row.verified_profit,
  retracted:row.retracted,
});

const GROUP_SQL=(bucket:string)=>`SELECT ${bucket} AS bucket,
  COUNT(*) AS issued,
  SUM(CASE WHEN status IN ('WON','LOST') THEN 1 ELSE 0 END) AS settled,
  SUM(CASE WHEN status='WON' THEN 1 ELSE 0 END) AS wins,
  SUM(CASE WHEN status='RETRACTED' THEN 1 ELSE 0 END) AS retracted,
  SUM(CASE WHEN decision='PAPER_BET' AND stake_units>0 AND price_verified=1 AND status IN ('WON','LOST') THEN 1 ELSE 0 END) AS verified_bets,
  SUM(CASE WHEN decision='PAPER_BET' AND stake_units>0 AND price_verified=1 AND status IN ('WON','LOST') THEN stake_units ELSE 0 END) AS verified_stake,
  SUM(CASE WHEN decision='PAPER_BET' AND stake_units>0 AND price_verified=1 AND status IN ('WON','LOST') THEN COALESCE(profit_units,0) ELSE 0 END) AS verified_profit,
  SUM(CASE WHEN price_verified=1 AND status IN ('WON','LOST') THEN (model_probability-(CASE WHEN status='WON' THEN 1.0 ELSE 0.0 END))*(model_probability-(CASE WHEN status='WON' THEN 1.0 ELSE 0.0 END)) ELSE 0 END) AS verified_brier_sum,
  SUM(CASE WHEN price_verified=1 AND status IN ('WON','LOST') THEN 1 ELSE 0 END) AS verified_settled
FROM tracked_bets WHERE mode='PAPER' AND created_at >= ?1 GROUP BY bucket ORDER BY bucket`;

export async function GET(){
  try{
    const {env}=await import("cloudflare:workers");
    const [byMarket,byMonth,overallRow,decisionsQuery,testersRow,clvRow,unverifiedRow]=await Promise.all([
      env.DB.prepare(GROUP_SQL("market")).bind(VALIDATION_EPOCH).all<GroupRow>(),
      env.DB.prepare(GROUP_SQL("substr(created_at,1,7)")).bind(VALIDATION_EPOCH).all<GroupRow>(),
      env.DB.prepare(GROUP_SQL("'all'")).bind(VALIDATION_EPOCH).first<GroupRow>(),
      env.DB.prepare("SELECT decision, COUNT(*) AS count FROM tracked_bets WHERE mode='PAPER' AND created_at >= ? GROUP BY decision").bind(VALIDATION_EPOCH).all<{decision:string;count:number}>(),
      env.DB.prepare("SELECT COUNT(DISTINCT owner_key) AS testers FROM tracked_bets WHERE mode='PAPER' AND created_at >= ?").bind(VALIDATION_EPOCH).first<{testers:number}>(),
      env.DB.prepare("SELECT AVG(closing_line_value) AS average_clv, COUNT(*) AS samples FROM tracked_bets WHERE mode='PAPER' AND created_at >= ? AND price_verified=1 AND closing_line_value IS NOT NULL").bind(VALIDATION_EPOCH).first<{average_clv:number|null;samples:number}>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM tracked_bets WHERE mode='PAPER' AND created_at >= ? AND price_verified=0 AND decision='PAPER_BET'").bind(VALIDATION_EPOCH).first<{count:number}>(),
    ]);
    const overall=overallRow?summarize(overallRow):{issued:0,settled:0,accuracy:null,paperBets:0,brier:null,roi:null,profitUnits:0,retracted:0};
    return Response.json({
      retrievedAt:new Date().toISOString(),
      epoch:VALIDATION_EPOCH,
      testers:testersRow?.testers??0,
      decisions:Object.fromEntries(["PAPER_BET","WATCH","PASS"].map(decision=>[decision,(decisionsQuery.results??[]).find(row=>row.decision===decision)?.count??0])),
      overall:{...overall,averageClv:clvRow?.average_clv??null,clvSamples:clvRow?.samples??0,unverifiedBets:unverifiedRow?.count??0},
      markets:(byMarket.results??[]).map(row=>({market:row.bucket,...summarize(row)})),
      months:(byMonth.results??[]).map(row=>({month:row.bucket,...summarize(row)})),
    },{headers:{"cache-control":"no-store"}});
  }catch(error){
    return Response.json({error:"Public beta performance is initializing.",detail:error instanceof Error?error.message:"Unknown database error"},{status:503,headers:{"cache-control":"no-store"}});
  }
}
