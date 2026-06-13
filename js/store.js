async function ldCoups(){
  const d=await api('/api/coupons');const list=document.getElementById('couplist');
  if(!d.coupons?.length){list.innerHTML='<div class="empty"><div class="ei">🎟️</div><p>لا كوبونات</p></div>';return;}
  list.innerHTML=`<div class="tw"><table><tr><th>الكود</th><th>النوع</th><th>القيمة</th><th>الاستخدام</th><th>الحالة</th><th>إجراءات</th></tr>${d.coupons.map(c=>`<tr><td style="font-weight:700;font-family:monospace">${esc(c.code)}</td><td>${c.type==='percent'?'%':'ثابت'}</td><td style="color:var(--accent);font-weight:700">${c.value}${c.type==='percent'?'%':''}</td><td>${c.used_count}/${c.max_uses}</td><td><span class="badge ${c.is_active?'bgr':'brd'}">${c.is_active?'✅':'❌'}</span></td><td><button class="btn bd bsm" onclick="delCoup(${c.id})">🗑</button></td></tr>`).join('')}</table></div>`;
}

function openCoupModal(){
  // اقتراحات حسب نوع العمل (بدون AI — سريعة)
  const type = biz?.business_type || 'other';
  const suggestions = {
    restaurant:  [{code:'MEAL10',type:'percent',val:10,min:5000},{code:'LUNCH15',type:'percent',val:15,min:10000}],
    retail:      [{code:'SHOP10',type:'percent',val:10,min:15000},{code:'SAVE5K',type:'fixed',val:5000,min:20000}],
    fashion:     [{code:'STYLE10',type:'percent',val:10,min:20000},{code:'SEASON15',type:'percent',val:15,min:30000}],
    electronics: [{code:'TECH5',type:'percent',val:5,min:50000},{code:'GADGET3',type:'percent',val:3,min:100000}],
    perfume:     [{code:'SCENT15',type:'percent',val:15,min:15000},{code:'LUXURY20',type:'percent',val:20,min:30000}],
    health:      [{code:'CARE10',type:'percent',val:10,min:10000},{code:'BEAUTY15',type:'percent',val:15,min:20000}],
    furniture:   [{code:'HOME5',type:'percent',val:5,min:100000},{code:'DECO10',type:'percent',val:10,min:200000}],
    other:       [{code:'SAVE10',type:'percent',val:10,min:10000},{code:'WELCOME15',type:'percent',val:15,min:20000}]
  }[type] || [{code:'SAVE10',type:'percent',val:10,min:10000}];
  const el=document.getElementById('coup-suggestions');
  if(el) el.innerHTML=suggestions.map(s=>`<button class="cs" onclick="applyCoupSuggestion('${s.code}','${s.type}',${s.val},${s.min})">${s.code} — ${s.val}${s.type==='percent'?'%':' ثابت'}</button>`).join('');
  om('mcoup');
}
function applyCoupSuggestion(code,type,val,min){
  document.getElementById('ccode').value=code;
  document.getElementById('ctype').value=type;
  document.getElementById('cval').value=val;
  document.getElementById('cmin').value=min;
}
async function saveCoup(){
  const d=await api('/api/coupons',{method:'POST',body:JSON.stringify({code:document.getElementById('ccode').value,type:document.getElementById('ctype').value,value:parseFloat(document.getElementById('cval').value)||0,min_order:parseFloat(document.getElementById('cmin').value)||0,max_uses:parseInt(document.getElementById('cmax').value)||100,expires_at:document.getElementById('cexp').value||null})});
  if(d.success){toast('✅ تم');cm('mcoup');ldCoups();}else toast('❌ '+(d.message||'خطأ'));
}
async function delCoup(id){if(!confirm('حذف؟')) return;await api('/api/coupons/'+id,{method:'DELETE'});ldCoups();}

// ============================================================
// LOYALTY
// ============================================================
async function ldLoy(){
  const d=await api('/api/loyalty/customers');const list=document.getElementById('loylist');
  if(!d.customers?.length){list.innerHTML='<div class="empty"><div class="ei">💎</div><p>لا عملاء بنقاط</p></div>';return;}
  list.innerHTML=`<div class="tw"><table><tr><th>العميل</th><th>الهاتف</th><th>النقاط</th><th>المكتسب</th><th>المستخدم</th></tr>${d.customers.map(c=>`<tr><td>${esc(c.customer_name||'-')}</td><td dir="ltr">${esc(c.customer_phone)}</td><td style="font-weight:700;color:var(--accent)">${c.points}</td><td>${c.total_earned}</td><td>${c.total_redeemed}</td></tr>`).join('')}</table></div>`;
}
async function openLoySet(){
  const d=await api('/api/loyalty/settings');const s=d.settings||{};
  document.getElementById('lr').value=s.points_per_currency||1;
  document.getElementById('lrd').value=s.redeem_rate||100;
  document.getElementById('lmn').value=s.min_redeem||100;
  document.getElementById('lac').checked=s.is_active!==false;
  document.getElementById('loy-smart-hint').style.display='none';
  om('mloy');
}
async function applySmartLoyalty(){
  const btn=document.getElementById('loy-smart-btn');
  btn.disabled=true; btn.textContent='⏳ جاري التحليل...';
  const d=await api('/api/loyalty/smart-defaults',{method:'POST'});
  btn.disabled=false; btn.textContent='✨ إعدادات ذكية حسب نشاطي';
  if(!d.success) return toast('❌ '+(d.message||'خطأ'));
  const s=d.defaults;
  document.getElementById('lr').value=s.points_per_currency;
  document.getElementById('lrd').value=s.redeem_rate;
  document.getElementById('lmn').value=s.min_redeem;
  document.getElementById('lac').checked=true;
  const hint=document.getElementById('loy-smart-hint');
  hint.innerHTML=`💡 <strong>سبب هذه الإعدادات:</strong> ${esc(s.reason)}`;
  hint.style.display='block';
  toast('✅ تم تطبيق الإعدادات الذكية');
}
async function saveLoy(){
  const d=await api('/api/loyalty/settings',{method:'PUT',body:JSON.stringify({points_per_currency:parseFloat(document.getElementById('lr').value)||1,redeem_rate:parseFloat(document.getElementById('lrd').value)||100,min_redeem:parseInt(document.getElementById('lmn').value)||100,is_active:document.getElementById('lac').checked})});
  if(d.success){toast('✅ تم');cm('mloy');}else toast('❌ '+(d.message||'خطأ'));
}

