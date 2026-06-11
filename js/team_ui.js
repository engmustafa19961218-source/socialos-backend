// ============================================================
// TEAM UI — واجهة الفريق الرقمي الكامل
// ============================================================

let _teamTab = 'customer'; // التبويب الحالي
let _chatHistory = []; // تاريخ محادثة خدمة العملاء

// تحميل صفحة الفريق
async function loadTeamPage() {
  switchTeamTab(_teamTab, null);
  ldMikeBrief();
}

// تبديل تبويب الفريق
function switchTeamTab(tab, btn) {
  _teamTab = tab;
  document.querySelectorAll('.team-tab-content').forEach(t => t.style.display = 'none');
  document.querySelectorAll('.team-tab-btn').forEach(b => b.classList.remove('active'));
  const el = document.getElementById(`team-tab-${tab}`);
  if (el) el.style.display = 'block';
  if (btn) btn.classList.add('active');
  // تحميل البيانات الخاصة بكل تبويب
  const loaders = {
    customer: () => {},
    design: () => {},
    promotion: () => {},
    orders: ldTeamOrders,
    inventory: ldTeamInventory,
    analytics: () => {}
  };
  if (loaders[tab]) loaders[tab]();
}

// ============================================================
// 🤖 Mike — التقرير اليومي
// ============================================================
async function ldMikeBrief() {
  const el = document.getElementById('mike-brief');
  if (!el) return;
  const d = await api('/api/mike/daily-brief');
  if (d.success) {
    el.innerHTML = `
      <div style="display:flex;gap:12px;align-items:flex-start">
        <div style="width:40px;height:40px;background:linear-gradient(135deg,var(--accent),var(--purple));border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0">🤖</div>
        <div style="flex:1">
          <div style="font-size:.72rem;font-weight:700;color:var(--accent2);margin-bottom:4px">Mike — تقرير اليوم</div>
          <div style="font-size:.84rem;line-height:1.6;color:var(--text)">${esc(d.brief)}</div>
          <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap">
            <span style="background:rgba(91,106,240,.1);color:var(--accent2);border-radius:8px;padding:4px 10px;font-size:.75rem">📦 ${d.stats?.orders || 0} طلب اليوم</span>
            <span style="background:rgba(34,197,94,.1);color:var(--green);border-radius:8px;padding:4px 10px;font-size:.75rem">💰 ${Number(d.stats?.revenue||0).toLocaleString()}</span>
            ${d.stats?.pending > 0 ? `<span style="background:rgba(245,158,11,.1);color:var(--yellow);border-radius:8px;padding:4px 10px;font-size:.75rem">⏳ ${d.stats.pending} معلق</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }
}

