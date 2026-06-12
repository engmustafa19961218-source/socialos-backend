// ============================================================
// VIDEO DESIGNER — Mike مخرج الفيديو الذكي
// ============================================================

let _videoImages = [];
let _pollInterval = null;

function loadVideoPage() {
  ldVideoGallery();
}


// رفع صور من الهاتف
async function uploadVideoImages(input) {
  const files = Array.from(input.files).slice(0, 5 - _videoImages.length);
  if (!files.length) return;
  toast('⏳ جاري رفع الصور...');

  for (const file of files) {
    if (_videoImages.length >= 5) break;
    try {
      // تحويل الصورة لـ base64 ثم رفعها لـ Cloudinary أو استخدامها مباشرة
      const base64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });

      // رفع للـ API
      const d = await api('/api/images/upload-base64', {
        method: 'POST',
        body: JSON.stringify({ image: base64, filename: file.name })
      });

      if (d.success && d.url) {
        _videoImages.push(d.url);
      } else {
        // استخدام base64 مباشرة إن فشل الرفع
        _videoImages.push(base64);
      }
    } catch(e) {
      toast('❌ فشل رفع صورة');
    }
  }

  renderVideoImages();
  toast(`✅ تم إضافة ${files.length} صورة`);
  input.value = '';
}

// ============================================================
// إضافة وإزالة الصور
// ============================================================
function addVideoImage() {
  const url = document.getElementById('video-img-url')?.value.trim();
  if (!url) return toast('⚠️ أدخل رابط الصورة');
  if (_videoImages.length >= 5) return toast('⚠️ الحد الأقصى 5 صور');
  _videoImages.push(url);
  document.getElementById('video-img-url').value = '';
  renderVideoImages();
}

function renderVideoImages() {
  const el = document.getElementById('video-images-preview');
  if (!el) return;
  if (!_videoImages.length) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `
    <div style="margin-bottom:10px">
      <div style="font-size:.75rem;font-weight:700;color:var(--text2);margin-bottom:6px">📸 الصور المضافة (${_videoImages.length}/5)</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${_videoImages.map((url, i) => `
          <div style="position:relative">
            <img src="${url}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid var(--border)" onerror="this.style.opacity='.3'">
            <button onclick="_videoImages.splice(${i},1);renderVideoImages()" style="position:absolute;top:-6px;left:-6px;width:18px;height:18px;background:var(--red);border:none;border-radius:50%;color:white;font-size:.6rem;cursor:pointer;display:flex;align-items:center;justify-content:center">✕</button>
          </div>`).join('')}
      </div>
    </div>`;
}

