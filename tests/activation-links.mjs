import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';

export async function runActivationLinkChecks(){
  const shared=await fs.readFile(new URL('../activation-links.js',import.meta.url),'utf8');
  const redirect=await fs.readFile(new URL('../admin/activation-redirect.js',import.meta.url),'utf8');
  const publicAccess=await fs.readFile(new URL('../client-access.js',import.meta.url),'utf8');
  // Synthetic legacy key only; no customer bearer credentials belong in tests.
  const legacy='CFB-LIFETIME-demo player-2110000000000-deadbeef';
  const modern='CFB2.11111111-1111-4111-8111-111111111111.test-signature';
  const samples=[
    'https://game.example/admin/?key='+encodeURIComponent(legacy),
    'https://game.example/admin?key='+encodeURIComponent(modern),
    'https://game.example/admin/index.html?activate='+encodeURIComponent(modern),
    'https://game.example/admin/#activate='+encodeURIComponent(modern),
    'https://game.example/admin/?key='+encodeURIComponent(legacy)+'&admin=true&next=https://evil.example'
  ];
  for(const href of samples){
    const redirects=[],context={URL,URLSearchParams,location:{href,replace:value=>redirects.push(value)},document:{documentElement:{hidden:false}}};
    vm.createContext(context);vm.runInContext(shared,context);
    const key=context.CFBActivationLinks.read(href);
    vm.runInContext(redirect,context);
    assert.equal(redirects.length,1);
    const destination=new URL(redirects[0]);
    assert.equal(destination.origin,'https://game.example');assert.equal(destination.pathname,'/');assert.equal(destination.search,'');
    assert.equal(context.CFBActivationLinks.read(destination),key,'Keep spaces and signatures intact');
    assert.equal(context.document.documentElement.hidden,true);assert.equal(context.__cfbActivationRedirect,true);
  }
  const ordinary={URL,URLSearchParams,location:{href:'https://game.example/admin',replace(){throw new Error('Plain admin route must not redirect');}},document:{documentElement:{hidden:false}}};
  vm.createContext(ordinary);vm.runInContext(shared,ordinary);vm.runInContext(redirect,ordinary);assert.equal(ordinary.document.documentElement.hidden,false);
  assert.equal(new URL(ordinary.CFBActivationLinks.build(modern,'https://game.example/admin/index.html')).pathname,'/');
  assert.equal(new URL(ordinary.CFBActivationLinks.build(modern,'file:///E:/project/admin/index.html')).origin,'https://www.countryflagbattle.xyz');

  let calls=0;
  class SecurityEngine {}
  const publicContext={URL,URLSearchParams,SecurityEngine,location:{href:'https://game.example/',protocol:'https:',pathname:'/'},document:{getElementById:()=>null}};
  vm.createContext(publicContext);vm.runInContext(shared,publicContext);vm.runInContext(publicAccess,publicContext);
  const security=new SecurityEngine();security.api=async()=>{calls++;return {valid:true};};
  await assert.rejects(()=>security.activateKey(legacy),error=>error.code==='LEGACY_ACTIVATION_KEY');assert.equal(calls,0,'Do not trust legacy client-signed keys');
  await security.activateKey(modern);assert.equal(calls,1);

  const config=JSON.parse(await fs.readFile(new URL('../vercel.json',import.meta.url),'utf8'));
  for(const path of ['/admin','/admin/:path*'])for(const key of ['key','activate'])assert.ok(config.redirects.some(rule=>rule.source===path && rule.destination==='/' && rule.has?.some(condition=>condition.type==='query' && condition.key===key)));
  const adminHtml=await fs.readFile(new URL('../admin/index.html',import.meta.url),'utf8');assert.ok(adminHtml.indexOf('/admin/activation-redirect.js')<adminHtml.indexOf('/admin/app.js'));
  const adminScript=await fs.readFile(new URL('../admin/app.js',import.meta.url),'utf8');
  let adminRequests=0;
  const bypass={__cfbActivationRedirect:true,location:{protocol:'https:'},document:{getElementById:()=>({}),querySelectorAll:()=>[]},fetch(){adminRequests++;throw new Error('Customer activation must not call admin endpoints');},setInterval(){}};
  bypass.window=bypass;vm.createContext(bypass);vm.runInContext(adminScript.replace('  bootstrap();setInterval(','  globalThis.__ready=bootstrap();setInterval('),bypass);await bypass.__ready;assert.equal(adminRequests,0);
  return ['Root-only activation links, admin bypass before authentication, encoded usernames, safe destinations, untouched plain admin and legacy reissue handling passed'];
}
