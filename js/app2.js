// ============================================================
// DELIVERY — شركات التوصيل وتتبع الشحنات
// ============================================================
let deliveryCompanies = [];

async function ldDelivery() {
  // إحصائيات
  const [allOrds, shippedOrds, deliveredOrds, companies] = await Promise.all([
    api('/api/orders?status=confirmed'),
    api('/api/orders?status=shipped'),
    api('/api/orders?status=delivered'),
    api('/api/delivery/companies')
  ]);

  // إحصائيات
  const pending = (allOrds.orders||[]).filter(o => !o.delivery_company).length + (allOrds.orders||[]).filter(o=>o.delivery_company).length;
  document.getElementById('del-total').textContent = (shippedOrds.orders||[]).length;
  document.getElementById('del-pending').textContent = (allOrds.orders||[]).length;
  document.getElementById('del-done').textContent = (deliveredOrds.orders||[]).length;

  // حفظ الشركات للاستخدام لاحقاً
  deliveryCompanies = companies.companies || [];

  // طلبات بانتظار الشحن (confirmed + processing)
  const [conf, proc] = await Promise.all([
    api('/api/orders?status=confirmed'),
    api('/api/orders?status=processing')
  ]);
  const pendingOrders = [...(conf.orders||[]), ...(proc.orders||[])];
  const list = document.getElementById('del-orders-list');

  if (!pendingOrders.length) {
    list.innerHTML = '<div class="empty"><div class="ei">📦</div><p>لا طلبات بانتظار الشحن</p></div>';
  } else {
    list.innerHTML = `<div class="tw"><table><tr><th>#</th><th>العميل</th><th>الهاتف</th><th>المبلغ</th><th>الحالة</th><th>إجراءات</th></tr>${pendingOrders.map(o=>`
      <tr>
        <td style="font-family:monospace;color:var(--text2)">#${o.id}</td>
        <td>${esc(o.customer_name)}</td>
        <td dir="ltr" style="color:var(--text2);font-size:.8rem">${esc(o.customer_phone)}</td>
        <td style="font-weight:700">${Number(o.total||0).toLocaleString()}</td>
        <td>${o.delivery_company ? `<span class="badge bbl">${esc(o.delivery_company)}</span>` : '<span class="badge bor">لم يُشحن</span>'}</td>
        <td><button class="btn ba bsm" onclick="openShipModal(${o.id},'${esc(o.customer_name)}','${esc(o.customer_phone)}',${o.total})">🚚 شحن</button></td>
      </tr>`).join('')}</table></div>`;
  }

  // بطاقات الشركات
  const co = document.getElementById('del-companies');
  co.innerHTML = deliveryCompanies.map(c => `
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:11px;padding:13px;text-align:center;cursor:pointer" onclick="copyText('${esc(c.name)}')">
      <div style="font-size:1.6rem;margin-bottom:6px">${c.icon}</div>
      <div style="font-weight:700;font-size:.82rem">${esc(c.name)}</div>
      ${c.tracking_url ? `<div style="font-size:.68rem;color:var(--green);margin-top:3px">🔗 تتبع متاح</div>` : '<div style="font-size:.68rem;color:var(--text2);margin-top:3px">لا تتبع</div>'}
      ${c.custom ? `<div class="badge bpu" style="font-size:.62rem;margin-top:5px">مخصصة</div>` : ''}
    </div>
  `).join('');
}

function openShipModal(orderId, customerName, customerPhone, total) {
  document.getElementById('ship-order-id').value = orderId;
  document.getElementById('ship-order-info').innerHTML = `
    <div style="display:flex;justify-content:space-between">
      <span>👤 ${esc(customerName)}</span>
      <span style="font-weight:700;color:var(--accent)">${Number(total||0).toLocaleString()}</span>
    </div>
    <div style="color:var(--text2);font-size:.76rem;margin-top:3px">📱 ${esc(customerPhone)}</div>
  `;

  // تعبئة قائمة الشركات
  const sel = document.getElementById('ship-company');
  sel.innerHTML = deliveryCompanies.map(c => `<option value="${esc(c.id)}">${c.icon} ${esc(c.name)}</option>`).join('');

  document.getElementById('ship-wa-wrap').style.display = 'block';
  document.getElementById('ship-tracking').value = '';
  om('mship');
}

