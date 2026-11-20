import { randomUUID, createHmac } from 'node:crypto';
import { PLANS, hashPassword, verifyPassword, equal, sign, verify, activationKey, validatePolar, validateSSL, verifyPolarWebhook, sslTransactionId, sslOrderId, adminSetupStatus, supabaseServerKey } from '../server/security.js';

export const config = {api: {bodyParser: false}};
const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value || '');
const fail = (status, message) => {throw Object.assign(new Error(message), {status});};
const enc = encodeURIComponent;
const cookieName = role => role === 'admin' ? '__Host-cfb_admin' : '__Host-cfb_game';

// Dependencies are injectable for integration tests; production uses only server environment.
export function createHandler(env, fetcher = fetch) {
  const secret = () => env.SESSION_SECRET?.length >= 32 ? env.SESSION_SECRET : fail(503, 'Server setup incomplete');
  const origin = () => {
    const value = new URL(env.APP_ORIGIN || 'https://invalid.local');
    if (value.protocol !== 'https:' || value.hostname === 'invalid.local') fail(503, 'Server setup incomplete');
    return value.origin;
  };
  async function request(url, options = {}) {
    const response = await fetcher(url, {...options, signal: AbortSignal.timeout(8000)});
    if (!response.ok) fail(502, 'Upstream service unavailable. Please retry or contact support.');
    return response.status === 204 ? null : response.json();
  }
  async function db(path, method = 'GET', body) {
    const key=supabaseServerKey(env);
    if (!env.SUPABASE_URL || !key) fail(503, 'Database setup incomplete');
    return request(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/' + path, {
      // New secret keys are not JWTs; send them only through the apikey header.
      method, headers: {apikey:key, ...(key.startsWith('sb_secret_') ? {} : {Authorization:'Bearer '+key}),
        'Content-Type':'application/json', Prefer:'return=representation'},
      ...(body === undefined ? {} : {body:JSON.stringify(body)})
    });
  }
  const one = async path => (await db(path + (path.includes('?') ? '&' : '?') + 'limit=1'))?.[0];
  const event = (id, kind, detail) => db('cfb_events','POST',{order_id:id,kind,detail});
  const orderBy = async id => uuid(id) ? one('cfb_orders?id=eq.'+id) : null;
  const DEFAULT_POLAR_PRODUCTS = {
    "1m": "fb8af379-2bfd-40fa-ae41-834020eef919",
    "2m": "1fd12c45-72c8-4131-9d4a-917c24ce5d47",
    "4m": "8999eb1f-1e1d-45f5-b72b-7fba422a387a",
    "8m": "638101fd-a10f-46d3-8a17-9285f3e54194",
    "12m": "0feee5db-ed25-4887-81d7-cc3b4089305b",
    "lifetime": "0d5b371e-72e6-4a8a-8ee3-cdfa55c05a7a"
  };
  const DEFAULT_POLAR_TOKEN = 'polar_oat_aHGJLMbEEA9rHblTM4tk0YgIkx1T8uVnE0BWR3KuMCi';
  const polarToken = () => env.POLAR_ACCESS_TOKEN || DEFAULT_POLAR_TOKEN;
  const polarBase = () => env.POLAR_ENV === 'sandbox' ? 'https://sandbox-api.polar.sh' : 'https://api.polar.sh';
  const sslBase = () => env.SSLCOMMERZ_ENV === 'live' ? 'https://securepay.sslcommerz.com' : 'https://sandbox.sslcommerz.com';
  function products() {
    try {
      const parsed = JSON.parse(env.POLAR_PRODUCTS || '{}');
      return Object.keys(parsed).length > 0 ? parsed : DEFAULT_POLAR_PRODUCTS;
    } catch {
      return DEFAULT_POLAR_PRODUCTS;
    }
  }
  async function polar(path, method='GET', body) {
    const token = polarToken();
    if (!token) fail(503,'Polar is not configured');
    return request(polarBase()+path, {method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body ? {body:JSON.stringify(body)} : {})});
  }
  async function sslQuery(params) {
    if (!env.SSLCOMMERZ_STORE_ID || !env.SSLCOMMERZ_STORE_PASSWORD) fail(503,'Bangladesh gateway is not configured');
    const query = new URLSearchParams({store_id:env.SSLCOMMERZ_STORE_ID,store_passwd:env.SSLCOMMERZ_STORE_PASSWORD,format:'json',...params});
    return request(sslBase()+'/validator/api/'+('val_id' in params ? 'validationserverAPI.php' : 'merchantTransIDvalidationAPI.php')+'?'+query);
  }
  async function limited(req, scope, max=20, seconds=300) {
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0];
    const key = createHmac('sha256',secret()).update(scope+':'+ip).digest('hex');
    if (!await db('rpc/cfb_rate_limit','POST',{p_key:key,p_max:max,p_seconds:seconds})) fail(429,'Too many attempts. Try again later.');
  }
  function session(req, role) {
    const authHeader = req.headers?.authorization;
    if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const parsed = verify(authHeader.slice(7).trim(), secret(), role);
      if (parsed) return parsed;
    }
    const pair = String(req.headers?.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName(role)+'='));
    return verify(pair?.slice(pair.indexOf('=')+1),secret(),role);
  }
  function setSession(res, role, sub, seconds=(role==='admin'?86400:2592000)) {
    const token = sign({role,sub,exp:Date.now()+seconds*1000},secret());
    const sameSite = role === 'admin' ? 'Strict' : 'Lax';
    res.setHeader('Set-Cookie', `${cookieName(role)}=${token}; Path=/; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=${seconds}`);
    return token;
  }
  async function accountSession(req, active=true) {
    const auth = session(req,'subscriber');
    if (!auth || !uuid(auth.sub)) fail(401,'Please log in to your game account');
    const account = await one('cfb_accounts?id=eq.'+auth.sub+'&select=id,username,email');
    if (!account) fail(401,'Account unavailable');
    const entitlement = await one('cfb_entitlements?account_id=eq.'+auth.sub+'&revoked=eq.false&order=expires_at.desc');
    const valid = entitlement && !entitlement.revoked && Date.parse(entitlement.expires_at) > Date.now();
    if (active && !valid) fail(403,'No active game plan. Please purchase or renew your pass.');
    return {account, entitlement:valid ? entitlement : null};
  }
  function publicSession(account, entitlement) {
    return entitlement ? {role:'subscriber',userId:account.username,displayName:account.username,
      planTitle:PLANS[entitlement.plan_id]?.name || entitlement.plan_id,expiresAt:Date.parse(entitlement.expires_at),isPermanent:false} : null;
  }
  async function complete(order, providerId) {
    await db('rpc/cfb_complete_order','POST',{p_id:order.id,p_provider_id:providerId,p_days:PLANS[order.plan_id].days});
  }
  async function reconcile(order, providerId) {
    if (order.provider === 'manual') return order;
    if (!order.checkout_id) return order;
    if (order.provider === 'polar') {
      const response = providerId ? await polar('/v1/orders/'+enc(providerId)) : await polar('/v1/orders/?checkout_id='+enc(order.checkout_id)+'&limit=10');
      const payment = providerId ? response : response.items?.find(item=>item.checkout_id === order.checkout_id);
      if (payment && ['refunded','partially_refunded'].includes(payment.status)) {
        await db('cfb_orders?id=eq.'+order.id,'PATCH',{status:'refunded'});
        await db('cfb_entitlements?account_id=eq.'+order.account_id,'PATCH',{revoked:true});
        await event(order.id,'refunded','Access held following refund; review account');
      } else if (payment && validatePolar(payment,order,products()[order.plan_id])) await complete(order,payment.id);
      else if (payment?.paid) {await event(order.id,'verification_failed','Polar amount, currency, product or order mismatch'); fail(409,'Payment needs manual review');}
    } else {
      // Never trust callback status or amount. Query the merchant transaction, then validate.
      const transactionId=sslTransactionId(order.id);
      const query = await sslQuery({tran_id:transactionId});
      const transaction = query.element?.find(item=>item.tran_id === transactionId && ['VALID','VALIDATED'].includes(item.status)) || (query.tran_id === transactionId ? query : null);
      if (transaction?.val_id) {
        const payment = await sslQuery({val_id:transaction.val_id});
        if (validateSSL(payment,order)) await complete(order,'ssl:'+payment.val_id);
        else if (['VALID','VALIDATED'].includes(payment.status)) {await event(order.id,'verification_failed','Bangladesh payment mismatch or risk hold'); fail(409,'Payment needs manual review');}
      }
    }
    return orderBy(order.id);
  }
  async function bodyOf(req) {
    let raw = ''; for await (const chunk of req) {raw += chunk; if (Buffer.byteLength(raw)>65536) fail(413,'Request too large');}
    let body;
    try {body = (req.headers['content-type'] || '').includes('application/json') ? JSON.parse(raw || '{}') : Object.fromEntries(new URLSearchParams(raw));}
    catch {fail(400,'Invalid request body');}
    return {raw,body};
  }
  return async function handler(req,res) {
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Robots-Tag','noindex, nofollow');
    res.setHeader('Content-Type','application/json; charset=utf-8');
    const json = (status,value) => {res.statusCode=status; res.end(JSON.stringify(value));};
    const redirect = path => {res.statusCode=303;res.setHeader('Location',origin()+path);res.end();};
    const requestUrl = new URL(req.url, 'https://local');
    const route = String(req.query?.endpoint || requestUrl.searchParams.get('endpoint') || requestUrl.pathname.replace(/^\/api\//,'')).replace(/\/$/,'');
    try {
      if (!['GET','POST'].includes(req.method)) fail(405,'Method not allowed');
      const {raw,body} = req.method === 'POST' ? await bodyOf(req) : {body:{},raw:''};
      if(route==='admin/login' && req.method==='POST') {
        const setup=adminSetupStatus(env);
        if(!setup.ready)fail(503,'Administrator setup incomplete. Configure these hosting environment variables and redeploy: '+setup.missing.join(', '));
      }
      if (req.method === 'POST' && !route.startsWith('webhooks/') && route !== 'payment/return') {
        let publicAlias=false;
        try {
          const incoming=new URL(req.headers.origin),canonical=new URL(origin());
          publicAlias=!route.startsWith('admin/') && incoming.protocol==='https:' && incoming.port===canonical.port && incoming.hostname.replace(/^www\./,'')===canonical.hostname.replace(/^www\./,'');
        } catch (_) {}
        if (req.headers.origin !== origin() && !publicAlias) fail(403,'Request origin rejected');
        if (!(req.headers['content-type'] || '').includes('application/json')) fail(415,'JSON required');
      }
      if (route === 'health' && req.method === 'GET') {
        const setup=adminSetupStatus(env);
        const token = polarToken();
        const polarConfigured = !!token;
        const currentProducts = products();
        const polarProductCount = Object.keys(currentProducts).length;
        const polarMissing = [];
        if (!token) polarMissing.push('POLAR_ACCESS_TOKEN');
        if (!env.POLAR_WEBHOOK_SECRET) polarMissing.push('POLAR_WEBHOOK_SECRET');
        if (polarProductCount === 0) polarMissing.push('POLAR_PRODUCTS');

        return json(200,{
          database:!!(env.SUPABASE_URL && supabaseServerKey(env)),
          admin:setup.ready,adminReady:setup.ready,adminMissing:setup.missing,
          adminOrigin:setup.missing.includes('APP_ORIGIN') ? null : new URL(env.APP_ORIGIN).origin,
          polar: polarConfigured && polarProductCount > 0,
          polarReady: polarConfigured && polarProductCount >= 6,
          polarMissing,
          polarProductsCount: polarProductCount,
          polarEnvironment: env.POLAR_ENV === 'sandbox' ? 'sandbox' : 'live',
          sslcommerz:!!(env.SSLCOMMERZ_STORE_ID && env.SSLCOMMERZ_STORE_PASSWORD),
          sslEnvironment:env.SSLCOMMERZ_ENV === 'live' ? 'live':'sandbox'
        });
      }
      if (route === 'admin/login' && req.method === 'POST') {
        await limited(req,'admin-login',5,900);
        if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD_HASH || !equal(body.username,env.ADMIN_USERNAME) || !verifyPassword(body.password,env.ADMIN_PASSWORD_HASH)) fail(401,'Invalid administrator credentials');
        setSession(res,'admin',env.ADMIN_USERNAME,3600); return json(200,{success:true});
      }
      if (route.startsWith('admin/')) {
        if (!session(req,'admin')) fail(401,'Administrator login required');
        if (route === 'admin/logout' && req.method === 'POST') {setSession(res,'admin','',0);return json(200,{success:true});}
        if (route === 'admin/monitor' && req.method === 'GET') {
          const page = Math.max(0,Math.min(100000,Number(new URL(req.url,'https://local').searchParams.get('page')) || 0));
          const offset = Math.floor(page)*200;
          const [orders,accounts,entitlements,events] = await Promise.all([
            db('cfb_orders?select=*&order=created_at.desc&limit=200&offset='+offset),db('cfb_accounts?select=id,username,email,created_at&order=created_at.desc&limit=200&offset='+offset),
            db('cfb_entitlements?select=*&order=expires_at.desc&limit=200&offset='+offset),db('cfb_events?select=*&order=created_at.desc&limit=200&offset='+offset)]);
          return json(200,{orders,accounts,entitlements,events,plans:PLANS,limit:200,hasMore:[orders,accounts,entitlements,events].some(list=>list.length===200)});
        }
        if (route === 'admin/account' && req.method === 'POST') {
          const username=String(body.username || '').trim().toLowerCase(),email=String(body.email || '').trim().toLowerCase();
          if (!/^[a-z0-9@._+-]{3,80}$/.test(username) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>160 || typeof body.password !== 'string' || body.password.length<10 || body.password.length>128) fail(400,'Valid username, email and password of 10–128 characters required');
          if (await one('cfb_accounts?username=eq.'+enc(username))) fail(409,'Username already exists');
          const id=randomUUID();await db('cfb_accounts','POST',{id,username,email,password_hash:hashPassword(body.password)});
          await event(null,'account_created',id);return json(200,{success:true,accountId:id});
        }
        if (route === 'admin/reconcile' && req.method === 'POST') {
          const order=await orderBy(body.orderId); if (!order) fail(404,'Order not found');
          return json(200,{order:await reconcile(order)});
        }
        if (route === 'admin/activation' && req.method === 'POST') {
          const order=await orderBy(body.orderId); if (order?.status !== 'paid') fail(409,'Only paid orders have activation links');
          return json(200,{link:origin()+'/#activate='+activationKey(order,secret())});
        }
        if (route === 'admin/revoke' && req.method === 'POST' && uuid(body.accountId)) {
          await db('cfb_entitlements?account_id=eq.'+body.accountId,'PATCH',{revoked:true});
          await event(null,'admin_revoked',body.accountId); return json(200,{success:true});
        }
        if (route === 'admin/grant' && req.method === 'POST' && uuid(body.accountId) && PLANS[body.planId]) {
          const bucket=Math.floor(Date.now()/300000),checkoutId=`admin:${body.accountId}:${body.planId}:${bucket}`;
          const existing=await one('cfb_orders?checkout_id=eq.'+enc(checkoutId));
          if(existing)return json(200,{success:true,orderId:existing.id,reused:true,link:origin()+'/#activate='+activationKey(existing,secret())});
          const id=randomUUID();
          await db('cfb_orders','POST',{id,account_id:body.accountId,provider:'manual',plan_id:body.planId,amount_minor:PLANS[body.planId].bdt,currency:'bdt',checkout_id:checkoutId});
          await complete({id,plan_id:body.planId},'manual:'+id);
          const paid=await orderBy(id);
          return json(200,{success:true,orderId:id,reused:false,link:origin()+'/#activate='+activationKey(paid,secret())});
        }
        if (route === 'admin/delete-account' && req.method === 'POST' && uuid(body.accountId)) {
          const account=await one('cfb_accounts?id=eq.'+body.accountId);
          if(!account)fail(404,'Player account not found');
          if(String(body.confirmUsername || '').trim().toLowerCase()!==account.username)fail(400,'Type the exact username to delete this player');
          const orders=await db('cfb_orders?account_id=eq.'+body.accountId+'&select=id&limit=1000');
          for(const order of orders)await db('cfb_events?order_id=eq.'+order.id,'DELETE');
          await db('cfb_events?detail=eq.'+enc(body.accountId),'DELETE');
          await db('cfb_entitlements?account_id=eq.'+body.accountId,'DELETE');
          await db('cfb_orders?account_id=eq.'+body.accountId,'DELETE');
          await db('cfb_accounts?id=eq.'+body.accountId,'DELETE');
          return json(200,{success:true});
        }
        if (route === 'admin/clear-events' && req.method === 'POST') {
          if(body.confirm!=='CLEAR ACTIVITY LOG')fail(400,'Confirmation phrase does not match');
          await db('cfb_events?id=not.is.null','DELETE');
          return json(200,{success:true});
        }
        fail(404,'Admin operation not found');
      }
      if (route === 'account/login' && req.method === 'POST') {
        await limited(req,'login',10,600);
        const username=String(body.username || '').trim().toLowerCase();
        let account=await one('cfb_accounts?username=eq.'+enc(username));
        if (!account && username.includes('@')) {
          account=await one('cfb_accounts?email=eq.'+enc(username));
        }
        const dummy='scrypt$00000000000000000000000000000000$'+'0'.repeat(128);
        if (!verifyPassword(body.password,account?.password_hash || dummy) || !account) fail(401,'Invalid username or password');
        const token = setSession(res,'subscriber',account.id,2592000);
        const entitlement=await one('cfb_entitlements?account_id=eq.'+account.id+'&revoked=eq.false&order=expires_at.desc');
        if (!entitlement || Date.parse(entitlement.expires_at)<=Date.now()) return json(200,{success:false,message:'Account found. Purchase or renew your plan.'});
        return json(200,{success:true,token,session:publicSession(account,entitlement),role:'subscriber'});
      }
      if (route === 'account/session' && req.method === 'GET') {
        const {account,entitlement}=await accountSession(req); return json(200,{session:publicSession(account,entitlement)});
      }
      if (route === 'account/logout' && req.method === 'POST') {setSession(res,'subscriber','',0);return json(200,{success:true});}
      if (route === 'manual/claim' && req.method === 'POST') {
        await limited(req,'manual-claim',5,3600);
        const plan=PLANS[body.planId],method=String(body.method || '').toLowerCase(),methods={bkash:'bKash',nagad:'Nagad',rocket:'Rocket'};
        const email=String(body.email || '').trim().toLowerCase(),phone=String(body.phone || '').replace(/[^0-9]/g,''),sender=String(body.sender || '').replace(/[^0-9]/g,'');
        const trxId=String(body.trxId || '').trim().toUpperCase().replace(/\s+/g,''),username=email;
        if(!plan || !methods[method])fail(400,'Select bKash, Nagad or Rocket');
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>160 || typeof body.password!=='string' || body.password.length<10 || body.password.length>128)fail(400,'Enter a valid email and password of 10–128 characters');
        if(!/^01[3-9][0-9]{8}$/.test(phone) || !/^01[3-9][0-9]{8}$/.test(sender))fail(400,'Enter valid Bangladesh mobile and sender numbers');
        if(!/^[A-Z0-9-]{6,40}$/.test(trxId))fail(400,'Enter the complete 6–40 character transaction ID');
        if(body.confirmed!==true)fail(400,'Confirm that the payment information is correct');
        let account=await one('cfb_accounts?email=eq.'+enc(email));
        if(!account) account=await one('cfb_accounts?username=eq.'+enc(username));
        if(account && (!verifyPassword(body.password,account.password_hash) || (account.email && email!==account.email)))fail(401,'This email already has an account. Enter its existing password.');
        if(!account)[account]=await db('cfb_accounts','POST',{id:randomUUID(),username,email,password_hash:hashPassword(body.password)});
        const checkoutId='claim:'+method+':'+trxId;
        let order=await one('cfb_orders?checkout_id=eq.'+enc(checkoutId));
        if(order && order.account_id!==account.id)fail(409,'This transaction ID has already been used');
        if(!order){order={id:randomUUID(),account_id:account.id,provider:'manual',plan_id:body.planId,amount_minor:plan.bdt,currency:'bdt',checkout_id:checkoutId};await db('cfb_orders','POST',order);}
        if(order.status!=='paid'){await complete(order,'claim:'+method+':'+trxId);await event(order.id,'customer_claim_activated',methods[method]);order=await orderBy(order.id);}
        const token = setSession(res,'subscriber',account.id,2592000);
        const entitlement=await one('cfb_entitlements?account_id=eq.'+account.id+'&revoked=eq.false&order=expires_at.desc');
        return json(200,{success:true,token,orderId:order.id,link:origin()+'/#activate='+activationKey(order,secret()),session:publicSession(account,entitlement)});
      }
      if (route === 'activate' && req.method === 'POST') {
        if(/^CFB-/i.test(String(body.key || '')))fail(410,'This older activation key needs reissuing after purchase verification. Contact support for a new activation link.');
        await limited(req,'activate',20,300);
        const [prefix,id] = String(body.key || '').split('.');
        const order = prefix === 'CFB2' ? await orderBy(id) : null;
        if (!order || order.status !== 'paid' || !equal(body.key,activationKey(order,secret()))) fail(403,'Invalid activation link. Contact support to reissue older keys.');
        const account=await one('cfb_accounts?id=eq.'+order.account_id+'&select=id,username,email');
        const entitlement=await one('cfb_entitlements?account_id=eq.'+order.account_id+'&revoked=eq.false&order=expires_at.desc');
        if (!entitlement || Date.parse(entitlement.expires_at)<=Date.now()) fail(403,'Plan expired or revoked');
        const token = setSession(res,'subscriber',account.id,2592000);return json(200,{valid:true,token,session:publicSession(account,entitlement)});
      }
      if (route === 'checkout' && req.method === 'POST') {
        await limited(req,'checkout',10,600);
        const plan=PLANS[body.planId], provider=body.provider;
        if (!plan || !['polar','sslcommerz'].includes(provider)) fail(400,'Invalid plan or provider');
        if (provider === 'polar' && (!polarToken() || !products()[body.planId])) fail(503,'Polar setup incomplete; use WhatsApp support');
        if (provider === 'sslcommerz' && (!env.SSLCOMMERZ_STORE_ID || !env.SSLCOMMERZ_STORE_PASSWORD)) fail(503,'Bangladesh gateway setup incomplete; use WhatsApp support');
        const username=String(body.username || '').trim().toLowerCase(), email=String(body.email || '').trim().toLowerCase();
        if (!/^[a-z0-9@._+-]{3,80}$/.test(username) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>160 || typeof body.password !== 'string' || body.password.length<10 || body.password.length>128) fail(400,'Enter a username, valid email and password of 10–128 characters');
        if (provider === 'sslcommerz' && (!/^\+?[0-9]{10,15}$/.test(body.phone || '') || !body.address || !body.city || !body.postcode)) fail(400,'Phone, billing address, city and postcode are required for Bangladesh checkout');
        let account=await one('cfb_accounts?email=eq.'+enc(email));
        if (!account) account=await one('cfb_accounts?username=eq.'+enc(username));
        if (account && (!verifyPassword(body.password,account.password_hash) || (account.email && email !== account.email))) fail(401,'Account exists with this email. Enter your existing password to renew.');
        if (!account) [account]=await db('cfb_accounts','POST',{id:randomUUID(),username,email,password_hash:hashPassword(body.password)});
        setSession(res,'subscriber',account.id);
        const order={id:randomUUID(),account_id:account.id,provider,plan_id:body.planId,amount_minor:provider === 'polar' ? plan.usd:plan.bdt,currency:provider === 'polar' ? 'usd':'bdt'};
        await db('cfb_orders','POST',order);
        const receipt=sign({role:'payment',sub:order.id,accountId:account.id,exp:Date.now()+86400000},secret());
        try {
          let checkoutId, url;
          if (provider === 'polar') {
            const checkout=await polar('/v1/checkouts/','POST',{products:[products()[body.planId]],customer_email:email,customer_name:String(body.name || username).slice(0,80),
              allow_discount_codes:false,allow_trial:false,metadata:{cfb_order_id:order.id},
              success_url:origin()+'/?payment_return='+order.id+'#receipt='+receipt,return_url:origin()+'/?payment_return='+order.id+'#receipt='+receipt});
            checkoutId=checkout.id;url=checkout.url;
          } else {
            const form=new URLSearchParams({store_id:env.SSLCOMMERZ_STORE_ID,store_passwd:env.SSLCOMMERZ_STORE_PASSWORD,
              total_amount:(plan.bdt/100).toFixed(2),currency:'BDT',tran_id:sslTransactionId(order.id),
              success_url:origin()+'/api/payment/return',fail_url:origin()+'/api/payment/return',cancel_url:origin()+'/api/payment/return',
              ipn_url:origin()+'/api/webhooks/sslcommerz',cus_name:String(body.name || username).slice(0,80),cus_email:email,cus_phone:body.phone,
              cus_add1:String(body.address).slice(0,180),cus_city:String(body.city).slice(0,60),cus_postcode:String(body.postcode).slice(0,20),cus_country:'Bangladesh',
              shipping_method:'NO',product_name:plan.name+' Game Pass',product_category:'Software',product_profile:'non-physical-goods',value_a:order.id});
            const checkout=await request(sslBase()+'/gwprocess/v4/api.php',{method:'POST',body:form,headers:{'Content-Type':'application/x-www-form-urlencoded'}});
            if (checkout.status !== 'SUCCESS') fail(502,'Bangladesh checkout could not be created');
            checkoutId=checkout.sessionkey; url=checkout.GatewayPageURL;
          }
          const destination=new URL(url);
          const allowed=provider === 'polar' ? ['buy.polar.sh','checkout.polar.sh','sandbox.polar.sh','polar.sh'] : ['securepay.sslcommerz.com','sandbox.sslcommerz.com'];
          if (destination.protocol !== 'https:' || !allowed.includes(destination.hostname) || !checkoutId) fail(502,'Invalid gateway response');
          await db('cfb_orders?id=eq.'+order.id,'PATCH',{checkout_id:checkoutId});
          return json(200,{url,orderId:order.id,receipt});
        } catch (error) {
          await db('cfb_orders?id=eq.'+order.id,'PATCH',{status:'checkout_failed'});
          await event(order.id,'checkout_failed','Gateway creation failed; retry or contact WhatsApp support');
          throw error;
        }
      }
      if (route === 'payment/status' && req.method === 'POST') {
        await limited(req,'status',60,300);
        const order=await orderBy(body.orderId),auth=session(req,'subscriber'),proof=verify(body.receipt,secret(),'payment');
        const matchingReceipt=order && proof?.sub===order.id && proof?.accountId===order.account_id;
        if (!order || (!matchingReceipt && auth?.sub!==order.account_id)) fail(404,'Order not found. Log in to check your purchase.');
        const account=await one('cfb_accounts?id=eq.'+order.account_id+'&select=id,username,email');
        if(!account)fail(404,'Account unavailable');
        const fresh=await reconcile(order);
        const entitlement=await one('cfb_entitlements?account_id=eq.'+account.id+'&revoked=eq.false&order=expires_at.desc');
        if(fresh.status==='paid' && entitlement && Date.parse(entitlement.expires_at)>Date.now())setSession(res,'subscriber',account.id,2592000);
        return json(200,{status:fresh.status,session:fresh.status==='paid' ? publicSession(account,entitlement) : null});
      }
      if (route === 'webhooks/polar' && req.method === 'POST') {
        if (!verifyPolarWebhook(raw,req.headers,env.POLAR_WEBHOOK_SECRET)) fail(403,'Invalid webhook signature');
        if (!['order.paid','order.refunded'].includes(body.type)) return json(200,{ignored:true});
        const order=await orderBy(body.data?.metadata?.cfb_order_id);
        if (!order || order.provider !== 'polar') fail(404,'Unknown payment order');
        if (!order.checkout_id) fail(503,'Checkout is still being saved. Retry delivery.');
        await reconcile(order,body.data.id);return json(200,{received:true});
      }
      if ((route === 'webhooks/sslcommerz' || route === 'payment/return') && req.method === 'POST') {
        const order=await orderBy(sslOrderId(body.tran_id));
        if (!order || order.provider !== 'sslcommerz') fail(404,'Unknown payment order');
        if (route === 'payment/return') {
          // Return the customer to retry/support even when the gateway is temporarily down.
          // IPN still returns failures so the gateway can retry delivery.
          try {await reconcile(order);} catch (_) {}
          return redirect('/?payment_return='+order.id);
        }
        await reconcile(order);
        return json(200,{received:true});
      }
      fail(404,'Endpoint not found');
    } catch (error) {
      // Do not log provider responses, credentials, tokens or request bodies.
      return json(error.status || 503,{success:false,message:error.status ? error.message:'Service temporarily unavailable. Please retry or contact WhatsApp support.'});
    }
  };
}
export default async function handler(req,res) {return createHandler(process.env)(req,res);}
