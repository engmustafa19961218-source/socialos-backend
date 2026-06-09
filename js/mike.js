// ============================================================
// ============================================================
// MIKE — المساعد التنفيذي الذكي
// ============================================================
let mikeHistory = [];
let mikeInited = false;

function ldMike() {
  if (!mikeInited) {
    mikeInited = true;
    const msgs = document.getElementById('mike-msgs');
    msgs.innerHTML = '';
    addCm('mike-msgs', 'ai', `مرحباً! أنا Mike ⚡ مساعدك التنفيذي الذكي.\n\nأستطيع تنفيذ أي أمر مباشرة — جرب قل لي:\n• "أضف طلب جديد لأحمد بمبلغ 50000"\n• "انشر بوست على Instagram"\n• "شو إيراداتي هذا الشهر؟"\n\nما الذي تريد تنفيذه؟`);
  }
  document.getElementById('mike-input').focus();
}

async function sendMike(text) {
  const input = document.getElementById('mike-input');
  const msg = text || input.value.trim();
  if (!msg) return;
  input.value = '';

  const btn = document.getElementById('mike-btn');
  btn.disabled = true;

  // إخفاء الأمثلة بعد أول رسالة
  const suggs = document.getElementById('mike-suggs');
  if (suggs) suggs.style.display = 'none';

  addCm('mike-msgs', 'user', msg);
  mikeHistory.push({ role: 'user', content: msg });

  // رسالة انتظار
  const msgs = document.getElementById('mike-msgs');
  const loadingId = 'mike-loading-' + Date.now();
  const loadingDiv = document.createElement('div');
  loadingDiv.id = loadingId;
  loadingDiv.className = 'cm';
  loadingDiv.innerHTML = `<div class="cav" style="background:linear-gradient(135deg,var(--accent),var(--accent2))">⚡</div><div class="cbub" style="background:var(--surface2)"><span style="display:inline-flex;gap:4px"><span style="animation:pulse 1s infinite">●</span><span style="animation:pulse 1s infinite .2s">●</span><span style="animation:pulse 1s infinite .4s">●</span></span></div>`;
  msgs.appendChild(loadingDiv);
  msgs.scrollTop = msgs.scrollHeight;

  const d = await api('/api/mike', { method: 'POST', body: JSON.stringify({ message: msg, history: mikeHistory.slice(-6) }) });

  // إزالة رسالة الانتظار
  const ldEl = document.getElementById(loadingId);
  if (ldEl) ldEl.remove();

  btn.disabled = false;

  if (d.success) {
    mikeHistory.push({ role: 'assistant', content: d.reply });

    // بناء الرد
    let fullReply = d.reply;

    // إضافة نتيجة الإجراء
    if (d.action_result) {
      fullReply += '\n\n✅ ' + esc(d.action_result.message || '');
    }
    if (d.action_error) {
      fullReply += '\n\n❌ ' + esc(d.action_error);
    }

    addCm('mike-msgs', 'ai', fullReply);

    // تحديث الصفحة الحالية إذا نفّذ إجراء
    if (d.action && d.action !== 'none' && d.action_result) {
      const refreshMap = {
        create_order: 'orders',
        create_product: 'products',
        create_customer: 'customers',
        create_post: 'posts',
        create_coupon: 'coupons',
        update_order_status: 'orders'
      };
      const refreshPage = refreshMap[d.action];
      if (refreshPage) {
        setTimeout(() => {
          // إضافة زر للانتقال للصفحة
          const lastMsg = msgs.lastElementChild;
          if (lastMsg) {
            const actionBtn = document.createElement('div');
            actionBtn.style.cssText = 'margin-top:7px';
            actionBtn.innerHTML = `<button class="btn ba bsm" onclick="sp('${refreshPage}',null)" style="font-size:.75rem">🔗 عرض في ${refreshPage === 'orders' ? 'الطلبات' : refreshPage === 'products' ? 'المنتجات' : refreshPage === 'customers' ? 'العملاء' : refreshPage === 'posts' ? 'المنشورات' : 'الكوبونات'}</button>`;
            lastMsg.querySelector('.cbub')?.appendChild(actionBtn);
          }
        }, 100);
      }
    }
  } else {
    addCm('mike-msgs', 'ai', '❌ عذراً، حدث خطأ: ' + esc(d.message || 'حاول مرة أخرى'));
  }

  msgs.scrollTop = msgs.scrollHeight;
  input.focus();
}

// ADVANCED ANALYTICS — التحليلات المتقدمة

// ============================================================
// MIKE GALLERY — معرض الصور
// ============================================================
let mikeGalleryImages = [], mikeGalleryFilter = 'all';

function switchMikeTab(tab, btn) {
  document.getElementById('mike-tab-chat').style.display = tab === 'chat' ? '' : 'none';
  document.getElementById('mike-tab-gallery').style.display = tab === 'gallery' ? '' : 'none';
  document.querySelectorAll('#page-mike .fb').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (tab === 'gallery') ldMikeGallery();
}

