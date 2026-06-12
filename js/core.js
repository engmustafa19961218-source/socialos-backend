// ============================================================
// STATE
// ============================================================
let token=localStorage.getItem('sos_token')||'';
let cu=null; // current user
let biz={};
let allOrds=[],allProds=[],allCusts=[];
let trainSess=null,trainMode='open';
let lastAiResp='',lastTrainR='';
let pAttrs={};
let waTarget='all';

// ============================================================
// HELPERS
// ============================================================
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function toast(msg,d=2800){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),d);}
async function api(path,opts={}){
  try{
    const r=await fetch(path,{...opts,headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`,...(opts.headers||{})}});
    if(r.status===401){logout();return{};}
    return r.json().catch(()=>({}));
  }catch(e){return{};}
}
function om(id){document.getElementById(id).classList.add('show');setTimeout(initImgPickers,80);}
function cm(id){document.getElementById(id).classList.remove('show');}
// ─── SIDEBAR ───
let sidebarExpanded = false;
function toggleSidebar(){
  sidebarExpanded=!sidebarExpanded;
  const sb=document.getElementById('sidebar');
  const mc=document.getElementById('main-content');
  if(sb) sb.classList.toggle('expanded',sidebarExpanded);
  if(mc) mc.classList.toggle('expanded',sidebarExpanded);
}
function openMobileMenu(){document.getElementById('mobile-menu').style.display='block';}
function closeMobileMenu(){document.getElementById('mobile-menu').style.display='none';}

// ============================================================
// AUTH
// ============================================================
// نوع تسجيل الدخول: email أو phone
let loginType='email', regType='email';

function switchLoginType(t){
  loginType=t;
  document.getElementById('l-email-field').style.display=t==='email'?'block':'none';
  document.getElementById('l-phone-field').style.display=t==='phone'?'block':'none';
  document.getElementById('l-email-tab').classList.toggle('active',t==='email');
  document.getElementById('l-phone-tab').classList.toggle('active',t==='phone');
}
function switchRegType(t){
  regType=t;
  document.getElementById('r-email-field').style.display=t==='email'?'block':'none';
  document.getElementById('r-phone-field').style.display=t==='phone'?'block':'none';
  document.getElementById('r-email-tab').classList.toggle('active',t==='email');
  document.getElementById('r-phone-tab').classList.toggle('active',t==='phone');
}
function togglePass(id){
  const el=document.getElementById(id);
  el.type=el.type==='password'?'text':'password';
}
function switchTab(t){
  document.getElementById('lform').style.display=t==='login'?'block':'none';
  document.getElementById('rform').style.display=t==='register'?'block':'none';
  document.getElementById('fform').style.display=t==='forgot'?'block':'none';
  document.querySelectorAll('.auth-tabs .auth-tab').forEach((b,i)=>{
    b.classList.toggle('active',(i===0&&t==='login')||(i===1&&t==='register'));
  });
}
async function doLogin(){
  const pass=document.getElementById('lp').value;
  let body={password:pass};
  if(loginType==='email'){
    const email=document.getElementById('le').value.trim();
    if(!email||!pass) return shErr('يرجى ملء جميع الحقول');
    body.email=email;
  } else {
    const phone=document.getElementById('lph').value.trim();
    if(!phone||!pass) return shErr('يرجى ملء جميع الحقول');
    body.phone=phone;
  }
  const btn=document.getElementById('lbtn');btn.disabled=true;btn.textContent='⏳...';
  const d=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json()).catch(()=>({}));
  btn.disabled=false;btn.textContent='دخول ←';
  if(d.success) setUser(d.user,d.token);
  else shErr(d.message||'بيانات غير صحيحة');
}
async function doRegister(){
  const name=document.getElementById('rn').value.trim();
  const pass=document.getElementById('rp').value;
  if(!name||!pass) return shErr('يرجى ملء جميع الحقول');
  let body={name,password:pass};
  if(regType==='email'){
    const email=document.getElementById('re').value.trim();
    if(!email) return shErr('البريد الإلكتروني مطلوب');
    body.email=email;
  } else {
    const phone=document.getElementById('rph').value.trim();
    if(!phone) return shErr('رقم الهاتف مطلوب');
    body.phone=phone;
  }
  const btn=document.getElementById('rbtn');btn.disabled=true;btn.textContent='⏳...';
  const d=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json()).catch(()=>({}));
  btn.disabled=false;btn.textContent='إنشاء حساب ←';
  if(d.success) setUser(d.user,d.token);
  else shErr(d.message||'خطأ في التسجيل');
}

// نسيت كلمة المرور
async function sendResetCode(){
  const identifier=document.getElementById('fid').value.trim();
  if(!identifier) return shErr('أدخل البريد أو الهاتف');
  const btn=document.getElementById('fbtn');btn.disabled=true;btn.textContent='⏳ جاري الإرسال...';
  const d=await fetch('/api/auth/forgot-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier})}).then(r=>r.json()).catch(()=>({}));
  btn.disabled=false;btn.textContent='إرسال الكود ←';
  if(d.success){
    // إذا كان هاتف — نفتح واتساب تلقائياً
    if(d.wa_link){
      // نفتح واتساب ليرسل الكود لنفسه
      window.open(d.wa_link,'_blank');
      // نعرض رسالة توضيحية
      document.getElementById('fstep1').style.display='none';
      document.getElementById('fstep2').style.display='block';
      // نحدّث نص التوضيح
      const hint=document.getElementById('fstep2-hint');
      if(hint) hint.innerHTML=`📱 فُتح واتساب — أرسل الرسالة لنفسك ثم أدخل الكود هنا<br><small style="color:var(--text2)">إشارة الكود: ${d.code_hint||''}</small>`;
    } else {
      document.getElementById('fstep1').style.display='none';
      document.getElementById('fstep2').style.display='block';
    }
  } else shErr(d.message||'خطأ');
}
async function doResetPass(){
  const identifier=document.getElementById('fid').value.trim();
  const code=document.getElementById('fcode').value.trim();
  const newPass=document.getElementById('fnp').value;
  if(!code||!newPass) return shErr('يرجى ملء جميع الحقول');
  if(newPass.length<6) return shErr('كلمة المرور 6 أحرف على الأقل');
  const btn=document.getElementById('frsbtn');btn.disabled=true;btn.textContent='⏳...';
  const d=await fetch('/api/auth/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier,code,new_password:newPass})}).then(r=>r.json()).catch(()=>({}));
  btn.disabled=false;btn.textContent='تعيين كلمة المرور ←';
  if(d.success){
    shErr('✅ تم تعيين كلمة المرور — سجل دخولك الآن');
    setTimeout(()=>switchTab('login'),1500);
    document.getElementById('fstep2').style.display='none';
    document.getElementById('fstep1').style.display='block';
    document.getElementById('fid').value='';
  } else shErr(d.message||'خطأ');
}

function shErr(msg){const el=document.getElementById('aerr');el.textContent=msg;el.style.display='block';setTimeout(()=>el.style.display='none',5000);}
function googleLogin(){
  if(typeof google==='undefined') return shErr('Google API لم يتحمل، حاول مجدداً');
  google.accounts.id.initialize({client_id:window.GOOGLE_CLIENT_ID||'',callback:async(resp)=>{
    const d=await fetch('/api/auth/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:resp.credential})}).then(r=>r.json()).catch(()=>({}));
    if(d.success) setUser(d.user,d.token);else shErr(d.message||'فشل Google');
  }});
  google.accounts.id.prompt();
}
function setUser(user,tok){
  token=tok;cu=user;
  localStorage.setItem('sos_token',tok);
  localStorage.setItem('sos_user',JSON.stringify(user));
  const initials=user.name?.charAt(0)||'?';
  ['uav','uav2'].forEach(id=>{
    const av=document.getElementById(id);
    if(!av) return;
    if(user.avatar_url){av.innerHTML=`<img src="${esc(user.avatar_url)}" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.textContent='${esc(initials)}'">`;
    } else av.textContent=initials;
  });
  ['unm','unm2'].forEach(id=>{
    const nm=document.getElementById(id);
    if(nm) nm.textContent=user.name||user.email||user.phone||'';
  });
  chkOnboard();
  // تطبيق هوية المتجر
  setTimeout(loadInitialIdentity, 500);
  // فحص المهام المعلقة كل دقيقة
  setTimeout(() => {
    if (typeof ldPendingTasksMike === 'function') ldPendingTasksMike();
    setInterval(() => {
      if (typeof ldPendingTasksMike === 'function') ldPendingTasksMike();
    }, 60000);
  }, 3000);
}
async function chkOnboard(){
  // أولاً نتحقق من localStorage للسرعة
  const localDone = localStorage.getItem('sos_onboarded');
  if(localDone === '1'){
    document.getElementById('auth').style.display='none';
    document.getElementById('onboarding').style.display='none';
    document.getElementById('dashboard').style.display='block';
    ldHome();
    return;
  }
  // إذا لم يكن محفوظاً، نتحقق من الـ API
  try {
    const d=await api('/api/business/profile');
    biz=d.profile||{};
    if(biz.onboarding_done){
      localStorage.setItem('sos_onboarded','1');
      document.getElementById('auth').style.display='none';
      document.getElementById('onboarding').style.display='none';
      document.getElementById('dashboard').style.display='block';
      ldHome();
    } else {
      document.getElementById('auth').style.display='none';
      initOb();
      document.getElementById('onboarding').style.display='block';
    }
  } catch(e) {
    // إذا فشل الـ API ولدينا token، ندخل للداشبورد
    document.getElementById('auth').style.display='none';
    document.getElementById('onboarding').style.display='none';
    document.getElementById('dashboard').style.display='block';
    ldHome();
  }
}
function logout(){
  token='';cu=null;
  localStorage.removeItem('sos_token');
  localStorage.removeItem('sos_user');
  localStorage.removeItem('sos_onboarded');
  document.getElementById('dashboard').style.display='none';
  document.getElementById('auth').style.display='flex';
}
window.onload=()=>{const sv=localStorage.getItem('sos_user');if(token&&sv){cu=JSON.parse(sv);setUser(cu,token);}};

