module.exports = function(app, pool, helpers) {
const { escapeHtml, sanitize, authenticateToken, rateLimit, notify, auditLog, blockedIPs, esc } = helpers;

// ============================================================
app.post('/api/coupons', authenticateToken, async (req, res) => {
  const { code, type, value, min_order, max_uses, expires_at } = req.body;
  if (!code || !value) return res.status(400).json({ success: false, message: 'الكود والقيمة مطلوبان' });
  if (parseFloat(value) <= 0) return res.status(400).json({ success: false, message: 'القيمة يجب أن تكون أكبر من صفر' });
  if (type === 'percent' && parseFloat(value) > 100) return res.status(400).json({ success: false, message: 'النسبة لا تتجاوز 100%' });
  try {
    if (pool) {
      const r = await pool.query(
        'INSERT INTO coupons (user_id,code,type,value,min_order,max_uses,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [req.user.id, code.toUpperCase().trim(), type||'percent', parseFloat(value), parseFloat(min_order)||0, parseInt(max_uses)||100, expires_at||null]
      );
      return res.json({ success: true, coupon: r.rows[0] });
    }
  } catch (e) { return res.status(400).json({ success: false, message: e.message.includes('unique')?'هذا الكود مستخدم':e.message }); }
});

app.get('/api/coupons', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM coupons WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
      return res.json({ success: true, coupons: r.rows });
    }
  } catch (e) {}
  res.json({ success: true, coupons: [] });
});

