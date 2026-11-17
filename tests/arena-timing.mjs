import assert from 'node:assert/strict';
import {runStartupChecks} from './startup.mjs';
export async function runTimingChecks(presets=['blitz','standard'], counts=[40,120], templates=['hole','ring']) {
 const results=[];
 await runStartupChecks(async (_,context,mode)=>{
  if(mode!=='fresh')return;
  let time=1800000000000;
  context.Date=class extends Date {static now(){return time;}};
  for(const template of templates) for(const count of counts) for(const preset of presets) {
   const app=new context.TestApp();
   app.selectedBatchSize=count;app.arenaTemplate=template;app.applyDurationPreset(preset);app.startNewRound();
   app.humanStreamer=null;
   const started=time, target=app.targetMatchSeconds;
   let eliminations=0, previous=count;
   for(let step=0;step<(target+6)*60 && !app.isRoundOver;step++){
    time+=1000/60;
    app.Engine.update(app.engine,1000/60);app.updateCircularArena(1);app.checkBallPhysicsAndEliminations(1/60);
    if(app.balls.length<previous){eliminations+=previous-app.balls.length;previous=app.balls.length;}
    if(template==='hole') for(const b of app.balls)assert.ok(Math.hypot(b.body.position.x-app.arenaCenter.x,b.body.position.y-app.arenaCenter.y)+b.radius<=app.arenaRadius-18+0.001);
   }
   const elapsed=(time-started)/1000;
   assert.equal(app.isRoundOver,true,template+' stalled');assert.equal(app.balls.length,1);assert.equal(eliminations,count-1);
   assert.ok(elapsed>=target-2 && elapsed<=target+6,template+' bad duration '+elapsed);
   results.push({template,count,preset,target,elapsed:Number(elapsed.toFixed(2)),eliminations});
  }
 });return results;
}
