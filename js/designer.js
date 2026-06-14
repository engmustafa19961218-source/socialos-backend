// ============================================================
// DESIGNER — مولّد الإعلانات الذكي
// ============================================================

let dsProdFiles = [];
let dsDecorFile = null;
let dsSelectedProdIdx = 0;

function addProdImgs(input) {
  const files = Array.from(input.files);
  if (!files.length) return;
  files.forEach(f => dsProdFiles.push(f));
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
    <div style="position:relative;border-radius:10px;overflow:hidden;aspect-ratio:1;background:#111;border:2px solid ${i===dsSelectedProdIdx?'var(--accent)':'#2a2a45'}">
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
  if (dsSelectedProdIdx >= dsProdFiles.length) dsSelectedProdIdx = Math.max(0, dsProdFiles.length - 1);
  renderProdGrid();
}

function setDecorImg(input) {
  const file = input.files[0];
  if (!file) return;
  dsDecorFile = file;
  const preview = document.getElementById('dsDecorPreview');
  const wrap = document.getElementById('dsDecorPreviewWrap');
  const btn = document.getElementById('dsDecorBtn');
  preview.src = URL.createObjectURL(file);
  wrap.style.display = 'block';
  btn.textContent = '🔄 تغيير صورة الديكور';
  input.value = '';
}

function clearDecor() {
  dsDecorFile = null;
  document.getElementById('dsDecorPreviewWrap').style.display = 'none';
  document.getElementById('dsDecorBtn').textContent = '+ رفع صورة الديكور';
}

function dsSetStatus(msg, color) {
  const el = document.getElementById('dsStatus');
  el.style.display = 'block';
  el.textContent = msg;
  el.style.color = color || 'var(--text2)';
}

async function dsGenerate() {
  if (!dsProdFiles.length) { toast('❌ ارفع صورة المنتج أولاً'); return; }
  if (!dsDecorFile) { toast('❌ ارفع صورة الديكور أولاً'); return; }

  const btn = document.getElementById('dsGenBtn');
  btn.disabled = true;
  btn.textContent = '⏳ جاري التوليد...';
  document.getElementById('dsResultArea').style.display = 'none';

  const apiKey = document.getElementById('dsApiKey').value.trim();
  const title = document.getElementById('dsAdTitle').value || '';
  const sub = document.getElementById('dsAdSub').value || '';

  // جلب بيانات المتجر
  let storeName = '', storePhone = '', storeLogo = '';
  try {
    const biz = await api('/api/business-profile');
    storeName = biz.store_name || '';
    storePhone = biz.whatsapp_number || biz.phone || '';
    storeLogo = biz.logo_url || '';
  } catch(e) {}

  const results = [];

  // توليد إعلان لكل صورة منتج (أو فقط المختارة)
  const filesToProcess = dsProdFiles.length > 1 ? [dsProdFiles[dsSelectedProdIdx]] : dsProdFiles;

  for (let i = 0; i < filesToProcess.length; i++) {
    dsSetStatus(`⏳ معالجة صورة ${i+1} من ${filesToProcess.length}...`);
    try {
      let productBlob;

      if (apiKey) {
        dsSetStatus(`🔄 إزالة خلفية الصورة ${i+1}...`);
        const bgForm = new FormData();
        bgForm.append('image_file', filesToProcess[i]);
        const bgRes = await fetch('https://clipdrop-api.co/remove-background/v1', {
          method: 'POST',
          headers: { 'x-api-key': apiKey },
          body: bgForm
        });
        if (!bgRes.ok) throw new Error('فشل إزالة الخلفية — تحقق من الـ API key');
        productBlob = await bgRes.blob();
      } else {
        productBlob = filesToProcess[i];
      }

      dsSetStatus(`🎨 دمج الصور...`);
      const canvas = await composeAdCanvas(productBlob, dsDecorFile, {
        title, sub, storeName, storePhone, storeLogo
      });

      results.push(canvas.toDataURL('image/jpeg', 0.92));
    } catch(e) {
      dsSetStatus('❌ ' + e.message, '#f87171');
      btn.disabled = false;
      btn.textContent = '✨ توليد الإعلان';
      return;
    }
  }

  // عرض النتائج
  const grid = document.getElementById('dsResultGrid');
  grid.innerHTML = results.map((src, i) => `
    <div>
      <img src="${src}" style="width:100%;border-radius:12px;margin-bottom:8px">
      <button onclick="dsDownload('${src}',${i})" class="btn bo bsm" style="width:100%">⬇️ تنزيل الإعلان ${results.length > 1 ? i+1 : ''}</button>
    </div>
  `).join('');

  document.getElementById('dsResultArea').style.display = 'block';
  dsSetStatus('✅ الإعلان جاهز!', '#34d399');
  btn.disabled = false;
  btn.textContent = '✨ توليد الإعلان';
}

async function composeAdCanvas(productBlob, decorFile, opts) {
  const W = 1080, H = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const [decorImg, prodImg] = await Promise.all([
    loadDsImg(URL.createObjectURL(decorFile)),
    loadDsImg(URL.createObjectURL(productBlob))
  ]);

  // رسم الديكور (cover)
  const dR = Math.max(W / decorImg.width, H / decorImg.height);
  ctx.drawImage(decorImg, (W - decorImg.width*dR)/2, (H - decorImg.height*dR)/2, decorImg.width*dR, decorImg.height*dR);

  // تدرج سفلي
  const grad = ctx.createLinearGradient(0, H*0.45, 0, H);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.78)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // رسم المنتج (وسط، نصف الصورة العلوي)
  const pR = Math.min((W * 0.72) / prodImg.width, (H * 0.58) / prodImg.height);
  const pW = prodImg.width * pR, pH = prodImg.height * pR;
  ctx.drawImage(prodImg, (W-pW)/2, H*0.18, pW, pH);

  // النص الرئيسي
  if (opts.title) {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 60px Tahoma, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 10;
    ctx.fillText(opts.title, W/2, H*0.82);
  }

  // النص الفرعي
  if (opts.sub) {
    ctx.font = '34px Tahoma, Arial, sans-serif';
    ctx.fillStyle = '#dddddd';
    ctx.fillText(opts.sub, W/2, H*0.88);
  }

  ctx.shadowBlur = 0;

  // اسم المتجر + هاتف (يمين سفل)
  if (opts.storeName) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px Tahoma';
    ctx.textAlign = 'right';
    ctx.fillText(opts.storeName, W - 40, H - 55);
  }
  if (opts.storePhone) {
    ctx.font = '28px Tahoma';
    ctx.fillStyle = '#ccc';
    ctx.textAlign = 'right';
    ctx.fillText(opts.storePhone, W - 40, H - 22);
  }

  // شعار / بادج (يسار أعلى)
  ctx.fillStyle = 'rgba(80,60,220,0.82)';
  dsRoundRect(ctx, 30, 30, 190, 58, 12);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 26px Tahoma';
  ctx.textAlign = 'center';
  ctx.fillText(opts.storeName || 'SocialOS', 125, 66);

  return canvas;
}

function dsRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);
  ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r);
  ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h);
  ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r);
  ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
}

function loadDsImg(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('فشل تحميل الصورة'));
    img.src = src;
  });
}

function dsDownload(src, idx) {
  const a = document.createElement('a');
  a.download = `اعلان_${Date.now()}${idx > 0 ? '_'+idx : ''}.jpg`;
  a.href = src;
  a.click();
}

function ldDesigner() {
  // reset on page load
}