// ============================================================
// Mike ينشئ الفيديو
// ============================================================
async function mikeCreateVideo() {
  const idea = document.getElementById('video-idea')?.value.trim();
  if (!idea && !_videoImages.length) return toast('⚠️ اكتب فكرة أو أضف صوراً');

  const btn = document.getElementById('video-create-btn');
  const resultEl = document.getElementById('video-result');
  const mikeEl = document.getElementById('mike-video-thinking');

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Mike يفكر...'; }

  // Mike يفكر...
  if (mikeEl) {
    mikeEl.style.display = 'block';
    mikeEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:12px;background:rgba(91,106,240,.08);border:1px solid rgba(91,106,240,.15);border-radius:12px;margin-bottom:12px">
        <div style="font-size:1.4rem;animation:spin 1s linear infinite">🤖</div>
        <div>
          <div style="font-weight:700;font-size:.85rem;color:var(--accent2)">Mike يحلل الفكرة...</div>
          <div style="font-size:.75rem;color:var(--text2)">يختار القالب المناسب ويعبئ البيانات</div>
        </div>
      </div>`;
  }

  const d = await api('/api/video/mike-create', {
    method: 'POST',
    body: JSON.stringify({
      idea: idea || '',
      images: _videoImages
    })
  });

  if (btn) { btn.disabled = false; btn.textContent = '🎬 Mike اصنع الفيديو'; }

  if (!d.success) {
    if (mikeEl) mikeEl.style.display = 'none';
    console.error('Video error:', JSON.stringify(d));
    toast('❌ ' + (d.message || d.error || JSON.stringify(d).substring(0,100)));
    return;
  }

  // Mike قرر!
  if (mikeEl) {
    mikeEl.innerHTML = `
      <div style="background:rgba(91,106,240,.08);border:1px solid rgba(91,106,240,.2);border-radius:12px;padding:14px;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <div style="font-size:1.2rem">🤖</div>
          <div style="font-weight:700;font-size:.85rem;color:var(--accent2)">Mike اختار: ${esc(d.template_used)}</div>
        </div>
        <div style="font-size:.8rem;color:var(--text2);margin-bottom:6px">💭 ${esc(d.reasoning || '')}</div>
        ${d.mike_note ? `<div style="font-size:.8rem;color:var(--green)">💡 ${esc(d.mike_note)}</div>` : ''}
      </div>`;
  }

  // تتبع الفيديو
  showRenderProgress(resultEl);
  pollVideoStatus(d.render_id, resultEl);
}

// ============================================================
// تتبع حالة الفيديو
// ============================================================
function showRenderProgress(el) {
  if (!el) return;
  el.innerHTML = `
    <div style="background:rgba(91,106,240,.06);border:1px solid rgba(91,106,240,.12);border-radius:12px;padding:20px;text-align:center">
      <div style="font-size:2rem;margin-bottom:10px">🎬</div>
      <div style="font-weight:700;font-size:.88rem;margin-bottom:4px">Creatomate يصنع الفيديو...</div>
      <div style="font-size:.76rem;color:var(--text2);margin-bottom:16px">30-60 ثانية</div>
      <div style="background:var(--s2);border-radius:6px;height:6px;overflow:hidden">
        <div id="render-progress-bar" style="height:100%;background:var(--accent);border-radius:6px;width:5%;transition:width 2s ease"></div>
      </div>
      <div id="render-progress-text" style="font-size:.72rem;color:var(--text3);margin-top:8px">0%</div>
    </div>`;
}

function pollVideoStatus(renderId, resultEl) {
  if (_pollInterval) clearInterval(_pollInterval);
  let progress = 5;

  _pollInterval = setInterval(async () => {
    progress = Math.min(progress + 7, 92);
    const bar = document.getElementById('render-progress-bar');
    const txt = document.getElementById('render-progress-text');
    if (bar) bar.style.width = progress + '%';
    if (txt) txt.textContent = progress + '%';

    const d = await api(`/api/video/status/${renderId}`);

    if (d.ready && d.url) {
      clearInterval(_pollInterval);
      showVideoReady(resultEl, d.url);
      toast('🎬 الفيديو جاهز!');
      ldVideoGallery();
    } else if (d.status === 'failed') {
      clearInterval(_pollInterval);
      if (resultEl) resultEl.innerHTML = `<div class="empty"><div class="ei">❌</div><p>فشل إنشاء الفيديو — حاول مرة أخرى</p></div>`;
    }
  }, 3000);
}

function showVideoReady(el, url) {
  if (!el) return;
  el.innerHTML = `
    <div style="background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.2);border-radius:12px;padding:14px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <div style="font-size:1.4rem">🎬</div>
        <div style="font-weight:700;font-size:.9rem;color:var(--green)">الفيديو جاهز!</div>
      </div>
      <video controls style="width:100%;border-radius:10px;max-height:420px;background:#000;margin-bottom:10px" src="${url}"></video>
      <div style="display:flex;gap:7px">
        <a href="${url}" download="socialos-video.mp4" class="btn ba bsm" style="flex:1;text-align:center;text-decoration:none">⬇️ تحميل</a>
        <button class="btn bo bsm" onclick="navigator.clipboard.writeText('${url}').then(()=>toast('✅ تم نسخ الرابط'))" style="flex:1">📋 نسخ</button>
        <button class="btn bo bsm" onclick="publishVideoNow('${url}')" style="flex:1">📱 نشر</button>
      </div>
    </div>`;
}

async function publishVideoNow(videoUrl) {
  const platform = document.getElementById('video-platform')?.value || 'instagram';
  const caption = document.getElementById('video-idea')?.value || '';
  const d = await api('/api/team/publish/post', {
    method: 'POST',
    body: JSON.stringify({ platform, content: caption, media_url: videoUrl })
  });
  if (d.success) toast(`✅ تم النشر على ${platform}!`);
  else toast('❌ ' + (d.message || 'خطأ في النشر'));
}

// ============================================================
// معرض الفيديوهات
// ============================================================
async function ldVideoGallery() {
  const d = await api('/api/video/list');
  if (!d.success) return;
  const el = document.getElementById('video-gallery');
  if (!el) return;

  if (!d.videos.length) {
    el.innerHTML = '<div class="empty"><div class="ei">🎬</div><p>لا فيديوهات بعد</p></div>';
    return;
  }

  const typeNames = {
    'product-hero-discount': '🛍️ منتج مع خصم',
    'matrix-promotion': '📢 حملة ترويجية',
    'animated-review': '⭐ تقييم متحرك'
  };
  const statusColors = { completed: 'var(--green)', rendering: 'var(--yellow)', failed: 'var(--red)' };
  const statusLabels = { completed: '✅ جاهز', rendering: '⏳ جاري', failed: '❌ فشل' };

  el.innerHTML = d.videos.map(v => `
    <div style="background:var(--s2);border-radius:12px;overflow:hidden;margin-bottom:10px">
      ${v.video_url
        ? `<video style="width:100%;max-height:220px;background:#000" src="${v.video_url}" preload="none" controls></video>`
        : `<div style="height:90px;background:var(--s3);display:flex;align-items:center;justify-content:center;font-size:2rem">🎬</div>`}
      <div style="padding:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
          <div style="font-weight:700;font-size:.84rem">${esc(typeNames[v.type] || v.type)}</div>
          <span style="font-size:.72rem;font-weight:700;color:${statusColors[v.status]||'var(--text2)'}">${statusLabels[v.status]||v.status}</span>
        </div>
        <div style="font-size:.74rem;color:var(--text2);margin-bottom:8px">${esc(v.product_name?.substring(0,50)||'')} · ${v.platform} · ${new Date(v.created_at).toLocaleDateString('ar')}</div>
        ${v.video_url ? `
          <div style="display:flex;gap:6px">
            <a href="${v.video_url}" download class="btn ba bsm" style="flex:1;text-align:center;text-decoration:none">⬇️ تحميل</a>
            <button class="btn bo bsm" onclick="publishVideoNow('${v.video_url}')" style="flex:1">📱 نشر</button>
          </div>` : v.status === 'rendering' ? `
          <button class="btn bo bsm bfull" onclick="pollVideoStatus('${v.render_id}',document.getElementById('video-result'))">🔄 تحديث</button>` : ''}
      </div>
    </div>`).join('');
}

// CSS للـ spin
const style = document.createElement('style');
style.textContent = '@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';
document.head.appendChild(style);