// ============================================================
// BULK WHATSAPP
// ============================================================
async function ldWa(){
  const d=await api('/api/whatsapp/bulk/counts');const c=d.counts||{};
  document.getElementById('wca').textContent=(c.all||0)+' عميل';
  document.getElementById('wcr').textContent=(c.recent||0)+' عميل';
  document.getElementById('wcl').textContent=(c.loyalty||0)+' عميل';
}
function selWa(target,el){waTarget=target;document.querySelectorAll('#page-bulk-wa .btc').forEach(c=>c.classList.remove('sel'));el.classList.add('sel');}
async function sendBulk(){
  const msg=document.getElementById('wamsg').value.trim();if(!msg) return toast('⚠️ اكتب الرسالة');
  const d=await api('/api/whatsapp/bulk',{method:'POST',body:JSON.stringify({message:msg,target:waTarget})});
  if(!d.success) return toast('❌ '+(d.message||'خطأ'));
  const la=document.getElementById('walinks'),ll=document.getElementById('walinksl');
  la.style.display='block';
  ll.innerHTML=d.links.map(l=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)"><span style="font-size:.82rem">${esc(l.name||l.phone)}</span><a href="${esc(l.url)}" target="_blank" class="btn ba bsm">📤 إرسال</a></div>`).join('');
  toast(`✅ ${d.shown} رابط من ${d.total}`);
}

let _waTplCache = {};
async function loadWaTemplates(type){
  const resultsEl = document.getElementById('wa-tpl-results');
  const loadingEl = document.getElementById('wa-tpl-loading');
  if(_waTplCache[type]){ renderWaTpls(_waTplCache[type]); return; }
  loadingEl.style.display='block'; resultsEl.style.display='none';
  const d = await api('/api/whatsapp/templates/suggest',{method:'POST',body:JSON.stringify({template_type:type})});
  loadingEl.style.display='none';
  if(!d.success||!d.templates?.length) return toast('❌ تعذر توليد القوالب');
  _waTplCache[type] = d.templates;
  renderWaTpls(d.templates);
}
function renderWaTpls(templates){
  const resultsEl = document.getElementById('wa-tpl-results');
  resultsEl.innerHTML = templates.map(t=>`
    <div style="background:var(--surface2);border-radius:9px;padding:10px;border:1px solid var(--border)">
      <div style="font-size:.72rem;color:var(--accent);font-weight:700;margin-bottom:5px">${esc(t.label)}</div>
      <div style="font-size:.81rem;color:var(--text1);line-height:1.6;margin-bottom:7px;white-space:pre-wrap">${esc(t.text)}</div>
      <button class="btn ba bsm" onclick="document.getElementById('wamsg').value=\`${t.text.replace(/`/g,"'")}\`;toast('✅ تم تطبيق القالب')" style="padding:6px 12px">تطبيق ←</button>
    </div>`).join('');
  resultsEl.style.display='flex';
}

// ============================================================
// MARKETPLACE
// ============================================================
async function ldMkt(){
  const el=document.getElementById('storelink');if(!cu) return;
  const u=`${location.origin}/store/${cu.id}`;
  el.innerHTML=`<div style="font-size:2rem;margin-bottom:9px">🏪</div><div style="font-weight:700;margin-bottom:7px">رابط متجرك</div><div style="background:var(--surface2);border:1px solid var(--border);border-radius:9px;padding:9px 13px;font-family:monospace;font-size:.85rem;margin-bottom:13px;direction:ltr">${esc(u)}</div><div style="display:flex;gap:8px;justify-content:center"><button class="btn ba" onclick="window.open('${esc(u)}','_blank')">🔗 فتح</button><button class="btn bo" onclick="navigator.clipboard.writeText('${esc(u)}').then(()=>toast('✅ نُسخ'))">📋 نسخ</button></div>`;
}

// ============================================================
// TEAM
// ============================================================
async function ldTeam(){
  const d=await api('/api/team');const list=document.getElementById('teamlist');
  if(!d.members?.length){list.innerHTML='<div class="empty"><div class="ei">👨‍💼</div><p>لا أعضاء</p></div>';return;}
  const rl={manager:'مدير',sales:'مبيعات',customer_service:'خدمة عملاء',designer:'مصمم',orders:'طلبات',viewer:'مشاهد'};
  list.innerHTML=`<div class="tw"><table><tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>إجراءات</th></tr>${d.members.map(m=>`<tr><td>${esc(m.name)}</td><td dir="ltr" style="color:var(--text2)">${esc(m.email)}</td><td><span class="badge bpu">${rl[m.role]||m.role}</span></td><td><button class="btn bd bsm" onclick="delTeam(${m.id})">🗑</button></td></tr>`).join('')}</table></div>`;
}
async function saveTeam(){
  const d=await api('/api/team',{method:'POST',body:JSON.stringify({name:document.getElementById('tn').value,email:document.getElementById('te').value,password:document.getElementById('tp').value,role:document.getElementById('tr').value})});
  if(d.success){toast('✅ تم');cm('mteam');ldTeam();}else toast('❌ '+(d.message||'خطأ'));
}
async function delTeam(id){if(!confirm('حذف؟')) return;await api('/api/team/'+id,{method:'DELETE'});ldTeam();}

// ============================================================
// EMERGENCY
// ============================================================
async function ldEm(){
  const d=await api('/api/emergency');const em=d.emergency||{};
  const el=document.getElementById('emst');
  el.innerHTML=em.is_active?`<div style="background:rgba(255,68,102,.08);border:2px solid rgba(255,68,102,.3);border-radius:12px;padding:16px;margin-bottom:15px"><div style="color:var(--danger);font-weight:900;margin-bottom:4px">🚨 وضع الطوارئ مفعّل</div><div style="color:var(--text2);font-size:.83rem">${esc(em.mode_type)} | ${em.stop_orders?'الطلبات موقفة':'الطلبات تعمل'}</div>${em.message?`<div style="margin-top:6px;font-size:.83rem">${esc(em.message)}</div>`:''}</div>`:'<div class="badge bgr" style="margin-bottom:13px">✅ النظام يعمل</div>';
  document.getElementById('emtype').value=em.mode_type||'emergency';
  document.getElementById('emmsg').value=em.message||'';
  document.getElementById('emso').checked=em.stop_orders||false;
  document.getElementById('emsa').checked=em.stop_ai||false;
}
async function setEm(active){
  const d=await api('/api/emergency',{method:'PUT',body:JSON.stringify({is_active:active,mode_type:document.getElementById('emtype').value,message:document.getElementById('emmsg').value,stop_orders:document.getElementById('emso').checked,stop_ai:document.getElementById('emsa').checked,end_at:document.getElementById('emend').value||null})});
  if(d.success){toast(active?'🚨 تفعيل الطوارئ':'✅ إلغاء الطوارئ');ldEm();}else toast('❌ '+(d.message||'خطأ'));
}