async function saveShipping() {
  const orderId = document.getElementById('ship-order-id').value;
  const companyId = document.getElementById('ship-company').value;
  const tracking = document.getElementById('ship-tracking').value.trim();
  const status = document.getElementById('ship-status').value;
  if (!companyId) return toast('⚠️ اختر شركة التوصيل');
  const company = deliveryCompanies.find(c => c.id === companyId);
  const d = await api(`/api/delivery/orders/${orderId}`, {
    method: 'PUT',
    body: JSON.stringify({ delivery_company: company?.name || companyId, tracking_number: tracking, status })
  });
  if (d.success) {
    toast('✅ تم تحديث معلومات الشحن');
    cm('mship');
    ldDelivery();
    ldOrds();
    // إرسال إشعار واتساب للعميل إن كان هناك رقم تتبع
    if (tracking && status === 'shipped') {
      const trackData = await api(`/api/delivery/track/${orderId}`);
      if (trackData.success && trackData.order.tracking_url) {
        const waOrd = await api(`/api/orders/${orderId}/whatsapp`);
        // فتح واتساب مع رقم التتبع
        const phone = document.getElementById('ship-order-info').querySelector('div:last-child').textContent.replace('📱 ','').trim().replace(/[^0-9]/g,'');
        const waPhone = phone.startsWith('0') ? '964' + phone.slice(1) : phone;
        const trackUrl = trackData.order.tracking_url;
        const msg = `📦 *تم شحن طلبك!*\n\nرقم التتبع: *${tracking}*\nشركة التوصيل: ${company?.name || ''}\n🔗 تتبع شحنتك:\n${trackUrl}\n\nشكراً لثقتك! ⚡ SocialOS`;
        window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`, '_blank');
      }
    }
  } else toast('❌ ' + (d.message || 'خطأ'));
}

async function saveDeliveryCompany() {
  const name = document.getElementById('delco-name').value.trim();
  if (!name) return toast('⚠️ اسم الشركة مطلوب');
  const d = await api('/api/delivery/companies', {
    method: 'POST',
    body: JSON.stringify({
      name,
      icon: document.getElementById('delco-icon').value.trim() || '📦',
      tracking_url: document.getElementById('delco-url').value.trim()
    })
  });
  if (d.success) {
    toast('✅ تم إضافة الشركة');
    cm('mdelivery');
    ldDelivery();
    document.getElementById('delco-name').value = '';
    document.getElementById('delco-icon').value = '';
    document.getElementById('delco-url').value = '';
  } else toast('❌ ' + (d.message || 'خطأ'));
}

function copyText(text) {
  navigator.clipboard?.writeText(text).then(() => toast('✅ نُسخ: ' + text)).catch(() => {});
}

// ============================================================
// PUSH NOTIFICATIONS — الإشعارات الفورية
// ============================================================
let pushSubscription = null;

async function initPushStatus() {
  const statusEl = document.getElementById('push-status-badge');
  const btnEl = document.getElementById('push-enable-btn');
  if (!statusEl || !btnEl) return;

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    statusEl.innerHTML = '<span class="badge brd">غير مدعوم</span>';
    btnEl.style.display = 'none';
    return;
  }

  const perm = Notification.permission;
  const d = await api('/api/push/status').catch(() => ({ subscribed: false }));

  if (perm === 'granted' && d.subscribed) {
    statusEl.innerHTML = '<span class="badge bgr">✅ مفعّل</span>';
    btnEl.textContent = '🔕 إيقاف الإشعارات';
    btnEl.onclick = disablePush;
  } else if (perm === 'denied') {
    statusEl.innerHTML = '<span class="badge brd">🚫 محجوب</span>';
    btnEl.textContent = 'السماح من إعدادات المتصفح';
    btnEl.disabled = true;
  } else {
    statusEl.innerHTML = '<span class="badge bor">غير مفعّل</span>';
    btnEl.textContent = '🔔 تفعيل الإشعارات';
    btnEl.onclick = enablePush;
  }
}

async function enablePush() {
  if (!('serviceWorker' in navigator)) return toast('⚠️ المتصفح لا يدعم هذه الميزة');
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return toast('⚠️ لم تُمنح صلاحية الإشعارات');

    const reg = await navigator.serviceWorker.ready;

    // VAPID public key من السيرفر
    const config = await fetch('/api/config').then(r => r.json()).catch(() => ({}));
    const vapidKey = config.vapid_public_key;

    if (vapidKey) {
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey)
      });
      pushSubscription = sub;
      const subJson = sub.toJSON();
      await api('/api/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint: subJson.endpoint, p256dh: subJson.keys?.p256dh, auth: subJson.keys?.auth })
      });
    }
    toast('✅ تم تفعيل الإشعارات الفورية!');
    initPushStatus();
  } catch(e) {
    toast('⚠️ تعذر تفعيل الإشعارات: ' + e.message);
  }
}

async function disablePush() {
  try {
    if (pushSubscription) {
      await api('/api/push/unsubscribe', { method: 'DELETE', body: JSON.stringify({ endpoint: pushSubscription.endpoint }) });
      await pushSubscription.unsubscribe();
      pushSubscription = null;
    }
    toast('✅ تم إيقاف الإشعارات');
    initPushStatus();
  } catch(e) { toast('⚠️ ' + e.message); }
}

async function testPush() {
  const d = await api('/api/push/test', { method: 'POST' });
  if (d.success) toast('✅ تم إرسال إشعار اختباري — تحقق من الإشعارات');
  else toast('❌ ' + (d.message || 'خطأ'));
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

// تهيئة Push عند فتح صفحة الإشعارات
const _origLdNotifs = typeof ldNotifs === 'function' ? ldNotifs : null;
async function ldNotifs() {
  if (_origLdNotifs) await _origLdNotifs();
  initPushStatus();
}

// ============================================================
// DYNAMIC ATTRS — السمات الديناميكية حسب نوع النشاط
// ============================================================
async function loadDynAttrs(){
  const d=await api('/api/products/dynamic-attrs');
  if(!d.attrs?.length) return toast('⚠️ أضف نوع نشاطك في الإعدادات أولاً');
  pAttrs={};
  d.attrs.forEach(([k,v])=>{if(k) pAttrs[k]=v;});
  rnAttrs();
  toast(`✅ تم تحميل سمات ${d.business_type}`);
}

// ============================================================
// EXCEL IMPORT — استيراد من Excel/CSV
// ============================================================
let excelRows=[];
function parseExcelFile(input){
  const file=input.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const text=typeof e.target.result==='string'?e.target.result:new TextDecoder('utf-8').decode(e.target.result);
      const sep=text.includes('\t')?'\t':',';
      const lines=text.split('\n').filter(l=>l.trim());
      if(!lines.length) return toast('❌ الملف فارغ');
      const headers=lines[0].split(sep).map(h=>h.trim().replace(/^"|"$/g,'').toLowerCase());
      excelRows=lines.slice(1).map(line=>{
        const vals=line.split(sep).map(v=>v.trim().replace(/^"|"$/g,''));
        const obj={};headers.forEach((h,i)=>{obj[h]=vals[i]||'';});return obj;
      }).filter(r=>Object.values(r).some(v=>v));
      showExcelPreview();
    }catch(e){toast('⚠️ يرجى حفظ الملف بصيغة CSV وإعادة الرفع');}
  };
  file.name.endsWith('.csv')?reader.readAsText(file,'utf-8'):reader.readAsArrayBuffer(file);
}
function showExcelPreview(){
  if(!excelRows.length) return toast('❌ لا بيانات صالحة');
  document.getElementById('excel-preview').style.display='block';
  document.getElementById('excel-import-btn').style.display='block';
  document.getElementById('excel-count').textContent=`✅ وُجد ${excelRows.length} منتج جاهز للاستيراد`;
  document.getElementById('excel-rows').innerHTML=excelRows.slice(0,5).map(r=>`<div style="padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05)">${Object.entries(r).slice(0,4).map(([k,v])=>`${k}:${v}`).join(' | ')}</div>`).join('')+(excelRows.length>5?`<div style="color:var(--text2);padding-top:4px">...و ${excelRows.length-5} أخرى</div>`:'');
}
async function importExcel(){
  if(!excelRows.length) return toast('⚠️ لا بيانات');
  const btn=document.getElementById('excel-import-btn');
  btn.disabled=true;btn.textContent='⏳ جاري الاستيراد...';
  const d=await api('/api/products/import-excel',{method:'POST',body:JSON.stringify({rows:excelRows})});
  btn.disabled=false;btn.textContent='📥 استيراد المنتجات';
  if(d.success){
    toast(`✅ تم استيراد ${d.imported} منتج${d.skipped?` | تجاهل ${d.skipped}`:''}`);
    cm('mp-import');excelRows=[];
    document.getElementById('excel-preview').style.display='none';
    document.getElementById('excel-import-btn').style.display='none';
    document.getElementById('excel-file').value='';
    ldProds();
  } else toast('❌ '+(d.message||'خطأ'));
}

// ============================================================
// PRODUCT FROM IMAGE — منتج من صورة
// ============================================================
let extractedProductFromImage=null;
function prvProdImg(){
  const url=document.getElementById('pimg-url').value.trim();
  const prv=document.getElementById('pimg-prv');const img=document.getElementById('pimg-img');
  if(url){img.src=url;prv.style.display='block';}else prv.style.display='none';
}
async function analyzeProductImage(){
  const url=document.getElementById('pimg-url').value.trim();
  if(!url) return toast('⚠️ أدخل رابط الصورة أولاً');
  const btn=document.getElementById('pimg-btn');
  btn.disabled=true;btn.textContent='⏳ AI يحلل الصورة...';
  const d=await api('/api/products/from-image',{method:'POST',body:JSON.stringify({image_url:url})});
  btn.disabled=false;btn.textContent='🤖 تحليل الصورة بالـ AI';
  if(d.success&&d.product){
    extractedProductFromImage={...d.product,image_url:url};
    const p=d.product;
    document.getElementById('pimg-extracted').innerHTML=`
      <div style="font-weight:700;font-size:.9rem;margin-bottom:7px">${esc(p.name||'منتج')}</div>
      <div style="color:var(--text2);font-size:.8rem;margin-bottom:7px">${esc(p.description||'')}</div>
      <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:7px">
        <span class="badge bbl">📁 ${esc(p.category||'عام')}</span>
        ${p.suggested_price?`<span class="badge bor">💰 ${Number(p.suggested_price).toLocaleString()}</span>`:''}
        <span class="badge ${p.confidence>=80?'bgr':p.confidence>=50?'bor':'brd'}">${p.confidence||0}% ثقة</span>
      </div>
      ${p.dynamic_attrs&&Object.keys(p.dynamic_attrs).length?`<div style="font-size:.74rem;color:var(--text2)">${Object.entries(p.dynamic_attrs).map(([k,v])=>`${k}: ${v}`).join(' · ')}</div>`:''}
      ${p.notes?`<div style="font-size:.73rem;color:var(--accent3);margin-top:5px">💡 ${esc(p.notes)}</div>`:''}`;
    document.getElementById('pimg-result').style.display='block';
  } else toast('❌ '+(d.message||'تعذر التحليل'));
}
async function saveProductFromImage(){
  if(!extractedProductFromImage) return;
  const p=extractedProductFromImage;
  if(!p.name) return toast('⚠️ لم يُستخرج اسم المنتج');
  const d=await api('/api/products',{method:'POST',body:JSON.stringify({name:p.name,description:p.description||'',price:p.suggested_price||0,category:p.category||'عام',stock:0,image_url:p.image_url||'',dynamic_attrs:p.dynamic_attrs||{}})});
  if(d.success){toast('✅ تم حفظ المنتج');cm('mp-image');document.getElementById('pimg-url').value='';document.getElementById('pimg-prv').style.display='none';document.getElementById('pimg-result').style.display='none';extractedProductFromImage=null;ldProds();}
  else toast('❌ '+(d.message||'خطأ'));
}

// ============================================================
// PRODUCT FROM TEXT — منتج بأمر نصي
// ============================================================
async function addProductFromText(){
  const text=document.getElementById('ptxt-input').value.trim();
  if(!text) return toast('⚠️ أدخل وصف المنتج');
  const btn=document.getElementById('ptxt-btn');
  btn.disabled=true;btn.textContent='⏳ AI يستخرج البيانات...';
  const d=await api('/api/products/from-text',{method:'POST',body:JSON.stringify({text})});
  btn.disabled=false;btn.textContent='🤖 استخراج وحفظ';
  const resultEl=document.getElementById('ptxt-result');
  resultEl.style.display='block';
  if(d.success){
    const p=d.product;
    if(d.saved){
      resultEl.innerHTML=`<div style="background:rgba(0,200,150,.08);border:1px solid rgba(0,200,150,.25);border-radius:10px;padding:12px"><div style="color:var(--green);font-weight:700;margin-bottom:5px">✅ تم حفظ المنتج تلقائياً!</div><div style="font-size:.82rem;color:var(--text2)">${esc(p.name)} — ${Number(p.price||0).toLocaleString()} — مخزون: ${p.stock||0}</div></div>`;
      setTimeout(()=>{cm('mp-text');document.getElementById('ptxt-input').value='';resultEl.style.display='none';ldProds();},2000);
    } else {
      resultEl.innerHTML=`<div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:10px;padding:12px"><div style="color:var(--accent3);font-weight:700;margin-bottom:7px">⚠️ أكمل البيانات الناقصة</div><div style="font-size:.82rem;margin-bottom:8px">${esc(p.name||'')}${p.price?` — ${Number(p.price).toLocaleString()}`:''}</div><button class="btn ba bsm" style="width:100%" onclick='fillFromText(${JSON.stringify(p).replace(/'/g,"\\'")} )'>✏️ فتح نموذج الإضافة</button></div>`;
    }
  } else toast('❌ '+(d.message||'خطأ'));
}
function fillFromText(p){
  cm('mp-text');om('mp');
  setTimeout(()=>{
    if(p.name) document.getElementById('pn').value=p.name;
    if(p.price) document.getElementById('pp').value=p.price;
    if(p.stock) document.getElementById('pst').value=p.stock;
    if(p.category) document.getElementById('pc').value=p.category;
    if(p.description) document.getElementById('pd2').value=p.description;
    if(p.dynamic_attrs&&Object.keys(p.dynamic_attrs).length){pAttrs=p.dynamic_attrs;rnAttrs();}
  },200);
}

// ============================================================
// EMPLOYEE ACTIVITY LOG — سجل نشاط الموظف
// ============================================================
async function ldEmpLog(){
  const d=await api('/api/employee/activity');
  if(!d.success) return;
  const s=d.stats||{};
  document.getElementById('el-total').textContent=(s.total_interactions||0).toLocaleString();
  document.getElementById('el-correct').textContent=(s.correct_interactions||0).toLocaleString();
  document.getElementById('el-accuracy').textContent=(s.accuracy||0)+'%';
  document.getElementById('el-accuracy').style.color=s.accuracy>=80?'var(--green)':s.accuracy>=60?'var(--accent3)':'var(--danger)';
  document.getElementById('el-sessions').textContent=(d.sessions?.length||0);
  const typeLabel={open:'💬 مفتوح',simulate_customer:'🎭 محاكاة',evaluate:'📊 تقييم',explain:'🔍 شرح'};
  const sessEl=document.getElementById('emplog-sessions');
  if(!d.sessions?.length){sessEl.innerHTML='<div class="empty"><div class="ei">📋</div><p>لا جلسات بعد</p></div>';}
  else{sessEl.innerHTML=d.sessions.map(s=>`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--surface2);border-radius:10px;margin-bottom:7px;cursor:pointer" onclick="viewSession(${s.id})">
      <div><div style="font-weight:700;font-size:.83rem">${typeLabel[s.type]||s.type}</div>
      <div style="font-size:.72rem;color:var(--text2)">${new Date(s.created_at).toLocaleString('ar')}</div></div>
      <div style="text-align:left">${s.corrections?`<span class="badge bor" style="font-size:.65rem">✏️ ${s.corrections}</span>`:''}<div style="font-size:.7rem;color:var(--text2);margin-top:3px">← عرض</div></div>
    </div>`).join('');}
  const corrEl=document.getElementById('emplog-corrections');
  if(!d.corrections?.length){corrEl.innerHTML='<div class="empty"><div class="ei">✏️</div><p>لا تصحيحات</p></div>';}
  else{corrEl.innerHTML=d.corrections.map(c=>`
    <div style="background:var(--surface2);border-radius:10px;padding:11px;margin-bottom:8px;border-right:3px solid var(--accent2)">
      <div style="display:flex;justify-content:space-between;font-size:.71rem;color:var(--text2);margin-bottom:5px"><span>${c.context||'عام'}</span><span>${new Date(c.created_at).toLocaleDateString('ar')}</span></div>
      <div style="color:var(--danger);font-size:.74rem;margin-bottom:4px">❌ ${esc((c.original_response||'').substring(0,80))}...</div>
      <div style="color:var(--green);font-size:.74rem;margin-bottom:4px">✅ ${esc((c.corrected_response||'').substring(0,80))}...</div>
      ${c.lesson?`<div style="font-size:.71rem;color:var(--accent);background:rgba(79,142,247,.08);border-radius:6px;padding:3px 7px">💡 ${esc(c.lesson)}</div>`:''}
    </div>`).join('');}
}
async function viewSession(id){
  sp('session-detail',null);
  const d=await api(`/api/employee/activity/${id}`);
  if(!d.success) return toast('❌ تعذر تحميل الجلسة');
  const s=d.session; const msgs=s.messages||[];
  const typeLabel={open:'💬 تدريب مفتوح',simulate_customer:'🎭 محاكاة عميل',evaluate:'📊 تقييم',explain:'🔍 شرح'};
  document.getElementById('session-detail-content').innerHTML=`
    <div class="card" style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="font-weight:700">${typeLabel[s.type]||s.type}</div>
        <div style="font-size:.75rem;color:var(--text2)">${new Date(s.created_at).toLocaleString('ar')}</div>
      </div>
      <div style="font-size:.74rem;color:var(--text2);margin-top:3px">${msgs.length} رسالة</div>
    </div>
    <div class="cwrap" style="max-height:500px"><div class="cmsgs" style="max-height:460px">
      ${msgs.map(m=>`<div class="cm${m.role==='user'?' u':''}"><div class="cav" style="background:${m.role==='user'?'var(--accent)':'linear-gradient(135deg,var(--accent2),#a855f7)'}">${m.role==='user'?'👤':'🧠'}</div><div class="cbub" style="white-space:pre-wrap">${esc(m.content||'')}</div></div>`).join('')}
    </div></div>`;
}

// تتبع تلقائي — إشعار العميل
async function notifyCustomer(orderId,type){
  const d=await api(`/api/orders/${orderId}/notify-customer`,{method:'POST',body:JSON.stringify({type})});
  if(d.success){
    if(d.auto_sent) toast('✅ تم إرسال الإشعار تلقائياً للعميل');
    else if(d.wa_url){window.open(d.wa_url,'_blank');toast('📱 فُتح واتساب لإرسال الإشعار');}
  } else toast('❌ '+(d.message||'خطأ'));
}

fetch('/api/config').then(r=>r.json()).then(d=>{
  window.GOOGLE_CLIENT_ID=d.google_client_id||'';
  if(!window.GOOGLE_CLIENT_ID){
    const gb=document.querySelector('.gbtn');
    if(gb){gb.style.display='none';const dv=document.querySelector('.gdiv');if(dv) dv.style.display='none';}
  }
}).catch(()=>{});
// Service Worker

// ============================================================
// MIKE FLOATING PANEL — النافذة العائمة في كل صفحة
// ============================================================
let mfpOpen = false;
let mfpHistory = [];
let mfpMicActive = false;
let mfpRecognition = null;

function toggleMikePanel() {
  mfpOpen = !mfpOpen;
  const panel = document.getElementById('mike-float-panel');
  const fab = document.getElementById('mike-fab');
  if (mfpOpen) {
    panel.classList.add('open');
    fab.textContent = '✕';
    setTimeout(() => document.getElementById('mfp-input')?.focus(), 150);
  } else {
    closeMikePanel();
  }
}

function closeMikePanel() {
  mfpOpen = false;
  document.getElementById('mike-float-panel')?.classList.remove('open');
  const fab = document.getElementById('mike-fab');
  if (fab) fab.textContent = '⚡';
}

function mfpAddMsg(role, text) {
  const msgs = document.getElementById('mfp-msgs');
  if (!msgs) return;
  const div = document.createElement('div');
  div.className = 'mfp-msg ' + role;
  div.innerHTML = `<div class="mfp-av ${role}">${role==='ai'?'⚡':'👤'}</div><div class="mfp-bubble">${role==='ai'?text:escHtml(text)}</div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function sendMfp(text) {
  const input = document.getElementById('mfp-input');
  const msg = text || input?.value?.trim();
  if (!msg) return;
  if (input) input.value = '';

  mfpAddMsg('user', msg);
  mfpHistory.push({ role: 'user', content: msg });

  // مؤشر التحميل
  const status = document.getElementById('mfp-status');
  if (status) status.textContent = '⏳ جاري التنفيذ...';

  const loadId = 'mfp-load-' + Date.now();
  const msgs = document.getElementById('mfp-msgs');
  const loadDiv = document.createElement('div');
  loadDiv.id = loadId;
  loadDiv.className = 'mfp-msg ai';
  loadDiv.innerHTML = '<div class="mfp-av ai">⚡</div><div class="mfp-bubble" style="opacity:.5">●●●</div>';
  msgs?.appendChild(loadDiv);
  if (msgs) msgs.scrollTop = msgs.scrollHeight;

  const d = await api('/api/mike', { method: 'POST', body: JSON.stringify({ message: msg, history: mfpHistory.slice(-6) }) });

  document.getElementById(loadId)?.remove();
  if (status) status.textContent = 'جاهز للتنفيذ';

  if (d.success) {
    mfpHistory.push({ role: 'assistant', content: d.reply });

    let replyHtml = escHtml(d.reply);

    // تنفيذ إجراء التنقل في الواجهة
    if (d.action === 'navigate_to' && d.action_data?.page) {
      const page = d.action_data.page;
      replyHtml += `<br><span class="mfp-action-chip" onclick="sp('${page}',null);closeMikePanel()">🔗 فتح الصفحة ←</span>`;
      setTimeout(() => { sp(page, null); closeMikePanel(); }, 600);
    }

    // نتيجة إجراء
    if (d.action_result) {
      replyHtml += '<br><span style="color:var(--green);font-size:.75rem">✅ ' + escHtml(d.action_result.message || '') + '</span>';
      // chip للانتقال للصفحة المرتبطة
      const pageMap = { create_order:'orders', create_product:'products', create_customer:'customers', create_post:'posts', create_coupon:'coupons', update_order_status:'orders', schedule_followup:'customers' };
      const target = pageMap[d.action];
      if (target) replyHtml += `<br><span class="mfp-action-chip" onclick="sp('${target}',null);closeMikePanel()">🔗 عرض ←</span>`;
      // تحديث الصفحة الحالية تلقائياً
      if (target && currentPage === target) {
        const loaders = {orders:ldOrds,products:ldProds,customers:ldCusts,posts:ldPosts,coupons:ldCoups};
        if (loaders[target]) setTimeout(() => loaders[target](), 400);
      }
    }
    if (d.action_error) replyHtml += '<br><span style="color:var(--danger);font-size:.75rem">❌ ' + escHtml(d.action_error) + '</span>';

    mfpAddMsg('ai', replyHtml);
  } else {
    mfpAddMsg('ai', '❌ ' + escHtml(d.message || 'حدث خطأ'));
  }
}

// ─── الميكروفون في النافذة العائمة ───
function toggleMfpMic() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    toast('⚠️ جرب Chrome للتعرف على الصوت'); return;
  }
  if (mfpMicActive) { stopMfpMic(); } else { startMfpMic(); }
}

function startMfpMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  mfpRecognition = new SR();
  mfpRecognition.lang = 'ar-SA';
  mfpRecognition.continuous = false;
  mfpRecognition.interimResults = true;
  mfpRecognition.onstart = () => {
    mfpMicActive = true;
    document.getElementById('mfp-mic-btn')?.classList.add('listening');
    document.getElementById('mfp-status').textContent = '🎤 يستمع...';
    // إظهار النافذة إذا كانت مغلقة
    if (!mfpOpen) toggleMikePanel();
  };
  mfpRecognition.onresult = (e) => {
    let t = '';
    for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript;
    const inp = document.getElementById('mfp-input');
    if (inp) inp.value = t;
  };
  mfpRecognition.onend = () => {
    stopMfpMic();
    const txt = document.getElementById('mfp-input')?.value?.trim();
    if (txt) setTimeout(() => sendMfp(), 300);
  };
  mfpRecognition.onerror = (e) => {
    stopMfpMic();
    if (e.error === 'not-allowed') toast('⚠️ اسمح بالوصول للميكروفون');
  };
  mfpRecognition.start();
}

