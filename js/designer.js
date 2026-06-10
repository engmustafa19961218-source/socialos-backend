// ============================================================
async function ldIdentity(){
  const d = await api('/api/identity');
  const id = d.identity || {};
  document.getElementById('id-logo').value = id.logo_url||'';
  document.getElementById('id-cover').value = id.cover_url||'';
  document.getElementById('id-c1').value = id.primary_color||'#4f8ef7';
  document.getElementById('id-c1t').value = id.primary_color||'#4f8ef7';
  document.getElementById('id-c2').value = id.secondary_color||'#7c3aed';
  document.getElementById('id-c2t').value = id.secondary_color||'#7c3aed';
  document.getElementById('id-c3').value = id.accent_color||'#00d4aa';
  document.getElementById('id-c3t').value = id.accent_color||'#00d4aa';
  document.getElementById('id-font').value = id.font_name||'Tajawal';
  document.getElementById('id-style').value = id.communication_style||'ودي وقريب';
  document.getElementById('id-wm').checked = id.watermark_enabled||false;
  document.getElementById('id-wmp').value = id.watermark_position||'bottom-right';
  document.getElementById('id-wmo').value = id.watermark_opacity||0.8;
  document.getElementById('id-wmo-val').textContent = id.watermark_opacity||0.8;
  document.getElementById('prv-c1').style.background = id.primary_color||'#4f8ef7';
  document.getElementById('prv-c2').style.background = id.secondary_color||'#7c3aed';
  document.getElementById('prv-c3').style.background = id.accent_color||'#00d4aa';
  if (id.logo_url) prvLogo();
  if (biz) document.getElementById('id-prv-name').textContent = biz.store_name||'اسم متجرك';
  // تحميل البطاقات
  try { _payCards = Array.isArray(id.payment_cards) ? id.payment_cards : JSON.parse(id.payment_cards||'[]'); } catch(e){ _payCards=[]; }
  renderPayCards();
  document.getElementById('id-prv-style').textContent = id.communication_style||'ودي وقريب';
  // تطبيق هوية المتجر على كل الواجهة
  applyStoreIdentity(id);
}

// تطبيق هوية المتجر على CSS variables
function applyStoreIdentity(id){
  if (!id) return;
  const root = document.documentElement;
  if (id.primary_color) root.style.setProperty('--accent', id.primary_color);
  if (id.secondary_color) root.style.setProperty('--accent2', id.secondary_color);
  if (id.accent_color) root.style.setProperty('--green', id.accent_color);
  if (id.font_name) {
    root.style.setProperty('--font', `'${id.font_name}', 'Tajawal', sans-serif`);
    document.body.style.fontFamily = `'${id.font_name}', 'Tajawal', sans-serif`;
  }
  // تحديث Mike button color
  const mikeBtns = document.querySelectorAll('.mike-btn:not(.active)');
  if (id.primary_color) mikeBtns.forEach(btn => {
    btn.style.borderColor = id.primary_color + '50';
  });
  // حفظ الهوية في localStorage للاستخدام في Canvas
  try { localStorage.setItem('sos_identity', JSON.stringify(id)); } catch(e){}
}

// تحميل هوية المتجر عند البداية
async function loadInitialIdentity(){
  try {
    // من cache أولاً
    const cached = localStorage.getItem('sos_identity');
    if (cached) applyStoreIdentity(JSON.parse(cached));
    // ثم من السيرفر
    const d = await api('/api/identity');
    if (d.identity) {
      applyStoreIdentity(d.identity);
      localStorage.setItem('sos_identity', JSON.stringify(d.identity));
    }
  } catch(e){}
}

// إضافة شعار المتجر للـ Canvas (مصمم الصور)
function addLogoToCanvas(){
  const identity = JSON.parse(localStorage.getItem('sos_identity')||'{}');
  if (!identity.logo_url) return toast('⚠️ أضف شعاراً في هوية المتجر أولاً');
  const canvas = document.getElementById('des-canvas');
  if (!canvas) return;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const ctx = canvas.getContext('2d');
    const size = Math.min(canvas.width * 0.15, 80);
    const x = canvas.width - size - 12;
    const y = 12;
    ctx.globalAlpha = 0.85;
    ctx.drawImage(img, x, y, size, size);
    ctx.globalAlpha = 1;
    toast('✅ تم إضافة الشعار');
  };
  img.onerror = () => toast('⚠️ تعذر تحميل الشعار');
  img.src = identity.logo_url;
}
function syncColor(pickerId, textId){
  const txt=document.getElementById(textId).value;
  if(/^#[0-9A-Fa-f]{6}$/.test(txt)){
    document.getElementById(pickerId).value=txt;
    const map={'id-c1t':'prv-c1','id-c2t':'prv-c2','id-c3t':'prv-c3'};
    if(map[textId]) document.getElementById(map[textId]).style.background=txt;
  }
}
function prvLogo(){
  const url=document.getElementById('id-logo').value.trim();
  const prv=document.getElementById('id-logo-prv');
  const img=document.getElementById('id-logo-img');
  if(url&&url.startsWith('https://')){
    img.src=url;
    prv.style.display='block';
    document.getElementById('id-prv-logo').innerHTML=`<img src="${esc(url)}" style="width:60px;height:60px;border-radius:12px;object-fit:cover">`;
  } else {
    prv.style.display='none';
  }
}
// ─── بطاقات الدفع ───
let _payCards = [];