// ============================================================
// BACKUP
// ============================================================
async function ldBkps(){
  const d = await api('/api/backup/list');
  const list = document.getElementById('bklist');
  if (!d.backups?.length) { list.innerHTML='<div class="empty"><div class="ei">💾</div><p>لا نسخ بعد — أنشئ نسختك الأولى</p></div>'; return; }
  list.innerHTML = d.backups.map(b=>`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:11px;background:var(--surface2);border-radius:11px;margin-bottom:7px">
      <div>
        <div style="font-weight:700;font-size:.85rem;margin-bottom:3px">💾 نسخة #${b.id}</div>
        <div style="color:var(--text2);font-size:.74rem">${new Date(b.created_at).toLocaleString('ar')} — ${(b.size/1024).toFixed(1)} KB</div>
      </div>
      <div style="display:flex;gap:6px">
        <a href="/api/backup/${b.id}/download?token=${token}" class="btn ba bsm" style="text-decoration:none">⬇️ تنزيل</a>
        <button class="btn bo bsm" onclick="previewBackup(${b.id})">👁</button>
      </div>
    </div>
  `).join('');
}

async function mkBackup(){
  const btn = document.getElementById('bkbtn');
  btn.disabled = true; btn.textContent = '⏳ جاري الحفظ...';
  const d = await api('/api/backup/create',{method:'POST'});
  btn.disabled = false; btn.textContent = '💾 نسخة الآن';
  if (d.success) {
    const stats = d.stats || {};
    const summary = [
      stats.products ? `${stats.products} منتج` : '',
      stats.customers ? `${stats.customers} عميل` : '',
      stats.orders ? `${stats.orders} طلب` : '',
      stats.knowledge ? `${stats.knowledge} معرفة` : '',
      stats.decisions ? `${stats.decisions} قرار` : '',
      stats.corrections ? `${stats.corrections} تصحيح` : ''
    ].filter(Boolean).join(' · ');
    toast('✅ تم حفظ النسخة' + (summary ? ': ' + summary : ''));
    ldBkps();
  } else toast('❌ '+(d.message||'خطأ'));
}

async function previewBackup(id){
  const r = await fetch(`/api/backup/${id}/download`, { headers:{ Authorization: 'Bearer '+token } });
  const data = await r.json();
  const stats = data.stats || {};
  const s = data.sections || data;
  toast(`نسخة ${new Date(data.timestamp).toLocaleDateString('ar')}: ${Object.entries(stats).map(([k,v])=>v+' '+k).join(' · ')}`);
}

// استيراد نسخة
let bkFileData = null;
function loadBkFile(input){
  const file = input.files[0];
  if (!file) return;
  document.getElementById('bk-file-name').textContent = file.name;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      bkFileData = JSON.parse(e.target.result);
      document.getElementById('bk-restore-btn').disabled = false;
      // عرض محتوى النسخة
      const stats = bkFileData.stats || {};
      const s = bkFileData.sections || bkFileData;
      const info = [
        s.products?.length ? `📦 ${s.products.length} منتج` : '',
        s.customers?.length ? `👥 ${s.customers.length} عميل` : '',
        s.orders?.length ? `🛒 ${s.orders.length} طلب` : '',
        s.knowledge_base?.length ? `📚 ${s.knowledge_base.length} معرفة` : '',
        s.decision_memory?.length ? `🗂️ ${s.decision_memory.length} قرار` : '',
        s.training_corrections?.length ? `✏️ ${s.training_corrections.length} تصحيح` : ''
      ].filter(Boolean).join(' · ');
      const res = document.getElementById('bk-restore-result');
      res.style.display = 'block';
      res.innerHTML = `<div style="font-weight:700;margin-bottom:4px">✅ ملف صالح — ${new Date(bkFileData.timestamp||Date.now()).toLocaleDateString('ar')}</div><div style="color:var(--text2)">${info||'نسخة فارغة'}</div>`;
    } catch(e) {
      toast('❌ ملف غير صالح');
      document.getElementById('bk-file-name').textContent = 'اضغط لاختيار ملف النسخة (.json)';
    }
  };
  reader.readAsText(file);
}

async function restoreBackup(){
  if (!bkFileData) return toast('⚠️ اختر ملف نسخة أولاً');
  if (!confirm('⚠️ هذا سيضيف البيانات للحساب الحالي. هل أنت متأكد؟')) return;

  // جمع الأقسام المختارة
  const sections = [];
  if (document.getElementById('bkr-bp')?.checked) sections.push('business_profile');
  if (document.getElementById('bkr-emp')?.checked) sections.push('digital_employee');
  if (document.getElementById('bkr-kb')?.checked) sections.push('knowledge_base');
  if (document.getElementById('bkr-dec')?.checked) sections.push('decision_memory');
  if (document.getElementById('bkr-cor')?.checked) sections.push('training_corrections');
  if (document.getElementById('bkr-prod')?.checked) sections.push('products');

  if (!sections.length) return toast('⚠️ اختر قسماً واحداً على الأقل');

  const btn = document.getElementById('bk-restore-btn');
  btn.disabled = true; btn.textContent = '⏳ جاري الاستيراد...';
  const d = await api('/api/backup/restore',{method:'POST',body:JSON.stringify({ backup_data: bkFileData, sections })});
  btn.disabled = false; btn.textContent = '📥 استيراد النسخة';

  if (d.success) {
    const res = document.getElementById('bk-restore-result');
    res.style.display = 'block';
    res.innerHTML = `<div style="color:var(--green);font-weight:700">✅ ${esc(d.message)}</div>`;
    toast('✅ تم الاستيراد بنجاح');
    bkFileData = null;
  } else toast('❌ '+(d.message||'خطأ'));
}