// Mike ينفذ أمر
async function mikeSendCommand() {
  const input = document.getElementById('mike-command-input');
  const msg = input?.value.trim();
  if (!msg) return;
  input.value = '';

  const msgsEl = document.getElementById('mike-chat-msgs');
  if (msgsEl) {
    msgsEl.innerHTML += `<div style="text-align:left;margin-bottom:8px"><div style="background:var(--accent);color:white;border-radius:12px 12px 3px 12px;padding:9px 13px;display:inline-block;max-width:80%;font-size:.83rem">${esc(msg)}</div></div>`;
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  const d = await api('/api/mike/execute', { method: 'POST', body: JSON.stringify({ command: msg }) });

  if (msgsEl) {
    const reply = d.reply || 'تم تنفيذ الأمر ✅';
    const reqOwner = d.requires_owner ? `<div style="margin-top:6px;font-size:.72rem;color:var(--yellow)">⚠️ ${d.reason || 'يحتاج موافقتك'}</div>` : '';
    msgsEl.innerHTML += `
      <div style="text-align:right;margin-bottom:10px;display:flex;gap:8px;align-items:flex-end">
        <div style="width:28px;height:28px;background:linear-gradient(135deg,var(--accent),var(--purple));border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.8rem;flex-shrink:0">🤖</div>
        <div style="background:var(--s2);border-radius:12px 12px 12px 3px;padding:9px 13px;max-width:80%;font-size:.83rem;line-height:1.5">${esc(reply)}${reqOwner}</div>
      </div>`;
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }
}

// ============================================================
// 💬 قسم خدمة العملاء
// ============================================================
async function customerSendMsg() {
  const input = document.getElementById('customer-msg-input');
  const phone = document.getElementById('customer-phone-input')?.value.trim() || '';
  const name = document.getElementById('customer-name-input')?.value.trim() || '';
  const msg = input?.value.trim();
  if (!msg) return;
  input.value = '';

  const msgsEl = document.getElementById('customer-chat-msgs');
  if (msgsEl) {
    msgsEl.innerHTML += `<div style="text-align:left;margin-bottom:8px"><div style="background:var(--s3);border-radius:12px 12px 3px 12px;padding:8px 12px;display:inline-block;max-width:80%;font-size:.82rem"><div style="font-size:.7rem;color:var(--text2);margin-bottom:2px">${esc(name||phone||'زبون')}</div>${esc(msg)}</div></div>`;
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  _chatHistory.push({ role: 'user', content: msg });

  const d = await api('/api/team/customer/reply', {
    method: 'POST',
    body: JSON.stringify({ message: msg, customer_name: name, customer_phone: phone, history: _chatHistory.slice(-4) })
  });

  const reply = d.reply || 'عذراً، حدث خطأ';
  _chatHistory.push({ role: 'assistant', content: reply });

  if (msgsEl) {
    const actionBadge = d.action === 'transfer_to_orders' ? '<div style="margin-top:5px;font-size:.7rem;color:var(--green)">✅ تم إرسال الطلب لقسم الطلبات</div>' : '';
    msgsEl.innerHTML += `
      <div style="text-align:right;margin-bottom:10px;display:flex;gap:8px;align-items:flex-end">
        <div style="width:26px;height:26px;background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.3);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.75rem;flex-shrink:0">💬</div>
        <div style="background:var(--s2);border-radius:12px 12px 12px 3px;padding:8px 12px;max-width:80%;font-size:.82rem;line-height:1.5">${esc(reply)}${actionBadge}</div>
      </div>`;
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }
}

// رد على تعليق
async function replyToComment() {
  const comment = document.getElementById('comment-text')?.value.trim();
  if (!comment) return toast('⚠️ أدخل التعليق');
  const btn = document.getElementById('comment-reply-btn');
  if (btn) btn.disabled = true;
  const d = await api('/api/team/customer/comment-reply', { method: 'POST', body: JSON.stringify({ comment }) });
  if (btn) btn.disabled = false;
  if (d.success) {
    const el = document.getElementById('comment-reply-result');
    if (el) {
      el.style.display = 'block';
      el.innerHTML = `
        <div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:10px;padding:12px">
          <div style="font-size:.72rem;font-weight:700;color:var(--green);margin-bottom:5px">💬 الرد المقترح:</div>
          <div style="font-size:.84rem;line-height:1.6">${esc(d.reply)}</div>
          <button class="btn ba bsm" onclick="navigator.clipboard.writeText(${JSON.stringify(d.reply)}).then(()=>toast('✅ تم النسخ'))" style="margin-top:8px">📋 نسخ</button>
        </div>`;
    }
  } else toast('❌ ' + (d.message || 'خطأ'));
}

// ============================================================
// 🎨 قسم التصميم والنشر
// ============================================================
async function generateBatchDesign() {
  const product = document.getElementById('design-product')?.value.trim();
  const bg = document.getElementById('design-bg')?.value.trim();
  const count = parseInt(document.getElementById('design-count')?.value || '3');
  if (!product) return toast('⚠️ أدخل اسم المنتج');

  const btn = document.getElementById('design-gen-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري التصميم...'; }

  const d = await api('/api/team/design/batch', {
    method: 'POST',
    body: JSON.stringify({ product_name: product, background_style: bg, count })
  });

  if (btn) { btn.disabled = false; btn.textContent = '🎨 توليد التصاميم'; }

  if (!d.success) return toast('❌ ' + (d.message || 'خطأ'));

  const el = document.getElementById('design-results');
  if (!el) return;
  el.innerHTML = `
    <div style="font-size:.8rem;font-weight:700;margin-bottom:10px">✅ ${d.prompts.length} تصاميم جاهزة</div>
    <div style="background:rgba(91,106,240,.06);border-radius:10px;padding:10px;margin-bottom:10px;font-size:.75rem;color:var(--text2)">
      🏷️ العلامة التجارية: <strong>${esc(d.watermark?.store_name||'')}</strong> | 📱 ${esc(d.watermark?.phone||'')}
    </div>
    ${d.prompts.map((p, i) => `
      <div style="background:var(--s2);border-radius:10px;padding:12px;margin-bottom:8px">
        <div style="font-weight:700;font-size:.82rem;margin-bottom:6px">تصميم ${i+1}: ${esc(p.style||'')}</div>
        <div style="font-size:.76rem;color:var(--text2);direction:ltr;text-align:left;line-height:1.5">${esc(p.prompt)}</div>
        <button class="btn ba bsm" onclick="useDesignPrompt(${JSON.stringify(p.prompt)})" style="margin-top:8px;font-size:.72rem">🤖 توليد بـ DALL-E</button>
      </div>`).join('')}`;
}

function useDesignPrompt(prompt) {
  if (typeof sp === 'function') {
    sp('designer', null);
    setTimeout(() => {
      const input = document.getElementById('gen-prompt');
      if (input) { input.value = prompt; }
    }, 500);
  }
}

async function generatePostContent() {
  const product = document.getElementById('post-product')?.value.trim();
  const price = document.getElementById('post-price')?.value.trim();
  const platform = document.getElementById('post-platform')?.value;

  const d = await api('/api/team/design/post', {
    method: 'POST',
    body: JSON.stringify({ product_name: product, price, platform })
  });

  if (!d.success) return toast('❌ ' + (d.message || 'خطأ'));
  const el = document.getElementById('post-result');
  if (!el) return;

  el.innerHTML = `
    <div class="card" style="border-color:rgba(91,106,240,.2)">
      <div style="font-size:.72rem;font-weight:700;color:var(--text2);margin-bottom:8px">${platform || 'Instagram'} — نص البوست</div>
      <div style="font-size:.84rem;line-height:1.7;white-space:pre-wrap;margin-bottom:10px">${esc(d.post.caption)}</div>
      ${d.post.hashtags?.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px">${d.post.hashtags.map(h => `<span style="background:rgba(91,106,240,.1);color:var(--accent2);border-radius:20px;padding:2px 8px;font-size:.72rem">${esc(h)}</span>`).join('')}</div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:.75rem">
        <span style="color:var(--text2)">⏰ ${esc(d.post.best_time)}</span>
        <span style="color:var(--text2)">📢 ${esc(d.post.cta)}</span>
      </div>
      <button class="btn ba bsm" onclick="navigator.clipboard.writeText(${JSON.stringify(d.post.caption)}).then(()=>toast('✅ تم النسخ'))" style="margin-top:10px;width:100%">📋 نسخ البوست</button>
    </div>`;
}

// ============================================================
// 📢 قسم الترويج
// ============================================================
async function generateCampaignStudy() {
  const goal = document.getElementById('promo-goal')?.value.trim();
  const product = document.getElementById('promo-product')?.value.trim();
  const days = document.getElementById('promo-days')?.value || '7';
  if (!goal) return toast('⚠️ أدخل هدف الحملة');

  const btn = document.getElementById('promo-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري الدراسة...'; }

  const d = await api('/api/team/promotion/study', {
    method: 'POST',
    body: JSON.stringify({ campaign_goal: goal, target_product: product, duration_days: parseInt(days) })
  });

  if (btn) { btn.disabled = false; btn.textContent = '📢 ابدأ الدراسة'; }
  if (!d.success) return toast('❌ ' + (d.message || 'خطأ'));

  const s = d.study || {};
  const el = document.getElementById('promo-result');
  if (!el) return;

  el.innerHTML = `
    <div class="card" style="border-color:rgba(239,68,68,.2)">
      <div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:8px;padding:10px;margin-bottom:12px;font-size:.78rem">
        ⚠️ <strong>تذكير:</strong> ${esc(s.budget_note || 'الميزانية تحددها أنت كصاحب العمل فقط')}
      </div>
      ${s.target_audience ? `<div style="margin-bottom:10px"><div style="font-size:.72rem;font-weight:700;color:var(--text2);margin-bottom:4px">👥 الجمهور المستهدف</div><div style="font-size:.82rem">${esc(s.target_audience)}</div></div>` : ''}
      ${s.platforms?.length ? `<div style="margin-bottom:10px"><div style="font-size:.72rem;font-weight:700;color:var(--text2);margin-bottom:4px">📱 المنصات</div><div style="display:flex;gap:5px;flex-wrap:wrap">${s.platforms.map(p => `<span style="background:rgba(91,106,240,.1);color:var(--accent2);border-radius:20px;padding:2px 10px;font-size:.75rem">${esc(p)}</span>`).join('')}</div></div>` : ''}
      ${s.content_pillars?.length ? `<div style="margin-bottom:10px"><div style="font-size:.72rem;font-weight:700;color:var(--text2);margin-bottom:4px">🎯 محاور المحتوى</div>${s.content_pillars.map(c => `<div style="font-size:.8rem;padding:3px 0">• ${esc(c)}</div>`).join('')}</div>` : ''}
      ${s.tips?.length ? `<div><div style="font-size:.72rem;font-weight:700;color:var(--text2);margin-bottom:4px">💡 نصائح</div>${s.tips.map(t => `<div style="font-size:.8rem;padding:3px 0;color:var(--green)">✓ ${esc(t)}</div>`).join('')}</div>` : ''}
      ${s.estimated_reach ? `<div style="margin-top:10px;background:rgba(34,197,94,.08);border-radius:8px;padding:8px;font-size:.78rem">📊 توقع الوصول: ${esc(s.estimated_reach)}</div>` : ''}
    </div>`;
}

// ============================================================
// 🏪 قسم المنتجات والمخزن
// ============================================================
async function ldTeamInventory() {
  const d = await api('/api/team/inventory/check');
  if (!d.success) return;
  const el = document.getElementById('inventory-alerts');
  if (!el) return;
  if (!d.alerts.length) {
    el.innerHTML = '<div class="empty"><div class="ei">✅</div><p>المخزون جيد — لا تنبيهات</p></div>';
    return;
  }
  el.innerHTML = d.alerts.map(a => `
    <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.15);border-radius:10px;margin-bottom:7px">
      <div style="font-size:1.3rem">⚠️</div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:.85rem">${esc(a.name)}</div>
        <div style="font-size:.75rem;color:var(--red)">تبقى ${a.stock} قطع فقط</div>
      </div>
      <button class="btn ba bsm" onclick="toast('سيتم إشعار Mike بهذا المنتج')">إشعار Mike</button>
    </div>`).join('');
}

async function addTeamProduct() {
  const name = document.getElementById('inv-name')?.value.trim();
  const price = document.getElementById('inv-price')?.value;
  const stock = document.getElementById('inv-stock')?.value;
  const desc = document.getElementById('inv-desc')?.value.trim();
  const cat = document.getElementById('inv-cat')?.value.trim();
  if (!name || !price) return toast('⚠️ الاسم والسعر مطلوبان');
  const d = await api('/api/team/inventory/add-product', {
    method: 'POST',
    body: JSON.stringify({ name, price, stock, description: desc, category: cat })
  });
  if (d.success) {
    toast('✅ تم إضافة المنتج');
    document.getElementById('inv-name').value = '';
    document.getElementById('inv-price').value = '';
    document.getElementById('inv-stock').value = '';
    ldTeamInventory();
  } else toast('❌ ' + (d.message || 'خطأ'));
}

// ============================================================
// 📊 قسم التحليل
// ============================================================
async function generateTeamReport() {
  const period = document.getElementById('report-period')?.value || '7';
  const btn = document.getElementById('report-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري التحليل...'; }

  const d = await api('/api/team/analytics/report', { method: 'POST', body: JSON.stringify({ period }) });

  if (btn) { btn.disabled = false; btn.textContent = '📊 توليد التقرير'; }
  if (!d.success) return toast('❌ ' + (d.message || 'خطأ'));

  const r = d.report;
  const a = r.analysis || {};
  const el = document.getElementById('team-report-result');
  if (!el) return;

  const scoreColor = a.score >= 70 ? 'var(--green)' : a.score >= 40 ? 'var(--yellow)' : 'var(--red)';

  el.innerHTML = `
    <!-- KPIs -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">
      <div style="background:var(--s2);border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:1.3rem;font-weight:900;color:var(--accent2)">${r.total_orders}</div>
        <div style="font-size:.7rem;color:var(--text2)">إجمالي الطلبات</div>
      </div>
      <div style="background:var(--s2);border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:1.1rem;font-weight:900;color:var(--green)">${Number(r.total_revenue).toLocaleString()}</div>
        <div style="font-size:.7rem;color:var(--text2)">الإيراد ${r.currency}</div>
      </div>
      <div style="background:var(--s2);border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:1.3rem;font-weight:900;color:${scoreColor}">${a.score || 0}</div>
        <div style="font-size:.7rem;color:var(--text2)">صحة العمل</div>
      </div>
    </div>

    <!-- الملخص -->
    ${a.summary ? `<div style="background:rgba(91,106,240,.06);border-radius:10px;padding:12px;margin-bottom:12px;font-size:.83rem;line-height:1.6">${esc(a.summary)}</div>` : ''}

    <!-- التوصيات -->
    ${a.recommendations?.length ? `
    <div style="margin-bottom:12px">
      <div style="font-size:.75rem;font-weight:700;color:var(--text2);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">💡 توصيات Mike</div>
      ${a.recommendations.map(rec => `
        <div style="display:flex;gap:8px;padding:8px;background:var(--s2);border-radius:8px;margin-bottom:5px;font-size:.8rem">
          <span style="color:var(--accent2);flex-shrink:0">✓</span>
          <span>${esc(rec)}</span>
        </div>`).join('')}
    </div>` : ''}

    <!-- أفضل المنتجات -->
    ${r.top_products?.length ? `
    <div>
      <div style="font-size:.75rem;font-weight:700;color:var(--text2);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">🏆 أفضل المنتجات</div>
      ${r.top_products.map((p,i) => `
        <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border2)">
          <span style="font-size:.8rem;color:var(--text3);width:16px">${i+1}</span>
          <span style="flex:1;font-size:.82rem">${esc(p.name||'')}</span>
          <span style="font-size:.78rem;color:var(--accent2);font-weight:700">${p.orders} طلب</span>
        </div>`).join('')}
    </div>` : ''}`;
}

// طلبات قسم الطلبات
async function ldTeamOrders() {
  const d = await api('/api/workflow/tasks?dept=orders&status=pending');
  if (!d.success) return;
  const el = document.getElementById('team-orders-list');
  if (!el) return;
  if (!d.tasks?.length) {
    el.innerHTML = '<div class="empty"><div class="ei">📦</div><p>لا طلبات معلقة</p></div>';
    return;
  }
  el.innerHTML = d.tasks.map(t => `
    <div class="card" style="margin-bottom:8px">
      <div style="font-weight:700;font-size:.86rem;margin-bottom:4px">${esc(t.title)}</div>
      <div style="font-size:.76rem;color:var(--text2);margin-bottom:10px">${esc(t.description||'')}</div>
      <button class="btn ba bsm" onclick="processTeamOrder(${t.id})">✅ إنشاء فاتورة</button>
    </div>`).join('');
}

async function processTeamOrder(taskId) {
  toast('⏳ جاري إنشاء الفاتورة...');
  const d = await api(`/api/workflow/tasks/${taskId}/approve`, { method: 'POST' });
  if (d.success) { toast('✅ تم إنشاء الفاتورة'); ldTeamOrders(); }
  else toast('❌ ' + (d.message || 'خطأ'));
}
