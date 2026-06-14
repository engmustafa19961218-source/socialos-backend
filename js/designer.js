// ============================================================
// DESIGNER — مولّد الإعلانات (Server-Side Compositing)
// ============================================================

let dsProdFile = null;
let dsProdUrl = null;
let dsDecorFile = null;
let dsDecorUrl = null;
let dsSelectedDecorId = null;
let dsCurrentCat = 'all';

const DS_DECORS = [
  // غرف فارغة
  { id:1,  cat:'empty',    label:'غرفة معيشة فارغة',      url:'https://images.unsplash.com/photo-1598928636135-d146006ff4be?w=800&q=85' },
  { id:2,  cat:'empty',    label:'غرفة كريمية فارغة',      url:'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800&q=85' },
  { id:3,  cat:'empty',    label:'غرفة بيضاء مودرن',       url:'https://images.unsplash.com/photo-1484101403633-562f891dc89a?w=800&q=85' },
  { id:4,  cat:'empty',    label:'غرفة رمادية فارغة',      url:'https://images.unsplash.com/photo-1505691723518-36a5ac3be353?w=800&q=85' },
  { id:5,  cat:'empty',    label:'مكتب فارغ أنيق',         url:'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=85' },
  { id:6,  cat:'empty',    label:'غرفة نوم فارغة فاخرة',   url:'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=800&q=85' },
  { id:7,  cat:'empty',    label:'غرفة بيضاء إضاءة طبيعية',url:'https://images.unsplash.com/photo-1560440021-33f9b867899d?w=800&q=85' },
  // معيشة
  { id:8,  cat:'living',   label:'جلسة فاخرة كلاسيك',      url:'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800&q=85' },
  { id:9,  cat:'living',   label:'ديكور ذهبي فاخر',         url:'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?w=800&q=85' },
  { id:10, cat:'living',   label:'غرفة بيج دافئة',          url:'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=800&q=85' },
  { id:11, cat:'living',   label:'جلسة رمادية أنيقة',       url:'https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?w=800&q=85' },
  { id:12, cat:'living',   label:'معيشة مودرن بيضاء',       url:'https://images.unsplash.com/photo-1567016432779-094069958ea5?w=800&q=85' },
  // استوديو
  { id:13, cat:'studio',   label:'خلفية بيضاء نظيفة',       url:'https://images.unsplash.com/photo-1525909002-1b05e0c869d8?w=800&q=85' },
  { id:14, cat:'studio',   label:'استوديو رمادي ناعم',      url:'https://images.unsplash.com/photo-1533090161767-e6ffed986c88?w=800&q=85' },
  { id:15, cat:'studio',   label:'خلفية كريمية',            url:'https://images.unsplash.com/photo-1553356084-58ef4a67b2a7?w=800&q=85' },
  // دارك
  { id:16, cat:'dark',     label:'دارك ذهبي فاخر',          url:'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=800&q=85' },
  { id:17, cat:'dark',     label:'خلفية سوداء أنيقة',       url:'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&q=85' },
  { id:18, cat:'dark',     label:'غرفة داكنة فاخرة',        url:'https://images.unsplash.com/photo-1615873968403-89e068629265?w=800&q=85' },
  // طبيعة
  { id:19, cat:'nature',   label:'نباتات داخلية خضراء',     url:'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800&q=85' },
  { id:20, cat:'nature',   label:'طبيعة هادئة',             url:'https://images.unsplash.com/photo-1444605806593-9700ade7e53d?w=800&q=85' },
  // فني
  { id:21, cat:'abstract', label:'تدرج بنفسجي فاخر',        url:'https://images.unsplash.com/photo-1557682250-33bd709cbe85?w=800&q=85' },
  { id:22, cat:'abstract', label:'تدرج وردي ذهبي',          url:'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=800&q=85' },
  { id:23, cat:'abstract', label:'ألوان زرقاء فنية',        url:'https://images.unsplash.com/photo-1541701494587-cb58502866ab?w=800&q=85' },
];

function ldDesigner() {
  dsRenderDecorGrid();
}

// ---- تبويبات الديكور ----
function dsFilterCat(cat, btn) {
  dsCurrentCat = cat;
  document.querySelectorAll('.dsDecorTab').forEach(t => {
    t.classList.remove('ba'); t.classList.add('bo');
  });
  btn.classList.remove('bo'); btn.classList.add('ba');
  dsRenderDecorGrid();
}

function dsRenderDecorGrid() {
  const grid = document.getElementById('dsDecorGrid');
  if (!grid) return;
  const list = dsCurrentCat === 'all' ? DS_DECORS : DS_DECORS.filter(d => d.cat === dsCurrentCat);
  grid.innerHTML = '';
  list.forEach(d => {
    const div = document.createElement('div');
    div.style.cssText = `position:relative;border-radius:9px;overflow:hidden;aspect-ratio:1;cursor:pointer;border:2px solid ${dsSelectedDecorId===d.id?'var(--accent)':'transparent'};transition:border-color .15s`;
    const img = document.createElement('img');
    img.src = d.url;
    img.loading = 'lazy';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
    const label = document.createElement('div');
    label.style.cssText = 'position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,.7));padding:12px 5px 5px;font-size:.62rem;color:#fff;font-weight:600';
    label.textContent = d.label;
    div.appendChild(img); div.appendChild(label);
    if (dsSelectedDecorId === d.id) {
      const check = document.createElement('div');
      check.style.cssText = 'position:absolute;top:5px;right:5px;background:var(--accent);border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:.65rem;color:#fff';
      check.textContent = '✓';
      div.appendChild(check);
    }
    div.onclick = () => dsPickDecor(d.id);
    grid.appendChild(div);
  });
}

