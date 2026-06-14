// ============================================================
// DESIGNER — مولّد الإعلانات الذكي
// ============================================================

let dsProdFiles = [];
let dsDecorFile = null;
let dsDecorUrl = null;
let dsSelectedProdIdx = 0;
let dsCurrentCat = 'all';

const DS_DECORS = [
  // غرف فارغة (مثالية لوضع الأثاث)
  { id: 1,  cat: 'empty', label: 'غرفة معيشة فارغة بيضاء',   url: 'https://images.unsplash.com/photo-1484101403633-562f891dc89a?w=800&q=85' },
  { id: 2,  cat: 'empty', label: 'غرفة كريمية فارغة',         url: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800&q=85' },
  { id: 3,  cat: 'empty', label: 'غرفة رمادية مودرن',         url: 'https://images.unsplash.com/photo-1598928636135-d146006ff4be?w=800&q=85' },
  { id: 4,  cat: 'empty', label: 'غرفة بيضاء إضاءة طبيعية',  url: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=85' },
  { id: 5,  cat: 'empty', label: 'غرفة خشبية دافئة',          url: 'https://images.unsplash.com/photo-1505691723518-36a5ac3be353?w=800&q=85' },
  { id: 6,  cat: 'empty', label: 'مكتب فارغ أنيق',            url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=85' },
  { id: 7,  cat: 'empty', label: 'غرفة نوم فارغة فاخرة',      url: 'https://images.unsplash.com/photo-1556909172-54557c7e4fb7?w=800&q=85' },
  { id: 8,  cat: 'empty', label: 'غرفة صغيرة بيضاء',          url: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=800&q=85' },

  // غرف معيشة مفروشة
  { id: 9,  cat: 'living', label: 'جلسة فاخرة كلاسيك',        url: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800&q=85' },
  { id: 10, cat: 'living', label: 'ديكور ذهبي فاخر',           url: 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?w=800&q=85' },
  { id: 11, cat: 'living', label: 'غرفة بيج دافئة',            url: 'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=800&q=85' },
  { id: 12, cat: 'living', label: 'جلسة رمادية أنيقة',         url: 'https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?w=800&q=85' },
  { id: 13, cat: 'living', label: 'معيشة مودرن بيضاء',         url: 'https://images.unsplash.com/photo-1567016432779-094069958ea5?w=800&q=85' },
  { id: 14, cat: 'living', label: 'جلسة بني داكن',             url: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&q=85' },

  // استوديو
  { id: 15, cat: 'studio', label: 'خلفية بيضاء نظيفة',         url: 'https://images.unsplash.com/photo-1601628828688-632f38a5a7d0?w=800&q=85' },
  { id: 16, cat: 'studio', label: 'استوديو رمادي ناعم',        url: 'https://images.unsplash.com/photo-1604014237800-1c9102c219da?w=800&q=85' },
  { id: 17, cat: 'studio', label: 'خلفية كريمية استوديو',      url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&q=85' },
  { id: 18, cat: 'studio', label: 'خلفية بيضاء ظلال',          url: 'https://images.unsplash.com/photo-1603712725038-e9334ae8f39f?w=800&q=85' },

  // دارك
  { id: 19, cat: 'dark', label: 'دارك ذهبي فاخر',              url: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=800&q=85' },
  { id: 20, cat: 'dark', label: 'خلفية سوداء أنيقة',           url: 'https://images.unsplash.com/photo-1565538810643-b5bdb714032a?w=800&q=85' },
  { id: 21, cat: 'dark', label: 'دارك مع إضاءة جانبية',        url: 'https://images.unsplash.com/photo-1572297748986-13545eff1d9d?w=800&q=85' },
  { id: 22, cat: 'dark', label: 'غرفة داكنة فاخرة',            url: 'https://images.unsplash.com/photo-1615873968403-89e068629265?w=800&q=85' },

  // طبيعة
  { id: 23, cat: 'nature', label: 'نباتات داخلية خضراء',       url: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800&q=85' },
  { id: 24, cat: 'nature', label: 'طبيعة هادئة',               url: 'https://images.unsplash.com/photo-1444605806593-9700ade7e53d?w=800&q=85' },
  { id: 25, cat: 'nature', label: 'أوراق خضراء ناعمة',         url: 'https://images.unsplash.com/photo-1446071103084-c257b5f70672?w=800&q=85' },

  // فني / تجريدي
  { id: 26, cat: 'abstract', label: 'تدرج بنفسجي فاخر',        url: 'https://images.unsplash.com/photo-1557682250-33bd709cbe85?w=800&q=85' },
  { id: 27, cat: 'abstract', label: 'موجات ذهبية فنية',        url: 'https://images.unsplash.com/photo-1554034483-04fda0d3507b?w=800&q=85' },
  { id: 28, cat: 'abstract', label: 'تدرج وردي ذهبي',          url: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=800&q=85' },
  { id: 29, cat: 'abstract', label: 'ألوان زرقاء فنية',        url: 'https://images.unsplash.com/photo-1541701494587-cb58502866ab?w=800&q=85' },
];

let dsSelectedDecorId = null;

function ldDesigner() {
  dsRenderDecorGrid();
}

// ---- شبكة الديكورات ----
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
  grid.innerHTML = list.map(d => `
    <div onclick="dsPickDecor(${d.id})" style="
      position:relative;border-radius:9px;overflow:hidden;aspect-ratio:1;cursor:pointer;
      border:2px solid ${dsSelectedDecorId===d.id ? 'var(--accent)' : 'transparent'};
      transition:border-color .15s;
    ">
      <img src="${d.url}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block">
      <div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,.7));padding:12px 5px 5px;font-size:.62rem;color:#fff;font-weight:600">${d.label}</div>
      ${dsSelectedDecorId===d.id ? '<div style="position:absolute;top:5px;right:5px;background:var(--accent);border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:.65rem;color:#fff">✓</div>' : ''}
    </div>
  `).join('');
}

async function dsPickDecor(id) {
  dsSelectedDecorId = id;
  dsDecorFile = null;
  const decor = DS_DECORS.find(d => d.id === id);
  dsDecorUrl = decor.url;

  // عرض preview
  const preview = document.getElementById('dsDecorPreview');
  const wrap = document.getElementById('dsDecorPreviewWrap');
  preview.src = decor.url;
  wrap.style.display = 'block';
  document.getElementById('dsDecorBtn').textContent = '📁 أو ارفع صورتك الخاصة';

  dsRenderDecorGrid();
}

// ---- صور المنتج ----
function addProdImgs(input) {
  Array.from(input.files).forEach(f => dsProdFiles.push(f));
  renderProdGrid();
  input.value = '';
}

function renderProdGrid() {
  const grid = document.getElementById('dsProdGrid');
  const thumbRow = document.getElementById('dsProdThumbRow');
  if (!dsProdFiles.length) {
    grid.innerHTML = '';
    thumbRow.innerHTML = '<span style="font-size:.75rem;color:#888">ارفع صور المنتج أولاً</span>';
    return;
  }
  grid.innerHTML = dsProdFiles.map((f, i) => `
    <div style="position:relative;border-radius:10px;overflow:hidden;aspect-ratio:1;border:2px solid ${i===dsSelectedProdIdx?'var(--accent)':'#2a2a45'}">
      <img src="${URL.createObjectURL(f)}" style="width:100%;height:100%;object-fit:cover">
      <button onclick="removeProdImg(${i})" style="position:absolute;top:4px;left:4px;background:rgba(0,0,0,.7);border:none;border-radius:50%;width:22px;height:22px;color:#fff;cursor:pointer;font-size:.7rem">✕</button>
    </div>
  `).join('');
  thumbRow.innerHTML = dsProdFiles.map((f, i) => `
    <img src="${URL.createObjectURL(f)}" onclick="dsSelectedProdIdx=${i};renderProdGrid()"
      style="width:44px;height:44px;object-fit:cover;border-radius:8px;cursor:pointer;border:2px solid ${i===dsSelectedProdIdx?'var(--accent)':'#2a2a45'}">
  `).join('');
}

function removeProdImg(idx) {
  dsProdFiles.splice(idx, 1);
  if (dsSelectedProdIdx >= dsProdFiles.length) dsSelectedProdIdx = Math.max(0, dsProdFiles.length-1);
  renderProdGrid();
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
  preview.src = URL.createObjectURL(file);
  wrap.style.display = 'block';
  document.getElementById('dsDecorBtn').textContent = '🔄 تغيير الصورة';
  dsRenderDecorGrid();
  input.value = '';
}

function clearDecor() {
  dsDecorFile = null;
  dsDecorUrl = null;
  dsSelectedDecorId = null;
  document.getElementById('dsDecorPreviewWrap').style.display = 'none';
  document.getElementById('dsDecorBtn').textContent = '📁 أو ارفع صورتك الخاصة';
  dsRenderDecorGrid();
}

// ---- التوليد ----
function dsSetStatus(msg, color) {
  const el = document.getElementById('dsStatus');
  el.style.display = 'block';
  el.textContent = msg;
  el.style.color = color || 'var(--text2)';
}

async function dsGenerate() {
  if (!dsProdFiles.length) { toast('❌ ارفع صورة المنتج أولاً'); return; }
  if (!dsDecorFile && !dsDecorUrl) { toast('❌ اختر ديكوراً أو ارفع صورة خلفية'); return; }

  const btn = document.getElementById('dsGenBtn');
  btn.disabled = true; btn.textContent = '⏳ جاري التوليد...';
  document.getElementById('dsResultArea').style.display = 'none';

  const apiKey = document.getElementById('dsApiKey').value.trim();
  const title = document.getElementById('dsAdTitle').value || '';
  const sub = document.getElementById('dsAdSub').value || '';

  let storeName = '', storePhone = '';
  try {
    const biz = await api('/api/business-profile');
    storeName = biz.store_name || '';
    storePhone = biz.whatsapp_number || biz.phone || '';
  } catch(e) {}

  const prodFile = dsProdFiles[dsSelectedProdIdx];

  try {
    let productBlob;
    if (apiKey) {
      dsSetStatus('🔄 إزالة خلفية المنتج...');
      const bgForm = new FormData();
      bgForm.append('image_file', prodFile);
      const bgRes = await fetch('https://clipdrop-api.co/remove-background/v1', {
        method: 'POST', headers: { 'x-api-key': apiKey }, body: bgForm
      });
      if (!bgRes.ok) throw new Error('فشل إزالة الخلفية — تحقق من الـ API key');
      productBlob = await bgRes.blob();
    } else {
      productBlob = prodFile;
    }

    dsSetStatus('🎨 دمج الصور وتوليد الإعلان...');

    // تحميل صورة الديكور
    let decorSrc;
    if (dsDecorFile) {
      decorSrc = URL.createObjectURL(dsDecorFile);
    } else {
      decorSrc = dsDecorUrl;
    }

    const canvas = await dsComposeCanvas(productBlob, decorSrc, { title, sub, storeName, storePhone });
    const resultSrc = canvas.toDataURL('image/jpeg', 0.93);

    const grid = document.getElementById('dsResultGrid');
    grid.innerHTML = `
      <div>
        <img src="${resultSrc}" style="width:100%;border-radius:12px;margin-bottom:8px">
        <button onclick="dsDownload('${resultSrc}')" class="btn ba" style="width:100%">⬇️ تنزيل الإعلان</button>
      </div>
    `;
    document.getElementById('dsResultArea').style.display = 'block';
    dsSetStatus('✅ الإعلان جاهز!', '#34d399');

  } catch(e) {
    dsSetStatus('❌ ' + e.message, '#f87171');
  }

  btn.disabled = false; btn.textContent = '✨ توليد الإعلان';
}

async function dsComposeCanvas(productBlob, decorSrc, opts) {
  const W = 1080, H = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const [decorImg, prodImg] = await Promise.all([
    dsLoadImg(decorSrc),
    dsLoadImg(URL.createObjectURL(productBlob))
  ]);

  // ديكور (cover)
  const dR = Math.max(W/decorImg.width, H/decorImg.height);
  ctx.drawImage(decorImg, (W-decorImg.width*dR)/2, (H-decorImg.height*dR)/2, decorImg.width*dR, decorImg.height*dR);

  // تدرج سفلي
  const grad = ctx.createLinearGradient(0, H*0.5, 0, H);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.8)');
  ctx.fillStyle = grad; ctx.fillRect(0,0,W,H);

  // منتج (وسط)
  const pR = Math.min((W*0.72)/prodImg.width, (H*0.58)/prodImg.height);
  const pW = prodImg.width*pR, pH = prodImg.height*pR;
  ctx.drawImage(prodImg, (W-pW)/2, H*0.17, pW, pH);

  // نص رئيسي
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 12;
  if (opts.title) {
    ctx.fillStyle = '#fff'; ctx.font = 'bold 58px Tahoma';
    ctx.textAlign = 'center';
    ctx.fillText(opts.title, W/2, H*0.82);
  }
  if (opts.sub) {
    ctx.font = '34px Tahoma'; ctx.fillStyle = '#ddd';
    ctx.fillText(opts.sub, W/2, H*0.88);
  }
  ctx.shadowBlur = 0;

  // اسم المتجر + هاتف
  if (opts.storeName) {
    ctx.fillStyle = '#fff'; ctx.font = 'bold 34px Tahoma'; ctx.textAlign = 'right';
    ctx.fillText(opts.storeName, W-38, H-52);
  }
  if (opts.storePhone) {
    ctx.fillStyle = '#ccc'; ctx.font = '27px Tahoma';
    ctx.fillText(opts.storePhone, W-38, H-20);
  }

  // بادج اسم المتجر (يسار أعلى)
  if (opts.storeName) {
    ctx.fillStyle = 'rgba(80,60,220,0.85)';
    dsRoundRect(ctx, 28, 28, 200, 56, 12); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 25px Tahoma'; ctx.textAlign = 'center';
    ctx.fillText(opts.storeName, 128, 63);
  }

  return canvas;
}

function dsRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
  ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

function dsLoadImg(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('فشل تحميل الصورة'));
    img.src = src;
  });
}

function dsDownload(src) {
  const a = document.createElement('a');
  a.download = `اعلان_${Date.now()}.jpg`;
  a.href = src; a.click();
}