// ============================================================
// ONBOARDING
// ============================================================
let obS=0,selBT='',ob1CustomDesc='';
function initOb(){
  const types=[
    {id:'retail',n:'تجارة',i:'🛍️'},{id:'restaurant',n:'مطاعم',i:'🍽️'},
    {id:'real_estate',n:'عقارات',i:'🏠'},{id:'services',n:'خدمات',i:'🔧'},
    {id:'health',n:'صحة',i:'💆'},{id:'education',n:'تعليم',i:'📚'},
    {id:'fashion',n:'أزياء',i:'👗'},{id:'electronics',n:'إلكترونيات',i:'📱'},
    {id:'perfume',n:'عطور',i:'🌹'},{id:'furniture',n:'أثاث',i:'🛋️'},
    {id:'sports',n:'رياضة',i:'⚽'},{id:'other',n:'أخرى',i:'🏪'}
  ];
  document.getElementById('btg').innerHTML=types.map(t=>`<div class="btc" onclick="pickBT('${t.id}',this)"><div class="bi">${t.i}</div><div class="bn">${t.n}</div></div>`).join('');
}
function pickBT(id,el){
  selBT=id;
  document.querySelectorAll('.btc').forEach(c=>c.classList.remove('sel'));
  el.classList.add('sel');
}
async function saveOb1(){
  // جمع نوع العمل من الاختيار
  const customDesc = document.getElementById('ob1-custom')?.value.trim() || '';
  ob1CustomDesc = customDesc;
  // حفظ نوع العمل مؤقتاً
  if(selBT || customDesc){
    await api('/api/business/profile',{method:'PUT',body:JSON.stringify({
      business_type: selBT || 'other',
      business_desc: customDesc || ''
    })});
  }
  nextStep();
}
function nextStep(){goOb(obS+1);}
function goOb(n){
  document.getElementById('obs'+obS).classList.remove('active');
  document.getElementById('pd'+obS).classList.remove('active');document.getElementById('pd'+obS).classList.add('done');
  obS=n;
  if(obS>=4){finOb();return;}
  document.getElementById('obs'+obS).classList.add('active');
  document.getElementById('pd'+obS).classList.add('active');
}
async function saveOb2(){
  const name=document.getElementById('obsn').value.trim();
  const desc=document.getElementById('obsd').value.trim();
  const wa=document.getElementById('obsw').value.trim();
  if(!name) return toast('⚠️ أدخل اسم متجرك');
  // دمج الوصف الحر من الخطوة الأولى مع وصف الخطوة الثانية
  const finalDesc = desc || ob1CustomDesc || '';
  await api('/api/business/profile',{method:'PUT',body:JSON.stringify({
    store_name:name,
    business_type:selBT||'other',
    business_desc:finalDesc,
    whatsapp_number:wa
  })});
  nextStep();
}
async function saveOb3(){
  const en=document.getElementById('oen').value.trim(),phil=document.getElementById('oep').value.trim(),obj=document.getElementById('oeo').value.trim();
  const storeName=document.getElementById('obsn').value.trim();
  const storeDesc=document.getElementById('obsd').value.trim()||ob1CustomDesc||'';

  // إظهار مؤشر التحميل
  const btn=document.querySelector('#obs3 button.btn.ba');
  if(btn){btn.disabled=true;btn.textContent='⏳ جاري إعداد نظامك...';}

  try{
    // 1) استدعاء auto-setup لتوليد الإعدادات المناسبة لنوع العمل
    const setup=await api('/api/onboarding/auto-setup',{method:'POST',body:JSON.stringify({
      business_type:selBT||'other',
      business_desc:storeDesc,
      store_name:storeName,
      employee_name:en||'',
      user_philosophy:phil||'',
      user_objection:obj||''
    })});

    const s=setup.settings||{};

    // 2) تطبيق إعدادات الموظف الرقمي (يدمج مدخلات المستخدم مع ما ولّده الذكاء)
    await api('/api/employee',{method:'PUT',body:JSON.stringify({
      name:       en   || s.employee_name        || 'مساعدي الذكي',
      personality:       s.personality           || '',
      sales_style:       s.sales_style           || '',
      philosophy: phil || s.philosophy           || '',
      objection_handling:obj||s.objection_handling||'',
      boundaries:        s.boundaries            || ''
    })});

    // 3) تطبيق السياسات والأسلوب على الملف التجاري
    await api('/api/business/profile',{method:'PUT',body:JSON.stringify({
      communication_style: s.communication_style || '',
      policies:            s.policies            || '',
      onboarding_done:true
    })});

  }catch(e){
    // في حال فشل الـ AI نكمل بالبيانات الأساسية فقط
    await api('/api/employee',{method:'PUT',body:JSON.stringify({name:en||'مساعدي الذكي',philosophy:phil,objection_handling:obj})});
    await api('/api/business/profile',{method:'PUT',body:JSON.stringify({onboarding_done:true})});
  }

  finOb();
}
function finOb(){
  localStorage.setItem('sos_onboarded','1');
  document.getElementById('onboarding').style.display='none';
  document.getElementById('dashboard').style.display='block';
  toast('🎉 تم إعداد نظامك بنجاح!');
  ldHome();
}