// ============================================================
// SECURITY
// ============================================================
async function ldSec(){
  const[st,logs]=await Promise.all([api('/api/security/status'),api('/api/security/audit-log')]);
  const sec=st.security||{};
  document.getElementById('secst').innerHTML=`<div style="display:flex;flex-direction:column;gap:7px"><div style="display:flex;justify-content:space-between"><span>Rate Limiting</span><span class="badge bgr">✅</span></div><div style="display:flex;justify-content:space-between"><span>JWT Auth</span><span class="badge bgr">✅</span></div><div style="display:flex;justify-content:space-between"><span>Bcrypt</span><span class="badge bgr">✅</span></div><div style="display:flex;justify-content:space-between"><span>IPs محظورة</span><span class="badge ${sec.blocked_ips>0?'brd':'bgr'}">${sec.blocked_ips||0}</span></div></div>`;
  const ll=document.getElementById('auditl');const ld=logs.logs||[];
  if(!ld.length){ll.innerHTML='<div class="empty"><div class="ei">📋</div><p>لا سجلات</p></div>';return;}
  ll.innerHTML=`<div class="tw"><table><tr><th>العملية</th><th>النوع</th><th>التاريخ</th></tr>${ld.map(l=>`<tr><td>${esc(l.action)}</td><td>${esc(l.entity)}</td><td style="color:var(--text2);font-size:.76rem">${new Date(l.created_at).toLocaleString('ar')}</td></tr>`).join('')}</table></div>`;
}
async function chgPass(){
  const o=document.getElementById('op').value,n=document.getElementById('np').value;
  if(!o||!n) return toast('⚠️ أدخل كلا الحقلين');
  const d=await api('/api/auth/change-password',{method:'POST',body:JSON.stringify({current_password:o,new_password:n})});
  if(d.success){toast('✅ تم التغيير');document.getElementById('op').value='';document.getElementById('np').value='';}else toast('❌ '+(d.message||'خطأ'));
}

// ============================================================
// SETTINGS
// ============================================================
async function ldSets(){
  const d = await api('/api/business/profile');
  const p = d.profile||{};
  document.getElementById('sn').value = p.store_name||'';
  document.getElementById('st').value = p.business_type||'';
  document.getElementById('sd').value = p.business_desc||'';
  document.getElementById('sau').value = p.target_audience||'';
  document.getElementById('sl').value = p.location||'';
  document.getElementById('sc').value = p.currency||'IQD';
  document.getElementById('sw').value = p.whatsapp_number||'';
  document.getElementById('sst').value = p.communication_style||'ودي وقريب';
  document.getElementById('sp2').value = p.policies||'';
  biz = p;
  // تحميل سياسة العربون
  ldDepositPolicy();
}

async function saveSets(){
  const d = await api('/api/business/profile',{method:'PUT',body:JSON.stringify({
    store_name:document.getElementById('sn').value,
    business_type:document.getElementById('st').value,
    business_desc:document.getElementById('sd').value,
    target_audience:document.getElementById('sau').value,
    location:document.getElementById('sl').value,
    currency:document.getElementById('sc').value,
    whatsapp_number:document.getElementById('sw').value,
    communication_style:document.getElementById('sst').value,
    policies:document.getElementById('sp2').value,
    onboarding_done:true
  })});
  if (d.success) { toast('✅ تم الحفظ'); biz=d.profile||biz; }
  else toast('❌ '+(d.message||'خطأ'));
}

// ============================================================
// DEPOSIT POLICY — سياسة العربون
// ============================================================
let depositPolicyCache = null;

async function ldDepositPolicy(){
  const d = await api('/api/deposit/policy');
  const p = d.policy || {};
  depositPolicyCache = p;
  const polEl = document.getElementById('dep-policy');
  const valEl = document.getElementById('dep-value');
  const reqEl = document.getElementById('dep-required');
  const noteEl = document.getElementById('dep-note');
  if (polEl) polEl.value = p.deposit_policy || 'none';
  if (valEl) valEl.value = p.deposit_value || 0;
  if (reqEl) reqEl.checked = p.deposit_required || false;
  if (noteEl) noteEl.value = p.deposit_note || '';
  updateDepositPreview();
}

function updateDepositPreview(){
  const policy = document.getElementById('dep-policy')?.value || 'none';
  const value = parseFloat(document.getElementById('dep-value')?.value) || 0;
  const required = document.getElementById('dep-required')?.checked || false;
  const prv = document.getElementById('dep-preview');
  const valWrap = document.getElementById('dep-val-wrap');
  const valLabel = document.getElementById('dep-val-label');
  const unit = document.getElementById('dep-unit');
  if (!prv) return;

  if (valWrap) valWrap.style.display = policy === 'none' ? 'none' : 'block';

  if (policy === 'percent') {
    if (valLabel) valLabel.textContent = 'النسبة المئوية';
    if (unit) unit.textContent = '%';
  } else {
    if (valLabel) valLabel.textContent = 'المبلغ الثابت';
    if (unit) unit.textContent = biz?.currency || 'د.ع';
  }

  if (policy === 'none') {
    prv.innerHTML = '<div style="text-align:center;padding:14px;color:var(--green);font-size:.84rem">✅ لا عربون — العميل يدفع المبلغ كاملاً عند الاستلام</div>';
    return;
  }

  // مثال بمبلغ افتراضي 100000
  const example = 100000;
  let dep = 0;
  if (policy === 'fixed') dep = Math.min(value, example);
  else if (policy === 'percent') dep = example * value / 100;

  prv.innerHTML = `
    <div style="font-size:.74rem;color:var(--text2);margin-bottom:8px">مثال: طلب بقيمة 100,000</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:9px">
      <div style="background:var(--surface);border-radius:9px;padding:9px;text-align:center">
        <div style="font-size:.68rem;color:var(--text2);margin-bottom:3px">العربون</div>
        <div style="font-weight:900;color:var(--accent3)">${dep.toLocaleString('ar-IQ')}</div>
      </div>
      <div style="background:var(--surface);border-radius:9px;padding:9px;text-align:center">
        <div style="font-size:.68rem;color:var(--text2);margin-bottom:3px">المتبقي</div>
        <div style="font-weight:900">${(example-dep).toLocaleString('ar-IQ')}</div>
      </div>
    </div>
    ${required ? '<div style="font-size:.74rem;color:var(--danger);margin-bottom:5px">⚠️ العربون إلزامي</div>' : ''}
    <div style="font-size:.74rem;color:var(--text2)">${policy === 'fixed' ? 'مبلغ ثابت: '+value.toLocaleString() : 'نسبة: '+value+'%'}</div>
  `;
}