app.post('/api/coupons/validate', async (req, res) => {
  const { code, order_total, store_user_id } = req.body;
  if (!code || !store_user_id) return res.status(400).json({ success: false, message: 'البيانات ناقصة' });
  try {
    if (pool) {
      const r = await pool.query(
        `SELECT * FROM coupons WHERE user_id=$1 AND code=$2 AND is_active=true AND (expires_at IS NULL OR expires_at>NOW()) AND used_count<max_uses`,
        [store_user_id, code.toUpperCase().trim()]
      );
      if (!r.rows.length) return res.status(404).json({ success: false, message: 'الكود غير صحيح أو منتهي' });
      const coupon = r.rows[0];
      const total = parseFloat(order_total)||0;
      if (total < parseFloat(coupon.min_order)) return res.status(400).json({ success: false, message: `الحد الأدنى ${coupon.min_order}` });
      const discount = coupon.type === 'percent' ? total*parseFloat(coupon.value)/100 : Math.min(parseFloat(coupon.value), total);
      return res.json({ success: true, coupon, discount: parseFloat(discount.toFixed(2)), final_total: parseFloat((total-discount).toFixed(2)) });
    }
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/coupons/:id', authenticateToken, async (req, res) => {
  try {
    if (pool) await pool.query('DELETE FROM coupons WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// LOYALTY POINTS
// ============================================================
app.get('/api/loyalty/settings', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM loyalty_settings WHERE user_id=$1', [req.user.id]);
      return res.json({ success: true, settings: r.rows[0] || { points_per_currency: 1, redeem_rate: 100, min_redeem: 100, is_active: true } });
    }
  } catch (e) {}
  res.json({ success: true, settings: { points_per_currency: 1, redeem_rate: 100, min_redeem: 100, is_active: true } });
});

app.put('/api/loyalty/settings', authenticateToken, async (req, res) => {
  const { points_per_currency, redeem_rate, min_redeem, is_active } = req.body;
  try {
    if (pool) {
      await pool.query(`INSERT INTO loyalty_settings (user_id,points_per_currency,redeem_rate,min_redeem,is_active) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id) DO UPDATE SET points_per_currency=$2,redeem_rate=$3,min_redeem=$4,is_active=$5`,
        [req.user.id, parseFloat(points_per_currency)||1, parseFloat(redeem_rate)||100, parseInt(min_redeem)||100, is_active!==false]);
      return res.json({ success: true });
    }
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// إعدادات ولاء ذكية حسب نوع العمل
app.post('/api/loyalty/smart-defaults', authenticateToken, rateLimit(10, 60*1000), async (req, res) => {
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.json({ success: false, message: 'AI غير متاح' });
  try {
    let bp = {};
    if (pool) {
      const r = await pool.query('SELECT business_type, currency FROM business_profile WHERE user_id=$1', [req.user.id]);
      bp = r.rows[0] || {};
    }

    // إعدادات افتراضية ذكية بدون AI لأنواع العمل الشائعة (أسرع وأوفر)
    const smartDefaults = {
      restaurant:   { points_per_currency: 1,    redeem_rate: 500,  min_redeem: 500,  reason: 'المطاعم تعتمد تكرار الزيارة — نقطة لكل دينار تشجع العودة السريعة، والاسترداد بـ500 نقطة يعادل وجبة صغيرة' },
      retail:       { points_per_currency: 0.5,  redeem_rate: 1000, min_redeem: 1000, reason: 'تجارة التجزئة: نصف نقطة لكل دينار مع استرداد بـ1000 نقطة يحافظ على هامش الربح' },
      fashion:      { points_per_currency: 0.5,  redeem_rate: 1000, min_redeem: 1000, reason: 'الأزياء: مشتريات بمبالغ عالية — نقطة لكل 2 دينار ومكافأة عند تراكم كافٍ' },
      electronics:  { points_per_currency: 0.2,  redeem_rate: 2000, min_redeem: 2000, reason: 'الإلكترونيات: هامش ربح محدود — 0.2 نقطة فقط مع استرداد عالي لحماية الهامش' },
      perfume:      { points_per_currency: 1,    redeem_rate: 500,  min_redeem: 500,  reason: 'العطور: مشتريات متكررة — نقطة كاملة لكل دينار لتشجيع الولاء' },
      health:       { points_per_currency: 1,    redeem_rate: 500,  min_redeem: 500,  reason: 'الصحة والجمال: زيارات متكررة — نقطة لكل دينار مع استرداد معقول' },
      education:    { points_per_currency: 0.5,  redeem_rate: 1000, min_redeem: 1000, reason: 'التعليم: خدمات دورية — نصف نقطة مع استرداد يوازي خصم على الدورة القادمة' },
      furniture:    { points_per_currency: 0.1,  redeem_rate: 5000, min_redeem: 5000, reason: 'الأثاث: مشتريات نادرة وكبيرة — نقاط رمزية للولاء بدون ضغط على الهامش' },
      sports:       { points_per_currency: 1,    redeem_rate: 500,  min_redeem: 500,  reason: 'الرياضة: مشتريات متكررة — نقطة كاملة تشجع على الاستمرار' },
      real_estate:  { points_per_currency: 0.01, redeem_rate: 10000,min_redeem:10000, reason: 'العقارات: صفقات ضخمة ونادرة — نقاط رمزية فقط، نظام الولاء غير أساسي لهذا النشاط' },
      services:     { points_per_currency: 1,    redeem_rate: 500,  min_redeem: 500,  reason: 'الخدمات: تكرار التعامل مهم — نقطة كاملة لكل دينار لبناء علاقة طويلة' },
      other:        { points_per_currency: 1,    redeem_rate: 1000, min_redeem: 1000, reason: 'إعدادات متوازنة مناسبة لمعظم أنواع الأعمال' }
    };

    const type = bp.business_type || 'other';
    const defaults = smartDefaults[type] || smartDefaults.other;
    res.json({ success: true, defaults });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/loyalty/customers', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM loyalty_points WHERE user_id=$1 ORDER BY points DESC', [req.user.id]);
      return res.json({ success: true, customers: r.rows });
    }
  } catch (e) {}
  res.json({ success: true, customers: [] });
});

app.post('/api/loyalty/add', authenticateToken, async (req, res) => {
  const { customer_phone, customer_name, order_id, order_total } = req.body;
  if (!customer_phone || !order_total) return res.status(400).json({ success: false, message: 'البيانات ناقصة' });
  try {
    if (pool) {
      const settings = await pool.query('SELECT * FROM loyalty_settings WHERE user_id=$1', [req.user.id]);
      const s = settings.rows[0] || { points_per_currency: 1, is_active: true };
      if (!s.is_active) return res.json({ success: false, message: 'نظام النقاط غير مفعّل' });
      const points = Math.floor(parseFloat(order_total) * parseFloat(s.points_per_currency));
      if (points <= 0) return res.json({ success: false, message: 'لا نقاط لهذا الطلب' });
      await pool.query(`INSERT INTO loyalty_points (user_id,customer_phone,customer_name,points,total_earned) VALUES ($1,$2,$3,$4,$4) ON CONFLICT (user_id,customer_phone) DO UPDATE SET points=loyalty_points.points+$4,total_earned=loyalty_points.total_earned+$4,customer_name=COALESCE($3,loyalty_points.customer_name),updated_at=NOW()`,
        [req.user.id, customer_phone, customer_name||'', points]);
      return res.json({ success: true, points_added: points });
    }
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// TEAM & PERMISSIONS
// ============================================================
app.post('/api/team', authenticateToken, async (req, res) => {
  const { name, email, password, role, permissions } = req.body;
  const validRoles = ['manager', 'sales', 'customer_service', 'designer', 'orders', 'viewer'];
  if (!name || !email || !password || !role) return res.status(400).json({ success: false, message: 'جميع الحقول مطلوبة' });
  if (!validRoles.includes(role)) return res.status(400).json({ success: false, message: 'صلاحية غير صحيحة' });
  try {
    if (pool) {
      const r = await pool.query(
        'INSERT INTO team_members (owner_id,name,email,password,role,permissions) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,name,email,role',
        [req.user.id, name, email, await bcrypt.hash(password, 10), role, JSON.stringify(permissions||[])]
      );
      await auditLog(req.user.id, 'add_team_member', 'team', r.rows[0].id, `${name} - ${role}`, req.ip);
      return res.json({ success: true, member: r.rows[0] });
    }
  } catch (e) { return res.status(400).json({ success: false, message: e.message.includes('unique')?'البريد مستخدم':e.message }); }
});

app.get('/api/team', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT id,name,email,role,permissions,created_at FROM team_members WHERE owner_id=$1 ORDER BY created_at DESC', [req.user.id]);
      return res.json({ members: r.rows });
    }
  } catch (e) {}
  res.json({ members: [] });
});

app.delete('/api/team/:id', authenticateToken, async (req, res) => {
  try {
    if (pool) await pool.query('DELETE FROM team_members WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// NOTIFICATIONS
// ============================================================
app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30', [req.user.id]);
      return res.json({ notifications: r.rows });
    }
  } catch (e) {}
  res.json({ notifications: [] });
});

app.put('/api/notifications/read', authenticateToken, async (req, res) => {
  try {
    if (pool) await pool.query('UPDATE notifications SET is_read=true WHERE user_id=$1', [req.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// AUDIT LOG — سجل العمليات
// ============================================================
app.get('/api/security/audit-log', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM audit_log WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
      return res.json({ success: true, logs: r.rows });
    }
  } catch (e) {}
  res.json({ success: true, logs: [] });
});

app.get('/api/security/status', authenticateToken, (req, res) => {
  res.json({ success: true, security: { blocked_ips: blockedIPs.size, rate_limit: true, jwt: true, bcrypt: true, audit_log: true } });
});

// ============================================================
};
