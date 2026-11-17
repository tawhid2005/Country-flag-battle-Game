import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
export async function runClientAccessChecks() {
  const code=await fs.readFile(new URL('../client-access.js',import.meta.url),'utf8');
  for(const input of ['https://game.example/index.html?admin=true','https://game.example/?admin=true&key=CFB2.test.token','https://game.example/#activate=CFB2.test.token']) {
    const url=new URL(input), changes=[], redirects=[];
    const session={role:'subscriber',userId:'player',displayName:'player',planTitle:'1 Month',expiresAt:Date.now()+86400000};
    class Engine {showLockModal(){}updateDrawerStatus(){}showActivationCelebrationToast(){}}
    const context={URL,URLSearchParams,SecurityEngine:Engine,location:{href:input,protocol:url.protocol,pathname:url.pathname,hash:url.hash,assign:value=>redirects.push(value)},
      history:{replaceState:(state,title,path)=>changes.push(path)},document:{getElementById:()=>null},gameStorage:{getItem(){return null;},removeItem(){}},setInterval(){},clearInterval(){}};
    vm.createContext(context);vm.runInContext(await fs.readFile(new URL('../activation-links.js', import.meta.url), 'utf8'),context);vm.runInContext(code,context);
    const engine=new Engine();engine.api=async(path)=>path==='activate'?{valid:true,session}:{success:true,role:'subscriber',session};
    await engine.login('player','password');assert.equal(engine.session.role,'subscriber');assert.ok(engine.isAuthenticated());
    if(input.includes('CFB2'))await engine.bootServerAccess();
    assert.equal(redirects.length,0,'Customer login/activation must not redirect to administrator');
    assert.ok(changes.every(path=>!path.includes('admin')),'Legacy admin flag must be removed');
    engine.session={...session,role:'admin'};assert.equal(engine.isAuthenticated(),false);
  }
  return ['Legacy admin query cleanup, game-only login/activation and rejection of client admin sessions passed'];
}
