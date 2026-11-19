/* Public game access. Administrator cookies and endpoints are separate. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const url = new URL(location.href);
  const params = new URLSearchParams(url.hash.replace(/^#/, ''));
  const activation = CFBActivationLinks.read(url);
  const returningOrder = url.searchParams.get('payment_return');
  const returningReceipt = params.get('receipt');
  if (returningReceipt) {try {history.replaceState(null,'',url.pathname+url.search);} catch (_) {}}
  // Old admin query flags are inert and never propagate through account links.
  if (url.searchParams.has('admin') || /admin/i.test(url.hash)) {
    url.searchParams.delete('admin');
    if (/admin/i.test(url.hash)) url.hash = '';
    try {history.replaceState(null, '', url.pathname + url.search + url.hash);} catch (_) {}
  }
  const proto = SecurityEngine.prototype;
  proto.api = async function(path, body) {
    if (!/^https?:$/.test(location.protocol)) throw new Error('Account and payment services require the hosted website. Local files run the game preview only.');
    let response;
    const headers = body === undefined ? {} : {'Content-Type':'application/json'};
    const token = this.authToken || (typeof gameStorage !== 'undefined' ? gameStorage.getItem('cfb_auth_token') : null);
    if (token) headers['Authorization'] = 'Bearer ' + token;
    try {response = await fetch('/api/' + path, {method:body === undefined ? 'GET':'POST', credentials:'same-origin', cache:'no-store', signal:globalThis.AbortSignal?.timeout?.(15000),
      headers, body:body === undefined ? undefined : JSON.stringify(body)});
    } catch(error) {if(['AbortError','TimeoutError'].includes(error.name))throw Object.assign(new Error('The payment service took too long to respond. Please try again.'),{status:408});throw error;}
    let result;
    try {result = await response.json();} catch (_) {throw Object.assign(new Error('Online payments are temporarily unavailable. Please use WhatsApp support.'),{code:'API_NOT_DEPLOYED'});}
    if (!response.ok) throw Object.assign(new Error(result.message || 'Service unavailable'), {status:response.status});
    return result;
  };
  proto.paymentNotice = function(message, orderId = '') {
    let notice = $('payment-notice');
    if (!notice) {
      notice = document.createElement('div'); notice.id='payment-notice'; notice.setAttribute('role','status');
      notice.style.cssText='position:fixed;left:50%;bottom:20px;transform:translateX(-50%);width:min(440px,92vw);padding:18px;background:#0f172a;border:1px solid #22d3ee;border-radius:14px;color:white;z-index:30000;font:14px/1.5 system-ui;box-shadow:0 16px 60px #0009';
      document.body.appendChild(notice);
    }
    notice.replaceChildren();
    const text=document.createElement('p');text.textContent=message;notice.appendChild(text);
    const link=document.createElement('a');link.textContent='Get help on WhatsApp';link.target='_blank';link.rel='noopener noreferrer';link.style.cssText='color:#4ade80;display:inline-block;margin:12px 12px 0 0';
    const detail=['Country Flag Battle payment support',orderId ? 'Order: '+orderId:'', 'Plan: '+(this.activePlanId || 'unknown'), 'Issue: '+message].filter(Boolean).join('\n');
    link.href='https://wa.me/8801711729858?text='+encodeURIComponent(detail);notice.appendChild(link);
    const close=document.createElement('button');close.type='button';close.textContent='Dismiss';close.style.cssText='padding:6px 10px';close.onclick=()=>notice.remove();notice.appendChild(close);
  };
  proto.acceptServerSession = function(session, keepPaymentModal=false, token=null) {
    if (!session || session.role !== 'subscriber' || session.expiresAt <= Date.now()) return false;
    this.session = session;
    this.serverVerifiedUntil = session.expiresAt;
    if (token) {
      this.authToken = token;
      try { gameStorage.setItem('cfb_auth_token', token); } catch (_) {}
    }
    try { gameStorage.setItem('cfb_user_session', JSON.stringify(session)); } catch (_) {}
    if (this.trialInterval) clearInterval(this.trialInterval);
    this.showLockModal(false);
    const lockEl = $('cyber-lock-modal'); if (lockEl) lockEl.classList.remove('show');
    this.updateDrawerStatus();
    if (!keepPaymentModal) $('cyber-order-modal')?.classList.remove('show');
    this.syncInterfacePause?.();
    const badge = $('hud-trial-badge'); if (badge) badge.style.display = 'none';
    return true;
  };
  proto.restoreCachedSession = function() {
    try {
      this.authToken = gameStorage.getItem('cfb_auth_token') || null;
      const raw = gameStorage.getItem('cfb_user_session');
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached && cached.role === 'subscriber' && cached.expiresAt > Date.now()) {
          this.session = cached;
          this.serverVerifiedUntil = cached.expiresAt;
          this.showLockModal(false);
          const lockEl = $('cyber-lock-modal'); if (lockEl) lockEl.classList.remove('show');
          return true;
        }
      }
    } catch (_) {}
    return false;
  };
  proto.isAuthenticated = function() {return !!(this.session?.role === 'subscriber' && this.session.expiresAt > Date.now() && this.serverVerifiedUntil > Date.now());};
  proto.saveSession = function() {
    if (this.session && this.session.role === 'subscriber' && this.session.expiresAt > Date.now()) {
      try { gameStorage.setItem('cfb_user_session', JSON.stringify(this.session)); } catch (_) {}
    } else {
      try { gameStorage.removeItem('cfb_user_session'); gameStorage.removeItem('cfb_auth_token'); } catch (_) {}
    }
  };
  proto.checkSession = function() {return {valid:this.isAuthenticated(),session:this.session};};
  proto.login = async function(username,password) {
    if (/^CFB/.test(username) || /^CFB/.test(password)) {
      const result=await this.activateKey(/^CFB/.test(password) ? password:username);
      return {success:result.valid,role:'subscriber',...result};
    }
    const result=await this.api('account/login',{username,password});
    if (result.success) this.acceptServerSession(result.session, false, result.token);
    return result;
  };
  proto.activateKey = async function(key) {
    if(/^CFB-/i.test(String(key || '')))throw Object.assign(new Error('This activation link was issued by an older version. Contact WhatsApp support to verify your purchase and get a new activation link.'),{code:'LEGACY_ACTIVATION_KEY'});
    const result=await this.api('activate',{key});
    if (result.valid) this.acceptServerSession(result.session, false, result.token);
    return result;
  };
  proto.logout = function() {
    this.session=null;this.authToken=null;this.serverVerifiedUntil=0;
    try { gameStorage.removeItem('cfb_user_session'); gameStorage.removeItem('cfb_auth_token'); gameStorage.removeItem('cfb_auth_session'); } catch (_) {}
    this.handleTrialWorkflow();this.updateDrawerStatus();
    this.api('account/logout',{}).catch(()=>{});
  };
  proto.startCheckout = async function(provider) {
    const button=$(provider === 'polar' ? 'btn-start-polar-checkout':'btn-start-bd-checkout');
    if (button) button.disabled=true;
    const status=$(provider === 'polar' ? 'polar-gw-status':'bd-gw-status');
    if(status){status.hidden=false;status.textContent=provider === 'polar' ? 'Opening secure Polar checkout…':'নিরাপদ payment gateway খোলা হচ্ছে…';}
    try {
      const isBd=provider==='sslcommerz';
      const email=$(isBd ? 'checkout-bd-email':'checkout-contact-email').value.trim();
      const password=$(isBd ? 'checkout-bd-password':'order-checkout-password').value;
      const phone=isBd ? $('checkout-bd-phone').value.trim().replace(/[\s-]/g,'') : '';
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Enter your email to continue.');
      if(password.length<10)throw new Error('Use a password of at least 10 characters.');
      if(isBd && !/^(?:\+?880|0)1[3-9][0-9]{8}$/.test(phone))throw new Error('সঠিক Bangladesh mobile number দিন।');
      const result=await this.api('checkout',{
        provider,planId:this.activePlanId || '1m',username:isBd ? email : ($('order-checkout-username').value.trim() || email),password,email,
        ...(isBd ? {phone,address:'Digital game pass',city:'Dhaka',postcode:'1000'} : {})
      });
      let destination;
      try {destination=new URL(result.url);}catch(_){throw new Error('Checkout could not be opened. Please retry or contact WhatsApp support.');}
      const allowedHosts=isBd ? ['securepay.sslcommerz.com','sandbox.sslcommerz.com'] : ['buy.polar.sh','checkout.polar.sh','sandbox.polar.sh','polar.sh'];
      if(destination.protocol!=='https:' || !allowedHosts.includes(destination.hostname) || !result.orderId)throw new Error('Checkout could not be opened. Please retry or contact WhatsApp support.');
      // Store only an order reference; never passwords, activation keys or API secrets.
      gameStorage.setItem('cfb_pending_order',result.orderId);
      if(result.receipt)gameSessionStorage.setItem('cfb_receipt_'+result.orderId,result.receipt);
      $(isBd ? 'checkout-bd-password':'order-checkout-password').value='';
      location.assign(destination.href);
    } catch(error) {
      const message=error.status===503 ? 'Online checkout is temporarily unavailable. Contact us on WhatsApp for help.' : error.name==='TypeError' ? 'Cannot reach checkout. Check your connection or contact us on WhatsApp.' : error.message;
      if(status){status.hidden=false;status.textContent=message;}else this.paymentNotice(message);
      if(provider==='sslcommerz' && error.status===503){const manual=$('manual-transfer-panel');if(manual)manual.open=true;}
    }
    finally {if(button)button.disabled=false;}
  };
  proto.startPolarCheckout = function() {return this.startCheckout('polar');};
  proto.startPaymentlyCheckout = function() {return this.startCheckout('sslcommerz');};
  proto.verifyAndActivateAutomatedOrder = function() {
    this.paymentNotice('Personal Send Money and transaction IDs require manual verification. Use the secure checkout for automatic activation.');
    return {success:false,message:'Manual transfer requires administrator review.'};
  };
  proto.pollPayment = async function(orderId, attempt=0) {
    try {
      const receipt=returningReceipt || gameSessionStorage.getItem('cfb_receipt_'+orderId);
      const result=await this.api('payment/status',{orderId,receipt});
      if (result.status === 'paid' && this.acceptServerSession(result.session)) {
        gameStorage.removeItem('cfb_pending_order');$('payment-notice')?.remove();
        gameSessionStorage.removeItem('cfb_receipt_'+orderId);
        this.showActivationCelebrationToast(result.session.userId,result.session.planTitle);
        try {history.replaceState(null,'',location.pathname);}catch(_){}return;
      }
      if (['checkout_failed','refunded'].includes(result.status)) throw new Error('Payment is '+result.status+'. Contact support with your order reference.');
      if (attempt >= 17) throw new Error('Payment is still awaiting verification. Your order is saved; log in again later or contact support.');
      this.paymentNotice('Verifying your payment. Please do not pay again.',orderId);
      setTimeout(()=>this.pollPayment(orderId,attempt+1),5000);
    } catch(error) {
      const retryable=!error.code && (!error.status || error.status===408 || error.status===429 || error.status>=500);
      if(retryable && attempt<17){this.paymentNotice('Payment verification is taking a little longer. Do not pay again; we are retrying.',orderId);setTimeout(()=>this.pollPayment(orderId,attempt+1),5000);}
      else this.paymentNotice(error.message,orderId);
    }
  };
  proto.updateWhatsAppLinks = function() {
    const bd=getPlanDef(this.activePlanId || '1m','bdt'),intl=getPlanDef(this.activePlanId || '1m','usd');
    const set=(id,lines)=>{const link=$(id);if(link)link.href='https://wa.me/8801711729858?text='+encodeURIComponent(lines.filter(Boolean).join('\n'));};
    set('checkout-bd-whatsapp',['আসসালামু আলাইকুম, Country Flag Battle-এর pass কিনতে চাই।','Plan: '+bd.name,'Amount: '+bd.price+' TK','Payment: bKash / Nagad / Rocket','পেমেন্ট ও activation-এর নিয়ম জানাবেন।']);
    const claimStatus=$('manual-claim-status'),issue=claimStatus?.classList.contains('failed') ? claimStatus.textContent:'Payment confirmation / login assistance requested';
    set('checkout-transfer-whatsapp',['Country Flag Battle — Bangladesh payment support','Method: '+(this.manualPaymentMethod || 'bKash'),'Plan: '+bd.name+' · '+bd.price+' TK','Email: '+($('checkout-bd-email')?.value || 'not provided'),'Mobile: '+($('checkout-bd-phone')?.value || 'not provided'),'Password entered: '+(($('checkout-bd-password')?.value || '').length>=10?'yes':'no'),'Sender: '+($('manual-sender')?.value || 'not provided'),'TrxID: '+($('manual-transaction')?.value || 'not provided'),'Problem: '+issue,'Please check the payment and send my login/activation information.']);
    set('checkout-intl-whatsapp',['Country Flag Battle — Polar payment support','Plan: '+intl.name+' · $'+intl.price.toFixed(2), 'Order: '+(gameStorage.getItem('cfb_pending_order') || 'checkout not started')]);
  };
  proto.updateOrderModalUI = function(tab='bd') {
    if(this.isInternational)tab='intl';
    this.activeTab=tab;this.activeOrderPlan=getPlanDef(this.activePlanId || '1m',tab==='intl'?'usd':'bdt');
    const plan=this.activeOrderPlan;
    for(const [name,id] of [['bd','panel-bd-pay'],['intl','panel-intl-pay']]){const panel=$(id);if(panel)panel.style.display=name===tab?'block':'none';}
    $('btn-tab-bd-pay')?.classList.toggle('active',tab==='bd');$('btn-tab-intl-pay')?.classList.toggle('active',tab==='intl');
    if($('order-card-plan-name'))$('order-card-plan-name').textContent=plan.name+' Pass';
    if($('order-card-plan-duration'))$('order-card-plan-duration').textContent=plan.id==='lifetime'?'Lifetime access':plan.days+' days of access';
    if($('order-card-plan-price'))$('order-card-plan-price').textContent=tab==='intl'?'$'+plan.price.toFixed(2)+' USD':plan.price+' TK';
    if($('polar-btn-price-display'))$('polar-btn-price-display').textContent='$'+getPlanDef(this.activePlanId || '1m','usd').price.toFixed(2);
    if($('bd-btn-price-display'))$('bd-btn-price-display').textContent=getPlanDef(this.activePlanId || '1m','bdt').price+' TK';
    const status=$('polar-gw-status');if(status){status.hidden=true;status.textContent='';}
    const tabs=$('order-tabs-wrapper');if(tabs)tabs.style.display=this.isInternational?'none':'grid';
    if($('checkout-retry-payment'))$('checkout-retry-payment').hidden=!gameStorage.getItem('cfb_pending_order');
    this.updateWhatsAppLinks();
  };
  proto.openOrderModal = function(planId,currency=this.selectedCurrency) {
    this.activePlanId=planId || '1m';this.activeBdtPlan=getPlanDef(this.activePlanId,'bdt');this.activeUsdPlan=getPlanDef(this.activePlanId,'usd');
    this.updateOrderModalUI(currency==='usd'?'intl':'bd');$('cyber-order-modal')?.classList.add('show');this.syncInterfacePause?.();
  };
  proto.updateBangladeshPaymentGate = function() {
    const email=$('checkout-bd-email'),phone=$('checkout-bd-phone'),password=$('checkout-bd-password'),button=$('btn-start-bd-checkout'),hint=$('bd-payment-gate-hint');
    const ready=!!email?.validity?.valid && /^(?:\+?880|0)1[3-9][0-9]{8}$/.test(phone?.value.trim().replace(/[\s-]/g,'') || '') && (password?.value.length || 0)>=10;
    if(button)button.disabled=!ready;if(hint){hint.classList.toggle('ready',ready);hint.textContent=ready?'✓ Account details complete — choose your payment method.':'Complete email, mobile number and password to continue.';}this.updateWhatsAppLinks();
    return ready;
  };
  proto.syncInterfacePause = function() {
    const paused = typeof document?.querySelector === 'function' ? !!document.querySelector('#cyber-order-modal.show,#cyber-lock-modal.show,#cyber-fail-recovery-modal.show,#streamer-drawer.open,#game-mode-modal.show') : false;
    this.app?.setInterfacePaused?.(paused);
  };
  proto.init = function() {
    const hasCached = this.restoreCachedSession();
    this.detectCountryAndCurrency();
    this.setupDOM();
    this.renderPricingCards();
    if (!hasCached && !this.isAuthenticated()) {
      this.handleTrialWorkflow();
    } else {
      this.showLockModal(false);
      const lockEl = $('cyber-lock-modal'); if (lockEl) lockEl.classList.remove('show');
    }
    this.updateDrawerStatus();
    for(const id of ['checkout-bd-email','checkout-bd-phone','checkout-bd-password'])$(id)?.addEventListener('input',()=>this.updateBangladeshPaymentGate());
    for(const id of ['manual-sender','manual-transaction'])$(id)?.addEventListener('input',()=>this.updateWhatsAppLinks());
    this.manualPaymentMethod='bKash';
    document.querySelectorAll('[data-manual-method]').forEach(button=>button.addEventListener('click',()=>{
      this.manualPaymentMethod=button.dataset.manualMethod;
      document.querySelectorAll('[data-manual-method]').forEach(item=>item.classList.toggle('selected',item===button));
      const instruction=$('manual-payment-instruction');if(instruction){instruction.replaceChildren();const strong=document.createElement('strong');strong.textContent=this.manualPaymentMethod;instruction.append(strong,document.createTextNode(' app থেকে এই personal number-এ Send Money করুন:'));}
      const panel=$('manual-transfer-panel'),theme=this.manualPaymentMethod.toLowerCase();if(panel)panel.className='transfer-details payment-experience theme-'+theme;
      const logo=$('manual-method-logo'),logos={bKash:'./assets/payments/bkash-mark.png',Nagad:'./assets/payments/nagad-logo.png',Rocket:'./assets/payments/rocket-logo.png'};if(logo){logo.src=logos[this.manualPaymentMethod];logo.alt=this.manualPaymentMethod;}if($('manual-method-title'))$('manual-method-title').textContent='Pay with '+this.manualPaymentMethod;
      this.updateWhatsAppLinks();
    }));
    $('btn-manual-claim')?.addEventListener('click',async()=>{
      const button=$('btn-manual-claim'),label=$('manual-claim-label'),status=$('manual-claim-status'),animationStarted=Date.now();button.disabled=true;button.classList.remove('confirmed');button.classList.add('processing');button.setAttribute('aria-busy','true');label.textContent='Confirming payment…';status.hidden=false;status.textContent='Submitting your payment information…';
      status.className='checkout-help claim-status';
      try{
        const result=await this.api('manual/claim',{planId:this.activePlanId || '1m',method:this.manualPaymentMethod,email:$('checkout-bd-email').value.trim(),phone:$('checkout-bd-phone').value.trim(),password:$('checkout-bd-password').value,sender:$('manual-sender').value.trim(),trxId:$('manual-transaction').value.trim(),confirmed:$('manual-confirm').checked});
        if(!this.acceptServerSession(result.session,true,result.token))throw new Error('Access was created but the login session could not be opened. Please sign in with your email and password.');const remaining=650-(Date.now()-animationStarted);if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));$('checkout-bd-password').value='';button.classList.remove('processing');button.classList.add('confirmed');label.textContent='Payment confirmed — access active';status.classList.add('success');status.textContent='✓ Payment information accepted. Access is active—opening the game…';this.showActivationCelebrationToast(result.session.userId,result.session.planTitle);this.updateDrawerStatus();setTimeout(()=>{$('cyber-order-modal')?.classList.remove('show');this.syncInterfacePause();if(!this.isGameStarted)this.startGame();},1000);
      }catch(error){button.classList.remove('processing');label.textContent='Confirm payment & activate';status.classList.add('failed');status.textContent='Payment confirmation failed: '+error.message;this.updateWhatsAppLinks();}finally{button.setAttribute('aria-busy','false');button.disabled=false;}
    });
    $('checkout-retry-payment')?.addEventListener('click',()=>{const id=typeof gameStorage !== 'undefined' ? gameStorage.getItem('cfb_pending_order') : null;if(id)this.pollPayment(id);});
    if($('btn-start-polar-checkout'))$('btn-start-polar-checkout').onclick=event=>{event.preventDefault();event.stopImmediatePropagation();this.startCheckout('polar');};
    if($('btn-start-bd-checkout'))$('btn-start-bd-checkout').onclick=event=>{event.preventDefault();event.stopImmediatePropagation();if(!this.updateBangladeshPaymentGate())return;const panel=$('manual-transfer-panel');panel.open=true;panel.scrollIntoView?.({behavior:'smooth',block:'start'});};
    const MutationObserverClass = typeof MutationObserver !== 'undefined' ? MutationObserver : (typeof window !== 'undefined' ? window.MutationObserver : null);
    if (MutationObserverClass) {
      const pauseObserver=new MutationObserverClass(()=>this.syncInterfacePause());
      for(const id of ['cyber-order-modal','cyber-lock-modal','cyber-fail-recovery-modal','streamer-drawer','game-mode-modal']){
        const el=$(id);if(el)pauseObserver.observe(el,{attributes:true,attributeFilter:['class']});
      }
      this.interfacePauseObserver=pauseObserver;
    }
    this.updateBangladeshPaymentGate();
    this.syncInterfacePause();
    this.updateWhatsAppLinks();
    // Remove credentials saved by previous releases.
    for (const key of ['cfb_pending_checkout_creds','cfb_admin_polar_token','cfb_paymently_api_key','cfb_auth_session']) {
      try { gameStorage.removeItem(key); } catch(_) {}
    }
    this.bootServerAccess();
  };
  proto.bootServerAccess = async function() {
    if (activation) {
      // Remove bearer token from the address bar even when activation fails.
      try {history.replaceState(null,'',location.pathname);}catch(_){}
      try {const result=await this.activateKey(activation);if(result.valid)this.showActivationCelebrationToast(result.session.userId,result.session.planTitle);}
      catch(error){this.paymentNotice(error.message);}
    } else if (/^https?:$/.test(location.protocol)) {
      try {const result=await this.api('account/session');this.acceptServerSession(result.session);}catch(err){
        if([401,403].includes(err.status)){
          this.session=null;this.authToken=null;this.serverVerifiedUntil=0;
          try { gameStorage.removeItem('cfb_user_session'); gameStorage.removeItem('cfb_auth_token'); } catch(_) {}
          this.handleTrialWorkflow();this.updateDrawerStatus();
        }
      }
    }
    const pendingOrder=returningOrder || (typeof gameStorage !== 'undefined' ? gameStorage.getItem('cfb_pending_order') : null);
    if (pendingOrder && /^https?:$/.test(location.protocol)) this.pollPayment(pendingOrder);
    if (/^https?:$/.test(location.protocol)) setInterval(async()=>{
      if (!this.session) return;
      try {const result=await this.api('account/session');if(!this.acceptServerSession(result.session))this.logout();}
      catch(error){if([401,403].includes(error.status)){this.session=null;this.authToken=null;this.serverVerifiedUntil=0;try { gameStorage.removeItem('cfb_user_session'); gameStorage.removeItem('cfb_auth_token'); } catch(_) {} this.handleTrialWorkflow();this.updateDrawerStatus();}}
    },60000);
  };
})();
