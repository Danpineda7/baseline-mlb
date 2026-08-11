import { consensusOdds, type OddsEvent } from "@/lib/odds";
import { archiveOddsApiEvents } from "@/lib/odds-vault";
import { getOrCompute } from "@/lib/computed-cache";
import { logSystemEvent } from "@/lib/system-events";
import { getDatabase } from "@/lib/db";

// API routes are always dynamic: they read the database and live MLB feeds
// and must never be baked into the build as static responses.
export const dynamic="force-dynamic";

type OddsPayload={configured:true;provider:string;retrievedAt:string;games:ReturnType<typeof consensusOdds>;archived:number};

export async function GET(){
  const key=process.env.ODDS_API_KEY;
  if(!key)return Response.json({configured:false,provider:"The Odds API",games:[],message:"Manual capture is active. Add a free provider key later for automatic collection."});
  try{
    // One shared 60-second artifact for every visitor: public traffic (or a
    // refresh loop) must not multiply provider quota usage, and quota counters
    // are no longer exposed in the public payload.
    const compute=async():Promise<OddsPayload>=>{
      const endpoint=new URL("https://api.the-odds-api.com/v4/sports/baseball_mlb/odds");
      endpoint.searchParams.set("apiKey",key);endpoint.searchParams.set("regions","us");endpoint.searchParams.set("markets","h2h,totals");endpoint.searchParams.set("oddsFormat","american");endpoint.searchParams.set("dateFormat","iso");
      const response=await fetch(endpoint,{headers:{accept:"application/json"}});
      if(!response.ok)throw new Error(`Odds provider responded ${response.status}`);
      const events=await response.json() as OddsEvent[];
      let archived=0;
      try{archived=await archiveOddsApiEvents(getDatabase(),events);}
      catch(error){await logSystemEvent("odds-archive-failure","warning",{detail:error instanceof Error?error.message:"unknown"});}
      return {configured:true,provider:"The Odds API",retrievedAt:new Date().toISOString(),games:consensusOdds(events),archived};
    };
    let payload:OddsPayload;
    try{
      const cached=await getOrCompute(getDatabase(),"odds:the-odds-api","odds-feed",60,compute);
      payload=cached.value;
    }catch{
      payload=await compute();
    }
    return Response.json(payload,{headers:{"cache-control":"private, max-age=60"}});
  }catch(error){
    return Response.json({configured:true,error:"Automatic odds are temporarily unavailable.",detail:error instanceof Error?error.message:"Unknown provider error"},{status:502});
  }
}
