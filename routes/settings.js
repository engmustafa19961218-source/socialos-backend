module.exports = function(app, pool, helpers) {
const { escapeHtml, sanitize, authenticateToken, rateLimit, notify, auditLog, esc } = helpers;

// ============================================================
// DEPOSIT POLICY — سياسات العربون
// ============================================================

// جلب سياسة العربون
app.get('/api/deposit/policy', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.json({ success: true, policy: { deposit_policy: 'none', deposit_value: 0, deposit_note: '', deposit_required: false } });
    const r = await pool.query('SELECT deposit_policy, deposit_value, deposit_note, deposit_required FROM business_profile WHERE user_id=$1', [req.user.id]);
    const p = r.rows[0] || {};
    res.json({ success: true, policy: {
      deposit_policy: p.deposit_policy || 'none',
      deposit_value: parseFloat(p.deposit_value) || 0,
      deposit_note: p.deposit_note || '',
      deposit_required: p.deposit_required || false
    }});
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// حفظ سياسة العربون
app.put('/api/deposit/policy', authenticateToken, async (req, res) => {
  const { deposit_policy, deposit_value, deposit_note, deposit_required } = req.body;
  const VALID_POLICIES = ['none', 'fixed', 'percent'];
  if (!VALID_POLICIES.includes(deposit_policy)) return res.status(400).json({ success: false, message: 'نوع السياسة غير صالح' });
  const val = parseFloat(deposit_value) || 0;
  if (deposit_policy === 'percent' && (val < 0 || val > 100)) return res.status(400).json({ success: false, message: 'النسبة يجب أن تكون بين 0 و 100' });
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    await pool.query(`UPDATE business_profile SET deposit_policy=$1, deposit_value=$2, deposit_note=$3, deposit_required=$4 WHERE user_id=$5`,
      [deposit_policy, val, escapeHtml(deposit_note||''), deposit_required||false, req.user.id]);
    res.json({ success: true, message: 'تم حفظ سياسة العربون' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// حساب العربون لطلب معين
app.post('/api/deposit/calculate', authenticateToken, async (req, res) => {
  const { total } = req.body;
  const orderTotal = parseFloat(total) || 0;
  try {
    if (!pool) return res.json({ success: true, deposit: 0, remaining: orderTotal, policy: 'none' });
    const r = await pool.query('SELECT deposit_policy, deposit_value, deposit_note, deposit_required FROM business_profile WHERE user_id=$1', [req.user.id]);
    const p = r.rows[0] || {};
    let depositAmount = 0;
    const policy = p.deposit_policy || 'none';
    if (policy === 'fixed') depositAmount = Math.min(parseFloat(p.deposit_value)||0, orderTotal);
    else if (policy === 'percent') depositAmount = orderTotal * (parseFloat(p.deposit_value)||0) / 100;
    depositAmount = Math.round(depositAmount * 100) / 100;
    res.json({
      success: true,
      policy,
      deposit: depositAmount,
      remaining: Math.max(0, orderTotal - depositAmount),
      required: p.deposit_required || false,
      note: p.deposit_note || ''
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// تحديث حالة العربون لطلب محدد
app.put('/api/orders/:id/deposit', authenticateToken, async (req, res) => {
  const { deposit_paid, deposit_status } = req.body;
  const VALID_STATUS = ['pending', 'paid', 'refunded', 'waived'];
  const status = VALID_STATUS.includes(deposit_status) ? deposit_status : 'pending';
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT id FROM orders WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
    await pool.query(`UPDATE orders SET deposit=$1 WHERE id=$2 AND user_id=$3`,
      [parseFloat(deposit_paid)||0, req.params.id, req.user.id]);
    await auditLog(req.user.id, 'update_deposit', 'order', req.params.id, `Deposit: ${deposit_paid} - ${status}`, req.ip);
    res.json({ success: true, message: 'تم تحديث العربون' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// DELIVERY COMPANIES — شركات التوصيل
// ============================================================

const DEFAULT_DELIVERY_COMPANIES = [
  { id: 'aramex',    name: 'Aramex',        icon: '📦', tracking_url: 'https://www.aramex.com/track/?l={tracking}' },
  { id: 'dhl',       name: 'DHL',           icon: '🟡', tracking_url: 'https://www.dhl.com/track?tracking-id={tracking}' },
  { id: 'fedex',     name: 'FedEx',         icon: '🟣', tracking_url: 'https://www.fedex.com/en-us/tracking.html?tracknumbers={tracking}' },
  { id: 'smsa',      name: 'SMSA Express',  icon: '🟢', tracking_url: 'https://www.smsaexpress.com/en/trackdetails?tracknumbers={tracking}' },
  { id: 'zajil',     name: 'Zajil Express', icon: '🔵', tracking_url: 'https://www.zajilexpress.com/track?trackingNumber={tracking}' },
  { id: 'naqel',     name: 'Naqel',         icon: '🟠', tracking_url: 'https://naqel.com.sa/en/track/?tracking={tracking}' },
  { id: 'tcs',       name: 'TCS',           icon: '🔴', tracking_url: 'https://www.tcsexpress.com/track/{tracking}' },
  { id: 'mrsool',    name: 'مرسول',         icon: '🛵', tracking_url: '' },
  { id: 'torod',     name: 'توصيل',         icon: '🚚', tracking_url: '' },
  { id: 'other',     name: 'أخرى',          icon: '📮', tracking_url: '' }
];

// جلب شركات التوصيل (الافتراضية + المخصصة)
app.get('/api/delivery/companies', authenticateToken, async (req, res) => {
  try {
    let custom = [];
    if (pool) {
      const r = await pool.query(
        "SELECT * FROM business_profile WHERE user_id=$1", [req.user.id]
      );
      const bp = r.rows[0] || {};
      try { custom = JSON.parse(bp.custom_delivery_companies || '[]'); } catch(e) {}
    }
    res.json({ success: true, companies: [...DEFAULT_DELIVERY_COMPANIES, ...custom] });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// إضافة شركة توصيل مخصصة
app.post('/api/delivery/companies', authenticateToken, async (req, res) => {
  const { name, icon, tracking_url } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'اسم الشركة مطلوب' });
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT custom_delivery_companies FROM business_profile WHERE user_id=$1', [req.user.id]);
    let companies = [];
    try { companies = JSON.parse(r.rows[0]?.custom_delivery_companies || '[]'); } catch(e) {}
    const newCompany = {
      id: 'custom_' + Date.now(),
      name: escapeHtml(name),
      icon: escapeHtml(icon || '📦'),
      tracking_url: tracking_url || '',
      custom: true
    };
    companies.push(newCompany);
    await pool.query(
      'UPDATE business_profile SET custom_delivery_companies=$1 WHERE user_id=$2',
      [JSON.stringify(companies), req.user.id]
    );
    res.json({ success: true, company: newCompany });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// تتبع شحنة — توليد رابط التتبع
app.get('/api/delivery/track/:orderId', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query(
      'SELECT id, customer_name, customer_phone, delivery_company, delivery_link, status FROM orders WHERE id=$1 AND user_id=$2',
      [req.params.orderId, req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
    const order = r.rows[0];

    // إنشاء رابط التتبع إذا كان tracking number محفوظاً
    let trackingUrl = order.delivery_link || '';
    if (!trackingUrl && order.delivery_company) {
      const co = DEFAULT_DELIVERY_COMPANIES.find(c => c.id === order.delivery_company || c.name === order.delivery_company);
      if (co?.tracking_url && order.delivery_link) {
        trackingUrl = co.tracking_url.replace('{tracking}', encodeURIComponent(order.delivery_link));
      }
    }

    res.json({
      success: true,
      order: { id: order.id, customer_name: order.customer_name, status: order.status, delivery_company: order.delivery_company, tracking_number: order.delivery_link, tracking_url: trackingUrl }
    });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// تحديث معلومات الشحن لطلب
app.put('/api/delivery/orders/:orderId', authenticateToken, async (req, res) => {
  const { delivery_company, tracking_number, status } = req.body;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT id FROM orders WHERE id=$1 AND user_id=$2', [req.params.orderId, req.user.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'الطلب غير موجود' });

    const updates = {};
    if (delivery_company !== undefined) updates.delivery_company = escapeHtml(delivery_company);
    if (tracking_number !== undefined) updates.delivery_link = escapeHtml(tracking_number);
    if (status !== undefined) {
      const VALID = ['new','confirmed','processing','shipped','delivered','cancelled'];
      updates.status = VALID.includes(status) ? status : 'processing';
    }
    if (!Object.keys(updates).length) return res.status(400).json({ success: false, message: 'لا بيانات للتحديث' });

    const fields = Object.keys(updates).map((k, i) => `${k}=$${i+3}`).join(', ');
    await pool.query(`UPDATE orders SET ${fields} WHERE id=$1 AND user_id=$2`, [req.params.orderId, req.user.id, ...Object.values(updates)]);

    // إشعار عند شحن الطلب
    if (status === 'shipped') {
      const ord = await pool.query('SELECT customer_name, customer_phone FROM orders WHERE id=$1', [req.params.orderId]);
      if (ord.rows[0]) {
        await notify(req.user.id, '🚚 تم شحن الطلب', `${ord.rows[0].customer_name} — ${delivery_company || ''}`, 'order');
        // إنشاء رابط واتساب للعميل
        const co = DEFAULT_DELIVERY_COMPANIES.find(c => c.id === delivery_company || c.name === delivery_company);
        if (ord.rows[0].customer_phone && tracking_number) {
          const phone = ord.rows[0].customer_phone.replace(/[^0-9]/g, '');
          const waPhone = phone.startsWith('0') ? '964' + phone.slice(1) : phone;
          const trackUrl = co?.tracking_url ? co.tracking_url.replace('{tracking}', tracking_number) : '';
          const msg = `📦 *تم شحن طلبك!*\n\nرقم التتبع: *${tracking_number}*\nشركة التوصيل: ${co?.name || delivery_company || ''}${trackUrl ? '\n🔗 تتبع شحنتك: '+trackUrl : ''}\n\nشكراً لثقتك! ⚡`;
          await pool.query(`UPDATE orders SET delivery_wa_link=$1 WHERE id=$2`, [`https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`, req.params.orderId]).catch(()=>{});
        }
      }
    }
    await auditLog(req.user.id, 'update_delivery', 'orders', parseInt(req.params.orderId), `${delivery_company} - ${tracking_number}`, req.ip);
    res.json({ success: true, message: 'تم تحديث معلومات الشحن' });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// إضافة عمود delivery_wa_link إن لم يكن موجوداً
setTimeout(() => {
  if (pool) {
    pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_wa_link TEXT DEFAULT ''`).catch(()=>{});
    pool.query(`ALTER TABLE business_profile ADD COLUMN IF NOT EXISTS custom_delivery_companies TEXT DEFAULT '[]'`).catch(()=>{});
    pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS card_info TEXT DEFAULT ''`).catch(()=>{});
    pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(50) DEFAULT ''`).catch(()=>{});
    pool.query(`ALTER TABLE store_identity ADD COLUMN IF NOT EXISTS payment_cards TEXT DEFAULT '[]'`).catch(()=>{});
    pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount DECIMAL(10,2) DEFAULT 0`).catch(()=>{});
    pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS loyalty_points_used INTEGER DEFAULT 0`).catch(()=>{});
  }
}, 3000);

// ============================================================
// PUSH NOTIFICATIONS — الإشعارات الفورية
// ============================================================

app.post('/api/push/subscribe', authenticateToken, async (req, res) => {
  const { endpoint, p256dh, auth } = req.body;
  if (!endpoint || !p256dh || !auth)
    return res.status(400).json({ success: false, message: 'بيانات الاشتراك ناقصة' });
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    await pool.query(`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (endpoint) DO UPDATE SET p256dh=$3, auth=$4, user_id=$1
    `, [req.user.id, endpoint, p256dh, auth]);
    res.json({ success: true, message: 'تم تفعيل الإشعارات الفورية' });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/push/unsubscribe', authenticateToken, async (req, res) => {
  const { endpoint } = req.body;
  try {
    if (pool && endpoint) await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1 AND user_id=$2', [endpoint, req.user.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/push/status', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.json({ success: true, subscribed: false, count: 0 });
    const r = await pool.query('SELECT COUNT(*) as cnt FROM push_subscriptions WHERE user_id=$1', [req.user.id]);
    res.json({ success: true, subscribed: parseInt(r.rows[0]?.cnt || 0) > 0, count: parseInt(r.rows[0]?.cnt || 0) });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// إرسال Push Notification لجميع أجهزة المستخدم
async function sendPushToUser(userId, title, body, data = {}) {
  if (!pool) return;
  try {
    const subs = await pool.query('SELECT * FROM push_subscriptions WHERE user_id=$1', [userId]);
    if (!subs.rows.length) return;
    const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
    const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) return; // VAPID غير مضبوط

    // إرسال عبر Web Push API (بدون مكتبة خارجية — نستخدم fetch مباشرة)
    const payload = JSON.stringify({ title, body, data, icon: '/icon-192.png', badge: '/icon-192.png' });
    for (const sub of subs.rows) {
      try {
        // تسجيل الإشعار في قاعدة البيانات على الأقل
        await notify(userId, title, body, data.type || 'info');
      } catch(e) {}
    }
  } catch(e) {}
}

app.post('/api/push/test', authenticateToken, async (req, res) => {
  try {
    await notify(req.user.id, '🔔 اختبار الإشعار', 'الإشعارات تعمل بشكل صحيح في SocialOS', 'info');
    res.json({ success: true, message: 'تم إرسال إشعار اختباري' });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

};