async function saveDepositPolicy(){
  const d = await api('/api/deposit/policy',{method:'PUT',body:JSON.stringify({
    deposit_policy: document.getElementById('dep-policy')?.value || 'none',
    deposit_value: parseFloat(document.getElementById('dep-value')?.value) || 0,
    deposit_required: document.getElementById('dep-required')?.checked || false,
    deposit_note: document.getElementById('dep-note')?.value || ''
  })});
  if (d.success) {
    toast('✅ تم حفظ سياسة العربون');
    depositPolicyCache = null;
  } else toast('❌ '+(d.message||'خطأ'));
}

// حساب العربون تلقائياً عند إدخال المبلغ في modal الطلب
async function autoCalcDeposit(){
  const total = parseFloat(document.getElementById('otot')?.value) || 0;
  if (!total) { document.getElementById('deposit-auto-wrap').style.display='none'; return; }

  const d = await api('/api/deposit/calculate',{method:'POST',body:JSON.stringify({total})});
  const wrap = document.getElementById('deposit-auto-wrap');
  if (!d.success || d.policy === 'none') { if(wrap) wrap.style.display='none'; return; }

  if (wrap) wrap.style.display = 'block';
  const cur = biz?.currency || 'د.ع';
  document.getElementById('deposit-calc-amount').textContent = Number(d.deposit).toLocaleString('ar-IQ') + ' ' + cur;
  document.getElementById('deposit-calc-remaining').textContent = Number(d.remaining).toLocaleString('ar-IQ') + ' ' + cur;

  const badge = document.getElementById('deposit-policy-badge');
  if (badge) badge.textContent = d.policy === 'fixed' ? 'مبلغ ثابت' : 'نسبة مئوية';

  const note = document.getElementById('deposit-policy-note');
  if (note && d.note) { note.textContent = '📝 '+d.note; note.style.display='block'; }

  // تعبئة حقل العربون تلقائياً
  const depEl = document.getElementById('odep');
  if (depEl && !depEl.value) depEl.value = d.deposit;
}

// ============================================================
// NOTIFICATIONS
// ============================================================
async function ldNotifs(){
  const d=await api('/api/notifications');const list=document.getElementById('nlist');const ns=d.notifications||[];
  if(!ns.length){list.innerHTML='<div class="empty"><div class="ei">🔔</div><p>لا إشعارات</p></div>';return;}
  const ico={order:'🛒',inventory:'📦',stock:'⚠️',employee:'🧠',tip:'💡',payment:'💳',weekly_report:'📊',info:'ℹ️'};
  list.innerHTML=ns.map(n=>`<div style="display:flex;gap:9px;padding:11px 0;border-bottom:1px solid var(--border);opacity:${n.is_read?.8:1}"><div style="font-size:1.3rem">${ico[n.type]||'🔔'}</div><div style="flex:1"><div style="font-weight:700;font-size:.86rem">${esc(n.title)}</div><div style="color:var(--text2);font-size:.8rem;margin-top:2px">${esc(n.message)}</div><div style="color:var(--text2);font-size:.72rem;margin-top:3px">${new Date(n.created_at).toLocaleString('ar')}</div></div>${!n.is_read?'<div style="width:6px;height:6px;border-radius:50%;background:var(--accent);margin-top:5px;flex-shrink:0"></div>':''}</div>`).join('');
}
async function mrkRead(){await api('/api/notifications/read',{method:'PUT'});ldNotifs();document.getElementById('nbc').style.display='none';}

// ============================================================
// PROFILE
// ============================================================
async function ldProf(){
  const d=await api('/api/profile');
  document.getElementById('pfn').value=d.name||'';
  document.getElementById('pfe').value=d.email||'';
  document.getElementById('pfa').value=d.avatar_url||'';
}
async function saveProf(){
  const d=await api('/api/profile',{method:'PUT',body:JSON.stringify({name:document.getElementById('pfn').value,avatar_url:document.getElementById('pfa').value})});
  if(d.success) toast('✅ تم');else toast('❌ خطأ');
}

// ============================================================
// SOCIAL ACCOUNTS — ربط حسابات التواصل الاجتماعي
// ============================================================
// ============================================================
// COMMENTS — تعليقات الصفحة
// ============================================================
let currentCommentPostId = null;

async function ldCommentsPosts() {
  const el = document.getElementById('comments-posts-list');
  el.innerHTML = '<div class="empty"><div class="ei">⏳</div><p>جاري التحميل...</p></div>';
  const d = await api('/api/comments/posts');
  if (!d.success) {
    el.innerHTML = `<div class="empty"><div class="ei">⚠️</div><p>${esc(d.message||'خطأ')}</p><button class="btn ba bsm" onclick="sp('social',null)" style="margin-top:10px">ربط Facebook</button></div>`;
    return;
  }
  if (!d.posts?.length) {
    el.innerHTML = '<div class="empty"><div class="ei">📝</div><p>لا توجد منشورات</p></div>';
    return;
  }
  el.innerHTML = d.posts.map(p => {
    const cnt = p.comments?.summary?.total_count || 0;
    const msg = p.message ? (p.message.length > 60 ? p.message.slice(0,60)+'...' : p.message) : '(منشور بدون نص)';
    const date = p.created_time ? new Date(p.created_time).toLocaleDateString('ar-IQ') : '';
    return `<div class="card" style="margin-bottom:8px;cursor:pointer;border:2px solid transparent;transition:.2s" id="cp-${esc(p.id)}" onclick="ldComments('${esc(p.id)}','${esc(msg)}',this)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:.85rem;flex:1">${esc(msg)}</div>
        <div style="background:var(--accent);color:#fff;border-radius:20px;padding:2px 10px;font-size:.75rem;font-weight:700;margin-right:8px;flex-shrink:0">${cnt} 💬</div>
      </div>
      <div style="font-size:.72rem;color:var(--text2);margin-top:4px">${date}</div>
    </div>`;
  }).join('');
}

