/* Run before rendering/admin requests so a customer key never opens admin login. */
(() => {
  const key=CFBActivationLinks.read(location.href);
  if(!key)return;
  globalThis.__cfbActivationRedirect=true;
  if(document.documentElement)document.documentElement.hidden=true;
  location.replace(CFBActivationLinks.build(key,location.href));
})();
