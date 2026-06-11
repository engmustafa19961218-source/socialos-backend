// ============================================================
// AI FEATURES — واجهة ميزات الذكاء الاصطناعي
// ============================================================

// ============================================================
// 1. تحليل المشاعر
// ============================================================
async function analyzeSentiment(text, source, customerPhone, orderId) {
  if (!text) return toast('⚠️ أدخل النص');
  const btn = document.getElementById('sentiment-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري التحليل...'; }

  const d = await api('/api/ai/sentiment', {
    method: 'POST',
    body: JSON.stringify({ text, source: source || 'manual', customer_phone: customerPhone || '', order_id: orderId || null })
  });

  if (btn) { btn.disabled = false; btn.textContent = '🔍 تحليل'; }

  if (!d.success) return toast('❌ ' + (d.message || 'خطأ'));

  const r = d.result;
  const sentColors = { positive: '#10b981', negative: '#ef4444', neutral: '#f59e0b' };
  const sentIcons = { positive: '😊', negative: '😠', neutral: '😐' };
  const color = sentColors[r.sentiment] || '#888';

  const el = document.getElementById('sentiment-result');
  if (el) {
    el.innerHTML = `
      <div style="background:${color}15;border:1px solid ${color}33;border-radius:12px;padding:14px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <div style="font-size:2em">${sentIcons[r.sentiment]||'😐'}</div>
          <div>
            <div style="font-weight:700;color:${color}">${r.emotion || ''}</div>
            <div style="font-size:.76rem;color:var(--text2)">ثقة: ${((r.score||0)*100).toFixed(0)}%</div>
          </div>
          <span style="margin-right:auto;background:${color}22;color:${color};border-radius:20px;padding:4px 12px;font-size:.78rem;font-weight:700">${r.sentiment === 'positive' ? '😊 إيجابي' : r.sentiment === 'negative' ? '😠 سلبي' : '😐 محايد'}</span>
        </div>
        <div style="font-size:.84rem;color:var(--text2);margin-bottom:10px">${esc(r.summary||'')}</div>
        ${r.suggested_reply ? `
          <div style="background:white;border-radius:8px;padding:10px;margin-top:8px">
            <div style="font-size:.72rem;color:var(--text2);margin-bottom:4px;font-weight:700">💬 رد مقترح:</div>
            <div style="font-size:.83rem">${esc(r.suggested_reply)}</div>
            <button class="btn bo bsm" onclick="navigator.clipboard.writeText('${r.suggested_reply.replace(/'/g,"\\'")}').then(()=>toast('✅ تم النسخ'))" style="margin-top:8px;font-size:.72rem">📋 نسخ الرد</button>
          </div>
        ` : ''}
      </div>
    `;
    el.style.display = 'block';
  }

  ldSentimentHistory();
}

// جلب سجل المشاعر
async function ldSentimentHistory() {
  const d = await api('/api/ai/sentiment');
  if (!d.success) return;
  const el = document.getElementById('sentiment-history');
  if (!el) return;

  const sentColors = { positive: '#10b981', negative: '#ef4444', neutral: '#f59e0b' };
  const sentIcons = { positive: '😊', negative: '😠', neutral: '😐' };

  if (!d.records.length) {
    el.innerHTML = '<div class="empty"><div class="ei">🔍</div><p>لا سجل بعد</p></div>';
    return;
  }

  el.innerHTML = d.records.map(r => `
    <div style="display:flex;align-items:flex-start;gap:8px;padding:10px;background:var(--surface2);border-radius:10px;margin-bottom:7px">
      <div style="font-size:1.2em;flex-shrink:0">${sentIcons[r.sentiment]||'😐'}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:.8rem;color:var(--text2);margin-bottom:2px">${esc(r.text?.substring(0,60)||'')}...</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <span style="color:${sentColors[r.sentiment]||'#888'};font-size:.72rem;font-weight:700">${r.emotion||''}</span>
          ${r.customer_phone ? `<span style="font-size:.7rem;color:var(--text2)">${esc(r.customer_phone)}</span>` : ''}
          <span style="font-size:.7rem;color:var(--text2)">${new Date(r.created_at).toLocaleDateString('ar')}</span>
        </div>
      </div>
    </div>
  `).join('');
}

