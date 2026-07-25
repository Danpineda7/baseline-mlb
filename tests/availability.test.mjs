import assert from "node:assert/strict";
import test from "node:test";
import {currentInjuredList} from "../lib/availability.ts";

test("reconstructs current injured-list state from ordered transactions",()=>{
  const rows=[
    {id:1,date:"2026-04-01",description:"Team placed RHP A on the 15-day injured list. Elbow soreness.",person:{id:10,fullName:"Pitcher A"},toTeam:{id:1,name:"Team"}},
    {id:2,date:"2026-04-02",description:"Team placed CF B on the 10-day injured list. Hamstring strain.",person:{id:11,fullName:"Hitter B"},toTeam:{id:1,name:"Team"}},
    {id:3,date:"2026-04-20",description:"Team activated RHP A from the 15-day injured list.",person:{id:10,fullName:"Pitcher A"},toTeam:{id:1,name:"Team"}},
    {id:4,date:"2026-05-01",description:"Team transferred CF B from the 10-day injured list to the 60-day injured list.",person:{id:11,fullName:"Hitter B"},toTeam:{id:1,name:"Team"}},
  ];
  const current=currentInjuredList(rows);
  assert.equal(current.length,1);
  assert.equal(current[0].playerId,11);
  assert.match(current[0].description,/60-day/);
});
