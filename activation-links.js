/* Activation links always open the public game, regardless of the issuing page. */
(() => {
  'use strict';
  const aliases=['activate','key','k','license','code','lic'];
  function read(input) {
    const url=input instanceof URL ? input : new URL(input);
    const hash=url.hash.replace(/^#\/?/,'');
    if(/^CFB(?:2\.|-)/i.test(hash))return hash;
    const fragment=new URLSearchParams(hash);
    for(const source of [fragment,url.searchParams])for(const name of aliases){
      const value=source.get(name);if(value?.trim())return value.trim();
    }
    return null;
  }
  function build(key,input=location.href) {
    if(!String(key || '').trim())throw new Error('Activation key is required');
    const current=new URL(input);
    const target=new URL('/',/^https?:$/.test(current.protocol) ? current : 'https://www.countryflagbattle.xyz/');
    target.hash=new URLSearchParams({activate:String(key).trim()}).toString();
    return target.href;
  }
  globalThis.CFBActivationLinks=Object.freeze({read,build});
})();