async function ldComments(postId, title, el) {
  if (!postId) return;
  currentCommentPostId = postId;
  // تمييز المنشور المختار
  document.querySelectorAll('[id^="cp-"]').forEach(e => e.style.borderColor = 'transparent');
  if (el) el.style.borderColor = 'var(--accent)';
  document.getElementById('comments-refresh-btn').style.display = '';
  if (title) document.getElementById('comments-post-title').textContent = title;

  const list = document.getElementById('comments-list');
  list.innerHTML = '<div class="empty"><div class="ei">⏳</div><p>جاري تحميل التعليقات...</p></div>';

  const d = await api(`/api/comments/post/${encodeURIComponent(postId)}`);
  if (!d.success) {
    list.innerHTML = `<div class="empty"><div class="ei">⚠️</div><p>${esc(d.message||'خطأ')}</p></div>`;
    return;
  }
  if (!d.comments?.length) {
    list.innerHTML = '<div class="empty"><div class="ei">💬</div><p>لا توجد تعليقات على هذا المنشور</p></div>';
    return;
  }
  list.innerHTML = d.comments.map(c => {
    const name = c.from?.name || 'مجهول';
    const date = c.created_time ? new Date(c.created_time).toLocaleString('ar-IQ') : '';
    return `<div class="card" style="margin-bottom:10px" id="comment-${esc(c.id)}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div>
          <span style="font-weight:700;font-size:.85rem">${esc(name)}</span>
          <span style="color:var(--text2);font-size:.72rem;margin-right:8px">${date}</span>
        </div>
        <button onclick="deleteComment('${esc(c.id)}')" style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:.8rem;padding:2px 6px" title="حذف">🗑️</button>
      </div>
      <p style="font-size:.875rem;margin-bottom:10px;line-height:1.6">${esc(c.message||'')}</p>
      <div style="display:flex;gap:7px;align-items:center">
        <input class="fi" id="reply-${esc(c.id)}" placeholder="اكتب ردك هنا..." style="flex:1;padding:8px;font-size:.82rem">
        <button class="btn ba bsm" onclick="replyComment('${esc(c.id)}')" style="padding:8px 14px;flex-shrink:0">↩️ رد</button>
      </div>
    </div>`;
  }).join('');
}

async function replyComment(commentId) {
  const inp = document.getElementById('reply-'+commentId);
  const msg = inp?.value?.trim();
  if (!msg) return toast('⚠️ اكتب ردك أولاً');
  const btn = inp.nextElementSibling;
  btn.disabled = true; btn.textContent = '⏳';
  const d = await api('/api/comments/reply', 'POST', { comment_id: commentId, message: msg });
  btn.disabled = false; btn.textContent = '↩️ رد';
  if (d.success) { toast('✅ تم الرد بنجاح'); inp.value = ''; }
  else toast('❌ '+( d.message||'فشل الرد'));
}

async function deleteComment(commentId) {
  if (!confirm('هل تريد حذف هذا التعليق؟')) return;
  const d = await api(`/api/comments/${encodeURIComponent(commentId)}`, 'DELETE');
  if (d.success) {
    document.getElementById('comment-'+commentId)?.remove();
    toast('✅ تم حذف التعليق');
  } else toast('❌ '+(d.message||'فشل الحذف'));
}

// ============================================================
// INVOICES — الفواتير
// ============================================================
let invItems = [], invFilter = 'all', invReceiptBase64 = null;

// صورة الوصل
function loadReceiptImage(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) return toast('⚠️ الصورة أكبر من 5MB');
  const reader = new FileReader();
  reader.onload = function() {
    invReceiptBase64 = this.result;
    const img = document.getElementById('inv-receipt-img');
    const preview = document.getElementById('inv-receipt-preview');
    const clearBtn = document.getElementById('inv-receipt-clear');
    if (img) {
      img.src = this.result;
      img.style.display = 'block';
      img.style.width = '100%';
      img.style.maxHeight = '200px';
      img.style.borderRadius = '8px';
      img.style.marginTop = '8px';
      img.style.border = '2px solid #5b6af0';
    }
    if (preview) preview.style.display = 'block';
    if (clearBtn) clearBtn.style.display = 'inline-block';
    toast('✅ تم تحميل صورة الوصل');
  };
  reader.readAsDataURL(file);
}

function clearReceiptImage() {
  invReceiptBase64 = null;
  const img = document.getElementById('inv-receipt-img');
  const clearBtn = document.getElementById('inv-receipt-clear');
  const input = document.getElementById('inv-receipt-input');
  if (img) { img.removeAttribute('src'); img.style.display = 'none'; }
  if (clearBtn) clearBtn.style.display = 'none';
  if (input) input.value = '';
}


async function saveInvoice(print = false) {
  const cname = document.getElementById('inv-cname')?.value.trim();
  const details = document.getElementById('inv-details')?.value.trim();
  const gv = id => parseInt((document.getElementById(id)?.dataset?.raw || String(document.getElementById(id)?.value||'0')).replace(/[^0-9]/g,''))||0;
  const total = gv('inv-total-calc');
  if (!cname) return toast('⚠️ اسم الزبون مطلوب');
  if (!details) return toast('⚠️ تفاصيل الطلب مطلوبة');
  if (total <= 0) return toast('⚠️ السعر الكلي يجب أن يكون أكبر من صفر');
  const deposit = gv('inv-deposit');
  const delivery = gv('inv-delivery');
  const body = {
    customer_name: cname,
    customer_phone: document.getElementById('inv-cphone')?.value.trim(),
    customer_address: document.getElementById('inv-address')?.value.trim(),
    items: [{ description: details, qty: 1, price: total }],
    total,
    tax_rate: 0,
    discount: 0,
    deposit,
    delivery_cost: delivery,
    order_details: details,
    receipt_image: invReceiptBase64 || null,
    notes: document.getElementById('inv-notes')?.value.trim(),
    due_date: document.getElementById('inv-duedate')?.value || null,
    currency: document.getElementById('inv-currency')?.value || 'IQD'
  };
  const d = await api('/api/invoices', { method: 'POST', body: JSON.stringify(body) });
  if (d.success) {
    toast('✅ تم حفظ الفاتورة ' + (d.invoice?.invoice_number || ''));
    cm('minvoice');
    invReceiptBase64 = null;
    clearReceiptImage();
    ['inv-cname','inv-cphone','inv-details','inv-notes','inv-duedate'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    ['inv-total-calc','inv-deposit','inv-delivery'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.value = ''; el.dataset.raw = ''; }
    });
    calcInvRemaining();
    ldInvoices();
    if (print) printInvoice(d.invoice);
  } else toast('❌ ' + (d.message || 'خطأ في الحفظ'));
}