function renderPayCards(){
  const el = document.getElementById('pay-cards-list');
  if (!el) return;
  if (!_payCards.length) {
    el.innerHTML = '<div style="font-size:.78rem;color:var(--text2);text-align:center;padding:8px">لا توجد بطاقات مضافة بعد</div>';
    return;
  }
  el.innerHTML = _payCards.map((c,i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface2);border-radius:9px;margin-bottom:6px">
      <div style="flex:1;min-width:0">
        <div style="font-size:.82rem;font-weight:700">${esc(c.name)} — ${esc(c.type)}</div>
        <div style="font-size:.78rem;color:var(--text2);direction:ltr;text-align:right">${esc(c.number)}</div>
        <div style="font-size:.74rem;color:var(--text2)">${esc(c.owner)}</div>
      </div>
      <button class="btn bo bsm" onclick="removePayCard(${i})" style="padding:5px 9px;font-size:.75rem">✕</button>
    </div>
  `).join('');
}

function addPayCard(){
  const name = document.getElementById('pc-name').value.trim();
  const number = document.getElementById('pc-number').value.trim();
  const owner = document.getElementById('pc-owner').value.trim();
  const type = document.getElementById('pc-type').value;
  if (!name || !number) return toast('⚠️ أدخل اسم البطاقة والرقم');
  _payCards.push({ name, number, owner, type });
  renderPayCards();
  document.getElementById('pc-name').value = '';
  document.getElementById('pc-number').value = '';
  document.getElementById('pc-owner').value = '';
  toast('✅ تمت إضافة البطاقة');
}

function removePayCard(i){
  _payCards.splice(i, 1);
  renderPayCards();
}

async function saveIdentity(){
  const d=await api('/api/identity',{method:'PUT',body:JSON.stringify({
    logo_url:document.getElementById('id-logo').value.trim(),
    cover_url:document.getElementById('id-cover').value.trim(),
    primary_color:document.getElementById('id-c1t').value.trim(),
    secondary_color:document.getElementById('id-c2t').value.trim(),
    accent_color:document.getElementById('id-c3t').value.trim(),
    font_name:document.getElementById('id-font').value,
    communication_style:document.getElementById('id-style').value,
    watermark_enabled:document.getElementById('id-wm').checked,
    watermark_position:document.getElementById('id-wmp').value,
    watermark_opacity:parseFloat(document.getElementById('id-wmo').value),
    payment_cards: _payCards
  })});
  if(d.success) toast('✅ تم حفظ هوية المتجر');
  else toast('❌ '+(d.message||'خطأ'));
}

// ============================================================
// IMAGE DESIGNER — مصمم الصور الذكي
// ============================================================

// ─── تبويبات المصمم ───
function switchDesTab(tab, btn) {
  ['edit','batch','text','ai','gen'].forEach(t => {
    const el = document.getElementById('des-tab-'+t);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('#page-designer .fb').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

async function ldDesigner(){
  const d = await api('/api/images/projects');
  const list = document.getElementById('des-projects');
  const projects = d.projects||[];
  if (!projects.length) { list.innerHTML='<div class="empty"><div class="ei">🖼️</div><p>لا مشاريع بعد</p></div>'; return; }
  list.innerHTML = projects.map(p=>`
    <div style="display:flex;align-items:center;gap:9px;padding:8px 0;border-bottom:1px solid var(--border)">
      ${p.original_url?`<img src="${esc(p.original_url)}" style="width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0" onerror="this.style.display='none'">`:'<div style="width:44px;height:44px;border-radius:8px;background:var(--surface2);display:flex;align-items:center;justify-content:center">🖼️</div>'}
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.title||'بدون عنوان')}</div>
        <div style="font-size:.72rem;color:var(--text2)">${new Date(p.created_at).toLocaleDateString('ar')}</div>
      </div>
      <button class="btn bd bsm" onclick="delDesProject(${p.id})">🗑</button>
    </div>
  `).join('');
}

// ─── تبويب التعديل ───
function prvDesImg(){
  const url = document.getElementById('des-url')?.value.trim();
  const prv = document.getElementById('des-prv');
  const img = document.getElementById('des-img');
  if (!prv || !img) return;
  if (url && (url.startsWith('https://') || url.startsWith('data:'))) {
    img.src = url; prv.style.display = 'block';
  } else prv.style.display = 'none';
}

function setPlacementPrompt(text) {
  const inp = document.getElementById('placement-prompt');
  if (inp) inp.value = text;
}

async function placeProduct() {
  const prompt = document.getElementById('placement-prompt')?.value.trim();
  if (!prompt) return toast('⚠️ صف البيئة التي تريدها أولاً');
  const bgImg = document.getElementById('rm-bg-img')?.src;
  if (!bgImg || bgImg === window.location.href) return toast('⚠️ احذف الخلفية أولاً');
  const btn = document.getElementById('placement-btn');
  btn.disabled = true; btn.textContent = '⏳ جاري المعالجة...';
  const d = await api('/api/images/place-product', { method: 'POST', body: JSON.stringify({
    product_base64: bgImg.startsWith('data:') ? bgImg.split(',')[1] : null,
    product_url: bgImg.startsWith('http') ? bgImg : null,
    placement_prompt: prompt
  }) });
  btn.disabled = false; btn.textContent = '🎨 ضع المنتج في البيئة';
  if (d.success) {
    const result = document.getElementById('placement-result');
    const img = document.getElementById('placement-img');
    img.src = d.image_url || `data:image/png;base64,${d.image_base64}`;
    result.style.display = 'block';
    toast('✅ تم دمج المنتج بنجاح!');
  } else toast('❌ ' + (d.message || 'فشل'));
}

function downloadPlacement() {
  const img = document.getElementById('placement-img');
  if (!img?.src) return;
  const a = document.createElement('a');
  a.href = img.src;
  a.download = 'product-placement.png';
  a.click();
}

async function removeBg(){
  const url = document.getElementById('des-url')?.value.trim();
  const img = document.getElementById('des-img');
  if (!url && (!img || !img.src || img.src === window.location.href)) return toast('⚠️ أدخل رابط الصورة أو ارفع صورة أولاً');
  const btn = document.getElementById('rm-bg-btn');
  btn.disabled = true; btn.querySelector('span:last-child').textContent = '⏳ جاري الإزالة...';

  let payload;
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    payload = { image_url: url };
  } else {
    // تحويل الصورة لbase64 إن كانت blob أو data URL
    try {
      let base64;
      if (img.src.startsWith('data:')) {
        // تحويل لـ PNG
        base64 = await new Promise(res => {
          const image = new Image();
          image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            canvas.getContext('2d').drawImage(image, 0, 0);
            res(canvas.toDataURL('image/png'));
          };
          image.src = img.src;
        });
      } else {
        // blob URL — نحوله لbase64
        const resp = await fetch(img.src);
        const blob = await resp.blob();
        base64 = await new Promise(res => {
          const r = new FileReader();
          r.onloadend = () => res(r.result);
          r.readAsDataURL(blob);
        });
        // تحويل لـ PNG عبر canvas لضمان القبول
        base64 = await new Promise(res => {
          const image = new Image();
          image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            canvas.getContext('2d').drawImage(image, 0, 0);
            res(canvas.toDataURL('image/png'));
          };
          image.src = base64;
        });
      }
      payload = { image_base64: base64 };
    } catch(e) {
      btn.disabled = false;
      btn.querySelector('span:last-child').textContent = 'إزالة الخلفية';
      return toast('❌ تعذر قراءة الصورة — جرب رفعها مرة أخرى');
    }
  }

  const d = await api('/api/images/remove-bg', { method:'POST', body: JSON.stringify(payload) });
  btn.disabled = false; btn.querySelector('span:last-child').textContent = 'إزالة الخلفية';
  if (d.success) {
    const result = document.getElementById('rm-bg-result');
    const resultImg = document.getElementById('rm-bg-img');
    resultImg.src = d.url;
    result.style.display = 'block';
    // تحديث الصورة الرئيسية
    if (img) { img.src = d.url; document.getElementById('des-prv').style.display = 'block'; }
    if (document.getElementById('des-url')) document.getElementById('des-url').value = d.url;
    toast('✅ تمت إزالة الخلفية!');
  } else {
    toast('❌ ' + (d.message || 'فشل — تأكد من إضافة REMOVE_BG_API_KEY في Railway'));
  }
}

function downloadDesImg(){
  const url = document.getElementById('des-url')?.value.trim() || document.getElementById('rm-bg-img')?.src;
  if (!url) return toast('⚠️ لا توجد صورة');
  const a = document.createElement('a');
  a.href = url; a.download = 'socialos-image.png'; a.click();
}

function copyImgUrl(){
  const url = document.getElementById('des-url')?.value.trim();
  if (!url) return toast('⚠️ لا يوجد رابط');
  navigator.clipboard.writeText(url).then(() => toast('✅ تم نسخ الرابط'));
}

async function saveDesProject(){
  const url = document.getElementById('des-url')?.value.trim() || document.getElementById('ai-img-url')?.value.trim();
  const title = document.getElementById('des-title')?.value.trim();
  if (!url) return toast('⚠️ أدخل رابط الصورة');
  const d = await api('/api/images/projects', { method:'POST', body: JSON.stringify({
    title: title||'مشروع جديد', type:'product', original_url: url
  })});
  if (d.success) { toast('✅ تم الحفظ'); ldDesigner(); }
  else toast('❌ ' + (d.message||'خطأ'));
}

async function delDesProject(id){
  if (!confirm('حذف المشروع؟')) return;
  const d = await api('/api/images/projects/'+id, { method:'DELETE' });
  if (d.success) { toast('✅ تم الحذف'); ldDesigner(); }
  else toast('❌ ' + (d.message||'خطأ'));
}

// ─── تبويب Canvas (كتابة النصوص) ───
let canvasTexts = [];
let canvasImg = null;

function loadCanvasImg(){
  const url = document.getElementById('txt-img-url')?.value.trim();
  if (!url) return;
  const canvas = document.getElementById('des-canvas');
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    canvasImg = img;
    // أبعاد مناسبة
    const maxW = Math.min(600, window.innerWidth - 40);
    const ratio = img.height / img.width;
    canvas.width = maxW;
    canvas.height = maxW * ratio;
    renderCanvas();
  };
  img.onerror = () => toast('⚠️ تعذر تحميل الصورة — تأكد أنها تسمح بـ CORS');
  img.src = url;
}

function renderCanvas(){
  const canvas = document.getElementById('des-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // رسم الصورة
  if (canvasImg) {
    ctx.drawImage(canvasImg, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#4a5a7a';
    ctx.font = '16px Tajawal';
    ctx.textAlign = 'center';
    ctx.fillText('أدخل رابط الصورة أعلاه', canvas.width/2, canvas.height/2);
  }

  // رسم النصوص
  canvasTexts.forEach(t => {
    const fontSize = t.size || 36;
    ctx.font = `bold ${fontSize}px "${t.font||'Tajawal'}", Arial`;
    ctx.textAlign = 'center';
    const textW = ctx.measureText(t.text).width;
    let x, y;
    const pad = 20;

    switch(t.pos) {
      case 'top': x = canvas.width/2; y = fontSize + pad; break;
      case 'bottom': x = canvas.width/2; y = canvas.height - pad; break;
      case 'top-right': x = canvas.width - textW/2 - pad; y = fontSize + pad; ctx.textAlign='right'; x=canvas.width-pad; break;
      case 'bottom-right': x = canvas.width - pad; y = canvas.height - pad; ctx.textAlign='right'; break;
      default: x = canvas.width/2; y = canvas.height/2; // center
    }

    // خلفية النص
    if (t.bg && t.bg !== 'none') {
      const bw = textW + 24; const bh = fontSize + 16;
      let bx = ctx.textAlign === 'right' ? x - bw : x - bw/2;
      let by = y - fontSize - 4;
      ctx.globalAlpha = 0.75;
      if (t.bg === 'black') ctx.fillStyle = '#000000';
      else if (t.bg === 'white') ctx.fillStyle = '#ffffff';
      else if (t.bg === 'accent') ctx.fillStyle = '#4f8ef7';
      else if (t.bg === 'gradient') {
        const grad = ctx.createLinearGradient(bx, by, bx+bw, by);
        grad.addColorStop(0, '#4f8ef7'); grad.addColorStop(1, '#7c3aed');
        ctx.fillStyle = grad;
      }
      ctx.roundRect ? ctx.roundRect(bx, by, bw, bh, 8) : ctx.fillRect(bx, by, bw, bh);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // النص مع ظل
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = t.color || '#ffffff';
    ctx.fillText(t.text, x, y);
    ctx.shadowBlur = 0;
    ctx.textAlign = 'center';
  });
}

function addTextToCanvas(){
  const text = document.getElementById('txt-content')?.value.trim();
  if (!text) return toast('⚠️ أدخل النص أولاً');
  canvasTexts.push({
    text,
    size: parseInt(document.getElementById('txt-size')?.value) || 36,
    color: document.getElementById('txt-color')?.value || '#ffffff',
    font: document.getElementById('txt-font')?.value || 'Tajawal',
    bg: document.getElementById('txt-bg')?.value || 'none',
    pos: document.getElementById('txt-pos')?.value || 'center',
    id: Date.now()
  });
  renderCanvas();
  document.getElementById('txt-content').value = '';
  toast('✅ تم إضافة النص');
}

function clearCanvasTexts(){
  canvasTexts = [];
  renderCanvas();
  toast('✅ تم مسح النصوص');
}

function downloadCanvas(){
  const canvas = document.getElementById('des-canvas');
  if (!canvas || canvas.width === 0) return toast('⚠️ الصورة فارغة');
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = 'socialos-design-' + Date.now() + '.png';
  a.click();
  toast('✅ جاري التحميل...');
}

// قوالب جاهزة
function applyTemplate(type){
  const templates = {
    offer: { text:'🔥 عرض خاص محدود', size:40, color:'#ffffff', bg:'gradient', pos:'top' },
    new: { text:'🆕 وصل حديثاً', size:36, color:'#ffffff', bg:'accent', pos:'top' },
    price: { text:'السعر: ', size:44, color:'#f59e0b', bg:'black', pos:'bottom' },
    discount: { text:'خصم 20% 🏷️', size:42, color:'#ffffff', bg:'gradient', pos:'center' },
    contact: { text:'📞 للطلب تواصل معنا', size:28, color:'#ffffff', bg:'black', pos:'bottom' }
  };
  const t = templates[type];
  if (!t) return;
  document.getElementById('txt-content').value = t.text;
  document.getElementById('txt-size').value = t.size;
  document.getElementById('txt-color').value = t.color;
  document.getElementById('txt-bg').value = t.bg;
  document.getElementById('txt-pos').value = t.pos;
  toast('✅ تم تطبيق القالب — اضغط إضافة النص');
}

// ─── تبويب التحليل الذكي ───
function prvAiImg(){
  const url = document.getElementById('ai-img-url')?.value.trim();
  const prv = document.getElementById('ai-img-prv');
  const img = document.getElementById('ai-img');
  if (!prv || !img) return;
  if (url && (url.startsWith('https://') || url.startsWith('data:'))) {
    img.src = url; prv.style.display = 'block';
  } else prv.style.display = 'none';
}

async function analyzeImg(action){
  const url = document.getElementById('ai-img-url')?.value.trim() || document.getElementById('des-url')?.value.trim();
  if (!url) return toast('⚠️ أدخل رابط الصورة أولاً');
  const prompt = document.getElementById('des-prompt')?.value.trim();
  const loading = document.getElementById('des-loading');
  const result = document.getElementById('des-result');
  const actions = document.getElementById('des-result-actions');
  const empty = document.getElementById('des-empty');
  if (loading) loading.style.display = 'block';
  if (result) result.style.display = 'none';
  if (actions) actions.style.display = 'none';
  if (empty) empty.style.display = 'none';
  const d = await api('/api/images/process', { method:'POST', body: JSON.stringify({ image_url:url, action, prompt }) });
  if (loading) loading.style.display = 'none';
  if (d.success) {
    if (result) { result.style.display = 'block'; result.textContent = d.result; }
    if (actions) actions.style.display = 'flex';
  } else {
    if (empty) empty.style.display = 'block';
    toast('❌ ' + (d.message||'فشل التحليل'));
  }
}

function copyDesResult(){
  const txt = document.getElementById('des-result')?.textContent;
  if (txt) navigator.clipboard.writeText(txt).then(() => toast('✅ تم النسخ'));
}

// ─── مولّد النصوص ───
async function generateText(){
  const name = document.getElementById('gt-name')?.value.trim();
  if (!name) return toast('⚠️ أدخل اسم المنتج');
  const btn = document.getElementById('gt-btn');
  btn.disabled = true; btn.textContent = '⏳ جاري التوليد...';
  const d = await api('/api/images/generate-text', { method:'POST', body: JSON.stringify({
    product_name: name,
    product_desc: document.getElementById('gt-desc')?.value.trim(),
    platform: document.getElementById('gt-platform')?.value,
    tone: document.getElementById('gt-tone')?.value
  })});
  btn.disabled = false; btn.textContent = '✨ توليد المحتوى';
  const res = document.getElementById('gt-result');
  if (d.success && d.content) {
    const c = d.content;
    res.innerHTML = `
      <div style="background:var(--surface2);border-radius:12px;padding:14px;margin-bottom:9px">
        ${c.title?`<div style="font-weight:900;font-size:.95rem;margin-bottom:7px">${esc(c.title)}</div>`:''}
        ${c.body?`<div style="font-size:.84rem;line-height:1.75;margin-bottom:8px">${esc(c.body)}</div>`:''}
        ${c.cta?`<div style="color:var(--accent);font-weight:700;font-size:.82rem;margin-bottom:6px">👉 ${esc(c.cta)}</div>`:''}
        ${c.emojis?`<div style="font-size:1.1rem;margin-bottom:7px">${esc(c.emojis)}</div>`:''}
        ${c.hashtags&&c.hashtags.length?`<div style="display:flex;flex-wrap:wrap;gap:4px">${c.hashtags.map(h=>`<span style="background:rgba(79,142,247,.12);color:var(--accent);padding:2px 8px;border-radius:20px;font-size:.72rem">#${esc(h)}</span>`).join('')}</div>`:''}
      </div>
      <button class="btn bo bsm" onclick="navigator.clipboard.writeText(document.getElementById('gt-result').innerText).then(()=>toast('✅ تم النسخ'))">📋 نسخ الكل</button>
    `;
  } else toast('❌ ' + (d.message||'فشل التوليد'));
}

// ─── تبويب مجموعة الصور (Batch) ───
let batchImages = []; // [{id, file, dataUrl, name, processed, processedUrl}]
let batchDecorConfig = null;

// إضافة ملفات
function batchAddFiles(files) {
  Array.from(files).forEach(file => {
    const id = Date.now() + Math.random();
    const reader = new FileReader();
    reader.onload = e => {
      batchImages.push({ id, file, dataUrl: e.target.result, name: file.name, processed: false, processedUrl: null });
      renderBatchThumbs();
    };
    reader.readAsDataURL(file);
  });
}

function renderBatchThumbs() {
  const list = document.getElementById('batch-list');
  const thumbs = document.getElementById('batch-thumbs');
  const count = document.getElementById('batch-count');
  if (!batchImages.length) { list.style.display = 'none'; return; }
  list.style.display = 'block';
  count.textContent = batchImages.length + ' صورة';
  thumbs.innerHTML = batchImages.map(img => `
    <div style="position:relative;border-radius:10px;overflow:hidden;border:2px solid ${img.processed?'var(--green)':'var(--border)'}">
      <img src="${img.processedUrl || img.dataUrl}" style="width:100%;height:80px;object-fit:cover;display:block">
      ${img.processed ? '<div style="position:absolute;top:3px;right:3px;background:var(--green);border-radius:50%;width:16px;height:16px;display:flex;align-items:center;justify-content:center;font-size:.55rem;color:#fff">✅</div>' : ''}
      <button onclick="batchRemoveImg('${img.id}')" style="position:absolute;top:2px;left:2px;background:rgba(0,0,0,.7);border:none;border-radius:50%;width:18px;height:18px;cursor:pointer;color:#fff;font-size:.6rem;display:flex;align-items:center;justify-content:center">✕</button>
    </div>
  `).join('');

  // Drag & Drop effect
  const drop = document.getElementById('batch-drop');
  if (drop) drop.style.borderColor = 'var(--accent)';
}

function batchRemoveImg(id) {
  batchImages = batchImages.filter(i => String(i.id) !== String(id));
  renderBatchThumbs();
  renderBatchResults();
}

function clearBatch() {
  batchImages = [];
  renderBatchThumbs();
  renderBatchResults();
  batchDecorConfig = null;
  document.getElementById('batch-decor-preview').style.display = 'none';
}

// اقتراح ديكور ذكي
async function batchSuggestDecor() {
  const btn = document.getElementById('batch-suggest-btn');
  btn.disabled = true; btn.textContent = '⏳ AI يفكر...';
  const d = await api('/api/images/suggest-decor', { method: 'POST', body: JSON.stringify({
    product_type: document.getElementById('batch-product-type').value,
    store_style: document.getElementById('batch-style').value,
    color_scheme: document.getElementById('batch-color1-hex').value
  })});
  btn.disabled = false; btn.textContent = '🤖 اقترح ديكور ذكي بالـ AI';
  if (d.success) {
    batchDecorConfig = d.decor;
    // تحديث الألوان
    if (d.decor.bg_colors?.[0]) {
      document.getElementById('batch-color1').value = d.decor.bg_colors[0];
      document.getElementById('batch-color1-hex').value = d.decor.bg_colors[0];
    }
    if (d.decor.bg_colors?.[1]) {
      document.getElementById('batch-color2').value = d.decor.bg_colors[1];
      document.getElementById('batch-color2-hex').value = d.decor.bg_colors[1];
    }
    const prv = document.getElementById('batch-decor-preview');
    prv.style.display = 'block';
    prv.innerHTML = `
      <div style="display:flex;align-items:center;gap:9px;margin-bottom:7px">
        <div style="width:36px;height:36px;border-radius:8px;background:linear-gradient(${d.decor.gradient_direction||'135deg'},${(d.decor.bg_colors||['#4f8ef7','#7c3aed']).join(',')});flex-shrink:0"></div>
        <div><div style="font-weight:700;font-size:.84rem">${esc(d.decor.style_name||'')}</div><div style="font-size:.75rem;color:var(--text2)">${esc(d.decor.description||'')}</div></div>
      </div>
      ${d.decor.texts?.length ? `<div style="font-size:.75rem;color:var(--text2)">نصوص مقترحة: ${d.decor.texts.map(t=>esc(t.text)).join(' · ')}</div>` : ''}
    `;
    toast('✅ تم اقتراح ديكور من AI');
  } else toast('❌ ' + (d.message||'فشل'));
}

// دالة بناء الديكور على Canvas
function applyDecorToCanvas(canvas, imgEl, config, extraText) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;

  // ─── الخلفية ───
  if (config.bg_type === 'gradient' || !config.bg_type) {
    const colors = config.bg_colors || ['#4f8ef7', '#7c3aed'];
    const angle = parseFloat(config.gradient_direction||'135deg') * Math.PI / 180;
    const x1 = w/2 - Math.cos(angle) * w/2, y1 = h/2 - Math.sin(angle) * h/2;
    const x2 = w/2 + Math.cos(angle) * w/2, y2 = h/2 + Math.sin(angle) * h/2;
    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    grad.addColorStop(0, colors[0]);
    grad.addColorStop(1, colors[1] || colors[0]);
    ctx.fillStyle = grad;
  } else if (config.bg_type === 'solid') {
    ctx.fillStyle = config.bg_colors?.[0] || '#4f8ef7';
  } else if (config.bg_type === 'pattern') {
    // نمط نقاط
    ctx.fillStyle = config.bg_colors?.[0] || '#1a2234';
  }
  ctx.fillRect(0, 0, w, h);

  // نمط خفيف
  if (config.bg_type === 'pattern') {
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#ffffff';
    for (let x = 0; x < w; x += 30) for (let y = 0; y < h; y += 30) { ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI*2); ctx.fill(); }
    ctx.globalAlpha = 1;
  }

  // ─── ظل المنتج ───
  if (config.shadow) {
    ctx.shadowColor = config.shadow.color || 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = config.shadow.blur || 20;
    ctx.shadowOffsetX = config.shadow.offsetX || 0;
    ctx.shadowOffsetY = config.shadow.offsetY || 10;
  }

  // ─── الصورة ───
  const pad = 30;
  const imgW = w - pad*2, imgH = h - pad*2;
  const ratio = Math.min(imgW/imgEl.naturalWidth, imgH/imgEl.naturalHeight);
  const dw = imgEl.naturalWidth * ratio, dh = imgEl.naturalHeight * ratio;
  const dx = (w - dw) / 2, dy = (h - dh) / 2;

  // border للصورة
  if (config.border?.enabled) {
    ctx.shadowBlur = 0;
    ctx.strokeStyle = config.border.color || '#ffffff';
    ctx.lineWidth = config.border.width || 3;
    ctx.roundRect ? ctx.roundRect(dx-2, dy-2, dw+4, dh+4, config.border.radius||12) : ctx.strokeRect(dx-2, dy-2, dw+4, dh+4);
    ctx.stroke();
  }

  ctx.drawImage(imgEl, dx, dy, dw, dh);
  ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;

  // ─── نصوص الديكور ───
  const allTexts = [...(config.texts||[])];
  if (extraText) allTexts.push({ text: extraText, pos: 'bottom', size: 28, color: '#ffffff', bg: 'black' });

  allTexts.forEach(t => {
    const fs = t.size || 32;
    ctx.font = `bold ${fs}px Tajawal, Arial`;
    ctx.textAlign = 'center';
    const tw = ctx.measureText(t.text).width;
    let tx = w/2, ty;
    switch(t.pos) {
      case 'top': ty = fs + 14; break;
      case 'bottom': ty = h - 16; break;
      case 'top-right': tx = w - tw/2 - 16; ty = fs + 14; break;
      case 'bottom-right': tx = w - tw/2 - 16; ty = h - 16; break;
      default: ty = h/2;
    }
    // خلفية النص
    if (t.bg && t.bg !== 'none') {
      ctx.globalAlpha = 0.8;
      if (t.bg === 'black') ctx.fillStyle = '#000000';
      else if (t.bg === 'white') ctx.fillStyle = '#ffffff';
      else if (t.bg === 'gradient') {
        const g = ctx.createLinearGradient(tx-tw/2-12, 0, tx+tw/2+12, 0);
        g.addColorStop(0, config.bg_colors?.[0]||'#4f8ef7');
        g.addColorStop(1, config.bg_colors?.[1]||'#7c3aed');
        ctx.fillStyle = g;
      } else ctx.fillStyle = '#4f8ef7';
      const bh = fs + 12;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(tx-tw/2-12, ty-fs-4, tw+24, bh, 8); ctx.fill(); }
      else ctx.fillRect(tx-tw/2-12, ty-fs-4, tw+24, bh);
      ctx.globalAlpha = 1;
    }
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 5;
    ctx.fillStyle = t.color || '#ffffff';
    ctx.fillText(t.text, tx, ty);
    ctx.shadowBlur = 0;
  });
}

// الحصول على الديكور الحالي من الـ UI
function getCurrentDecor() {
  if (batchDecorConfig) return batchDecorConfig;
  return {
    bg_type: 'gradient',
    bg_colors: [
      document.getElementById('batch-color1-hex')?.value || '#4f8ef7',
      document.getElementById('batch-color2-hex')?.value || '#7c3aed'
    ],
    gradient_direction: '135deg',
    shadow: { color: 'rgba(0,0,0,0.4)', blur: 24, offsetX: 0, offsetY: 12 },
    border: { enabled: false },
    texts: []
  };
}

// تطبيق إزالة الخلفية على الكل
async function batchRemoveBg() {
  if (!batchImages.length) return toast('⚠️ أضف صوراً أولاً');
  const btn = document.getElementById('batch-rm-btn');
  btn.disabled = true;
  setBatchProgress(true, 'إزالة الخلفيات...', 0);
  let done = 0;
  for (const img of batchImages) {
    const d = await api('/api/images/remove-bg', { method:'POST', body: JSON.stringify({ image_base64: img.dataUrl }) });
    if (d.success) { img.processedUrl = d.url; img.processed = true; }
    done++;
    setBatchProgress(true, `إزالة الخلفية ${done}/${batchImages.length}`, Math.round(done/batchImages.length*100));
  }
  setBatchProgress(false);
  btn.disabled = false;
  renderBatchThumbs();
  renderBatchResults();
  toast(`✅ تمت إزالة الخلفية من ${done} صورة`);
}

// تطبيق الديكور على الكل
async function batchApplyDecor() {
  if (!batchImages.length) return toast('⚠️ أضف صوراً أولاً');
  const config = getCurrentDecor();
  const extraText = document.getElementById('batch-text')?.value.trim() || '';
  const btn = document.getElementById('batch-decor-btn');
  btn.disabled = true;
  setBatchProgress(true, 'تطبيق الديكور...', 0);
  let done = 0;
  for (const img of batchImages) {
    await new Promise(res => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 800; canvas.height = 800;
        applyDecorToCanvas(canvas, image, config, extraText);
        img.processedUrl = canvas.toDataURL('image/png');
        img.processed = true;
        done++;
        setBatchProgress(true, `تصميم ${done}/${batchImages.length}`, Math.round(done/batchImages.length*100));
        res();
      };
      image.onerror = () => { done++; res(); };
      image.src = img.processedUrl || img.dataUrl;
    });
  }
  setBatchProgress(false);
  btn.disabled = false;
  renderBatchThumbs();
  renderBatchResults();
  toast(`✅ تم تطبيق الديكور على ${done} صورة`);
}

// إزالة خلفية + ديكور معاً
async function batchApplyAll() {
  if (!batchImages.length) return toast('⚠️ أضف صوراً أولاً');
  const btn = document.getElementById('batch-all-btn');
  btn.disabled = true;
  setBatchProgress(true, 'إزالة الخلفيات...', 0);

  // خطوة 1: إزالة الخلفية
  let done = 0;
  for (const img of batchImages) {
    const d = await api('/api/images/remove-bg', { method:'POST', body: JSON.stringify({ image_base64: img.dataUrl }) });
    if (d.success) img.processedUrl = d.url;
    done++;
    setBatchProgress(true, `إزالة الخلفية ${done}/${batchImages.length}`, Math.round(done/batchImages.length*50));
  }

  // خطوة 2: تطبيق الديكور
  const config = getCurrentDecor();
  const extraText = document.getElementById('batch-text')?.value.trim() || '';
  done = 0;
  for (const img of batchImages) {
    await new Promise(res => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 800; canvas.height = 800;
        applyDecorToCanvas(canvas, image, config, extraText);
        img.processedUrl = canvas.toDataURL('image/png');
        img.processed = true;
        done++;
        setBatchProgress(true, `تصميم ${done}/${batchImages.length}`, 50 + Math.round(done/batchImages.length*50));
        res();
      };
      image.onerror = () => { done++; res(); };
      image.src = img.processedUrl || img.dataUrl;
    });
  }

  setBatchProgress(false);
  btn.disabled = false;
  renderBatchThumbs();
  renderBatchResults();
  toast(`✅ تم معالجة ${batchImages.length} صورة`);
}

// تحميل كل الصور
function batchDownloadAll() {
  const processed = batchImages.filter(i => i.processedUrl);
  if (!processed.length) return toast('⚠️ لا توجد صور معالجة بعد');
  processed.forEach((img, i) => {
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = img.processedUrl;
      a.download = `socialos-${i+1}-${img.name || 'image'}.png`;
      a.click();
    }, i * 300);
  });
  toast(`⬇️ جاري تحميل ${processed.length} صورة...`);
}

function renderBatchResults() {
  const res = document.getElementById('batch-results');
  const processed = batchImages.filter(i => i.processedUrl);
  if (!processed.length) { res.innerHTML='<div class="empty"><div class="ei">🖼️</div><p>أضف صوراً وطبّق التصميم</p></div>'; return; }
  res.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px">
      ${processed.map((img,i) => `
        <div style="border-radius:10px;overflow:hidden;border:1px solid var(--border);position:relative">
          <img src="${img.processedUrl}" style="width:100%;height:100px;object-fit:cover;display:block">
          <button onclick="batchDownloadOne('${img.id}')" style="position:absolute;bottom:0;right:0;left:0;background:rgba(0,0,0,.65);border:none;color:#fff;padding:5px;cursor:pointer;font-family:'Tajawal',sans-serif;font-size:.7rem;font-weight:700">⬇️ تحميل</button>
        </div>
      `).join('')}
    </div>
  `;
}

