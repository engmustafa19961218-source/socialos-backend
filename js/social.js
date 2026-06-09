async function ldSocial(){
  const d=await api('/api/social/accounts');
  const accounts=(d.accounts||[]);
  const map={};
  accounts.forEach(a=>{ if(a.is_connected) map[a.platform]=a; });

  // Instagram
  renderSocialCard('instagram', map['instagram'], {
    badge:'sc-ig-badge', info:'sc-ig-info', btn:'sc-ig-btn', dis:'sc-ig-dis',
    connectedLabel:`📸 ${esc(map['instagram']?.account_username?'@'+map['instagram'].account_username:map['instagram']?.account_name||'')}`
  });

  // Facebook
  renderSocialCard('facebook', map['facebook'], {
    badge:'sc-fb-badge', info:'sc-fb-info', btn:'sc-fb-btn', dis:'sc-fb-dis',
    connectedLabel:`👥 ${esc(map['facebook']?.page_name||map['facebook']?.account_name||'صفحتك')}`
  });

  // TikTok
  renderSocialCard('tiktok', map['tiktok'], {
    badge:'sc-tt-badge', info:'sc-tt-info', btn:'sc-tt-btn', dis:'sc-tt-dis',
    connectedLabel:`🎵 ${esc(map['tiktok']?.account_name||'')}`
  });

  // WhatsApp
  const wa=map['whatsapp'];
  const waBadge=document.getElementById('sc-wa-badge');
  const waForm=document.getElementById('sc-wa-form');
  const waActions=document.getElementById('sc-wa-actions');
  const waInfo=document.getElementById('sc-wa-info');
  if(wa){
    waBadge.innerHTML='<span class="badge bgr">✅ مربوط</span>';
    waInfo.innerHTML=`<div style="font-size:.8rem;color:var(--text2)">${esc(wa.account_name||'')} — Phone ID: <code>${esc(wa.whatsapp_phone_id||'')}</code></div>`;
    waForm.style.display='none';
    waActions.style.display='flex';
    waActions.style.gap='7px';
  } else {
    waBadge.innerHTML='<span class="badge" style="background:rgba(255,68,102,.15);color:var(--danger)">غير مربوط</span>';
    waInfo.innerHTML='';
    waForm.style.display='block';
    waActions.style.display='none';
  }
}

function renderSocialCard(platform, data, els){
  const badge=document.getElementById(els.badge);
  const info=document.getElementById(els.info);
  const btn=document.getElementById(els.btn);
  const dis=document.getElementById(els.dis);
  if(data){
    badge.innerHTML='<span class="badge bgr">✅ مربوط</span>';
    const since=data.connected_at?new Date(data.connected_at).toLocaleDateString('ar'):'';
    info.innerHTML=`<div style="font-size:.8rem;color:var(--text2)">${els.connectedLabel}${since?' — '+since:''}</div>`;
    btn.textContent='🔄 تحديث الربط';
    dis.style.display='inline-flex';
  } else {
    badge.innerHTML='<span class="badge" style="background:rgba(255,68,102,.15);color:var(--danger)">غير مربوط</span>';
    info.innerHTML='';
    btn.textContent='ربط الحساب';
    dis.style.display='none';
  }
}

async function connectMeta(){
  const d=await api('/api/social/meta/auth-url');
  if(!d.success) return toast('❌ '+(d.message||'META_APP_ID غير مضبوط في السيرفر'));
  const w=window.open(d.url,'_blank','width=600,height=700,scrollbars=yes');
  if(!w) window.location.href=d.url;
  // مراقبة رجوع الـ callback
  const timer=setInterval(()=>{
    try{
      if(w&&w.closed){clearInterval(timer);setTimeout(()=>ldSocial(),1500);}
    }catch(e){clearInterval(timer);}
  },1000);
}

async function connectTikTok(){
  const d=await api('/api/social/tiktok/auth-url');
  if(!d.success) return toast('❌ '+(d.message||'TIKTOK_CLIENT_KEY غير مضبوط في السيرفر'));
  const w=window.open(d.url,'_blank','width=600,height=700,scrollbars=yes');
  if(!w) window.location.href=d.url;
  const timer=setInterval(()=>{
    try{if(w&&w.closed){clearInterval(timer);setTimeout(()=>ldSocial(),1500);}}catch(e){clearInterval(timer);}
  },1000);
}

async function connectWhatsApp(){
  const token=document.getElementById('wa-token').value.trim();
  const phoneId=document.getElementById('wa-phoneid').value.trim();
  const bizId=document.getElementById('wa-bizid').value.trim();
  const name=document.getElementById('wa-name').value.trim();
  if(!token||!phoneId) return toast('⚠️ Access Token وPhone Number ID مطلوبان');
  const d=await api('/api/social/connect',{method:'POST',body:JSON.stringify({
    platform:'whatsapp',access_token:token,account_name:name||'WhatsApp Business',
    whatsapp_phone_id:phoneId,whatsapp_business_id:bizId
  })});
  if(d.success){toast('✅ تم ربط WhatsApp');ldSocial();}else toast('❌ '+(d.message||'خطأ'));
}

async function disconnectSocial(platform){
  if(!confirm(`هل تريد فك ربط ${platform}؟`)) return;
  const d=await api('/api/social/disconnect/'+platform,{method:'DELETE'});
  if(d.success){toast('✅ تم فك الربط');ldSocial();}else toast('❌ '+(d.message||'خطأ'));
}

function openWaTest(){om('mwatest');}
async function sendWaTest(){
  const phone=document.getElementById('wat-phone').value.trim();
  const msg=document.getElementById('wat-msg').value.trim();
  if(!phone||!msg) return toast('⚠️ الرقم والرسالة مطلوبان');
  const d=await api('/api/social/whatsapp/send',{method:'POST',body:JSON.stringify({to:phone,message:msg})});
  if(d.success){toast('✅ تم الإرسال!');cm('mwatest');}else toast('❌ '+(d.message||'فشل الإرسال'));
}

// التحقق من العودة بعد OAuth
(function checkSocialCallback(){
  const p=new URLSearchParams(location.search);
  if(p.get('social_connected')){
    const pl=p.get('social_connected');
    toast(`✅ تم ربط ${pl} بنجاح!`);
    history.replaceState({},'',location.pathname);
  }
  if(p.get('social_error')){
    toast('❌ فشل الربط: '+decodeURIComponent(p.get('social_error')));
    history.replaceState({},'',location.pathname);
  }
})();

// ============================================================
// ============================================================
