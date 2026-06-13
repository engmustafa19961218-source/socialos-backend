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
  // تحميل صلاحيات Mike وعرضها
  api('/api/mike/permissions').then(d => {
    if (d.success) renderMikePermissions(d.permissions);
  });
  // تحميل المهام المعلقة
  ldPendingTasks();
}


// ============================================================
// 📸 إرسال صورة لـ Mike
// ============================================================
let _mikeImgBase64 = null;

async function attachMikeImg(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) return toast('⚠️ الصورة أكبر من 5MB');

  const reader = new FileReader();
  reader.onload = function() {
    _mikeImgBase64 = this.result;
    const thumb = document.getElementById('mike-img-thumb');
    const preview = document.getElementById('mike-img-preview');
    if (thumb) thumb.src = this.result;
    if (preview) preview.style.display = 'block';
    toast('✅ الصورة جاهزة — اكتب رسالتك وأرسل');
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function clearMikeImg() {
  _mikeImgBase64 = null;
  const preview = document.getElementById('mike-img-preview');
  if (preview) preview.style.display = 'none';
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

  // إضافة الصورة للرسالة إن وجدت
  const imgToSend = _mikeImgBase64;
  if (imgToSend) {
    addCm('mike-msgs', 'user', '📸 صورة مرفقة');
    clearMikeImg();
  }
  const d = await api('/api/mike', { method: 'POST', body: JSON.stringify({ message: msg, history: mikeHistory.slice(-6), image: imgToSend || null }) });

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
      if (d.action === 'get_report' && d.action_result.data) {
        const rd = d.action_result.data;
        const rt = d.action_result.report_type || 'sales';
        if (rt === 'customers' && rd.top) {
          fullReply += '\n\n👥 تقرير العملاء:\n• إجمالي العملاء: ' + rd.total;
          if (rd.top.length > 0) {
            fullReply += '\n\n🏆 أفضل العملاء:';
            rd.top.forEach((c,i) => {
              fullReply += '\n' + (i+1) + '. ' + esc(c.name) + ' — ' + Number(c.spent).toLocaleString() + ' IQD (' + c.orders + ' طلب)';
            });
          }
        } else if (rt === 'products' && rd.products) {
          fullReply += '\n\n📦 تقرير المنتجات:\n• إجمالي المنتجات: ' + rd.products.length;
          rd.products.slice(0,5).forEach(p => {
            fullReply += '\n• ' + esc(p.name) + ' — ' + Number(p.price).toLocaleString() + ' IQD | مخزون: ' + p.stock;
          });
        } else if (rt === 'orders' && rd.recent) {
          fullReply += '\n\n🛒 تقرير الطلبات:\n• الطلبات (30 يوم): ' + rd.orders_30d + '\n• الإيراد: ' + Number(rd.revenue_30d).toLocaleString() + ' IQD';
          if (rd.recent.length > 0) {
            fullReply += '\n\nآخر الطلبات:';
            rd.recent.forEach(o => {
              fullReply += '\n• ' + esc(o.customer_name) + ' — ' + Number(o.total).toLocaleString() + ' IQD [' + esc(o.status) + ']';
            });
          }
        } else {
          fullReply += '\n\n📊 تقرير المبيعات:\n• الطلبات (30 يوم): ' + rd.orders_30d + '\n• الإيراد: ' + Number(rd.revenue_30d).toLocaleString() + ' IQD\n• المنتجات: ' + rd.products + '\n• العملاء: ' + rd.customers;
        }
      }
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
  document.getElementById('mike-tab-tasks').style.display = tab === 'tasks' ? '' : 'none';
  document.getElementById('mike-tab-permissions').style.display = tab === 'permissions' ? '' : 'none';
  document.querySelectorAll('#page-mike .fb').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (tab === 'gallery') ldMikeGallery();
  if (tab === 'tasks') ldPendingTasksMike();
  if (tab === 'permissions') {
    api('/api/mike/permissions').then(d => {
      if (d.success) renderMikePermissions(d.permissions);
    });
  }
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


// ============================================================
// واجهة الذاكرة الدائمة
// ============================================================
async function ldMikeMemory() {
  const d = await api('/api/mike/memory');
  const el = document.getElementById('mike-memory-list');
  if (!el) return;

  if (!d.success || !d.memories?.length) {
    el.innerHTML = '<div class="empty"><div class="ei">🧠</div><p>ذاكرة Mike فارغة بعد<br><small>ستُملأ تلقائياً مع كل محادثة</small></p></div>';
    return;
  }

  const typeNames = {
    customer: '👥 زبائن', product: '📦 منتجات', decision: '⚡ قرارات',
    policy: '📋 سياسات', preference: '⭐ تفضيلات', result: '📊 نتائج', general: '💡 عام'
  };
  const impColors = { 1: 'var(--text3)', 2: 'var(--accent2)', 3: 'var(--yellow)' };

  el.innerHTML = d.memories.map(m => `
    <div style="display:flex;align-items:flex-start;gap:8px;padding:9px;background:var(--s2);border-radius:9px;margin-bottom:6px">
      <div style="flex:1">
        <div style="font-size:.78rem;line-height:1.5">${esc(m.content)}</div>
        <div style="font-size:.7rem;color:var(--text3);margin-top:3px">
          ${typeNames[m.memory_type] || m.memory_type} · 
          <span style="color:${impColors[m.importance] || 'var(--text3)'}">
            ${'⭐'.repeat(m.importance || 1)}
          </span> · 
          ${new Date(m.created_at).toLocaleDateString('ar')}
        </div>
      </div>
      <button onclick="deleteMikeMemory(${m.id})" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:.75rem;flex-shrink:0">✕</button>
    </div>`).join('');
}

async function addMikeMemory() {
  const content = document.getElementById('mike-mem-input')?.value.trim();
  if (!content) return toast('⚠️ أدخل المعلومة');
  const type = document.getElementById('mike-mem-type')?.value || 'general';
  const d = await api('/api/mike/memory', { method: 'POST', body: JSON.stringify({ content, memory_type: type, importance: 2 }) });
  if (d.success) {
    toast('✅ تم الحفظ في ذاكرة Mike');
    document.getElementById('mike-mem-input').value = '';
    ldMikeMemory();
  } else toast('❌ ' + d.message);
}

async function deleteMikeMemory(id) {
  const d = await api(`/api/mike/memory/${id}`, { method: 'DELETE' });
  if (d.success) { toast('✅ تم الحذف'); ldMikeMemory(); }
}

async function clearMikeMemory() {
  if (!confirm('هل تريد مسح كل ذاكرة Mike؟')) return;
  const d = await api('/api/mike/memory', { method: 'DELETE' });
  if (d.success) { toast('✅ تم مسح الذاكرة'); ldMikeMemory(); }
}

// ============================================================
// 🎙️ نظام الصوت لـ Mike
// ============================================================
let mikeVoiceEnabled = localStorage.getItem('mike_voice') === '1';
let mikeVoicePlaying = false;

async function mikeSpeakReply(text) {
  if (!mikeVoiceEnabled || !text || mikeVoicePlaying) return;
  mikeVoicePlaying = true;
  try {
    const d = await api('/api/voice/speak', {
      method: 'POST',
      body: JSON.stringify({ text: text.substring(0, 500) })
    });
    if (d.success && d.audio_base64) {
      const audio = new Audio(`data:${d.mime_type || 'audio/mp3'};base64,${d.audio_base64}`);
      audio.onended = () => { mikeVoicePlaying = false; };
      audio.onerror = () => { mikeVoicePlaying = false; };
      await audio.play();
    }
  } catch(e) { mikeVoicePlaying = false; }
}

function toggleMikeVoice(btn) {
  mikeVoiceEnabled = !mikeVoiceEnabled;
  localStorage.setItem('mike_voice', mikeVoiceEnabled ? '1' : '0');
  if (btn) {
    btn.textContent = mikeVoiceEnabled ? '🔊 الصوت: تشغيل' : '🔇 الصوت: إيقاف';
    btn.style.background = mikeVoiceEnabled ? 'rgba(34,197,94,.15)' : 'var(--s2)';
    btn.style.borderColor = mikeVoiceEnabled ? 'rgba(34,197,94,.3)' : 'var(--border)';
    btn.style.color = mikeVoiceEnabled ? 'var(--green)' : 'var(--text2)';
  }
  toast(mikeVoiceEnabled ? '🔊 Mike سيتكلم الآن' : '🔇 تم إيقاف صوت Mike');
}

// إعدادات الصوت
async function saveVoiceSettings() {
  const tone = document.getElementById('voice-tone')?.value || 'alloy';
  const speed = parseFloat(document.getElementById('voice-speed')?.value || '1.0');
  const d = await api('/api/voice/profile', {
    method: 'POST',
    body: JSON.stringify({ voice_tone: tone, voice_speed: speed })
  });
  if (d.success) toast('✅ تم حفظ إعدادات الصوت');
  else toast('❌ ' + (d.message || 'خطأ'));
}

// اختبار الصوت
async function testVoice() {
  const tone = document.getElementById('voice-tone')?.value || 'alloy';
  const btn = document.querySelector('[onclick="testVoice()"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري...'; }
  const d = await api('/api/voice/speak', {
    method: 'POST',
    body: JSON.stringify({
      text: 'مرحباً! أنا Mike، مساعدك الذكي.',
      voice: tone
    })
  });
  if (btn) { btn.disabled = false; btn.textContent = '🔊 اختبر الصوت'; }
  if (d.success && d.audio_base64) {
    const audio = new Audio(`data:${d.mime_type || 'audio/mp3'};base64,${d.audio_base64}`);
    audio.play().catch(e => toast('⚠️ فعّل الصوت في المتصفح: ' + e.message));
    toast('🎙️ يتم تشغيل الصوت...');
  } else {
    toast('❌ ' + (d.message || 'تأكد من OPENAI_API_KEY في Railway'));
    console.error('Voice test failed:', d);
  }
}