// ============================================================
// 2. توقع المبيعات
// ============================================================
async function ldForecast() {
  const el = document.getElementById('forecast-result');
  if (el) el.innerHTML = '<div class="empty"><div class="ei">⏳</div><p>جاري التحليل...</p></div>';

  const d = await api('/api/ai/forecast', { method: 'POST', body: JSON.stringify({}) });
  if (!d.success || !el) return;

  const f = d.forecast;
  if (f.error) { el.innerHTML = `<div class="empty"><p>❌ ${esc(f.error)}</p></div>`; return; }

  const trendIcon = f.trend === 'صاعد' ? '📈' : f.trend === 'هابط' ? '📉' : '➡️';
  const trendColor = f.trend === 'صاعد' ? '#10b981' : f.trend === 'هابط' ? '#ef4444' : '#f59e0b';

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
      <div style="background:rgba(79,142,247,.1);border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:.72rem;color:var(--text2)">الإيراد المتوقع</div>
        <div style="font-weight:800;font-size:1rem;color:#5b6af0">${Number(f.total_predicted_revenue||0).toLocaleString()}</div>
      </div>
      <div style="background:rgba(16,185,129,.1);border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:.72rem;color:var(--text2)">الطلبات المتوقعة</div>
        <div style="font-weight:800;font-size:1rem;color:#10b981">${f.total_predicted_orders||0}</div>
      </div>
      <div style="background:${trendColor}15;border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:.72rem;color:var(--text2)">الاتجاه</div>
        <div style="font-weight:800;font-size:1rem;color:${trendColor}">${trendIcon} ${f.trend||''}</div>
      </div>
    </div>

    ${f.best_day ? `<div style="background:rgba(245,158,11,.1);border-radius:10px;padding:10px;margin-bottom:12px;font-size:.82rem">⭐ أفضل يوم متوقع: <strong>${f.best_day}</strong></div>` : ''}

    <!-- توقعات الأيام -->
    <div style="margin-bottom:14px">
      ${(f.next_7_days||[]).map(day => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px;border-bottom:1px solid var(--border)">
          <div style="width:60px;font-size:.8rem;font-weight:600">${day.day}</div>
          <div style="flex:1;background:var(--surface2);border-radius:6px;height:8px;overflow:hidden">
            <div style="height:100%;background:#6C63FF;border-radius:6px;width:${Math.min(100,(day.predicted_revenue/(f.total_predicted_revenue||1)*700))}%"></div>
          </div>
          <div style="font-size:.78rem;font-weight:700;min-width:60px;text-align:left">${Number(day.predicted_revenue||0).toLocaleString()}</div>
          <div style="font-size:.72rem;color:var(--text2)">${day.predicted_orders||0} طلب</div>
        </div>
      `).join('')}
    </div>

    <!-- النصائح -->
    ${f.tips?.length ? `
      <div style="background:rgba(16,185,129,.08);border-radius:10px;padding:12px">
        <div style="font-size:.76rem;font-weight:700;color:#10b981;margin-bottom:8px">💡 نصائح لزيادة المبيعات</div>
        ${f.tips.map(t => `<div style="font-size:.8rem;padding:4px 0;border-bottom:1px solid rgba(16,185,129,.1)">• ${esc(t)}</div>`).join('')}
      </div>
    ` : ''}
  `;
}

// ============================================================
// 3. تسعير ذكي
// ============================================================
async function ldPricing() {
  const el = document.getElementById('pricing-result');
  if (el) el.innerHTML = '<div class="empty"><div class="ei">⏳</div><p>جاري التحليل...</p></div>';

  const d = await api('/api/ai/pricing', { method: 'POST', body: JSON.stringify({}) });
  if (!d.success || !el) return;

  const p = d.pricing;
  if (p.error) { el.innerHTML = `<div class="empty"><p>❌ ${esc(p.error)}</p></div>`; return; }

  el.innerHTML = `
    ${p.pricing_strategy ? `<div style="background:rgba(79,142,247,.1);border-radius:10px;padding:10px;margin-bottom:12px;font-size:.82rem">📊 الاستراتيجية المقترحة: <strong>${esc(p.pricing_strategy)}</strong> — زيادة متوقعة: <strong style="color:#10b981">${esc(p.expected_revenue_increase||'')}</strong></div>` : ''}

    <div style="margin-bottom:14px">
      ${(p.recommendations||[]).map(rec => {
        const isUp = rec.change_percent > 0;
        const color = isUp ? '#10b981' : '#ef4444';
        const priority = rec.priority === 'high' ? '#ef4444' : rec.priority === 'medium' ? '#f59e0b' : '#10b981';
        return `
          <div style="background:var(--surface2);border-radius:10px;padding:12px;margin-bottom:8px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <div style="font-weight:700;font-size:.86rem;flex:1">${esc(rec.product_name||'')}</div>
              <span style="background:${priority}22;color:${priority};border-radius:20px;padding:2px 8px;font-size:.67rem">${rec.priority==='high'?'عاجل':rec.priority==='medium'?'متوسط':'منخفض'}</span>
            </div>
            <div style="display:flex;gap:10px;margin-bottom:6px;font-size:.8rem">
              <span style="color:var(--text2)">الحالي: <strong>${Number(rec.current_price||0).toLocaleString()}</strong></span>
              <span>←</span>
              <span style="color:${color}">المقترح: <strong>${Number(rec.suggested_price||0).toLocaleString()}</strong></span>
              <span style="color:${color};font-weight:700">(${isUp?'+':''}${rec.change_percent||0}%)</span>
            </div>
            <div style="font-size:.76rem;color:var(--text2)">${esc(rec.reason||'')}</div>
          </div>
        `;
      }).join('')}
    </div>

    ${p.general_tips?.length ? `
      <div style="background:rgba(108,99,255,.08);border-radius:10px;padding:12px">
        <div style="font-size:.76rem;font-weight:700;color:#6C63FF;margin-bottom:8px">💡 نصائح عامة</div>
        ${p.general_tips.map(t => `<div style="font-size:.8rem;padding:4px 0">• ${esc(t)}</div>`).join('')}
      </div>
    ` : ''}
  `;
}

// ============================================================
// 4. تتبع الطلب
// ============================================================
async function generateTrackLink(orderId) {
  const d = await api(`/api/orders/${orderId}/track-link`, { method: 'POST' });
  if (!d.success) return toast('❌ ' + (d.message || 'خطأ'));
  const url = d.track_url;
  navigator.clipboard.writeText(url).catch(() => {});
  toast('✅ رابط التتبع جاهز: ' + url.substring(0, 40) + '...');
  return url;
}

async function sendTrackLink(orderId, customerPhone, customerName) {
  const d = await api(`/api/orders/${orderId}/track-link`, { method: 'POST' });
  if (!d.success) return toast('❌ ' + (d.message || 'خطأ'));

  const phone = String(customerPhone || '').replace(/[^0-9]/g, '');
  const waPhone = phone.startsWith('0') ? '964' + phone.slice(1) : phone;
  const msg = `🔍 *تتبع طلبك*\n\nأهلاً ${customerName || ''} 😊\nتابع حالة طلبك مباشرة:\n${d.track_url}\n\n⚡ SocialOS`;
  window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`, '_blank');
}

// ============================================================
// 5. إرسال رابط التقييم
// ============================================================
async function sendReviewLink(orderId) {
  const d = await api(`/api/orders/${orderId}/send-review-link`, { method: 'POST' });
  if (!d.success) return toast('❌ ' + (d.message || 'خطأ'));
  window.open(d.wa_url, '_blank');
  toast('✅ تم فتح واتساب لإرسال رابط التقييم');
}

// جلب التقييمات
async function ldReviews() {
  const d = await api('/api/ai/reviews');
  if (!d.success) return;
  const el = document.getElementById('reviews-list');
  if (!el) return;

  const avg = document.getElementById('reviews-avg');
  if (avg) avg.textContent = `${d.avg} ⭐ (${d.total} تقييم)`;

  if (!d.reviews.length) { el.innerHTML = '<div class="empty"><div class="ei">⭐</div><p>لا تقييمات بعد</p></div>'; return; }

  el.innerHTML = d.reviews.map(r => `
    <div style="background:var(--surface2);border-radius:10px;padding:12px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <div style="font-weight:700;font-size:.85rem">${esc(r.customer_name||'')}</div>
        <div style="color:#f59e0b">${'⭐'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</div>
        <div style="margin-right:auto;font-size:.72rem;color:var(--text2)">${new Date(r.created_at).toLocaleDateString('ar')}</div>
      </div>
      ${r.comment ? `<div style="font-size:.8rem;color:var(--text2)">${esc(r.comment)}</div>` : ''}
    </div>
  `).join('');
}

// ============================================================
// 6. نقاط ضعف العمل
// ============================================================
async function ldWeaknesses() {
  const el = document.getElementById('weaknesses-result');
  if (el) el.innerHTML = '<div class="empty"><div class="ei">⏳</div><p>جاري التحليل...</p></div>';

  const d = await api('/api/ai/business-weaknesses');
  if (!d.success || !el) return;

  const a = d.analysis;
  if (a.error) { el.innerHTML = `<div class="empty"><p>❌ ${esc(a.error)}</p></div>`; return; }

  const scoreColor = a.score >= 70 ? '#10b981' : a.score >= 40 ? '#f59e0b' : '#ef4444';

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;background:${scoreColor}15;border-radius:12px;padding:14px;margin-bottom:14px">
      <div style="width:56px;height:56px;border-radius:50%;background:${scoreColor};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.1rem;color:white;flex-shrink:0">${a.score||0}</div>
      <div>
        <div style="font-weight:700;font-size:.88rem">صحة العمل</div>
        <div style="font-size:.78rem;color:var(--text2)">${esc(a.summary||'')}</div>
      </div>
    </div>

    ${(a.critical_issues||[]).map(issue => {
      const priColor = issue.priority === 'high' ? '#ef4444' : issue.priority === 'medium' ? '#f59e0b' : '#10b981';
      return `
        <div style="border:1px solid ${priColor}33;border-radius:10px;padding:12px;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="background:${priColor}22;color:${priColor};border-radius:20px;padding:2px 10px;font-size:.72rem;font-weight:700">${issue.priority==='high'?'🔴 عاجل':issue.priority==='medium'?'🟡 متوسط':'🟢 منخفض'}</span>
            <div style="font-weight:700;font-size:.84rem">${esc(issue.issue||'')}</div>
          </div>
          <div style="font-size:.78rem;color:var(--text2);margin-bottom:6px">📊 ${esc(issue.impact||'')}</div>
          <div style="font-size:.78rem;background:rgba(16,185,129,.08);border-radius:8px;padding:7px">💡 ${esc(issue.solution||'')}</div>
        </div>
      `;
    }).join('')}

    ${a.quick_wins?.length ? `
      <div style="background:rgba(79,142,247,.08);border-radius:10px;padding:12px;margin-top:10px">
        <div style="font-size:.76rem;font-weight:700;color:#5b6af0;margin-bottom:8px">⚡ إجراءات سريعة</div>
        ${a.quick_wins.map(w => `<div style="font-size:.8rem;padding:4px 0">✓ ${esc(w)}</div>`).join('')}
      </div>
    ` : ''}
  `;
}

// ============================================================
// 7. قالب تصميم ذكي
// ============================================================
async function generateDesignTemplate() {
  const postType = document.getElementById('dt-type')?.value || 'منتج جديد';
  const productName = document.getElementById('dt-product')?.value || '';
  const price = document.getElementById('dt-price')?.value || '';
  const occasion = document.getElementById('dt-occasion')?.value || '';

  const el = document.getElementById('dt-result');
  if (el) el.innerHTML = '<div class="empty"><div class="ei">⏳</div><p>جاري التوليد...</p></div>';

  const d = await api('/api/ai/design-template', {
    method: 'POST',
    body: JSON.stringify({ post_type: postType, product_name: productName, price, occasion })
  });

  if (!d.success || !el) return toast('❌ ' + (d.message || 'خطأ'));
  const t = d.template;

  el.innerHTML = `
    <div style="background:var(--surface2);border-radius:12px;padding:14px;margin-bottom:12px">
      <div style="font-size:.72rem;color:var(--text2);margin-bottom:6px;font-weight:700">📝 نص البوست</div>
      <div style="font-size:.85rem;line-height:1.7;white-space:pre-wrap">${esc(t.caption||'')}</div>
      <button class="btn bo bsm" onclick="navigator.clipboard.writeText(${JSON.stringify(t.caption||'')}).then(()=>toast('✅ تم النسخ'))" style="margin-top:8px;font-size:.72rem">📋 نسخ</button>
    </div>

    ${t.hashtags?.length ? `
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px">
        ${t.hashtags.map(h => `<span style="background:rgba(79,142,247,.12);color:#5b6af0;border-radius:20px;padding:3px 10px;font-size:.75rem">${esc(h)}</span>`).join('')}
      </div>
    ` : ''}

    ${t.design_prompt ? `
      <div style="background:rgba(108,99,255,.08);border-radius:10px;padding:12px;margin-bottom:10px">
        <div style="font-size:.72rem;color:#6C63FF;font-weight:700;margin-bottom:5px">🎨 وصف التصميم المقترح</div>
        <div style="font-size:.8rem;direction:ltr;text-align:left">${esc(t.design_prompt)}</div>
        <button class="btn ba bsm" onclick="generateFromTemplate(${JSON.stringify(t.design_prompt||'')})" style="margin-top:8px;font-size:.72rem;width:100%">🤖 توليد بـ DALL-E</button>
      </div>
    ` : ''}

    <div style="display:flex;gap:10px;font-size:.78rem">
      ${t.cta ? `<div style="flex:1;background:rgba(16,185,129,.1);border-radius:8px;padding:8px;text-align:center"><div style="color:#10b981;font-weight:700">CTA</div>${esc(t.cta)}</div>` : ''}
      ${t.best_time ? `<div style="flex:1;background:rgba(245,158,11,.1);border-radius:8px;padding:8px;text-align:center"><div style="color:#f59e0b;font-weight:700">⏰ أفضل وقت</div>${esc(t.best_time)}</div>` : ''}
    </div>
  `;
}

async function generateFromTemplate(prompt) {
  if (typeof generateImg === 'function') {
    const input = document.getElementById('gen-prompt');
    if (input) { input.value = prompt; sp('designer', null); }
  }
}

// تحميل صفحة AI
async function loadAIPage() {
  ldSentimentHistory();
  ldReviews();
}

// ============================================================
// تبديل تبويبات AI
// ============================================================
function switchAITab(tab, btn) {
  ['sentiment','forecast','pricing','weaknesses','reviews','design','chatbot'].forEach(t => {
    const el = document.getElementById(`ai-tab-${t}`);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  document.querySelectorAll('#page-ai .fb').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (tab === 'forecast') ldForecast();
  if (tab === 'pricing') ldPricing();
  if (tab === 'weaknesses') ldWeaknesses();
  if (tab === 'reviews') ldReviews();
}

// ============================================================
// اختبار ChatBot
// ============================================================
let chatbotHistory = [];

async function testChatbot() {
  const input = document.getElementById('chatbot-input');
  const msg = input?.value.trim();
  if (!msg) return;
  input.value = '';

  const msgsEl = document.getElementById('chatbot-msgs');
  if (!msgsEl) return;

  // عرض رسالة المستخدم
  msgsEl.innerHTML += `<div style="text-align:left;margin-bottom:8px"><span style="background:#6C63FF;color:white;border-radius:12px 12px 3px 12px;padding:8px 12px;display:inline-block;font-size:.83rem;max-width:80%">${esc(msg)}</span></div>`;
  msgsEl.scrollTop = msgsEl.scrollHeight;

  chatbotHistory.push({ role: 'user', content: msg });

  const d = await api('/api/ai/chatbot', {
    method: 'POST',
    body: JSON.stringify({ message: msg, history: chatbotHistory })
  });

  const reply = d.reply || 'عذراً، حدث خطأ';
  chatbotHistory.push({ role: 'assistant', content: reply });

  msgsEl.innerHTML += `<div style="text-align:right;margin-bottom:8px"><span style="background:var(--surface2);border-radius:12px 12px 12px 3px;padding:8px 12px;display:inline-block;font-size:.83rem;max-width:80%">${esc(reply)}</span></div>`;
  msgsEl.scrollTop = msgsEl.scrollHeight;
}

// إضافة أزرار تتبع وتقييم في صفحة الطلبات
function addOrderAIButtons(orderId, customerPhone, customerName, status) {
  return `
    ${status === 'delivered' ? `<button class="btn bo bsm" onclick="sendReviewLink(${orderId})" style="margin-top:3px;width:100%;font-size:.65rem;background:rgba(245,158,11,.1);color:#f59e0b">⭐ رابط تقييم</button>` : ''}
    <button class="btn bo bsm" onclick="sendTrackLink(${orderId},'${customerPhone}','${customerName}')" style="margin-top:3px;width:100%;font-size:.65rem">🔍 رابط تتبع</button>
  `;
}
