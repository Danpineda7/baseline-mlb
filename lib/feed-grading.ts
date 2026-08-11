import { inningsToDecimal } from "./modeling.ts";
import type { FinalGame } from "./settlement.ts";

export type Feed={gameData?:{status?:{abstractGameState?:string}};liveData?:{linescore?:{teams?:{away?:{runs?:number};home?:{runs?:number}};innings?:Array<{num?:number;away?:{runs?:number};home?:{runs?:number}}>};boxscore?:{teams?:{away?:FeedSide;home?:FeedSide}}}};
type FeedSide={players?:Record<string,{person?:{id?:number};stats?:{batting?:{hits?:number;plateAppearances?:number};pitching?:{strikeOuts?:number;inningsPitched?:string}}}>};

/**
 * Single canonical mapping from the MLB live feed to a gradable FinalGame.
 * Plate appearances and outs pitched are carried so player props for
 * scratched or non-participating players grade VOID instead of LOST.
 * Returns null unless the game is officially Final.
 */
export function finalGameFromFeed(feed:Feed):FinalGame|null{
  if(feed?.gameData?.status?.abstractGameState!=="Final")return null;
  const linescore=feed.liveData?.linescore;
  const players:FinalGame["players"]={};
  for(const side of [feed.liveData?.boxscore?.teams?.away,feed.liveData?.boxscore?.teams?.home]){
    for(const player of Object.values(side?.players??{})){
      const id=player.person?.id;
      if(!id)continue;
      const batting=player.stats?.batting,pitching=player.stats?.pitching;
      players[id]={
        hits:batting?.hits??0,
        strikeOuts:pitching?.strikeOuts??0,
        plateAppearances:batting?.plateAppearances,
        outsPitched:pitching?.inningsPitched!=null?Math.round(inningsToDecimal(pitching.inningsPitched)*3):undefined,
      };
    }
  }
  return{
    awayRuns:linescore?.teams?.away?.runs??0,
    homeRuns:linescore?.teams?.home?.runs??0,
    innings:(linescore?.innings??[]).map(inning=>({num:inning.num??0,awayRuns:inning.away?.runs??0,homeRuns:inning.home?.runs??0})),
    players,
  };
}
