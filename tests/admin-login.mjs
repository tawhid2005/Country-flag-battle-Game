import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {adminSetupStatus,hashPassword} from '../server/security.js';

export async function runAdminLoginChecks(){
  const html=await fs.readFile(new URL('../admin/index.html',import.meta.url),'utf8');
  const source=await fs.readFile(new URL('../admin/app.js',import.meta.url),'utf8');
  assert.match(html,/<form[^>]*id="login-form"[^>]*autocomplete="on"/);
  assert.match(html,/name="username"[^>]*autocomplete="username"/);
  assert.match(html,/name="password"[^>]*type="password"[^>]*autocomplete="current-password"/);
  const env={APP_ORIGIN:'https://game.example',SESSION_SECRET:'s'.repeat(40),ADMIN_USERNAME:'owner',ADMIN_PASSWORD_HASH:hashPassword('long-test-password'),SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'test-service-key'};
  assert.equal(adminSetupStatus(env).ready,true);
  assert.ok(adminSetupStatus({...env,SESSION_SECRET:''}).missing.includes('SESSION_SECRET'));
  assert.ok(adminSetupStatus({...env,ADMIN_PASSWORD_HASH:'plain-text-is-not-a-hash'}).missing.includes('ADMIN_PASSWORD_HASH'));
  assert.ok(adminSetupStatus({...env,APP_ORIGIN:'https://'}).missing.includes('APP_ORIGIN'));
  for(const scenario of ['success','wrong-password','missing-setup','canonical-domain']){
    const elements=new Map();
    function element(id=''){return {id,value:'',hidden:id==='dashboard',disabled:false,textContent:'',style:{},children:[],classList:{toggle(){}},appendChild(child){this.children.push(child);},replaceChildren(){this.children=[];},querySelector(){return element();}};}
    for(const id of [...html.matchAll(/id="([^"]+)"/g)].map(match=>match[1]))elements.set(id,element(id));
    const stored=[],redirects=[];let authenticated=false;
    const context={console,URL,URLSearchParams,Date,Intl,Promise,
      document:{hidden:false,getElementById:id=>elements.get(id),createElement:element,querySelectorAll:()=>[]},
      location:{protocol:'https:',origin:'https://game.example',replace:url=>redirects.push(url)},
      setInterval(){},navigator:{credentials:{store:async credential=>{stored.push(credential);}}},
      PasswordCredential:class{constructor(){this.id=elements.get('username').value;this.password=elements.get('password').value;}},
      fetch:async(url)=>{
        const path=url.split('?')[0];let status=200,body;
        if(path==='/api/health')body={admin:scenario!=='missing-setup',database:true,adminMissing:scenario==='missing-setup'?['SESSION_SECRET']:[],adminOrigin:scenario==='canonical-domain'?'https://www.game.example':'https://game.example'};
        else if(path==='/api/admin/login'){
          if(scenario==='wrong-password'){status=401;body={message:'Invalid administrator credentials'};}
          else{authenticated=true;body={success:true};}
        }else if(path==='/api/admin/monitor'){
          status=authenticated?200:401;body=authenticated?{orders:[],accounts:[],entitlements:[],events:[],plans:{},hasMore:false}:{message:'Administrator login required'};
        }else throw new Error('Unexpected request '+path);
        return {ok:status===200,status,json:async()=>body};
      }
    };
    context.window=context;
    vm.createContext(context);
    vm.runInContext(source.replace('  bootstrap();setInterval(','  globalThis.__adminReady=bootstrap();setInterval('),context);
    await context.__adminReady;
    if(scenario==='missing-setup'){
      assert.match(elements.get('login-status').textContent,/SESSION_SECRET/);assert.ok(elements.get('login-button').disabled);assert.equal(stored.length,0);continue;
    }
    if(scenario==='canonical-domain'){assert.deepEqual(redirects,['https://www.game.example/admin']);assert.equal(stored.length,0);continue;}
    elements.get('username').value='owner';elements.get('password').value='long-test-password';
    await elements.get('login-form').onsubmit({preventDefault(){}});
    if(scenario==='success'){
      assert.equal(stored.length,1);assert.equal(stored[0].id,'owner');assert.equal(stored[0].password,'long-test-password');assert.equal(elements.get('dashboard').hidden,false);assert.equal(elements.get('password').value,'');
    }else{
      assert.equal(stored.length,0,'Never offer to save an unsuccessful login');assert.equal(elements.get('dashboard').hidden,true);
    }
  }
  return ['Admin setup diagnostics, canonical login host, password-manager fields, save-after-success and failed login checks passed'];
}
