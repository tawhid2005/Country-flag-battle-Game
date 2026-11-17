(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  let data={}, view='overview', page=0, loading=false;
  const onboarding=new Map();
  async function api(path,body) {
    if (!/^https?:$/.test(location.protocol)) throw new Error('Open /admin on your hosted website; local files cannot access the server.');
    const response=await fetch('/api/'+path,{method:body === undefined ? 'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body === undefined ? {}:{'Content-Type':'application/json'},body:body === undefined ? undefined:JSON.stringify(body)});
    let result;try{result=await response.json();}catch(_){throw new Error('Admin API is not deployed. Complete the server setup first.');}
    if(!response.ok){if(response.status===401)showLogin();throw Object.assign(new Error(result.message || 'Unable to complete request'),{status:response.status});}return result;
  }
  function showLogin(){$('login-view').hidden=false;$('dashboard').hidden=true;}
  function message(text){$('dashboard-status').textContent=text;}
  function money(value,currency){return new Intl.NumberFormat('en',{style:'currency',currency}).format(value/100);}
  function date(value){return value ? new Date(value).toLocaleString('en-GB',{timeZone:'Asia/Dhaka',dateStyle:'medium',timeStyle:'short'}):'—';}
  function td(row,text,small){const cell=document.createElement('td');cell.textContent=String(text ?? '—');if(small){const label=document.createElement('small');label.textContent=small;cell.appendChild(label);}row.appendChild(cell);return cell;}
  function pill(row,status){const cell=td(row,'');const badge=document.createElement('span');badge.className='status '+status;badge.textContent=status.replaceAll('_',' ');cell.appendChild(badge);}
  function action(cell,label,fn){const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=async()=>{button.disabled=true;message('');try{await fn();}catch(error){message(error.message);}finally{button.disabled=false;}};cell.appendChild(button);}
  function account(id){return data.accounts?.find(item=>item.id===id);}
  async function deliverAccess(item,plan,result){
    const draft=onboarding.get(item.id);
    if(!draft)return message(result.reused?'This grant was already processed; duplicate order prevented.':'Access granted. Copy the activation link from Orders & payments.');
    const text=['🎮 Country Flag Battle access is ready','',`Username: ${item.username}`,`Email: ${item.email}`,`Password: ${draft.password}`,`Plan: ${plan}`,'',`One-click activation: ${result.link}`,'','Keep these details private.'].join('\n');
    let copied=false;try{await navigator.clipboard.writeText(text);copied=true;}catch(_){}
    if(draft.phone){window.open('https://wa.me/'+draft.phone+'?text='+encodeURIComponent(text),'_blank','noopener');message(copied?'Access message copied and WhatsApp opened.':'WhatsApp message prepared for the player.');}
    else{message(copied?'Player access message copied.':'Access granted. Copy the activation link from Orders & payments.');}
    onboarding.delete(item.id);
  }
  function render(){
    const isAccounts=view==='accounts',isEvents=view==='events';
    $('create-panel').hidden=!isAccounts;$('summary-panel').hidden=view!=='overview';$('clear-events').hidden=!isEvents;
    const titles={overview:'Overview',orders:'Orders & payments',accounts:'Player access',events:'Activity log'};
    $('page-title').textContent=titles[view];$('table-title').textContent=isAccounts?'Player accounts':isEvents?'Recent activity':'Payment orders';
    const columns=isAccounts?['Player / account','Email','Access until (Dhaka)','Status','Actions']:isEvents?['Time (Dhaka)','Event','Order','Detail']:['Order','Player','Plan','Amount','Status','Created (Dhaka)','Actions'];
    $('table-head').replaceChildren();const tr=document.createElement('tr');for(const title of columns){const th=document.createElement('th');th.textContent=title;tr.appendChild(th);}$('table-head').appendChild(tr);
    const records=isAccounts?data.accounts||[]:isEvents?data.events||[]:data.orders||[];
    const query=$('search').value.trim().toLowerCase();const visible=records.filter(item=>JSON.stringify([item,account(item.account_id)]).toLowerCase().includes(query));
    $('table-body').replaceChildren();
    for(const item of visible){const row=document.createElement('tr');
      if(isAccounts){
        const entitlement=data.entitlements?.find(e=>e.account_id===item.id),active=entitlement && !entitlement.revoked && Date.parse(entitlement.expires_at)>Date.now();
        td(row,item.username,item.id);td(row,item.email);td(row,date(entitlement?.expires_at));pill(row,active?'active':entitlement?.revoked?'revoked':'inactive');
        const cell=td(row,'');const select=document.createElement('select');select.setAttribute('aria-label','Plan for '+item.username);
        for(const [id,plan] of Object.entries(data.plans||{})){const option=document.createElement('option');option.value=id;option.textContent=plan.name;select.appendChild(option);}cell.appendChild(select);
        action(cell,'Grant / extend',async()=>{const plan=select.selectedOptions[0].textContent;if(!confirm('Grant '+plan+' to '+item.username+'? Confirm their payment independently first.'))return;const result=await api('admin/grant',{accountId:item.id,planId:select.value});await deliverAccess(item,plan,result);await refresh();});
        if(active)action(cell,'Revoke',async()=>{if(!confirm('Revoke access for '+item.username+'?'))return;await api('admin/revoke',{accountId:item.id});await refresh();});
        action(cell,'Delete player',async()=>{const typed=prompt('This permanently deletes the player and their orders. Type the username to continue:');if(typed===null)return;await api('admin/delete-account',{accountId:item.id,confirmUsername:typed});onboarding.delete(item.id);message('Player and related records deleted.');await refresh();});
      }else if(isEvents){td(row,date(item.created_at));td(row,item.kind);td(row,item.order_id);td(row,item.detail);}
      else{td(row,item.id.slice(0,8),item.provider);td(row,account(item.account_id)?.username || item.account_id);td(row,data.plans?.[item.plan_id]?.name || item.plan_id);td(row,money(item.amount_minor,item.currency));pill(row,item.status);td(row,date(item.created_at));const cell=td(row,'');
        if(item.provider!=='manual')action(cell,'Verify again',async()=>{await api('admin/reconcile',{orderId:item.id});message('Gateway verification completed.');await refresh();});
        if(item.status==='paid')action(cell,'Copy activation link',async()=>{const result=await api('admin/activation',{orderId:item.id});await navigator.clipboard.writeText(result.link);message('Activation link copied. It opens the game, never the admin page.');});
      }$('table-body').appendChild(row);
    }
    $('empty-state').hidden=visible.length>0;$('previous').disabled=page===0;$('next').disabled=!data.hasMore;$('page-number').textContent='Page '+(page+1);
    const paid=(data.orders||[]).filter(o=>o.status==='paid');$('kpi-paid').textContent=paid.length;$('kpi-pending').textContent=(data.orders||[]).filter(o=>['pending','checkout_failed'].includes(o.status)).length;
    $('kpi-active').textContent=(data.entitlements||[]).filter(e=>!e.revoked && Date.parse(e.expires_at)>Date.now()).length;
    $('kpi-revenue').textContent=['usd','bdt'].map(currency=>money(paid.filter(o=>o.currency===currency && o.provider!=='manual').reduce((sum,o)=>sum+o.amount_minor,0),currency)).join(' / ');
  }
  async function refresh(){if(loading)return;loading=true;$('refresh').disabled=true;try{
    data=await api('admin/monitor?page='+page);$('login-view').hidden=true;$('dashboard').hidden=false;
    const health=await api('health');$('integration-status').replaceChildren();
    for(const [name,ok,env] of [['Database credentials',health.database,''],['Polar',health.polar,health.polarEnvironment],['Bangladesh gateway',health.sslcommerz,health.sslEnvironment]]){
      const badge=document.createElement('span');badge.className='integration'+(!ok?' warn':'');badge.textContent=name+': '+(ok?'configured':'setup needed')+(env?' · '+env:'');$('integration-status').appendChild(badge);
    }
    $('updated').textContent='Updated '+new Date().toLocaleTimeString('en-GB',{timeZone:'Asia/Dhaka'})+' · Asia/Dhaka';render();
  }catch(error){if(!$('dashboard').hidden)message(error.message);else if(error.status!==401)$('login-status').textContent=error.message;}finally{loading=false;$('refresh').disabled=false;}}
  $('login-form').onsubmit=async event=>{event.preventDefault();$('login-button').disabled=true;$('login-status').textContent='';try{
    await api('admin/login',{username:$('username').value,password:$('password').value});
    // Let a supporting browser offer secure password-manager storage only after authentication.
    // Browser preferences and its own save/consent UI decide whether anything is stored.
    try {
      if(window.PasswordCredential && navigator.credentials?.store) {
        const credential=new window.PasswordCredential($('login-form'));
        Promise.resolve(navigator.credentials.store(credential)).catch(()=>{});
      }
    } catch (_) {}
    await refresh();
    if(!$('dashboard').hidden)$('password').value='';
  }catch(error){$('login-status').textContent=error.message;}finally{$('login-button').disabled=false;}};
  $('logout').onclick=async()=>{try{await api('admin/logout',{});showLogin();}catch(error){message(error.message);}};
  $('refresh').onclick=refresh;$('search').oninput=render;
  document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{view=button.dataset.view;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('selected',b===button));render();});
  $('previous').onclick=()=>{if(page>0){page--;refresh();}};$('next').onclick=()=>{page++;refresh();};
  $('create-form').onsubmit=async event=>{event.preventDefault();const button=event.target.querySelector('button'),password=$('new-password').value,phone=$('new-phone').value.replace(/[^0-9]/g,'').replace(/^0/,'88');button.disabled=true;try{if(phone&&!/^8801[3-9][0-9]{8}$/.test(phone))throw new Error('Enter a valid WhatsApp number or leave it blank.');const result=await api('admin/account',{username:$('new-username').value,email:$('new-email').value,password});onboarding.set(result.accountId,{password,phone});$('new-password').value='';$('new-phone').value='';message('Account created. Grant its verified plan to prepare the WhatsApp access message.');await refresh();}catch(error){message(error.message);}finally{button.disabled=false;}};
  $('clear-events').onclick=async()=>{const typed=prompt('Type CLEAR ACTIVITY LOG to permanently clear the activity log:');if(typed===null)return;try{await api('admin/clear-events',{confirm:typed});message('Activity log cleared.');await refresh();}catch(error){message(error.message);}};
  async function bootstrap(){
    if(window.__cfbActivationRedirect)return;
    try {
      const health=await api('health');
      if(health.adminOrigin && location.protocol==='https:' && location.origin!==health.adminOrigin){location.replace(health.adminOrigin+'/admin');return;}
      if(health.admin===false || health.database===false){
        showLogin();
        const names=health.adminMissing?.length ? ' Missing or invalid: '+health.adminMissing.join(', ')+'.' : '';
        $('login-status').textContent='Server setup incomplete. Configure the database and administrator credentials in hosting settings, then redeploy.'+names+' This is not a password error.';
        $('login-button').disabled=true;return;
      }
      await refresh();
    }catch(error){$('login-status').textContent=error.message;}
  }
  bootstrap();setInterval(()=>{if(!$('dashboard').hidden && !document.hidden)refresh();},30000);
})();
