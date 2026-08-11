import { impliedProbability } from "./modeling.ts";
import { CLOSING_WINDOW_MS } from "./ledger-validation.ts";

export type Forecast={game_id:number;market:string;selection_key:string;line:number|null;probability:number;outcome:number;starts_at:string};
export type Observation={game_id:number;market:string;selection:string;line:number|null;american_odds:number;observed_at:string;sportsbook:string;metadata_json:string};
type CanonicalObservation=Observation&{canonicalMarket:string;canonicalSelection:string;time:number};
type Pair={selected:CanonicalObservation;other:CanonicalObservation;time:number};

// Two sides of a market must be observed within this window of each other to
// count as one coherent price; mixing snapshots hours apart distorts no-vig.
export const PAIR_WINDOW_MS=10*60*1000;

const ALLOWED_SELECTIONS:Record<string,readonly string[]>={moneyline:["home","away"],over:["over","under"],f5:["home","away"],nrfi:["nrfi","yrfi"]};
const opposite=(selection:string)=>({home:"away",away:"home",over:"under",under:"over",nrfi:"yrfi",yrfi:"nrfi"}[selection]??"");
const profitFor=(odds:number)=>odds>0?odds/100:100/-odds;

// Strict: only observations whose writer recorded explicit canonical fields
// participate. No substring guessing from display text — that previously
// mapped "Opposite of Over 8.5" onto the same side as "Over 8.5".
function normalize(row:Observation):CanonicalObservation|null{
  let meta={} as Record<string,unknown>;
  try{meta=JSON.parse(row.metadata_json);}catch{}
  const market=typeof meta.canonicalMarket==="string"?meta.canonicalMarket:null;
  const selection=typeof meta.canonicalSelection==="string"?meta.canonicalSelection:null;
  const time=Date.parse(row.observed_at);
  if(!market||!selection||!ALLOWED_SELECTIONS[market]?.includes(selection)||!Number.isFinite(time)||impliedProbability(row.american_odds)==null)return null;
  return{...row,canonicalMarket:market,canonicalSelection:selection,time};
}

export type EvaluatedForecast={
  market:string;startsAt:string;probability:number;outcome:number;book:string;
  entryProbability:number;   // no-vig probability at the earliest valid pair (simulated entry)
  closeProbability:number;   // no-vig probability at the latest valid pair before first pitch
  closingClass:boolean;      // latest pair observed within 30 minutes of first pitch
  edge:number;               // model - entry no-vig (the edge available when the decision was made)
  closeEdge:number;          // model - close no-vig
  clv:number;                // closeProbability - entryProbability (did the market move toward the pick?)
  qualifies:boolean;profit:number;brier:number;
};

export type MarketSummary={priced:number;qualifying:number;closingPriced:number;roi:number|null;roiCi95:[number,number]|null;averageEdge:number|null;averageClv:number|null;clvSamples:number};

export function summarizeEvaluated(rows:EvaluatedForecast[]):MarketSummary{
  const plays=rows.filter(row=>row.qualifies);
  const clvRows=plays.filter(row=>row.closingClass);
  const mean=(values:number[])=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
  const profits=plays.map(row=>row.profit);
  const roi=mean(profits);
  let roiCi95:[number,number]|null=null;
  if(roi!=null&&profits.length>=2){
    const variance=profits.reduce((sum,value)=>sum+(value-roi)**2,0)/(profits.length-1);
    const half=1.96*Math.sqrt(variance/profits.length);
    roiCi95=[roi-half,roi+half];
  }
  return{priced:rows.length,qualifying:plays.length,closingPriced:rows.filter(row=>row.closingClass).length,roi,roiCi95,averageEdge:mean(rows.map(row=>row.edge)),averageClv:mean(clvRows.map(row=>row.clv)),clvSamples:clvRows.length};
}

export function marketValidation(forecasts:Forecast[],rawOdds:Observation[]){
  const odds=rawOdds.map(normalize).filter((row):row is CanonicalObservation=>Boolean(row));
  const evaluated:EvaluatedForecast[]=[];
  for(const forecast of forecasts){
    const start=Date.parse(forecast.starts_at);
    const selection=forecast.selection_key,other=opposite(selection),market=forecast.market;
    if(!Number.isFinite(start)||!ALLOWED_SELECTIONS[market]?.includes(selection))continue;
    // Line markets require an exact line match on both sides; a null line never
    // matches (the old wildcard silently paired mismatched totals).
    const lineMatches=(row:CanonicalObservation)=>market!=="over"||(forecast.line!=null&&row.line!=null&&Math.abs(row.line-forecast.line)<.01);
    const candidates=odds.filter(row=>row.game_id===forecast.game_id&&row.canonicalMarket===market&&row.time<start&&lineMatches(row));
    let best:{open:Pair;close:Pair;book:string}|null=null;
    for(const book of new Set(candidates.map(row=>row.sportsbook))){
      const rows=candidates.filter(row=>row.sportsbook===book);
      const selectedRows=rows.filter(row=>row.canonicalSelection===selection).sort((a,b)=>a.time-b.time);
      const otherRows=rows.filter(row=>row.canonicalSelection===other).sort((a,b)=>a.time-b.time);
      const pairs:Pair[]=[];
      for(const selectedRow of selectedRows){
        let bestOther:CanonicalObservation|null=null,bestGap=PAIR_WINDOW_MS+1;
        for(const otherRow of otherRows){const gap=Math.abs(otherRow.time-selectedRow.time);if(gap<bestGap){bestGap=gap;bestOther=otherRow;}}
        if(bestOther&&bestGap<=PAIR_WINDOW_MS)pairs.push({selected:selectedRow,other:bestOther,time:Math.max(selectedRow.time,bestOther.time)});
      }
      if(!pairs.length)continue;
      const open=pairs[0],close=pairs[pairs.length-1];
      if(!best||close.time>best.close.time)best={open,close,book};
    }
    if(!best)continue;
    const noVig=(pair:Pair)=>{const selectedImplied=impliedProbability(pair.selected.american_odds)!,otherImplied=impliedProbability(pair.other.american_odds)!;return selectedImplied/(selectedImplied+otherImplied);};
    const entryProbability=noVig(best.open),closeProbability=noVig(best.close);
    const closingClass=start-best.close.time<=CLOSING_WINDOW_MS;
    const edge=forecast.probability-entryProbability;
    const qualifies=forecast.probability>=.5&&edge>=.03;
    // A qualifying play is simulated as entered at the earliest priced moment,
    // so ROI uses the entry price and CLV measures movement toward the close.
    const profit=qualifies?(forecast.outcome===1?profitFor(best.open.selected.american_odds):-1):0;
    evaluated.push({market,startsAt:forecast.starts_at,probability:forecast.probability,outcome:forecast.outcome,book:best.book,entryProbability,closeProbability,closingClass,edge,closeEdge:forecast.probability-closeProbability,clv:closeProbability-entryProbability,qualifies,profit,brier:(forecast.probability-forecast.outcome)**2});
  }
  const markets=[...new Set(forecasts.map(row=>row.market))].map(market=>({market,...summarizeEvaluated(evaluated.filter(row=>row.market===market))}));
  return{
    forecasts:forecasts.length,
    pricedForecasts:evaluated.length,
    coverage:forecasts.length?evaluated.length/forecasts.length:0,
    forecastDays:new Set(forecasts.map(row=>row.starts_at.slice(0,10))).size,
    pricedDays:new Set(evaluated.map(row=>row.startsAt.slice(0,10))).size,
    ...summarizeEvaluated(evaluated),
    markets,
    evaluated,
  };
}