function initInvFields() {
  ['inv-total-calc','inv-delivery','inv-deposit'].forEach(id => {
    const el = document.getElementById(id);
    if (!el || el.dataset.priceInit) return;
    el.dataset.priceInit = '1';
    el.addEventListener('input', function() {
      const raw = this.value.replace(/[^0-9]/g, '');
      this.dataset.raw = raw;
      if (raw.length > 0) this.value = parseInt(raw).toLocaleString('en');
      calcInvRemaining();
    });
    el.addEventListener('blur', function() {
      const raw = this.dataset.raw || this.value.replace(/[^0-9]/g,'');
      if (raw && parseInt(raw) > 0) {
        const cur = document.getElementById('inv-currency')?.value||'IQD';
        const sym = {IQD:'د.ع',SAR:'ر.س',AED:'د.إ',USD:'$'}[cur]||cur;
        this.value = parseInt(raw).toLocaleString('en') + ' ' + sym;
      }
    });
    el.addEventListener('focus', function() {
      const raw = this.dataset.raw || this.value.replace(/[^0-9]/g,'');
      this.value = raw === '0' ? '' : (raw || '');
    });
  });
}


// calcInvRemaining already defined above

function calcInvRemaining() {
  const gv = id => {
    const el = document.getElementById(id);
    if (!el) return 0;
    return parseInt((el.dataset.raw || el.value).replace(/[^0-9]/g,'')) || 0;
  };
  const grand = gv('inv-total-calc') + gv('inv-delivery');
  const remaining = Math.max(0, grand - gv('inv-deposit'));
  const cur = document.getElementById('inv-currency')?.value || 'IQD';
  const sym = {IQD:'د.ع',SAR:'ر.س',AED:'د.إ',USD:'$',KWD:'د.ك'}[cur] || cur;
  const fmt = n => n > 0 ? n.toLocaleString('en') + ' ' + sym : '0';
  const remEl = document.getElementById('inv-remaining');
  if (remEl) remEl.textContent = fmt(remaining);
  const gtEl = document.getElementById('inv-grand-total');
  if (gtEl) gtEl.textContent = fmt(grand);
}

function saveAndPrintInvoice() { saveInvoice(true); }

