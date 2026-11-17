import assert from 'node:assert/strict';
import {runStartupChecks} from './startup.mjs';
export async function runTransitionChecks(){
  const reports=[];
  await runStartupChecks(async(_,context,mode)=>{
    if(mode!=='fresh')return;
    let now=1800000000000;context.Date=class extends Date {static now(){return now;}};
    for(const template of ['hole','ring']){
      const app=new context.TestApp();app.humanStreamer=null;app.selectedBatchSize=16;app.arenaTemplate=template;app.startNewRound();
      // Start a transit while the pacing timer is still closed: crossing is terminal.
      app.roundStartTime=now;app.lastEliminationTime=now;
      app.updateHazardTransit(true,0.9,now);
      const ball=app.hazardTransit.ball;let previous={...ball.body.position},maxStep=0;
      for(let frame=0;frame<150 && app.balls.includes(ball);frame++){
        now+=1000/60;app.Engine.update(app.engine,1000/60);app.updateCircularArena(1);app.checkBallPhysicsAndEliminations(1/60);
        const current=ball.body.position;maxStep=Math.max(maxStep,Math.hypot(current.x-previous.x,current.y-previous.y));previous={...current};
      }
      assert.ok(!app.balls.includes(ball),template+' guided contender must complete its visible hazard transition '+JSON.stringify({position:ball.body.position,exiting:ball.exiting,readyAge:now-app.lastEliminationTime,gate:app.arenaGate?.isSensor,count:app.balls.length,transit:app.hazardTransit?.ball===ball}));
      assert.ok(maxStep<40,template+' contender jumped '+maxStep+' virtual pixels in one frame');
      assert.ok(app.eliminatedAnims.length>0);
      app.isRoundOver=true;
      for(let frame=0;frame<100;frame++)app.updateEliminationAnimations(1/60);
      assert.equal(app.eliminatedAnims.length,0,'Elimination animations must finish during the victory screen');
      reports.push({template,maxStep:Number(maxStep.toFixed(2)),animationFinished:true});
    }
    // A naturally escaped marble must keep travelling outward during the pacing cooldown.
    const ring=new context.TestApp();ring.humanStreamer=null;ring.arenaTemplate='ring';ring.selectedBatchSize=16;ring.startNewRound();
    const escaped=ring.balls[0];escaped.hasShield=false;escaped.exiting=true;escaped.exitAngle=0;escaped.body.isSensor=true;
    ring.Body.setPosition(escaped.body,{x:ring.arenaCenter.x+ring.arenaRadius+10,y:ring.arenaCenter.y});
    ring.Body.setVelocity(escaped.body,{x:8,y:0});
    ring.roundStartTime=now;ring.lastEliminationTime=now;
    const initialCount=ring.balls.length;
    for(let frame=0;frame<12 && ring.balls.includes(escaped);frame++){
      now+=1000/60;ring.Engine.update(ring.engine,1000/60);ring.updateCircularArena(1);ring.checkBallPhysicsAndEliminations(1/60);
      if(ring.balls.includes(escaped))assert.ok(escaped.body.velocity.x>0,'Cooldown must not bounce an already escaped marble back inward');
    }
    assert.equal(ring.balls.length,initialCount-1,'Already escaped marble must be eliminated without waiting for the next pacing interval');
    assert.equal(ring.hazardTransit,null);
    const beforeAngle=ring.arenaAngle;ring.updateCircularArena(1);
    assert.notEqual(ring.arenaAngle,beforeAngle,'Wheel must resume after the marble clears the gate');
    for(let frame=0;frame<100;frame++)ring.updateEliminationAnimations(1/60);
    assert.equal(ring.eliminatedAnims.length,0);
    reports.push({template:'ring cooldown',removedWithoutTimerWait:true,wheelResumed:true});
  });return reports;
}
