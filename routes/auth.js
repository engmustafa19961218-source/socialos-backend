module.exports = function(app, pool, helpers) {
const { escapeHtml, sanitize, authenticateToken, authLimiter, rateLimit, bcrypt, jwt, JWT_SECRET, trackFailedLogin, notify, auditLog, esc } = helpers;

// ============================================================
// AUTH
// ============================================================
app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !password) return res.status(400).json({ success: false, message: 'الاسم وكلمة المرور مطلوبان' });
  if (!email && !phone) return res.status(400).json({ success: false, message: 'البريد الإلكتروني أو رقم الهاتف مطلوب' });
  if (password.length < 6) return res.status(400).json({ success: false, message: 'كلمة المرور 6 أحرف على الأقل' });

  // تنظيف رقم الهاتف
  const cleanPhone = phone ? String(phone).replace(/[^\d+]/g, '') : null;
  if (cleanPhone && cleanPhone.length < 7) return res.status(400).json({ success: false, message: 'رقم الهاتف غير صالح' });

  try {
    const hashed = await bcrypt.hash(password, 10);
    if (pool) {
      // التحقق من عدم التكرار
      if (email) {
        const existing = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
        if (existing.rows.length) return res.status(400).json({ success: false, message: 'البريد مستخدم مسبقاً' });
      }
      if (cleanPhone) {
        const existing = await pool.query('SELECT id FROM users WHERE phone=$1', [cleanPhone]);
        if (existing.rows.length) return res.status(400).json({ success: false, message: 'رقم الهاتف مستخدم مسبقاً' });
      }
      const r = await pool.query(
        'INSERT INTO users (name, email, phone, password) VALUES ($1,$2,$3,$4) RETURNING id, name, email, phone, plan, role',
        [name, email||null, cleanPhone||null, hashed]
      );
      const user = r.rows[0];
      await pool.query('INSERT INTO business_profile (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
      await pool.query('INSERT INTO digital_employee (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
      const token = jwt.sign({ id: user.id, email: user.email||user.phone, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, plan: user.plan, role: user.role }, token });
    }
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message.includes('unique') ? 'البريد أو الهاتف مستخدم مسبقاً' : e.message });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { email, phone, password } = req.body;
  const identifier = email || phone;
  if (!identifier || !password) return res.status(400).json({ success: false, message: 'البريد/الهاتف وكلمة المرور مطلوبان' });
  const cleanPhone = phone ? String(phone).replace(/[^\d+]/g, '') : null;
  const ip = req.ip || '';
  try {
    if (pool) {
      // البحث بالبريد أو الهاتف
      let result;
      if (email) {
        result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
        // تحقق من team members أيضاً
        if (!result.rows.length) {
          const teamResult = await pool.query('SELECT * FROM team_members WHERE email=$1', [email]);
          if (teamResult.rows.length > 0) {
            const member = teamResult.rows[0];
            const match = await bcrypt.compare(password, member.password);
            if (!match) { trackFailedLogin(ip); return res.status(401).json({ success: false, message: 'بيانات غير صحيحة' }); }
            const token = jwt.sign({ id: member.id, email: member.email, role: member.role, owner_id: member.owner_id }, JWT_SECRET, { expiresIn: '7d' });
            return res.json({ success: true, user: { id: member.id, name: member.name, email: member.email, role: member.role, owner_id: member.owner_id }, token });
          }
        }
      } else {
        result = await pool.query('SELECT * FROM users WHERE phone=$1', [cleanPhone]);
      }

      if (!result.rows.length) { trackFailedLogin(ip); return res.status(401).json({ success: false, message: 'بيانات غير صحيحة' }); }
      const user = result.rows[0];
      const match = await bcrypt.compare(password, user.password);
      if (!match) { trackFailedLogin(ip); return res.status(401).json({ success: false, message: 'بيانات غير صحيحة' }); }
      await auditLog(user.id, 'login', 'auth', null, 'تسجيل دخول ناجح', ip);
      const token = jwt.sign({ id: user.id, email: user.email||user.phone, role: user.role || 'owner' }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, plan: user.plan, role: user.role || 'owner', avatar_url: user.avatar_url } , token });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT id, name, email, avatar_url, plan, plan_expires_at, role FROM users WHERE id=$1', [req.user.id]);
      if (r.rows.length > 0) return res.json({ success: true, user: r.rows[0] });
    }
  } catch (e) {}
  res.json({ success: true, user: req.user });
});