function dsPickDecor(id) {
  dsSelectedDecorId = id;
  dsDecorFile = null;
  const decor = DS_DECORS.find(d => d.id === id);
  dsDecorUrl = decor.url;
  // عرض preview
  const preview = document.getElementById('dsDecorPreview');
  const wrap = document.getElementById('dsDecorPreviewWrap');
  if (preview && wrap) { preview.src = decor.url; wrap.style.display = 'block'; }
  dsRenderDecorGrid();
}

// ---- صورة المنتج ----
function addProdImgs(input) {
  const file = input.files[0];
  if (!file) return;
  dsProdFile = file;

  const reader = new FileReader();
  reader.onload = function(e) {
    dsProdUrl = e.target.result;

    const grid = document.getElementById('dsProdGrid');
    const thumbRow = document.getElementById('dsProdThumbRow');

    if (grid) {
      grid.innerHTML = '';
      const div = document.createElement('div');
      div.style.cssText = 'position:relative;border-radius:10px;overflow:hidden;aspect-ratio:1;border:2px solid var(--accent);background:#111';
      const img = document.createElement('img');
      img.src = dsProdUrl;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
      const btn = document.createElement('button');
      btn.textContent = '✕';
      btn.style.cssText = 'position:absolute;top:4px;left:4px;background:rgba(0,0,0,.7);border:none;border-radius:50%;width:22px;height:22px;color:#fff;cursor:pointer;font-size:.7rem';
      btn.onclick = () => {
        dsProdFile = null; dsProdUrl = null;
        grid.innerHTML = '';
        if (thumbRow) thumbRow.innerHTML = '<span style="font-size:.75rem;color:#888">ارفع صور المنتج أولاً</span>';
      };
      div.appendChild(img);
      div.appendChild(btn);
      grid.appendChild(div);
    }

    if (thumbRow) {
      thumbRow.innerHTML = '';
      const th = document.createElement('img');
      th.src = dsProdUrl;
      th.style.cssText = 'width:44px;height:44px;object-fit:cover;border-radius:8px;border:2px solid var(--accent)';
      thumbRow.appendChild(th);
    }
  };
  reader.readAsDataURL(file);
  input.value = '';
}

// ---- الديكور المرفوع يدوياً ----
function setDecorImg(input) {
  const file = input.files[0];
  if (!file) return;
  dsDecorFile = file;
  dsDecorUrl = null;
  dsSelectedDecorId = null;
  const preview = document.getElementById('dsDecorPreview');
  const wrap = document.getElementById('dsDecorPreviewWrap');
  if (preview && wrap) { preview.src = URL.createObjectURL(file); wrap.style.display = 'block'; }
  document.getElementById('dsDecorBtn').textContent = '🔄 تغيير الصورة';
  dsRenderDecorGrid();
  input.value = '';
}

function clearDecor() {
  dsDecorFile = null; dsDecorUrl = null; dsSelectedDecorId = null;
  const wrap = document.getElementById('dsDecorPreviewWrap');
  if (wrap) wrap.style.display = 'none';
  const btn = document.getElementById('dsDecorBtn');
  if (btn) btn.textContent = '📁 أو ارفع صورتك الخاصة';
  dsRenderDecorGrid();
}

// ---- التوليد (Server-Side) ----
function dsSetStatus(msg, color) {
  const el = document.getElementById('dsStatus');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = msg;
  el.style.color = color || 'var(--text2)';
}

async function dsGenerate() {
  if (!dsProdFile) { toast('❌ ارفع صورة المنتج أولاً'); return; }
  if (!dsDecorFile && !dsDecorUrl) { toast('❌ اختر ديكوراً أو ارفع صورة خلفية'); return; }

  const btn = document.getElementById('dsGenBtn');
  btn.disabled = true; btn.textContent = '⏳ جاري التوليد...';
  document.getElementById('dsResultArea').style.display = 'none';
  dsSetStatus('⏳ جاري دمج الصور في السيرفر...');

  try {
    // جلب بيانات المتجر
    let storeName = '', storePhone = '';
    try {
      const biz = await api('/api/business-profile');
      storeName = biz.store_name || '';
      storePhone = biz.whatsapp_number || biz.phone || '';
    } catch(e) {}

    const title = document.getElementById('dsAdTitle')?.value || '';
    const sub = document.getElementById('dsAdSub')?.value || '';

    const formData = new FormData();
    formData.append('product', dsProdFile);
    if (dsDecorFile) {
      formData.append('decor', dsDecorFile);
    } else {
      formData.append('decor_url', dsDecorUrl);
    }
    formData.append('title', title);
    formData.append('sub', sub);
    formData.append('store_name', storeName);
    formData.append('store_phone', storePhone);

    const r = await fetch('/api/compose-ad', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: formData
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.message || 'فشل التوليد');
    }

    const blob = await r.blob();
    const src = URL.createObjectURL(blob);

    const grid = document.getElementById('dsResultGrid');
    grid.innerHTML = '';
    const img = document.createElement('img');
    img.src = src;
    img.style.cssText = 'width:100%;border-radius:12px;margin-bottom:8px';
    const dlBtn = document.createElement('button');
    dlBtn.className = 'btn ba';
    dlBtn.style.width = '100%';
    dlBtn.textContent = '⬇️ تنزيل الإعلان';
    dlBtn.onclick = () => { const a = document.createElement('a'); a.href = src; a.download = `اعلان_${Date.now()}.jpg`; a.click(); };
    grid.appendChild(img); grid.appendChild(dlBtn);

    document.getElementById('dsResultArea').style.display = 'block';
    dsSetStatus('✅ الإعلان جاهز!', '#34d399');

  } catch(e) {
    dsSetStatus('❌ ' + e.message, '#f87171');
  }

  btn.disabled = false; btn.textContent = '✨ توليد الإعلان';
}
