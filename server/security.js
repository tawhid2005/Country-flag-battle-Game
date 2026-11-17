import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';

export function supabaseServerKey(env) {
  const preferred=String(env.SUPABASE_SECRET_KEY || '').trim();
  const key=preferred || String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if(!key || key.startsWith('sb_publishable_') || (preferred && !key.startsWith('sb_secret_'))) return '';
  return key;
}

// Only setting names are returned; credential values never leave the server.
export function adminSetupStatus(env) {
  const missing=[];
  const https=value=>{try {return new URL(value).protocol==='https:';}catch{return false;}};
  if(!https(env.APP_ORIGIN))missing.push('APP_ORIGIN');
  if(typeof env.SESSION_SECRET!=='string' || env.SESSION_SECRET.length<32)missing.push('SESSION_SECRET');
  if(!String(env.ADMIN_USERNAME || '').trim())missing.push('ADMIN_USERNAME');
  if(!/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(env.ADMIN_PASSWORD_HASH || ''))missing.push('ADMIN_PASSWORD_HASH');
  if(!https(env.SUPABASE_URL))missing.push('SUPABASE_URL');
  if(!supabaseServerKey(env))missing.push('SUPABASE_SECRET_KEY');
  return {ready:missing.length===0,missing};
}

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
}
export function equal(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
export function verifyPassword(password, hash = '') {
  const [kind, salt, digest] = hash.split('$');
  if (kind !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(digest || '')) return false;
  return equal(hashPassword(String(password), salt), hash);
}
export function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + createHmac('sha256', secret).update(body).digest('base64url');
}
export function verify(token, secret, role) {
  try {
    const [body, mac, extra] = String(token || '').split('.');
    if (extra || !equal(mac, createHmac('sha256', secret).update(body).digest('base64url'))) return null;
    const value = JSON.parse(Buffer.from(body, 'base64url').toString());
    return value.role === role && value.exp > Date.now() && typeof value.sub === 'string' ? value : null;
  } catch { return null; }
}
export function activationKey(order, secret) {
  return 'CFB2.' + order.id + '.' + createHmac('sha256', secret).update(`activation:${order.id}:${order.activation_nonce}`).digest('base64url');
}
export function verifyPolarWebhook(raw, headers, secret) {
  if (!secret || !headers['webhook-id']) return false;
  const timestamp = Number(headers['webhook-timestamp']);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now()/1000 - timestamp) > 300) return false;
  const content = `${headers['webhook-id']}.${headers['webhook-timestamp']}.${raw}`;
  // Polar documents both legacy literal-secret and Standard Webhooks derivations.
  const keys = [Buffer.from(secret)];
  if (secret.startsWith('whsec_')) keys.push(Buffer.from(secret.slice(6), 'base64'));
  return keys.some(key => String(headers['webhook-signature'] || '').split(' ').some(part =>
    equal(part, 'v1,' + createHmac('sha256', key).update(content).digest('base64'))));
}
export const PLANS = Object.freeze({
  '1m': {days:30, usd:399, bdt:9900, name:'1 Month'},
  '2m': {days:60, usd:599, bdt:14900, name:'2 Months'},
  '4m': {days:120, usd:999, bdt:23900, name:'4 Months'},
  '8m': {days:240, usd:1599, bdt:39900, name:'8 Months'},
  '12m': {days:365, usd:1999, bdt:49900, name:'1 Year'},
  'lifetime': {days:36500, usd:2599, bdt:69900, name:'Lifetime (100-year access)'}
});
export function validatePolar(payment, order, product) {
  return payment.paid === true && payment.status === 'paid' && payment.checkout_id === order.checkout_id &&
    payment.product_id === product && payment.metadata?.cfb_order_id === order.id &&
    payment.currency?.toLowerCase() === order.currency && payment.net_amount === order.amount_minor &&
    payment.refunded_amount === 0 && (!payment.subscription_id);
}
export function validateSSL(payment, order) {
  return ['VALID','VALIDATED'].includes(payment.status) && payment.tran_id === sslTransactionId(order.id) &&
    payment.currency === 'BDT' && Math.round(Number(payment.amount)*100) === order.amount_minor &&
    String(payment.risk_level) === '0';
}
// SSLCOMMERZ allows 30 characters; a textual UUID would exceed that limit.
export function sslTransactionId(id) {return 'cfb_' + Buffer.from(id.replaceAll('-',''),'hex').toString('base64url');}
export function sslOrderId(value) {
  if (!/^cfb_[A-Za-z0-9_-]{22}$/.test(value || '')) return null;
  const h=Buffer.from(value.slice(4),'base64url').toString('hex');
  const id=[h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');
  return sslTransactionId(id) === value ? id : null;
}