function printInvoice(inv) {
  const cur = inv.currency || 'IQD';
  const fmt = n => parseFloat(n||0).toLocaleString('ar-IQ') + ' ' + cur;
  const items = (typeof inv.items === 'string' ? JSON.parse(inv.items) : inv.items) || [];
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>فاتورة ${esc(inv.invoice_number)}</title>
  <style>body{font-family:'Tajawal',Arial,sans-serif;padding:30px;color:#111;direction:rtl}
  h1{font-size:1.4rem;margin:0}table{width:100%;border-collapse:collapse;margin:14px 0}
  th,td{border:1px solid #ddd;padding:8px;text-align:right}th{background:#f5f5f5}
  .total{font-weight:700;font-size:1.1rem}.logo{font-size:1.8rem;font-weight:900;color:#4f8ef7}
  .meta{color:#666;font-size:.85rem}.footer{margin-top:20px;text-align:center;color:#aaa;font-size:.75rem}
  @media print{button{display:none}}</style></head><body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;border-bottom:2px solid #4f8ef7;padding-bottom:14px">
    <div><div class="logo">SocialOS</div><div class="meta">نظام إدارة الأعمال</div></div>
    <div style="text-align:left"><h1>فاتورة</h1><div class="meta">${esc(inv.invoice_number)}</div>
    <div class="meta">${new Date(inv.created_at).toLocaleDateString('ar-IQ')}</div></div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:16px">
    <div><b>بيانات العميل:</b><br>${esc(inv.customer_name)}<br>${inv.customer_phone?esc(inv.customer_phone)+'<br>':''} ${inv.customer_address?esc(inv.customer_address):''}</div>
    ${inv.due_date?`<div style="text-align:left"><b>تاريخ الاستحقاق:</b><br>${new Date(inv.due_date).toLocaleDateString('ar-IQ')}</div>`:''}
  </div>
  <table><thead><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>المجموع</th></tr></thead><tbody>
  ${items.map(i=>`<tr><td>${esc(i.name)}</td><td>${i.qty}</td><td>${fmt(i.price)}</td><td>${fmt(i.price*i.qty)}</td></tr>`).join('')}
  </tbody></table>
  <div style="text-align:left;width:280px;margin-right:auto">
    <div style="display:flex;justify-content:space-between;padding:4px 0"><span>المجموع الفرعي:</span><span>${fmt(inv.subtotal)}</span></div>
    ${inv.tax_rate>0?`<div style="display:flex;justify-content:space-between;padding:4px 0"><span>ضريبة (${inv.tax_rate}%):</span><span>${fmt(inv.tax_amount)}</span></div>`:''}
    ${inv.discount>0?`<div style="display:flex;justify-content:space-between;padding:4px 0"><span>خصم:</span><span>- ${fmt(inv.discount)}</span></div>`:''}
    <div class="total" style="display:flex;justify-content:space-between;padding:8px 0;border-top:2px solid #4f8ef7;margin-top:6px"><span>الإجمالي:</span><span>${fmt(inv.total)}</span></div>
  </div>
  ${inv.notes?`<div style="margin-top:14px;padding:10px;background:#f9f9f9;border-radius:8px"><b>ملاحظات:</b> ${esc(inv.notes)}</div>`:''}
  <div class="footer">شكراً لتعاملكم معنا • SocialOS</div>
  <div style="text-align:center;margin-top:16px"><button onclick="window.print()" style="padding:10px 24px;background:#4f8ef7;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:1rem">🖨️ طباعة</button></div>
  </body></html>`);
  w.document.close();
}

async function ldInvoices() {
  const el = document.getElementById('invoices-list');
  if (!el) return;
  const d = await api('/api/invoices');
  if (!d.success) { el.innerHTML = `<div class="empty"><p>${esc(d.message||'خطأ')}</p></div>`; return; }
  const all = d.invoices || [];
  // إحصائيات
  document.getElementById('inv-total').textContent = all.length;
  document.getElementById('inv-paid').textContent = all.filter(i=>i.status==='paid').length;
  document.getElementById('inv-pending').textContent = all.filter(i=>i.status==='sent'||i.status==='draft').length;
  const totalAmt = all.reduce((s,i)=>s+parseFloat(i.total||0),0);
  document.getElementById('inv-amount').textContent = totalAmt.toLocaleString('ar-IQ');
  const filtered = invFilter === 'all' ? all : all.filter(i=>i.status===invFilter);
  if (!filtered.length) { el.innerHTML = '<div class="empty"><div class="ei">🧾</div><p>لا فواتير</p></div>'; return; }
  const statusMap = {draft:'📝 مسودة',sent:'📤 مرسلة',paid:'✅ مدفوعة',cancelled:'❌ ملغاة'};
  const statusColor = {draft:'var(--text2)',sent:'var(--accent)',paid:'var(--green)',cancelled:'var(--danger)'};
  el.innerHTML = filtered.map(inv => {
    const items = (typeof inv.items === 'string' ? JSON.parse(inv.items||'[]') : inv.items)||[];
    return `<div class="card" style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-weight:700;font-size:.9rem">${esc(inv.invoice_number)}</div>
          <div style="font-size:.82rem;color:var(--text2)">${esc(inv.customer_name)} ${inv.customer_phone?'• '+esc(inv.customer_phone):''}</div>
          <div style="font-size:.78rem;color:var(--text2)">${new Date(inv.created_at).toLocaleDateString('ar-IQ')} • ${items.length} منتج</div>
        </div>
        <div style="text-align:left">
          <div style="font-weight:700;color:var(--accent)">${parseFloat(inv.total||0).toLocaleString('ar-IQ')} ${inv.currency}</div>
          <div style="font-size:.75rem;color:${statusColor[inv.status]||'var(--text2)'}">${statusMap[inv.status]||inv.status}</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
        <button class="btn bo bsm" onclick="printInvoice(${JSON.stringify(inv).replace(/"/g,'&quot;')})">🖨️ طباعة</button>
        <button class="btn bo bsm" onclick="changeInvStatus('${inv.id}','paid')">✅ مدفوعة</button>
        <button class="btn bo bsm" onclick="changeInvStatus('${inv.id}','sent')">📤 مرسلة</button>
        <button class="btn bd bsm" onclick="deleteInvoice('${inv.id}')">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

function filterInvoices(f, btn) {
  invFilter = f;
  document.querySelectorAll('#page-invoices .fb').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  ldInvoices();
}

async function changeInvStatus(id, status) {
  const d = await api(`/api/invoices/${id}`, 'PUT', { status });
  if (d.success) { toast('✅ تم تحديث الحالة'); ldInvoices(); }
  else toast('❌ ' + (d.message||'خطأ'));
}

async function deleteInvoice(id) {
  if (!confirm('حذف الفاتورة؟')) return;
  const d = await api(`/api/invoices/${id}`, 'DELETE');
  if (d.success) { toast('✅ تم الحذف'); ldInvoices(); }
  else toast('❌ ' + (d.message||'خطأ'));
}

// ============================================================
// VOICE TRAINING — الصوت في التدريب
// ============================================================
let mediaRecorder = null, audioChunks = [], isRecording = false;

async function toggleVoiceMode() {
  voiceMode = !voiceMode;
  const btn = document.getElementById('voice-mode-btn');
  if (btn) btn.textContent = voiceMode ? '🎙️ وضع الصوت: تشغيل' : '🎤 وضع الصوت: إيقاف';
  toast(voiceMode ? '🎙️ وضع الصوت مفعّل — اضغط المايك للكلام' : '🔇 وضع الصوت متوقف');
}

async function startVoiceRecord() {
  if (isRecording) return stopVoiceRecord();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = processVoiceInput;
    mediaRecorder.start();
    isRecording = true;
    const btn = document.getElementById('voice-rec-btn');
    if (btn) { btn.textContent = '⏹️ إيقاف'; btn.style.background = 'var(--danger)'; }
    toast('🔴 التسجيل جارٍ...');
  } catch(e) { toast('❌ لا يمكن الوصول للمايك: ' + e.message); }
}

function stopVoiceRecord() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
    isRecording = false;
    const btn = document.getElementById('voice-rec-btn');
    if (btn) { btn.textContent = '🎤 تحدث'; btn.style.background = ''; }
  }
}

async function processVoiceInput() {
  const blob = new Blob(audioChunks, { type: 'audio/webm' });
  const reader = new FileReader();
  reader.onloadend = async () => {
    const base64 = reader.result.split(',')[1];
    toast('⏳ جاري تحويل الصوت...');
    const d = await api('/api/voice/transcribe', {
      method: 'POST',
      body: JSON.stringify({ audio_base64: base64, mime_type: 'audio/webm' })
    });
    if (d.success && d.text) {
      toast('✅ ' + d.text.substring(0, 40));
      // إرسال للمكان الصحيح حسب الصفحة الحالية
      const mikeInput = document.getElementById('mike-command-input');
      const trainInput = document.getElementById('tinput');
      if (mikeInput && document.getElementById('page-digital-team')?.classList.contains('active')) {
        mikeInput.value = d.text;
        if (typeof mikeSendCommand === 'function') await mikeSendCommand();
      } else if (mikeInput && document.getElementById('mike-chat-msgs')) {
        mikeInput.value = d.text;
        if (typeof mikeSendCommand === 'function') await mikeSendCommand();
      } else if (trainInput) {
        trainInput.value = d.text;
        if (typeof sendTrain === 'function') await sendTrain();
      }
    } else toast('❌ ' + (d.message || 'فشل التعرف على الصوت'));
  };
  reader.readAsDataURL(blob);
}

async function speakResponse(text, force = false) {
  if ((!voiceMode && !force) || !text) return;
  try {
    const d = await api('/api/voice/speak', { method: 'POST', body: JSON.stringify({ text: text.substring(0, 500) }) });
    if (d.success && d.audio_base64) {
      const audio = new Audio(`data:${d.mime_type || 'audio/mp3'};base64,${d.audio_base64}`);
      audio.play().catch(() => {});
    }
  } catch(e) {}
}