// Google Auth
app.post('/api/auth/google', authLimiter, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, message: 'Token مطلوب' });
  try {
    const googleRes = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?id_token=${token}`);
    const g = await googleRes.json();
    if (g.error) return res.status(401).json({ success: false, message: 'Token غير صالح' });
    if (!g.email) return res.status(401).json({ success: false, message: 'البريد غير موجود' });
    if (pool) {
      let r = await pool.query('SELECT * FROM users WHERE email=$1', [g.email]);
      let user;
      if (r.rows.length === 0) {
        const nr = await pool.query(
          'INSERT INTO users (name, email, password, avatar_url) VALUES ($1,$2,$3,$4) RETURNING id, name, email, plan, role, avatar_url',
          [g.name || g.email.split('@')[0], g.email, await bcrypt.hash(g.sub, 10), g.picture || '']
        );
        user = nr.rows[0];
        await pool.query('INSERT INTO business_profile (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
        await pool.query('INSERT INTO digital_employee (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
      } else {
        user = r.rows[0];
        if (g.picture && !user.avatar_url) await pool.query('UPDATE users SET avatar_url=$1 WHERE id=$2', [g.picture, user.id]);
      }
      const jwtToken = jwt.sign({ id: user.id, email: user.email, role: user.role || 'owner' }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, plan: user.plan, role: user.role || 'owner', avatar_url: user.avatar_url || g.picture }, token: jwtToken });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// نسيت كلمة المرور — طلب كود
app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
  const { identifier } = req.body;
  if (!identifier) return res.status(400).json({ success: false, message: 'البريد أو الهاتف مطلوب' });

  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    const cleanPhone = /^\d+$/.test(identifier.replace(/[+\s]/g,'')) ? identifier.replace(/[^\d+]/g,'') : null;
    let user;
    if (cleanPhone) {
      const r = await pool.query('SELECT id, name, phone FROM users WHERE phone=$1', [cleanPhone]);
      user = r.rows[0];
    } else {
      const r = await pool.query('SELECT id, name, email FROM users WHERE email=$1', [identifier]);
      user = r.rows[0];
    }

    if (!user) return res.json({ success: true, message: 'إذا كان الحساب موجوداً ستصله رسالة' });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await pool.query('DELETE FROM reset_codes WHERE identifier=$1', [identifier]);
    await pool.query('INSERT INTO reset_codes (identifier, code, expires_at) VALUES ($1,$2,$3)', [identifier, code, expiresAt]);

    console.log(`Reset code for ${identifier}: ${code}`);

    // إذا كان هاتف — نولّد رابط واتساب لإرسال الكود
    let waLink = null;
    if (cleanPhone) {
      const msg = `مرحباً ${escapeHtml(user.name||'')} 👋\n\nكود إعادة تعيين كلمة المرور لـ SocialOS:\n\n*${code}*\n\nصالح لمدة 15 دقيقة فقط.\nإذا لم تطلب هذا الكود تجاهل الرسالة.`;
      waLink = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
    }

    return res.json({
      success: true,
      message: cleanPhone ? 'سيُفتح واتساب لإرسال الكود' : 'تم إرسال الكود',
      wa_link: waLink,
      code_hint: code.substring(0,2) + '****'
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// التحقق من الكود وتعيين كلمة مرور جديدة
app.post('/api/auth/reset-password', authLimiter, async (req, res) => {
  const { identifier, code, new_password } = req.body;
  if (!identifier || !code || !new_password)
    return res.status(400).json({ success: false, message: 'جميع الحقول مطلوبة' });
  if (new_password.length < 6)
    return res.status(400).json({ success: false, message: 'كلمة المرور 6 أحرف على الأقل' });

  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    // التحقق من الكود
    const r = await pool.query(
      'SELECT * FROM reset_codes WHERE identifier=$1 AND code=$2 AND used=false AND expires_at > NOW()',
      [identifier, String(code).trim()]
    );

    if (!r.rows.length)
      return res.status(400).json({ success: false, message: 'الكود غير صحيح أو منتهي الصلاحية' });

    // البحث عن المستخدم
    const cleanPhone = /^\d+$/.test(identifier.replace(/[+\s]/g,'')) ? identifier.replace(/[^\d+]/g,'') : null;
    let userId;
    if (cleanPhone) {
      const u = await pool.query('SELECT id FROM users WHERE phone=$1', [cleanPhone]);
      userId = u.rows[0]?.id;
    } else {
      const u = await pool.query('SELECT id FROM users WHERE email=$1', [identifier]);
      userId = u.rows[0]?.id;
    }

    if (!userId) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });

    // تحديث كلمة المرور
    const hashed = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password=$1 WHERE id=$2', [hashed, userId]);

    // تعليم الكود كمستخدم
    await pool.query('UPDATE reset_codes SET used=true WHERE identifier=$1 AND code=$2', [identifier, code]);

    await auditLog(userId, 'reset_password', 'auth', null, 'إعادة تعيين كلمة المرور', req.ip);
    res.json({ success: true, message: 'تم تعيين كلمة المرور الجديدة بنجاح' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// cleanup reset codes كل ساعة
setInterval(() => {
  if (pool) pool.query('DELETE FROM reset_codes WHERE expires_at < NOW() OR used=true').catch(() => {});
}, 60 * 60 * 1000);

app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ success: false, message: 'جميع الحقول مطلوبة' });
  if (new_password.length < 6) return res.status(400).json({ success: false, message: 'كلمة المرور 6 أحرف على الأقل' });
  try {
    if (pool) {
      const r = await pool.query('SELECT password FROM users WHERE id=$1', [req.user.id]);
      if (!r.rows.length) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
      const match = await bcrypt.compare(current_password, r.rows[0].password);
      if (!match) return res.status(401).json({ success: false, message: 'كلمة المرور الحالية غير صحيحة' });
      await pool.query('UPDATE users SET password=$1 WHERE id=$2', [await bcrypt.hash(new_password, 10), req.user.id]);
      await auditLog(req.user.id, 'change_password', 'auth', null, 'تغيير كلمة المرور', req.ip);
      return res.json({ success: true, message: 'تم تغيير كلمة المرور' });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

};
