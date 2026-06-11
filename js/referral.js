// ============================================================
// REFERRAL — برنامج الإحالة
// ============================================================

async function ldReferral() {
  await Promise.all([ldReferralSettings(), ldReferralStats()]);
}

// جلب الإعدادات
async function ldReferralSettings() {
  const d = await api('/api/referral/settings');
  if (!d.success) return;
  const s = d.settings || {};

  const fields = {
    'ref-active': s.is_active !== false,
    'ref-referrer-type': s.referrer_reward_type || 'points',
    'ref-referrer-value': s.referrer_reward_value || 500,
    'ref-referee-type': s.referee_reward_type || 'discount',
    'ref-referee-value': s.referee_reward_value || 10,
    'ref-min-order': s.min_order || 0
  };

  Object.entries(fields).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = val;
    else el.value = val;
  });
}

// حفظ الإعدادات
async function saveReferralSettings() {
  const d = await api('/api/referral/settings', {
    method: 'PUT',
    body: JSON.stringify({
      is_active: document.getElementById('ref-active')?.checked !== false,
      referrer_reward_type: document.getElementById('ref-referrer-type')?.value || 'points',
      referrer_reward_value: parseFloat(document.getElementById('ref-referrer-value')?.value) || 500,
      referee_reward_type: document.getElementById('ref-referee-type')?.value || 'discount',
      referee_reward_value: parseFloat(document.getElementById('ref-referee-value')?.value) || 10,
      min_order: parseFloat(document.getElementById('ref-min-order')?.value) || 0
    })
  });
  if (d.success) toast('✅ تم حفظ إعدادات برنامج الإحالة');
  else toast('❌ ' + (d.message || 'خطأ'));
}

// جلب إحصائيات
async function ldReferralStats() {
  const d = await api('/api/referral/stats');
  if (!d.success) return;

  const statsEl = document.getElementById('referral-stats');
  if (statsEl) {
    const s = d.stats || {};
    statsEl.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">
        <div style="background:var(--s2);border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:1.4rem;font-weight:900;color:var(--accent2)">${s.total_referrals || 0}</div>
          <div style="font-size:.7rem;color:var(--text2)">إجمالي الإحالات</div>
        </div>
        <div style="background:var(--s2);border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:1.4rem;font-weight:900;color:var(--green)">${s.successful || 0}</div>
          <div style="font-size:.7rem;color:var(--text2)">إحالات ناجحة</div>
        </div>
        <div style="background:var(--s2);border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:1.2rem;font-weight:900;color:var(--yellow)">${Number(s.total_rewards||0).toLocaleString()}</div>
          <div style="font-size:.7rem;color:var(--text2)">مكافآت منحت</div>
        </div>
      </div>`;
  }

  // أكثر المُحيلين
  const topEl = document.getElementById('top-referrers');
  if (topEl) {
    if (!d.top_referrers?.length) {
      topEl.innerHTML = '<div class="empty"><div class="ei">🔗</div><p>لا إحالات بعد</p></div>';
      return;
    }
    topEl.innerHTML = d.top_referrers.map((r, i) => `
      <div style="display:flex;align-items:center;gap:10px;padding:9px;background:var(--s2);border-radius:10px;margin-bottom:7px">
        <div style="width:28px;height:28px;background:${i===0?'var(--yellow)':i===1?'#aaa':'#cd7f32'};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.75rem;font-weight:800;color:var(--bg);flex-shrink:0">${i+1}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:.85rem">${esc(r.customer_phone)}</div>
          <div style="font-size:.72rem;color:var(--text2)">كود: ${r.code}</div>
        </div>
        <div style="text-align:left">
          <div style="font-size:.82rem;font-weight:700;color:var(--accent2)">${r.referrals} إحالة</div>
          <div style="font-size:.7rem;color:var(--green)">${r.successful} ناجحة</div>
        </div>
        <button class="btn ba bsm" onclick="sendReferralLink('${r.customer_phone}')">📤</button>
      </div>`).join('');
  }
}

// إنشاء وإرسال رابط الإحالة للزبون
async function sendReferralLink(phone) {
  if (!phone) {
    phone = document.getElementById('ref-customer-phone')?.value.trim();
    if (!phone) return toast('⚠️ أدخل رقم هاتف الزبون');
  }
  const d = await api(`/api/referral/send/${encodeURIComponent(phone)}`, { method: 'POST' });
  if (!d.success) return toast('❌ ' + (d.message || 'خطأ'));

  // فتح واتساب
  window.open(d.wa_url, '_blank');
  toast('✅ تم فتح واتساب لإرسال الرابط');

  // عرض الرابط
  const linkEl = document.getElementById('ref-generated-link');
  if (linkEl) {
    linkEl.style.display = 'block';
    linkEl.innerHTML = `
      <div style="background:rgba(91,106,240,.08);border:1px solid rgba(91,106,240,.2);border-radius:10px;padding:12px;margin-top:10px">
        <div style="font-size:.72rem;color:var(--text2);margin-bottom:5px">🔗 رابط الإحالة:</div>
        <div style="font-size:.82rem;direction:ltr;text-align:left;word-break:break-all;margin-bottom:8px;color:var(--accent2)">${d.link}</div>
        <div style="font-size:.72rem;color:var(--text2);margin-bottom:8px">🔑 الكود: <strong style="color:var(--text);letter-spacing:2px">${d.code}</strong></div>
        <button class="btn bo bsm" onclick="navigator.clipboard.writeText('${d.link}').then(()=>toast('✅ تم نسخ الرابط'))" style="width:100%">📋 نسخ الرابط</button>
      </div>`;
  }
  ldReferralStats();
}

// تطبيق كود إحالة على طلب
async function applyReferralCode() {
  const code = document.getElementById('ref-apply-code')?.value.trim().toUpperCase();
  const newPhone = document.getElementById('ref-apply-phone')?.value.trim();
  const orderId = document.getElementById('ref-apply-order')?.value;
  if (!code || !newPhone) return toast('⚠️ الكود ورقم الهاتف مطلوبان');

  const d = await api('/api/referral/use', {
    method: 'POST',
    body: JSON.stringify({ code, new_customer_phone: newPhone, order_id: orderId || null })
  });

  if (d.success) {
    toast('✅ تم تطبيق الإحالة — مكافأة: ' + d.referrer_reward);
    if (d.wa_url) window.open(d.wa_url, '_blank');
    document.getElementById('ref-apply-code').value = '';
    ldReferralStats();
  } else toast('❌ ' + (d.message || 'خطأ'));
}