async function ldMikeGallery() {
  const grid = document.getElementById('mike-gallery-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="empty"><div class="ei">⏳</div><p>جاري التحميل...</p></div>';
  const d = await api('/api/mike/gallery');
  if (!d.success) { grid.innerHTML = `<div class="empty"><p>${esc(d.message||'خطأ')}</p></div>`; return; }
  mikeGalleryImages = d.images || [];
  renderGallery();
}

function filterGallery(cat, btn) {
  mikeGalleryFilter = cat;
  document.querySelectorAll('#mike-tab-gallery .fb').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderGallery();
}

function renderGallery() {
  const grid = document.getElementById('mike-gallery-grid');
  if (!grid) return;
  const filtered = mikeGalleryFilter === 'all' ? mikeGalleryImages : mikeGalleryImages.filter(i => i.category === mikeGalleryFilter);
  if (!filtered.length) {
    grid.innerHTML = '<div class="empty"><div class="ei">🖼️</div><p>لا صور في هذه الفئة</p></div>';
    return;
  }
  grid.innerHTML = filtered.map(img => {
    const src = img.display_url || img.image_url || '';
    const date = img.created_at ? new Date(img.created_at).toLocaleDateString('ar-IQ') : '';
    const catColors = { product: 'rgba(79,142,247,.2)', store: 'rgba(0,212,170,.2)', identity: 'rgba(124,58,237,.2)', general: 'rgba(255,255,255,.1)' };
    return `<div style="background:var(--surface2);border-radius:12px;overflow:hidden;border:1px solid var(--border);position:relative" id="gimg-${img.id}">
      ${src ? `<img src="${esc(src)}" style="width:100%;height:100px;object-fit:cover;display:block" loading="lazy">` :
        `<div style="width:100%;height:100px;background:var(--surface);display:flex;align-items:center;justify-content:center;font-size:2rem">🖼️</div>`}
      <div style="padding:7px">
        <div style="font-size:.75rem;font-weight:700;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(img.label||'بدون تسمية')}</div>
        <div style="font-size:.68rem;color:var(--text2)">${date}</div>
        ${img.ai_analysis ? `<div style="font-size:.68rem;color:var(--text2);margin-top:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(img.ai_analysis)}</div>` : ''}
      </div>
      <div style="display:flex;gap:4px;padding:0 7px 7px">
        <select style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:3px;color:var(--text);font-size:.68rem" onchange="updateGalleryImg(${img.id},document.getElementById('glabel-${img.id}').value,this.value)">
          <option value="general" ${img.category==='general'?'selected':''}>عام</option>
          <option value="product" ${img.category==='product'?'selected':''}>منتج</option>
          <option value="store" ${img.category==='store'?'selected':''}>متجر</option>
          <option value="identity" ${img.category==='identity'?'selected':''}>هوية</option>
        </select>
        <button onclick="deleteGalleryImg(${img.id})" style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:.9rem;padding:2px 4px">🗑</button>
      </div>
      <input id="glabel-${img.id}" value="${esc(img.label||'')}" placeholder="تسمية..." style="display:none">
    </div>`;
  }).join('');
}

async function uploadMikeImages(files) {
  if (!files?.length) return;
  const status = document.getElementById('gallery-upload-status');
  status.style.display = 'block';
  let done = 0;
  for (const file of files) {
    status.textContent = `⏳ جاري رفع ${done+1}/${files.length}: ${file.name}`;
    const reader = new FileReader();
    await new Promise(resolve => {
      reader.onloadend = async () => {
        const base64 = reader.result;
        const d = await api('/api/mike/gallery', 'POST', {
          image_base64: base64,
          label: file.name.replace(/\.[^.]+$/, ''),
          category: 'general'
        });
        if (d.success) {
          done++;
          if (d.ai_analysis) status.textContent = `✅ تم رفع الصورة — ${d.ai_analysis.substring(0,80)}...`;
        } else {
          status.textContent = `❌ فشل رفع ${file.name}: ${d.message}`;
        }
        resolve();
      };
      reader.readAsDataURL(file);
    });
  }
  status.textContent = `✅ تم رفع ${done} صورة بنجاح!`;
  setTimeout(() => { status.style.display = 'none'; }, 3000);
  ldMikeGallery();
}

async function updateGalleryImg(id, label, category) {
  await api(`/api/mike/gallery/${id}`, 'PUT', { label, category });
}

async function deleteGalleryImg(id) {
  if (!confirm('حذف الصورة؟')) return;
  const d = await api(`/api/mike/gallery/${id}`, 'DELETE');
  if (d.success) {
    mikeGalleryImages = mikeGalleryImages.filter(i => i.id !== id);
    renderGallery();
    toast('✅ تم الحذف');
  } else toast('❌ ' + (d.message||'خطأ'));
}

