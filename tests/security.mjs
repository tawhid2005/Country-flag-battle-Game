import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHmac} from 'node:crypto';
import {createHandler} from '../api/service.js';
import {hashPassword,verifyPassword,sign,verify,activationKey,validatePolar,validateSSL,verifyPolarWebhook,sslTransactionId,sslOrderId} from '../server/security.js';

export async function runSecurityChecks() {
  const secret='test-secret-only-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const accountId='11111111-1111-4111-8111-111111111111',otherId='33333333-3333-4333-8333-333333333333',orderId='22222222-2222-4222-8222-222222222222';
  const password=hashPassword('a-long-test-password');
  assert.ok(verifyPassword('a-long-test-password',password));assert.equal(verifyPassword('wrong',password),false);
  const userToken=sign({role:'subscriber',sub:accountId,exp:Date.now()+60000},secret);
  assert.equal(verify(userToken,secret,'admin'),null);assert.equal(verify(userToken+'x',secret,'subscriber'),null);
  assert.equal(verify(sign({role:'admin',sub:'admin',exp:1},secret),secret,'admin'),null);
  const order={id:orderId,account_id:accountId,provider:'polar',plan_id:'1m',amount_minor:399,currency:'usd',checkout_id:'checkout-test',activation_nonce:'nonce',status:'pending'};
  const polarPaid={id:'polar-order',paid:true,status:'paid',checkout_id:'checkout-test',product_id:'product-1',metadata:{cfb_order_id:orderId},currency:'usd',net_amount:399,refunded_amount:0,subscription_id:null};
  assert.ok(validatePolar(polarPaid,order,'product-1'));
  for(const change of [{net_amount:1},{product_id:'other'},{currency:'bdt'},{checkout_id:'other'},{refunded_amount:1},{subscription_id:'sub'},{paid:false},{metadata:{}}])assert.equal(validatePolar({...polarPaid,...change},order,'product-1'),false);
  const sslOrder={...order,provider:'sslcommerz',amount_minor:9900,currency:'bdt'};
  const transactionId=sslTransactionId(orderId);assert.ok(transactionId.length<=30);assert.equal(sslOrderId(transactionId),orderId);
  const sslPaid={status:'VALID',tran_id:transactionId,currency:'BDT',amount:'99.00',risk_level:'0',val_id:'verified-val'};
  assert.ok(validateSSL(sslPaid,sslOrder));assert.equal(validateSSL({...sslPaid,amount:'1'},sslOrder),false);assert.equal(validateSSL({...sslPaid,risk_level:1},sslOrder),false);
  const webhookSecret='whsec_'+Buffer.from('another-test-secret').toString('base64'),raw=JSON.stringify({type:'order.paid',data:polarPaid});
  const headers={'webhook-id':'evt-test','webhook-timestamp':String(Math.floor(Date.now()/1000))};
  for(const key of [Buffer.from(webhookSecret),Buffer.from(webhookSecret.slice(6),'base64')]) {
    headers['webhook-signature']='v1,'+createHmac('sha256',key).update(headers['webhook-id']+'.'+headers['webhook-timestamp']+'.'+raw).digest('base64');
    assert.ok(verifyPolarWebhook(raw,headers,webhookSecret));assert.equal(verifyPolarWebhook(raw+' ',headers,webhookSecret),false);
  }
  assert.equal(verifyPolarWebhook(raw,{...headers,'webhook-timestamp':'1'},webhookSecret),false);
  let grants=0,allowRate=true,providerPaid=true;
  const account={id:accountId,username:'player',email:'player@example.com',password_hash:password};
  const env={APP_ORIGIN:'https://game.example',SESSION_SECRET:secret,SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'test-service',ADMIN_USERNAME:'owner',ADMIN_PASSWORD_HASH:password,POLAR_ENV:'sandbox',POLAR_ACCESS_TOKEN:'test-polar',POLAR_WEBHOOK_SECRET:webhookSecret,POLAR_PRODUCTS:JSON.stringify({'1m':'product-1'}),SSLCOMMERZ_STORE_ID:'test-store',SSLCOMMERZ_STORE_PASSWORD:'test-password'};
  function response(value){return {ok:true,status:200,json:async()=>value};}
  const fetcher=async(url,options={})=>{
    const u=new URL(url),p=u.pathname.replace('/rest/v1/','');
    if(u.hostname==='sandbox-api.polar.sh' && u.pathname==='/v1/checkouts/' && options.method==='POST') {
      const submitted=JSON.parse(options.body);assert.equal(submitted.products[0],'product-1');assert.equal(submitted.allow_discount_codes,false);assert.ok(!submitted.success_url.includes('admin'));
      return response({id:'new-polar-checkout',url:'https://buy.polar.sh/checkout/test'});
    }
    if(u.hostname==='sandbox.sslcommerz.com' && u.pathname==='/gwprocess/v4/api.php') {
      assert.equal(options.body.get('total_amount'),'99.00');assert.ok(options.body.get('tran_id').length<=30);assert.ok(!options.body.get('success_url').includes('admin'));
      return response({status:'SUCCESS',sessionkey:'new-bd-checkout',GatewayPageURL:'https://sandbox.sslcommerz.com/gwprocess/test'});
    }
    if(u.hostname==='sandbox-api.polar.sh')return response(u.pathname.endsWith('polar-order') ? polarPaid : {items:providerPaid?[polarPaid]:[]});
    if(u.hostname==='sandbox.sslcommerz.com')return response(u.searchParams.has('val_id') ? sslPaid : {element:providerPaid?[sslPaid]:[]});
    if(p==='rpc/cfb_rate_limit')return response(allowRate);
    if(p==='rpc/cfb_complete_order') {if(order.status!=='paid'){grants++;order.status='paid';}return response(null);}
    if(p==='cfb_events')return response([]);
    if(p==='cfb_accounts')return response(u.searchParams.get('id') === 'eq.'+otherId ? [{...account,id:otherId}] : [account]);
    if(p==='cfb_entitlements')return response([{account_id:accountId,plan_id:'1m',expires_at:new Date(Date.now()+86400000).toISOString(),revoked:false}]);
    if(p==='cfb_orders')return response([order]);
    throw new Error('Unexpected test URL '+u.pathname);
  };
  const handler=createHandler(env,fetcher);
  async function call(path,body,options={}) {
    const request=Readable.from(body===undefined?[]:[JSON.stringify(body)]);request.url='/api/'+path;request.method=body===undefined?'GET':'POST';
    request.headers={origin:env.APP_ORIGIN,'content-type':'application/json',cookie:options.cookie || '',...options.headers};
    const output={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(text){this.body=text?JSON.parse(text):null;}};
    await handler(request,output);return output;
  }
  assert.equal((await call('admin/monitor')).statusCode,401);
  assert.equal((await call('admin/monitor',undefined,{cookie:'__Host-cfb_game='+userToken})).statusCode,401);
  assert.equal((await call('admin/login',{username:'owner',password:'a-long-test-password'},{headers:{origin:'https://evil.example'}})).statusCode,403);
  allowRate=false;assert.equal((await call('admin/login',{username:'owner',password:'a-long-test-password'})).statusCode,429);allowRate=true;
  const login=await call('admin/login',{username:'owner',password:'a-long-test-password'});assert.equal(login.statusCode,200);assert.match(login.headers['set-cookie'],/HttpOnly; Secure; SameSite=Strict/);
  const adminCookie=login.headers['set-cookie'].split(';')[0];assert.equal((await call('admin/monitor',undefined,{cookie:adminCookie})).statusCode,200);
  assert.equal((await call('activate',{key:activationKey(order,secret)})).statusCode,403,'Unpaid order cannot activate');
  const userCookie='__Host-cfb_game='+userToken;
  providerPaid=false;
  assert.equal((await call('payment/status',{orderId},{cookie:userCookie})).body.status,'pending');assert.equal(grants,0,'Success return alone must not grant access');
  providerPaid=true;
  const fulfilled=await call('payment/status',{orderId},{cookie:userCookie});assert.equal(fulfilled.statusCode,200);assert.equal(fulfilled.body.status,'paid');assert.equal(fulfilled.body.session.role,'subscriber');
  await call('payment/status',{orderId},{cookie:userCookie});assert.equal(grants,1,'Duplicate reconciliation must grant once');
  const receipt=sign({role:'payment',sub:orderId,accountId,exp:Date.now()+60000},secret);
  const recovered=await call('payment/status',{orderId,receipt});
  assert.equal(recovered.statusCode,200);assert.match(recovered.headers['set-cookie'],/__Host-cfb_game=/);
  assert.equal((await call('payment/status',{orderId,receipt:receipt+'x'})).statusCode,404);
  assert.equal((await call('payment/status',{orderId,receipt:sign({role:'payment',sub:orderId,accountId:otherId,exp:Date.now()+60000},secret)})).statusCode,404);
  assert.equal((await call('payment/status',{orderId,receipt:sign({role:'payment',sub:orderId,accountId,exp:1},secret)})).statusCode,404);
  const activation=await call('activate',{key:activationKey(order,secret)});assert.equal(activation.statusCode,200);assert.match(activation.headers['set-cookie'],/__Host-cfb_game=/);assert.ok(!activation.headers.location,'Activation never redirects to admin');
  assert.equal((await call('activate',{key:activationKey(order,secret)+'x'})).statusCode,403);
  assert.equal((await call('payment/status',{orderId},{cookie:'__Host-cfb_game='+sign({role:'subscriber',sub:otherId,exp:Date.now()+60000},secret)})).statusCode,404);
  assert.equal((await call('webhooks/polar',JSON.parse(raw),{headers:{'webhook-signature':'invalid'}})).statusCode,403);
  const webhook=await call('webhooks/polar',JSON.parse(raw),{headers});assert.equal(webhook.statusCode,200);assert.equal(grants,1);
  Object.assign(order,sslOrder,{status:'pending'});providerPaid=false;
  assert.equal((await call('webhooks/sslcommerz',{tran_id:transactionId,status:'VALID',amount:'99.00'})).statusCode,200);assert.equal(grants,1,'Forged IPN must not grant without gateway verification');
  providerPaid=true;await call('webhooks/sslcommerz',{tran_id:transactionId,status:'VALID'});assert.equal(grants,2);await call('webhooks/sslcommerz',{tran_id:transactionId,status:'VALID'});assert.equal(grants,2);
  const customer={planId:'1m',username:'player',email:'player@example.com',password:'a-long-test-password',phone:'01712345678',address:'Test Road',city:'Dhaka',postcode:'1207'};
  for(const provider of ['polar','sslcommerz']) {
    const checkout=await call('checkout',{...customer,provider,amount:1});
    assert.equal(checkout.statusCode,200);assert.ok(checkout.body.orderId);assert.ok(checkout.body.url.startsWith('https://'));assert.equal(verify(checkout.body.receipt,secret,'payment').accountId,accountId);
  }
  assert.equal((await call('checkout',{...customer,provider:'unknown'})).statusCode,400);
  assert.equal((await call('checkout',{...customer,provider:'polar'},{headers:{origin:'https://www.game.example'}})).statusCode,200,'Public www alias must not block checkout');
  assert.equal((await call('admin/login',{username:'owner',password:'a-long-test-password'},{headers:{origin:'https://www.game.example'}})).statusCode,403,'Admin remains canonical-origin only');
  const returned=await call('payment/return',{tran_id:transactionId,status:'FAILED'});
  assert.equal(returned.statusCode,303);assert.equal(returned.headers.location,'https://game.example/?payment_return='+orderId);
  return ['Password hashing, role-separated sessions, expiry, CSRF and login rate limits passed',
    'Polar and Bangladesh amount/currency/order validation; signed webhooks and replay rejection passed',
    'Mocked API fulfilment, duplicate notification handling, forged callback rejection and game-only activation passed'];
}