// ============================================================
// HOME
// ============================================================
async function ldHome(){
  const[stats,ana,emp,board]=await Promise.all([api('/api/stats'),api('/api/analytics/dashboard'),api('/api/employee'),api('/api/board/recommendations')]);
  document.getElementById('h-ord').textContent=stats.orders||0;
  document.getElementById('h-prod').textContent=stats.products||0;
  document.getElementById('h-cust').textContent=stats.customers||0;
  const rev=ana.totals?.revenue||0;
  document.getElementById('h-rev').textContent=rev>=1000000?(rev/1000000).toFixed(1)+'م':rev>=1000?(rev/1000).toFixed(1)+'ك':rev.toFixed(0);
  // Recent orders
  const top=(ana.top_customers||[]);
  document.getElementById('h-ords').innerHTML=top.length
    ?`<div class="tw"><table><tr><th>العميل</th><th>الطلبات</th><th>المبلغ</th></tr>${top.map(c=>`<tr><td>${esc(c.customer_name)}</td><td>${c.orders_count}</td><td>${Number(c.total_spent||0).toLocaleString()}</td></tr>`).join('')}</table></div>`
    :'<div class="empty"><div class="ei">🛒</div><p>لا طلبات</p></div>';
  // Employee
  const e=emp.employee||{};
  const tl=e.trust_level||1;
  const correct=e.correct_interactions||0;
  const reqNext=tl*20;
  const pctHome=tl>=3?100:Math.min(100,Math.round((correct/reqNext)*100));
  const stageInfo=[
    {icon:'👁️',name:'مراقبة',color:'var(--accent3)',badge:'bor'},
    {icon:'🤝',name:'مساعدة',color:'var(--accent)',badge:'bbl'},
    {icon:'🚀',name:'استقلال',color:'var(--green)',badge:'bgr'}
  ][tl-1]||{icon:'👁️',name:'مراقبة',color:'var(--accent3)',badge:'bor'};
  document.getElementById('h-emp').innerHTML=`
    <div style="display:flex;align-items:center;gap:9px;margin-bottom:9px">
      <div style="width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0">🧠</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.name||'الموظف الرقمي')}</div>
        <span class="badge ${stageInfo.badge}" style="font-size:.65rem">${stageInfo.icon} ${stageInfo.name}</span>
      </div>
      <div style="text-align:left;flex-shrink:0">
        <div style="font-size:1.3rem;font-weight:900;color:${stageInfo.color};line-height:1">${pctHome}%</div>
        <div style="font-size:.62rem;color:var(--text2)">ثقة</div>
      </div>
    </div>
    <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;margin-bottom:7px">
      <div style="height:100%;width:${pctHome}%;background:linear-gradient(90deg,${stageInfo.color},${tl>=3?'#00a87a':tl>=2?'var(--accent2)':'#e08000'});border-radius:3px;transition:width .5s"></div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:.72rem;color:var(--text2);margin-bottom:8px">
      <span>التفاعلات: ${(e.total_interactions||0).toLocaleString()}</span>
      <span>${tl<3?`${Math.max(0,reqNext-correct)} للترقية`:'✅ أعلى مستوى'}</span>
    </div>
    <button class="btn bo bsm" onclick="sp('training',null)" style="width:100%;padding:8px">🎓 تدريب</button>
  `;
  // Board
  const recs=(board.recommendations||[]).filter(r=>!r.is_read).slice(0,3);
  document.getElementById('h-board').innerHTML=recs.length
    ?recs.map(r=>`<div class="bc ${r.priority}" style="padding:11px;margin-bottom:7px"><div style="font-weight:700;font-size:.84rem;margin-bottom:3px">${esc(r.title)}</div><div style="color:var(--text2);font-size:.78rem">${esc((r.content||'').substring(0,90))}...</div></div>`).join('')
    :'<div class="empty"><div class="ei">🏛️</div><p>اضغط "المجلس"</p></div>';
  // Badge
  const ub=stats.unread_notifications||0;
  const nb=document.getElementById('nbc');nb.style.display=ub>0?'flex':'none';nb.textContent=ub;
}


