import { clamp } from "./modeling.ts";

export type Coverage={available:number;expected:number};
export const coverageRatio=(coverage:Coverage)=>coverage.expected>0?clamp(coverage.available/coverage.expected,0,1):0;

export function slateQualityScore(input:{teams:Coverage;starters:Coverage;lineups:Coverage;hitters:Coverage;weather:Coverage;parks:Coverage;bullpens?:Coverage;opponentStrikeouts?:Coverage;calibrated:boolean}){
  return Math.round(100*(.12*coverageRatio(input.teams)+.18*coverageRatio(input.starters)+.12*coverageRatio(input.lineups)+.08*coverageRatio(input.hitters)+.07*coverageRatio(input.weather)+.06*coverageRatio(input.parks)+.10*coverageRatio(input.bullpens??{available:0,expected:0})+.12*coverageRatio(input.opponentStrikeouts??{available:0,expected:0})+.15*Number(input.calibrated)));
}

export function projectionUncertainty(input:{missingTeams:number;missingStarters:number;lineupsConfirmed:boolean;weatherAvailable:boolean;bullpenAvailable?:boolean;parkGames:number;parkFactor:number;historicalSeason:boolean}){
  return clamp(38+input.missingTeams*20+input.missingStarters*6+Number(!input.lineupsConfirmed)*6+Number(!input.weatherAvailable)+Number(input.bullpenAvailable===false)*3+Number(input.parkGames<20)*4+Number(input.historicalSeason)*8+Math.abs(input.parkFactor-1)*40,35,95);
}