function batchDownloadOne(id) {
  const img = batchImages.find(i => String(i.id) === String(id));
  if (!img?.processedUrl) return;
  const a = document.createElement('a');
  a.href = img.processedUrl;
  a.download = 'socialos-' + (img.name||'image') + '.png';
  a.click();
}

function setBatchProgress(show, label, pct) {
  const el = document.getElementById('batch-progress');
  if (!el) return;
  el.style.display = show ? 'block' : 'none';
  if (show) {
    document.getElementById('batch-progress-label').textContent = label || '';
    document.getElementById('batch-progress-pct').textContent = (pct||0) + '%';
    document.getElementById('batch-progress-bar').style.width = (pct||0) + '%';
  }
}

// Drag & Drop
document.addEventListener('DOMContentLoaded', () => {
  const drop = document.getElementById('batch-drop');
  if (!drop) return;
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.style.borderColor='var(--accent)'; drop.style.background='rgba(79,142,247,.05)'; });
  drop.addEventListener('dragleave', () => { drop.style.borderColor='var(--border)'; drop.style.background=''; });
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.style.borderColor='var(--border)'; drop.style.background='';
    batchAddFiles(e.dataTransfer.files);
  });
  // مزامنة ألوان batch
  ['batch-color1','batch-color2'].forEach((id,i) => {
    const picker = document.getElementById(id);
    const hex = document.getElementById(id+'-hex');
    if (picker && hex) picker.addEventListener('input', () => hex.value = picker.value);
  });
});
// تطبيق ألوان المتجر على الديكور
function applyBrandColors(){
  const identity = JSON.parse(localStorage.getItem('sos_identity')||'{}');
  if (!identity.primary_color) return toast('⚠️ أضف ألوان متجرك في صفحة هوية المتجر أولاً');
  const c1el = document.getElementById('batch-color1');
  const c1hex = document.getElementById('batch-color1-hex');
  const c2el = document.getElementById('batch-color2');
  const c2hex = document.getElementById('batch-color2-hex');
  if (c1el) c1el.value = identity.primary_color;
  if (c1hex) c1hex.value = identity.primary_color;
  if (c2el) c2el.value = identity.secondary_color||'#7c3aed';
  if (c2hex) c2hex.value = identity.secondary_color||'#7c3aed';
  batchDecorConfig = { ...getCurrentDecor(), bg_colors:[identity.primary_color, identity.secondary_color||'#7c3aed'] };
  toast('✅ تم تطبيق ألوان متجرك');
}

document.addEventListener('DOMContentLoaded', () => {
  if (ti) ti.addEventListener('input', loadCanvasImg);
  // مزامنة لون النص
  const tc = document.getElementById('txt-color');
  if (tc) tc.addEventListener('input', () => {
    const hex = document.getElementById('txt-color-hex');
    if (hex) hex.value = tc.value;
  });
});

// ============================================================
// ============================================================
// NAVIGATION HISTORY — سهم الرجوع