// ============================================================
// رفع صورة من الهاتف — دالة موحدة لكل الأماكن
// ============================================================
async function uploadImgToField(input, fieldId, callback) {
  const file = input.files[0];
  if (!file) return;

  const previewId = fieldId.replace('-url','') + '-preview';
  const prevEl = document.getElementById(previewId);

  toast('⏳ جاري رفع الصورة...');

  try {
    // تحويل لـ base64
    const base64 = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result);
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });

    // محاولة رفع للسيرفر
    let finalUrl = base64;
    try {
      const d = await api('/api/images/upload-base64', {
        method: 'POST',
        body: JSON.stringify({ image: base64, filename: file.name })
      });
      if (d.success && d.url) finalUrl = d.url;
    } catch(e) { /* استخدم base64 مباشرة */ }

    // وضع الرابط في الحقل
    const field = document.getElementById(fieldId);
    if (field) field.value = finalUrl;

    // معاينة الصورة
    if (prevEl) {
      prevEl.innerHTML = `<img src="${finalUrl}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;border:1px solid var(--border);margin-bottom:4px">`;
      prevEl.style.display = 'block';
    }

    // استدعاء callback إن وجد
    if (typeof callback === 'function') callback();

    toast('✅ تم رفع الصورة');
  } catch(e) {
    toast('❌ فشل رفع الصورة');
  }

  input.value = '';
}

// رفع عدة صور
async function uploadMultipleImgs(input, callback) {
  const files = Array.from(input.files);
  if (!files.length) return;
  toast('⏳ جاري رفع الصور...');

  const urls = [];
  for (const file of files) {
    try {
      const base64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      let finalUrl = base64;
      try {
        const d = await api('/api/images/upload-base64', {
          method: 'POST',
          body: JSON.stringify({ image: base64, filename: file.name })
        });
        if (d.success && d.url) finalUrl = d.url;
      } catch(e) {}
      urls.push(finalUrl);
    } catch(e) {}
  }

  if (typeof callback === 'function') callback(urls);
  toast(`✅ تم رفع ${urls.length} صورة`);
  input.value = '';
}
