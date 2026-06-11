module.exports = function(app, pool, helpers) {
const { sanitize, authenticateToken, rateLimit, notify, escapeHtml } = helpers;
const crypto = require('crypto');

// ============================================================
// REFERRAL — برنامج الإحالة
// ============================================================

// جلب إعدادات برنامج الإحالة
app.get('/api/referral/settings', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.json({ success: true, settings: null });
    const r = await pool.query('SELECT * FROM referral_settings WHERE user_id=$1', [req.user.id]);
    res.json({ success: true, settings: r.rows[0] || null });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// حفظ إعدادات برنامج الإحالة
app.put('/api/referral/settings', authenticateToken, async (req, res) => {
  const { is_active, referrer_reward_type, referrer_reward_value,
          referee_reward_type, referee_reward_value, min_order } = req.body;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    await pool.query(`
      INSERT INTO referral_settings (user_id, is_active, referrer_reward_type, referrer_reward_value, referee_reward_type, referee_reward_value, min_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (user_id) DO UPDATE SET
        is_active=$2, referrer_reward_type=$3, referrer_reward_value=$4,
        referee_reward_type=$5, referee_reward_value=$6, min_order=$7`,
      [req.user.id, is_active !== false,
       referrer_reward_type || 'points', parseFloat(referrer_reward_value) || 500,
       referee_reward_type || 'discount', parseFloat(referee_reward_value) || 10,
       parseFloat(min_order) || 0]
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// جلب رابط الإحالة الخاص بزبون
app.get('/api/referral/link/:customer_phone', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false });
    const phone = req.params.customer_phone;

    // البحث عن الزبون
    let r = await pool.query(
      'SELECT * FROM referral_codes WHERE user_id=$1 AND customer_phone=$2',
      [req.user.id, phone]
    );

    let code;
    if (!r.rows.length) {
      // إنشاء كود جديد
      code = crypto.randomBytes(4).toString('hex').toUpperCase();
      await pool.query(
        'INSERT INTO referral_codes (user_id, customer_phone, code) VALUES ($1,$2,$3)',
        [req.user.id, phone, code]
      );
    } else {
      code = r.rows[0].code;
    }

    const baseUrl = process.env.BASE_URL || 'https://socialos-production-4aa6.up.railway.app';
    const link = `${baseUrl}/ref/${code}`;
    res.json({ success: true, code, link });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// صفحة الإحالة العامة
app.get('/ref/:code', async (req, res) => {
  try {
    if (!pool) return res.redirect('/');
    const r = await pool.query(`
      SELECT rc.*, bp.store_name, bp.primary_color, bp.currency,
             rs.referee_reward_type, rs.referee_reward_value
      FROM referral_codes rc
      JOIN business_profile bp ON bp.user_id = rc.user_id
      LEFT JOIN referral_settings rs ON rs.user_id = rc.user_id
      WHERE rc.code = $1`, [req.params.code]);

    if (!r.rows.length) return res.redirect('/');
    const ref = r.rows[0];
    const color = ref.primary_color || '#5b6af0';
    const reward = ref.referee_reward_type === 'discount'
      ? `خصم ${ref.referee_reward_value || 10}%`
      : `${ref.referee_reward_value || 500} نقطة`;

    res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${ref.store_name} — عرض خاص لك</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;background:#0a0a0c;color:#f0f0f2;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;}
  .card{background:#111114;border:1px solid #28282f;border-radius:20px;padding:28px 24px;max-width:400px;width:100%;text-align:center;}
  .logo{width:64px;height:64px;background:${color};border-radius:18px;display:inline-flex;align-items:center;justify-content:center;font-size:1.8rem;margin-bottom:16px;}
  h1{font-size:1.4rem;font-weight:900;margin-bottom:8px;}
  .reward{background:rgba(91,106,240,.1);border:1px solid rgba(91,106,240,.2);border-radius:12px;padding:16px;margin:16px 0;font-size:1.1rem;font-weight:700;color:${color};}
  .btn{display:block;background:${color};color:white;border:none;border-radius:12px;padding:14px;font-size:1rem;font-weight:700;cursor:pointer;text-decoration:none;margin-top:16px;font-family:inherit;}
  p{font-size:.85rem;color:#8888a0;line-height:1.6;}
</style>
</head>
<body>
<div class="card">
  <div class="logo">⚡</div>
  <h1>${escapeHtml(ref.store_name)}</h1>
  <p>صديقك أهداك عرضاً خاصاً!</p>
  <div class="reward">🎁 احصل على ${reward}<br>عند أول طلب</div>
  <p>استخدم الكود أدناه عند الطلب:</p>
  <div style="background:#18181c;border-radius:10px;padding:14px;margin:12px 0;font-size:1.3rem;font-weight:900;letter-spacing:3px;color:${color}">${req.params.code}</div>
  <a href="https://wa.me/${ref.customer_phone?.replace(/[^0-9]/g,'').replace(/^0/,'964')}?text=${encodeURIComponent(`مرحباً! أريد الطلب وعندي كود إحالة: ${req.params.code}`)}" class="btn">📱 تواصل للطلب</a>
  <p style="margin-top:16px;font-size:.75rem">⚡ مدعوم بـ SocialOS</p>
</div>
</body>
</html>`);
  } catch(e) { res.redirect('/'); }
});

// جلب إحصائيات الإحالة
app.get('/api/referral/stats', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.json({ success: true, stats: {}, top_referrers: [] });
    const [stats, top] = await Promise.all([
      pool.query(`
        SELECT COUNT(*) as total_referrals,
               COUNT(*) FILTER(WHERE status='completed') as successful,
               SUM(reward_given) as total_rewards
        FROM referral_uses WHERE user_id=$1`, [req.user.id]),
      pool.query(`
        SELECT rc.customer_phone, rc.customer_name, rc.code,
               COUNT(ru.id) as referrals,
               SUM(CASE WHEN ru.status='completed' THEN 1 ELSE 0 END) as successful
        FROM referral_codes rc
        LEFT JOIN referral_uses ru ON ru.code=rc.code AND ru.user_id=rc.user_id
        WHERE rc.user_id=$1
        GROUP BY rc.customer_phone, rc.customer_name, rc.code
        ORDER BY referrals DESC LIMIT 10`, [req.user.id])
    ]);
    res.json({ success: true, stats: stats.rows[0] || {}, top_referrers: top.rows });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// تسجيل استخدام رابط إحالة (عند الطلب)
app.post('/api/referral/use', authenticateToken, async (req, res) => {
  const { code, new_customer_phone, order_id } = req.body;
  if (!code) return res.status(400).json({ success: false, message: 'الكود مطلوب' });
  try {
    if (!pool) return res.status(503).json({ success: false });

    const [codeR, settingsR] = await Promise.all([
      pool.query('SELECT * FROM referral_codes WHERE code=$1 AND user_id=$2', [code, req.user.id]),
      pool.query('SELECT * FROM referral_settings WHERE user_id=$1', [req.user.id])
    ]);

    if (!codeR.rows.length) return res.status(404).json({ success: false, message: 'الكود غير صالح' });
    const ref = codeR.rows[0];
    const settings = settingsR.rows[0];
    if (!settings?.is_active) return res.status(400).json({ success: false, message: 'برنامج الإحالة غير مفعل' });

    // تسجيل الاستخدام
    await pool.query(`
      INSERT INTO referral_uses (user_id, code, referrer_phone, new_customer_phone, order_id, status)
      VALUES ($1,$2,$3,$4,$5,'completed')
      ON CONFLICT DO NOTHING`,
      [req.user.id, code, ref.customer_phone, sanitize(new_customer_phone||''), order_id||null]
    );

    // مكافأة المُحيل (الزبون الذي أرسل الرابط)
    let referrerReward = '';
    if (settings.referrer_reward_type === 'points') {
      await pool.query(`
        INSERT INTO loyalty_points (user_id, customer_phone, customer_name, points, total_earned)
        VALUES ($1,$2,$3,$4,$4)
        ON CONFLICT (user_id, customer_phone) DO UPDATE SET
          points = loyalty_points.points + $4,
          total_earned = loyalty_points.total_earned + $4,
          updated_at = NOW()`,
        [req.user.id, ref.customer_phone, ref.customer_name || '', settings.referrer_reward_value || 500]
      );
      referrerReward = `${settings.referrer_reward_value} نقطة`;
    }

    // إشعار المُحيل عبر WhatsApp
    const bpR = await pool.query('SELECT store_name, whatsapp_number FROM business_profile WHERE user_id=$1', [req.user.id]);
    const bp = bpR.rows[0] || {};
    const phone = String(ref.customer_phone||'').replace(/[^0-9]/g,'');
    const waPhone = phone.startsWith('0') ? '964'+phone.slice(1) : phone;
    const waMsg = `🎉 *مبروك! حصلت على مكافأة إحالة*\n\nأحد أصدقائك طلب من ${bp.store_name} عبر رابطك!\n\n🎁 مكافأتك: *${referrerReward}*\n\nشكراً لثقتك ⚡ ${bp.store_name}`;
    const waUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(waMsg)}`;

    await notify(req.user.id, '🎉 إحالة ناجحة!', `${ref.customer_name || ref.customer_phone} أحال زبوناً جديداً`, 'referral');

    res.json({ success: true, referrer_reward: referrerReward, wa_url: waUrl });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// إنشاء رابط إحالة للزبون وإرساله على WhatsApp
app.post('/api/referral/send/:customer_phone', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false });
    const phone = req.params.customer_phone;

    let r = await pool.query('SELECT * FROM referral_codes WHERE user_id=$1 AND customer_phone=$2', [req.user.id, phone]);
    let code;
    if (!r.rows.length) {
      code = crypto.randomBytes(4).toString('hex').toUpperCase();
      await pool.query('INSERT INTO referral_codes (user_id, customer_phone, code) VALUES ($1,$2,$3)', [req.user.id, phone, code]);
    } else { code = r.rows[0].code; }

    const [settingsR, bpR] = await Promise.all([
      pool.query('SELECT * FROM referral_settings WHERE user_id=$1', [req.user.id]),
      pool.query('SELECT store_name, primary_color FROM business_profile WHERE user_id=$1', [req.user.id])
    ]);
    const settings = settingsR.rows[0] || {};
    const bp = bpR.rows[0] || {};
    const baseUrl = process.env.BASE_URL || 'https://socialos-production-4aa6.up.railway.app';
    const link = `${baseUrl}/ref/${code}`;
    const referrerReward = settings.referrer_reward_type === 'points'
      ? `${settings.referrer_reward_value || 500} نقطة`
      : `خصم ${settings.referrer_reward_value || 10}%`;
    const refereeReward = settings.referee_reward_type === 'discount'
      ? `خصم ${settings.referee_reward_value || 10}%`
      : `${settings.referee_reward_value || 500} نقطة`;

    const waPhone = phone.replace(/[^0-9]/g,'').replace(/^0/,'964');
    const msg = `🎁 *شارك واكسب — ${bp.store_name}*\n\nأهلاً! 😊\n\nشارك هذا الرابط مع أصدقائك:\n${link}\n\n✅ كل صديق يطلب = *${referrerReward}* لك\n🎁 صديقك يحصل على *${refereeReward}*\n\nكلما شاركت، كلما ربحت أكثر! 🚀\n⚡ ${bp.store_name}`;
    const waUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`;

    res.json({ success: true, code, link, wa_url: waUrl });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

};