function stopMfpMic() {
  mfpMicActive = false;
  if (mfpRecognition) { try { mfpRecognition.stop(); } catch(e) {} mfpRecognition = null; }
  document.getElementById('mfp-mic-btn')?.classList.remove('listening');
  const st = document.getElementById('mfp-status');
  if (st) st.textContent = 'جاهز للتنفيذ';
}

// ─── ميكروفون الـ FAB — ضغطة مطولة للتحدث مباشرة ───
const fabEl = document.getElementById('mike-fab');
if (fabEl) {
  let fabPressTimer = null;
  fabEl.addEventListener('mousedown', () => {
    fabPressTimer = setTimeout(() => { fabPressTimer = null; startMfpMic(); }, 600);
  });
  fabEl.addEventListener('mouseup', () => { if (fabPressTimer) { clearTimeout(fabPressTimer); fabPressTimer = null; } });
  fabEl.addEventListener('touchstart', (e) => {
    e.preventDefault();
    fabPressTimer = setTimeout(() => { fabPressTimer = null; startMfpMic(); }, 600);
  }, {passive:false});
  fabEl.addEventListener('touchend', () => { if (fabPressTimer) { clearTimeout(fabPressTimer); fabPressTimer = null; } });
}

// إخفاء الـ FAB في صفحة Mike نفسها (لا داعي لتكرار)
const origSp = sp;
if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{});}

