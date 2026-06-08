// ============================================================
// SocialOS v2.0 — نظام التشغيل العربي الذكي للأعمال
// Backend: Node.js + Express + PostgreSQL
// ============================================================
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const cron = require('node-cron');
const app = express();

// ========== CORS ==========
const ALLOWED_ORIGINS = [
  'https://socialos-production-4aa6.up.railway.app',
  'http://localhost:3000',
  ...(process.env.EXTRA_ORIGINS ? process.env.EXTRA_ORIGINS.split(',') : [])
];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json({ limit: '15mb' }));

// ========== SECURITY HEADERS ==========
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ========== RATE LIMITING ==========
const rateLimitStore = {};
function rateLimit(maxRequests, windowMs) {
  return (req, res, next) => {
    const ip = req.ip || 'unknown';
    const key = ip + req.path;
    const now = Date.now();
    if (!rateLimitStore[key]) rateLimitStore[key] = { count: 0, resetAt: now + windowMs };
    if (now > rateLimitStore[key].resetAt) rateLimitStore[key] = { count: 0, resetAt: now + windowMs };
    rateLimitStore[key].count++;
    if (rateLimitStore[key].count > maxRequests)
      return res.status(429).json({ success: false, message: 'طلبات كثيرة، حاول لاحقاً' });
    next();
  };
}
const authLimiter = rateLimit(10, 15 * 60 * 1000);
const apiLimiter  = rateLimit(120, 60 * 1000);

setInterval(() => {
  const now = Date.now();
  Object.keys(rateLimitStore).forEach(k => { if (now > rateLimitStore[k].resetAt) delete rateLimitStore[k]; });
}, 10 * 60 * 1000);

// Blocked IPs
const blockedIPs = new Set();
const failedAttempts = {};
app.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (blockedIPs.has(ip)) return res.status(403).json({ success: false, message: 'الوصول محظور' });
  next();
});
function trackFailedLogin(ip) {
  if (!failedAttempts[ip]) failedAttempts[ip] = { count: 0, lastAttempt: Date.now() };
  failedAttempts[ip].count++;
  if (failedAttempts[ip].count >= 10) blockedIPs.add(ip);
}

// ========== HELPERS ==========
function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function sanitize(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/<script[^>]*>.*?<\/script>/gi,'').replace(/<[^>]*>/g,'').replace(/javascript:/gi,'').trim();
}
function formatCurrency(amount, currency = 'IQD') {
  const num = parseFloat(amount) || 0;
  const symbols = { IQD:'د.ع', SAR:'ر.س', USD:'$', EUR:'€', KWD:'د.ك', AED:'د.إ' };
  return `${num.toLocaleString('ar-IQ')} ${symbols[currency]||currency}`;
}

// ========== JWT ==========
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error('FATAL: JWT_SECRET not set'); process.exit(1); }

function authenticateToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ message: 'Token required' });
  try {
    req.user = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    next();
  } catch (e) { return res.status(403).json({ message: e.message }); }
}

// ========== DATABASE ==========
let pool = null;
try {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  // ===== TABLES =====
  const tables = [
    // Users
    `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255),
      email VARCHAR(255) UNIQUE,
      password TEXT,
      avatar_url TEXT DEFAULT '',
      plan VARCHAR(50) DEFAULT 'trial',
      plan_expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '7 days'),
      role VARCHAR(50) DEFAULT 'owner',
      owner_id INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    // Business Profile — فهم طبيعة العمل
    `CREATE TABLE IF NOT EXISTS business_profile (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE,
      store_name VARCHAR(255) DEFAULT '',
      business_type VARCHAR(100) DEFAULT '',
      business_desc TEXT DEFAULT '',
      target_audience VARCHAR(255) DEFAULT '',
      pricing_style VARCHAR(100) DEFAULT '',
      communication_style VARCHAR(100) DEFAULT 'ودي وقريب',
      policies TEXT DEFAULT '',
      location VARCHAR(100) DEFAULT '',
      currency VARCHAR(10) DEFAULT 'IQD',
      whatsapp_number VARCHAR(50) DEFAULT '',
      logo_url TEXT DEFAULT '',
      brand_colors TEXT DEFAULT '[]',
      brand_fonts TEXT DEFAULT '[]',
      ai_analysis TEXT DEFAULT '',
      onboarding_done BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
    // Digital Employee — الموظف الرقمي
    `CREATE TABLE IF NOT EXISTS digital_employee (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE,
      name VARCHAR(255) DEFAULT 'مساعدي الذكي',
      personality TEXT DEFAULT '',
      sales_style TEXT DEFAULT '',
      philosophy TEXT DEFAULT '',
      objection_handling TEXT DEFAULT '',
      boundaries TEXT DEFAULT '',
      trust_level INTEGER DEFAULT 1,
      trust_score DECIMAL(5,2) DEFAULT 0,
      total_interactions INTEGER DEFAULT 0,
      correct_interactions INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
    // Training Sessions — جلسات التدريب
    `CREATE TABLE IF NOT EXISTS training_sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      type VARCHAR(50) DEFAULT 'open',
      topic TEXT DEFAULT '',
      messages TEXT DEFAULT '[]',
      corrections INTEGER DEFAULT 0,
      score DECIMAL(5,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    // Training Corrections — تصحيحات التدريب
    `CREATE TABLE IF NOT EXISTS training_corrections (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      original_response TEXT,
      corrected_response TEXT,
      context TEXT,
      lesson TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    // Business Brain — مركز المعرفة
    `CREATE TABLE IF NOT EXISTS knowledge_base (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      title VARCHAR(255),
      content TEXT,
      type VARCHAR(50) DEFAULT 'policy',
      file_url TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    // Decision Memory — سجل القرارات
    `CREATE TABLE IF NOT EXISTS decision_memory (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      decision TEXT,
      reason TEXT,
      context VARCHAR(100) DEFAULT 'general',
      customer_phone VARCHAR(50) DEFAULT '',
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    // Products — المنتجات مع سمات ديناميكية
    `CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      name VARCHAR(255) NOT NULL,
      description TEXT DEFAULT '',
      price DECIMAL(10,2) NOT NULL,
      category VARCHAR(100) DEFAULT 'عام',
      stock INTEGER DEFAULT 0,
      image_url TEXT DEFAULT '',
      is_available BOOLEAN DEFAULT TRUE,
      dynamic_attrs TEXT DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    // Orders — الطلبات
    `CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      customer_name VARCHAR(255),
      customer_phone VARCHAR(50),
      customer_address TEXT,
      items TEXT DEFAULT '[]',
      total DECIMAL(10,2) DEFAULT 0,
      deposit DECIMAL(10,2) DEFAULT 0,
      deposit_type VARCHAR(50) DEFAULT 'full',
      status VARCHAR(50) DEFAULT 'new',
      payment_method VARCHAR(50) DEFAULT 'cash',
      delivery_company VARCHAR(255),
      delivery_link TEXT,
      notes TEXT,
      platform VARCHAR(50),
      coupon_code VARCHAR(50),
      discount DECIMAL(10,2) DEFAULT 0,
      loyalty_points_used INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    // Customers — العملاء
    `CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      name VARCHAR(255),
      phone VARCHAR(50),
      address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    // Coupons — الكوبونات
    `CREATE TABLE IF NOT EXISTS coupons (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      code VARCHAR(50) NOT NULL,
      type VARCHAR(20) DEFAULT 'percent',
      value DECIMAL(10,2) NOT NULL,
      min_order DECIMAL(10,2) DEFAULT 0,
      max_uses INTEGER DEFAULT 100,
      used_count INTEGER DEFAULT 0,
      expires_at TIMESTAMP,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    // Loyalty Points — نقاط الولاء
    `CREATE TABLE IF NOT EXISTS loyalty_points (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      customer_phone VARCHAR(50),
      customer_name VARCHAR(255),
      points INTEGER DEFAULT 0,
      total_earned INTEGER DEFAULT 0,
      total_redeemed INTEGER DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, customer_phone)
    )`,
    `CREATE TABLE IF NOT EXISTS loyalty_settings (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE,
      points_per_currency DECIMAL(10,4) DEFAULT 1,
      redeem_rate DECIMAL(10,4) DEFAULT 100,
      min_redeem INTEGER DEFAULT 100,
      is_active BOOLEAN DEFAULT TRUE
    )`,
    // Notifications
    `CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      title VARCHAR(255),
      message TEXT,
      type VARCHAR(50) DEFAULT 'info',
      is_read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    // Team Members
    `CREATE TABLE IF NOT EXISTS team_members (
      id SERIAL PRIMARY KEY,
      owner_id INTEGER,
      name VARCHAR(255),
      email VARCHAR(255) UNIQUE,
      password TEXT,
      role VARCHAR(50) DEFAULT 'viewer',
      permissions TEXT DEFAULT '[]',
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    // Audit Log — سجل العمليات
    `CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      action VARCHAR(100),
      entity VARCHAR(100),
      entity_id INTEGER,
      details TEXT,
      ip VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    // Emergency Mode — وضع الطوارئ
    `CREATE TABLE IF NOT EXISTS emergency_mode (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE,
      is_active BOOLEAN DEFAULT FALSE,
      mode_type VARCHAR(50) DEFAULT 'emergency',
      message TEXT DEFAULT '',
      stop_orders BOOLEAN DEFAULT FALSE,
      stop_ai BOOLEAN DEFAULT FALSE,
      start_at TIMESTAMP,
      end_at TIMESTAMP,
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
    // Board Recommendations — مجلس الإدارة الذكي
    `CREATE TABLE IF NOT EXISTS board_recommendations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      type VARCHAR(50) DEFAULT 'insight',
      title VARCHAR(255),
      content TEXT,
      priority VARCHAR(20) DEFAULT 'medium',
      is_read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    // Backups — النسخ الاحتياطية
    `CREATE TABLE IF NOT EXISTS backups (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      type VARCHAR(50) DEFAULT 'full',
      data TEXT,
      size INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    // Approval Requests — مركز الموافقات
    `CREATE TABLE IF NOT EXISTS approval_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      requested_by VARCHAR(100) DEFAULT 'ai',
      action_type VARCHAR(100),
      action_data TEXT,
      status VARCHAR(50) DEFAULT 'pending',
      decided_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    // Reply Templates
    `CREATE TABLE IF NOT EXISTS reply_templates (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      title VARCHAR(255),
      content TEXT,
      category VARCHAR(100) DEFAULT 'عام',
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    // Push Subscriptions
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      endpoint TEXT UNIQUE,
      p256dh TEXT,
      auth TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    // Social Accounts — ربط حسابات التواصل الاجتماعي
    `CREATE TABLE IF NOT EXISTS social_accounts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      platform VARCHAR(50) NOT NULL,
      account_id VARCHAR(255) DEFAULT '',
      account_name VARCHAR(255) DEFAULT '',
      account_username VARCHAR(255) DEFAULT '',
      avatar_url TEXT DEFAULT '',
      access_token TEXT DEFAULT '',
      refresh_token TEXT DEFAULT '',
      token_expires_at TIMESTAMP,
      page_id VARCHAR(255) DEFAULT '',
      page_name VARCHAR(255) DEFAULT '',
      whatsapp_phone_id VARCHAR(255) DEFAULT '',
      whatsapp_business_id VARCHAR(255) DEFAULT '',
      is_connected BOOLEAN DEFAULT TRUE,
      scopes TEXT DEFAULT '[]',
      extra_data TEXT DEFAULT '{}',
      connected_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, platform)
    )`
  ];

  tables.forEach(q => pool.query(q).catch(e => console.log('Table:', e.message)));

  // Alter existing tables to add missing columns
  setTimeout(() => {
    const alters = [
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS dynamic_attrs TEXT DEFAULT '{}'`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'owner'`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS owner_id INTEGER`
    ];
    alters.forEach(q => pool.query(q).catch(() => {}));
  }, 2000);

} catch (e) {
  console.log('DB not available:', e.message);
}

// ========== AUDIT LOG HELPER ==========
async function auditLog(userId, action, entity, entityId, details, ip) {
  if (!pool) return;
  try {
    await pool.query(
      'INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES ($1,$2,$3,$4,$5,$6)',
      [userId, action, entity, entityId || null, details || '', ip || '']
    );
  } catch (e) {}
}

// ========== NOTIFY HELPER ==========
async function notify(userId, title, message, type = 'info') {
  if (!pool) return;
  try {
    await pool.query(
      'INSERT INTO notifications (user_id, title, message, type) VALUES ($1,$2,$3,$4)',
      [userId, title, message, type]
    );
  } catch (e) {}
}

// ============================================================
// AUTH
// ============================================================
app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ success: false, message: 'جميع الحقول مطلوبة' });
  if (password.length < 6) return res.status(400).json({ success: false, message: 'كلمة المرور 6 أحرف على الأقل' });
  try {
    const hashed = await bcrypt.hash(password, 10);
    if (pool) {
      const r = await pool.query(
        'INSERT INTO users (name, email, password) VALUES ($1,$2,$3) RETURNING id, name, email, plan, role',
        [name, email, hashed]
      );
      const user = r.rows[0];
      // Create empty business profile & digital employee
      await pool.query('INSERT INTO business_profile (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
      await pool.query('INSERT INTO digital_employee (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
      const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, plan: user.plan, role: user.role }, token });
    }
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message.includes('unique') ? 'البريد مستخدم مسبقاً' : e.message });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ success: false, message: 'جميع الحقول مطلوبة' });
  const ip = req.ip || '';
  try {
    if (pool) {
      // Check main users table
      let result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
      // Also check team members
      if (result.rows.length === 0) {
        const teamResult = await pool.query('SELECT * FROM team_members WHERE email=$1', [email]);
        if (teamResult.rows.length > 0) {
          const member = teamResult.rows[0];
          const match = await bcrypt.compare(password, member.password);
          if (!match) { trackFailedLogin(ip); return res.status(401).json({ success: false, message: 'بيانات غير صحيحة' }); }
          const token = jwt.sign({ id: member.id, email: member.email, role: member.role, owner_id: member.owner_id }, JWT_SECRET, { expiresIn: '7d' });
          return res.json({ success: true, user: { id: member.id, name: member.name, email: member.email, role: member.role, owner_id: member.owner_id }, token });
        }
      }
      if (result.rows.length === 0) { trackFailedLogin(ip); return res.status(401).json({ success: false, message: 'بيانات غير صحيحة' }); }
      const user = result.rows[0];
      const match = await bcrypt.compare(password, user.password);
      if (!match) { trackFailedLogin(ip); return res.status(401).json({ success: false, message: 'بيانات غير صحيحة' }); }
      await auditLog(user.id, 'login', 'auth', null, 'تسجيل دخول ناجح', ip);
      const token = jwt.sign({ id: user.id, email: user.email, role: user.role || 'owner' }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, plan: user.plan, role: user.role || 'owner', avatar_url: user.avatar_url }, token });
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

// ============================================================
// BUSINESS PROFILE — فهم طبيعة العمل
// ============================================================
app.get('/api/business/profile', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM business_profile WHERE user_id=$1', [req.user.id]);
      return res.json({ success: true, profile: r.rows[0] || {} });
    }
  } catch (e) {}
  res.json({ success: true, profile: {} });
});

app.put('/api/business/profile', authenticateToken, async (req, res) => {
  const {
    store_name, business_type, business_desc, target_audience,
    pricing_style, communication_style, policies, location,
    currency, whatsapp_number, logo_url, brand_colors, brand_fonts, onboarding_done
  } = req.body;
  const userId = req.user.id;
  try {
    if (pool) {
      // AI Analysis of business description
      let ai_analysis = '';
      const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
      if (OPENROUTER_KEY && business_desc) {
        try {
          const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'anthropic/claude-haiku-4-5',
              max_tokens: 500,
              messages: [{
                role: 'user',
                content: `حلل هذا الوصف التجاري وأرجع JSON فقط بهذا الشكل بدون أي كلام إضافي:
{"activity_type":"نوع النشاط","pricing_style":"طريقة التسعير","reply_style":"أسلوب الرد المناسب","key_features":["ميزة1","ميزة2"],"suggested_policies":["سياسة1","سياسة2"]}

الوصف: "${business_desc}"`
              }]
            })
          });
          const aiData = await aiRes.json();
          ai_analysis = aiData.choices?.[0]?.message?.content || '';
        } catch (e) {}
      }
      await pool.query(`
        INSERT INTO business_profile (user_id, store_name, business_type, business_desc, target_audience, pricing_style, communication_style, policies, location, currency, whatsapp_number, logo_url, brand_colors, brand_fonts, ai_analysis, onboarding_done)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        ON CONFLICT (user_id) DO UPDATE SET
          store_name=$2, business_type=$3, business_desc=$4, target_audience=$5,
          pricing_style=$6, communication_style=$7, policies=$8, location=$9,
          currency=$10, whatsapp_number=$11, logo_url=$12, brand_colors=$13,
          brand_fonts=$14, ai_analysis=CASE WHEN $15='' THEN business_profile.ai_analysis ELSE $15 END,
          onboarding_done=$16, updated_at=NOW()
      `, [userId, store_name||'', business_type||'', business_desc||'', target_audience||'',
          pricing_style||'', communication_style||'ودي وقريب', policies||'', location||'',
          currency||'IQD', whatsapp_number||'', logo_url||'',
          JSON.stringify(brand_colors||[]), JSON.stringify(brand_fonts||[]),
          ai_analysis, onboarding_done||false]);
      await auditLog(userId, 'update_business_profile', 'business_profile', null, '', req.ip);
      const r = await pool.query('SELECT * FROM business_profile WHERE user_id=$1', [userId]);
      return res.json({ success: true, profile: r.rows[0] });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// Business Types list
app.get('/api/business/types', (req, res) => {
  res.json({
    success: true,
    types: [
      { id: 'retail',    name: 'تجارة ومنتجات',  icon: '🛍️', attrs: ['اللون', 'المقاس', 'المادة'] },
      { id: 'restaurant',name: 'مطاعم وكافيه',   icon: '🍽️', attrs: ['الحجم', 'الإضافات', 'الحرارة'] },
      { id: 'real_estate',name: 'عقارات',         icon: '🏠', attrs: ['المساحة', 'الغرف', 'الطابق'] },
      { id: 'services',  name: 'خدمات',           icon: '🔧', attrs: ['المدة', 'النوع', 'المكان'] },
      { id: 'health',    name: 'صحة وجمال',       icon: '💆', attrs: ['النوع', 'المدة', 'الجنس'] },
      { id: 'education', name: 'تعليم',           icon: '📚', attrs: ['المستوى', 'المدة', 'الشهادة'] },
      { id: 'sports',    name: 'رياضة',           icon: '⚽', attrs: ['النوع', 'المقاس', 'اللون'] },
      { id: 'perfume',   name: 'عطور',            icon: '🌹', attrs: ['الحجم', 'التركيز', 'النوع'] },
      { id: 'furniture', name: 'أثاث',            icon: '🛋️', attrs: ['اللون', 'المادة', 'المقاس'] },
      { id: 'fashion',   name: 'أزياء وملابس',   icon: '👗', attrs: ['المقاس', 'اللون', 'الخامة'] },
      { id: 'electronics',name:'إلكترونيات',      icon: '📱', attrs: ['الموديل', 'اللون', 'السعة'] },
      { id: 'other',     name: 'أخرى',            icon: '🏪', attrs: [] }
    ]
  });
});

// ============================================================
// DIGITAL EMPLOYEE — الموظف الرقمي
// ============================================================
app.get('/api/employee', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM digital_employee WHERE user_id=$1', [req.user.id]);
      if (r.rows.length === 0) {
        await pool.query('INSERT INTO digital_employee (user_id) VALUES ($1)', [req.user.id]);
        return res.json({ success: true, employee: { user_id: req.user.id, name: 'مساعدي الذكي', trust_level: 1, trust_score: 0 } });
      }
      return res.json({ success: true, employee: r.rows[0] });
    }
  } catch (e) {}
  res.json({ success: true, employee: {} });
});

app.put('/api/employee', authenticateToken, async (req, res) => {
  const { name, personality, sales_style, philosophy, objection_handling, boundaries } = req.body;
  try {
    if (pool) {
      await pool.query(`
        INSERT INTO digital_employee (user_id, name, personality, sales_style, philosophy, objection_handling, boundaries)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (user_id) DO UPDATE SET
          name=$2, personality=$3, sales_style=$4, philosophy=$5,
          objection_handling=$6, boundaries=$7, updated_at=NOW()
      `, [req.user.id, name||'مساعدي الذكي', personality||'', sales_style||'', philosophy||'', objection_handling||'', boundaries||'']);
      return res.json({ success: true });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// Trust Level upgrade
app.post('/api/employee/trust/upgrade', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM digital_employee WHERE user_id=$1', [req.user.id]);
      if (!r.rows.length) return res.status(404).json({ success: false, message: 'الموظف غير موجود' });
      const emp = r.rows[0];
      if (emp.trust_level >= 3) return res.json({ success: false, message: 'الموظف وصل للمستوى الأعلى' });
      // Require min 20 correct interactions per level
      const minRequired = emp.trust_level * 20;
      if (emp.correct_interactions < minRequired)
        return res.json({ success: false, message: `يحتاج ${minRequired - emp.correct_interactions} تفاعل صحيح إضافي للترقية` });
      await pool.query('UPDATE digital_employee SET trust_level=trust_level+1, updated_at=NOW() WHERE user_id=$1', [req.user.id]);
      await notify(req.user.id, '🌟 ترقية الموظف الرقمي!', `وصل موظفك الرقمي للمستوى ${emp.trust_level + 1}`, 'employee');
      return res.json({ success: true, new_level: emp.trust_level + 1 });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// TRAINING — التدريب
// ============================================================

// Start training session
app.post('/api/training/session', authenticateToken, async (req, res) => {
  const { type, topic } = req.body;
  try {
    if (pool) {
      const r = await pool.query(
        'INSERT INTO training_sessions (user_id, type, topic, messages) VALUES ($1,$2,$3,$4) RETURNING *',
        [req.user.id, type || 'open', topic || '', '[]']
      );
      return res.json({ success: true, session: r.rows[0] });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// Training chat — محادثة تدريب
app.post('/api/training/chat', authenticateToken, rateLimit(30, 60*1000), async (req, res) => {
  const { session_id, message, mode } = req.body;
  const userId = req.user.id;
  if (!message) return res.status(400).json({ success: false, message: 'الرسالة مطلوبة' });

  let businessProfile = {}, employee = {}, knowledge = [], decisions = [];
  try {
    if (pool) {
      const [bp, emp, kb, dm] = await Promise.all([
        pool.query('SELECT * FROM business_profile WHERE user_id=$1', [userId]),
        pool.query('SELECT * FROM digital_employee WHERE user_id=$1', [userId]),
        pool.query('SELECT title, content, type FROM knowledge_base WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10', [userId]),
        pool.query('SELECT decision, reason, context FROM decision_memory WHERE user_id=$1 AND is_active=true LIMIT 10', [userId])
      ]);
      businessProfile = bp.rows[0] || {};
      employee = emp.rows[0] || {};
      knowledge = kb.rows;
      decisions = dm.rows;
    }
  } catch (e) {}

  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(500).json({ success: false, message: 'OpenRouter غير مفعّل' });

  // Build system prompt based on mode
  let systemPrompt = '';
  if (mode === 'simulate_customer') {
    systemPrompt = `أنت تلعب دور عميل يتواصل مع متجر "${businessProfile.store_name || 'المتجر'}".
نوع العمل: ${businessProfile.business_type || 'غير محدد'}
كن عميلاً حقيقياً: اسأل عن الأسعار، اعترض، تفاوض، أبدِ تردداً.
لا تكشف أنك AI. كن طبيعياً وتلقائياً.`;
  } else if (mode === 'evaluate') {
    systemPrompt = `أنت مدرب أعمال خبير. مهمتك تقييم أداء الموظف الرقمي.
فلسفة العمل: ${employee.philosophy || 'لم تُحدد بعد'}
أسلوب البيع: ${employee.sales_style || 'لم يُحدد بعد'}
قيّم الرد وأعطِ:
1. النقاط الإيجابية
2. نقاط التحسين
3. درجة من 10
4. ردّ أفضل مقترح
كن صريحاً ومفيداً.`;
  } else {
    // Open training
    systemPrompt = `أنت الموظف الرقمي الذكي لمتجر "${businessProfile.store_name || 'المتجر'}".
أنت في جلسة تدريب مع صاحب العمل. تعلم منه وطبّق توجيهاته.

معلومات العمل:
- النشاط: ${businessProfile.business_type || 'غير محدد'}
- الوصف: ${businessProfile.business_desc || ''}
- أسلوب التواصل: ${businessProfile.communication_style || 'ودي وقريب'}
- السياسات: ${businessProfile.policies || ''}

فلسفتك الحالية: ${employee.philosophy || 'لم تُحدد بعد'}
أسلوب بيعك: ${employee.sales_style || 'لم يُحدد بعد'}

مركز المعرفة:
${knowledge.map(k => `[${k.type}] ${k.title}: ${k.content.substring(0, 200)}`).join('\n') || 'فارغ'}

قرارات مهمة:
${decisions.map(d => `- ${d.decision} (السبب: ${d.reason})`).join('\n') || 'لا توجد'}

قواعد:
- أجب بطريقة تعكس ما تعلمته
- إذا صحّح صاحب العمل ردك، اشكره واحفظ الدرس
- اسأل عن سبب التصحيح لتتعلم أكثر`;
  }

  try {
    // Get session messages
    let sessionMessages = [];
    if (pool && session_id) {
      const r = await pool.query('SELECT messages FROM training_sessions WHERE id=$1 AND user_id=$2', [session_id, userId]);
      if (r.rows.length > 0) {
        try { sessionMessages = JSON.parse(r.rows[0].messages || '[]'); } catch (e) {}
      }
    }
    sessionMessages.push({ role: 'user', content: message.substring(0, 2000) });
    if (sessionMessages.length > 30) sessionMessages = sessionMessages.slice(-30);

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4-5',
        max_tokens: 1500,
        messages: [{ role: 'system', content: systemPrompt }, ...sessionMessages]
      })
    });
    const aiData = await aiRes.json();
    if (aiData.error) return res.json({ success: false, message: aiData.error.message });

    const response = aiData.choices?.[0]?.message?.content || '';
    sessionMessages.push({ role: 'assistant', content: response });

    // Save updated messages
    if (pool && session_id) {
      await pool.query('UPDATE training_sessions SET messages=$1 WHERE id=$2 AND user_id=$3',
        [JSON.stringify(sessionMessages), session_id, userId]);
      // Update employee interaction count
      await pool.query('UPDATE digital_employee SET total_interactions=total_interactions+1, updated_at=NOW() WHERE user_id=$1', [userId]);
    }

    return res.json({ success: true, response, mode });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// Submit correction — تصحيح الموظف
app.post('/api/training/correct', authenticateToken, async (req, res) => {
  const { original_response, corrected_response, context, lesson } = req.body;
  const userId = req.user.id;
  if (!original_response || !corrected_response) return res.status(400).json({ success: false, message: 'البيانات مطلوبة' });
  try {
    if (pool) {
      await pool.query(
        'INSERT INTO training_corrections (user_id, original_response, corrected_response, context, lesson) VALUES ($1,$2,$3,$4,$5)',
        [userId, original_response.substring(0,2000), corrected_response.substring(0,2000), context||'', lesson||'']
      );
      // Update employee: increment corrections, update philosophy if lesson provided
      if (lesson) {
        await pool.query(`UPDATE digital_employee SET
          philosophy = CASE WHEN philosophy='' THEN $1 ELSE philosophy || E'\n' || $1 END,
          correct_interactions = correct_interactions + 1,
          updated_at = NOW()
          WHERE user_id=$2`, [lesson, userId]);
      } else {
        await pool.query('UPDATE digital_employee SET correct_interactions=correct_interactions+1, updated_at=NOW() WHERE user_id=$1', [userId]);
      }
      return res.json({ success: true, message: 'تم حفظ التصحيح وتحديث الموظف' });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// Get training history
app.get('/api/training/sessions', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT id, type, topic, corrections, score, created_at FROM training_sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [req.user.id]);
      return res.json({ success: true, sessions: r.rows });
    }
  } catch (e) {}
  res.json({ success: true, sessions: [] });
});

// Get all corrections
app.get('/api/training/corrections', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM training_corrections WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
      return res.json({ success: true, corrections: r.rows });
    }
  } catch (e) {}
  res.json({ success: true, corrections: [] });
});

// ============================================================
// KNOWLEDGE BASE — مركز المعرفة
// ============================================================
app.post('/api/knowledge', authenticateToken, async (req, res) => {
  const { title, content, type } = req.body;
  const userId = req.user.id;
  if (!title || !content) return res.status(400).json({ success: false, message: 'العنوان والمحتوى مطلوبان' });
  const validTypes = ['policy', 'faq', 'catalog', 'warranty', 'return', 'price_list', 'other'];
  if (!validTypes.includes(type)) return res.status(400).json({ success: false, message: 'نوع غير صحيح' });
  try {
    if (pool) {
      const r = await pool.query(
        'INSERT INTO knowledge_base (user_id, title, content, type) VALUES ($1,$2,$3,$4) RETURNING *',
        [userId, title, content, type || 'other']
      );
      return res.json({ success: true, item: r.rows[0] });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/knowledge', authenticateToken, async (req, res) => {
  const { type } = req.query;
  try {
    if (pool) {
      let q = 'SELECT * FROM knowledge_base WHERE user_id=$1';
      const params = [req.user.id];
      if (type) { q += ' AND type=$2'; params.push(type); }
      q += ' ORDER BY created_at DESC';
      const r = await pool.query(q, params);
      return res.json({ success: true, items: r.rows });
    }
  } catch (e) {}
  res.json({ success: true, items: [] });
});

app.put('/api/knowledge/:id', authenticateToken, async (req, res) => {
  const { title, content, type } = req.body;
  try {
    if (pool) {
      await pool.query('UPDATE knowledge_base SET title=$1, content=$2, type=$3 WHERE id=$4 AND user_id=$5',
        [title, content, type, req.params.id, req.user.id]);
      return res.json({ success: true });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/knowledge/:id', authenticateToken, async (req, res) => {
  try {
    if (pool) { await pool.query('DELETE FROM knowledge_base WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]); }
    return res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// DECISION MEMORY — سجل القرارات
// ============================================================
app.post('/api/decisions', authenticateToken, async (req, res) => {
  const { decision, reason, context, customer_phone } = req.body;
  if (!decision || !reason) return res.status(400).json({ success: false, message: 'القرار والسبب مطلوبان' });
  try {
    if (pool) {
      const r = await pool.query(
        'INSERT INTO decision_memory (user_id, decision, reason, context, customer_phone) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [req.user.id, decision, reason, context || 'general', customer_phone || '']
      );
      return res.json({ success: true, decision: r.rows[0] });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/decisions', authenticateToken, async (req, res) => {
  const { context, phone } = req.query;
  try {
    if (pool) {
      let q = 'SELECT * FROM decision_memory WHERE user_id=$1 AND is_active=true';
      const params = [req.user.id];
      if (context) { q += ' AND context=$2'; params.push(context); }
      if (phone) { q += ` AND customer_phone=$${params.length+1}`; params.push(phone); }
      q += ' ORDER BY created_at DESC';
      const r = await pool.query(q, params);
      return res.json({ success: true, decisions: r.rows });
    }
  } catch (e) {}
  res.json({ success: true, decisions: [] });
});

app.delete('/api/decisions/:id', authenticateToken, async (req, res) => {
  try {
    if (pool) { await pool.query('UPDATE decision_memory SET is_active=false WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]); }
    return res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// SMART AGENT — الموظف الرقمي في وضع العمل
// ============================================================
const agentConversations = {};
setInterval(() => {
  const now = Date.now();
  Object.keys(agentConversations).forEach(uid => {
    if (agentConversations[uid]._lastActivity && now - agentConversations[uid]._lastActivity > 2*60*60*1000)
      delete agentConversations[uid];
  });
}, 60*60*1000);

app.post('/api/agent/chat', authenticateToken, rateLimit(25, 60*1000), async (req, res) => {
  const userId = req.user.id;
  const { message } = req.body;
  if (!message) return res.status(400).json({ success: false, message: 'الرسالة مطلوبة' });
  const safeMessage = message.substring(0, 2000);

  let bp = {}, emp = {}, knowledge = [], decisions = [], products = [], emergency = null;
  try {
    if (pool) {
      const [bpR, empR, kbR, dmR, prodR, ordR, emR] = await Promise.all([
        pool.query('SELECT * FROM business_profile WHERE user_id=$1', [userId]),
        pool.query('SELECT * FROM digital_employee WHERE user_id=$1', [userId]),
        pool.query('SELECT title, content, type FROM knowledge_base WHERE user_id=$1 LIMIT 15', [userId]),
        pool.query('SELECT decision, reason, context FROM decision_memory WHERE user_id=$1 AND is_active=true LIMIT 15', [userId]),
        pool.query('SELECT name, price, category, stock FROM products WHERE user_id=$1 AND is_available=true', [userId]),
        pool.query('SELECT COUNT(*) as cnt, SUM(total) as rev FROM orders WHERE user_id=$1', [userId]),
        pool.query('SELECT * FROM emergency_mode WHERE user_id=$1', [userId])
      ]);
      bp = bpR.rows[0] || {};
      emp = empR.rows[0] || {};
      knowledge = kbR.rows;
      decisions = dmR.rows;
      products = prodR.rows;
      emergency = emR.rows[0];
    }
  } catch (e) {}

  // Check emergency mode
  if (emergency?.is_active && emergency?.stop_ai) {
    return res.json({ success: true, response: emergency.message || 'النظام في وضع الطوارئ حالياً. سنعود قريباً.' });
  }

  const trustLabels = { 1: 'مراقبة — يعمل تحت إشراف كامل', 2: 'مساعدة — يمكنه المساعدة باستقلالية محدودة', 3: 'استقلال — يمكنه العمل باستقلالية' };
  const systemPrompt = `أنت الموظف الرقمي الذكي لـ "${bp.store_name || 'المتجر'}".
مستوى الثقة: ${trustLabels[emp.trust_level] || trustLabels[1]}

━━━ معلومات العمل ━━━
النشاط: ${bp.business_type || 'غير محدد'}
الوصف: ${bp.business_desc || ''}
الجمهور: ${bp.target_audience || 'الجميع'}
المنطقة: ${bp.location || ''}
العملة: ${bp.currency || 'IQD'}
أسلوب التواصل: ${bp.communication_style || 'ودي وقريب'}
السياسات: ${bp.policies || 'لم تُحدد'}

━━━ فلسفتي وأسلوبي ━━━
الفلسفة: ${emp.philosophy || 'لم تُحدد بعد — التزم بما يطلبه صاحب العمل'}
أسلوب البيع: ${emp.sales_style || ''}
التعامل مع الاعتراضات: ${emp.objection_handling || ''}
حدودي: ${emp.boundaries || 'لا أغير الأسعار بدون موافقة، لا أحذف بيانات'}

━━━ المنتجات المتاحة ━━━
${products.map(p => `• ${p.name} | ${Number(p.price).toLocaleString('ar-IQ')} ${bp.currency||'د.ع'} | مخزون: ${p.stock}`).join('\n') || 'لا منتجات مضافة'}

━━━ مركز المعرفة ━━━
${knowledge.map(k => `[${k.type}] ${k.title}: ${k.content.substring(0,300)}`).join('\n') || 'فارغ'}

━━━ قرارات مهمة ━━━
${decisions.map(d => `• ${d.decision} ← ${d.reason}`).join('\n') || 'لا توجد'}

━━━ قواعد عملي ━━━
- نفّذ الطلب مباشرةً
- لا تغير الأسعار أو السياسات بدون موافقة
- إذا طُلب خصم غير مصرّح به، اعتذر بأدب
- احفظ أسلوب صاحب العمل في كل رد`;

  if (!agentConversations[userId]) agentConversations[userId] = [];
  agentConversations[userId]._lastActivity = Date.now();
  agentConversations[userId].push({ role: 'user', content: safeMessage });
  if (agentConversations[userId].length > 20) agentConversations[userId] = agentConversations[userId].slice(-20);

  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(500).json({ success: false, message: 'OpenRouter غير مفعّل' });

  try {
    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4-5',
        max_tokens: 2000,
        messages: [{ role: 'system', content: systemPrompt }, ...agentConversations[userId].filter(m => m.role)]
      })
    });
    const aiData = await aiRes.json();
    if (aiData.error) return res.json({ success: false, message: aiData.error.message });
    const response = aiData.choices?.[0]?.message?.content || '';
    agentConversations[userId].push({ role: 'assistant', content: response });
    if (pool) await pool.query('UPDATE digital_employee SET total_interactions=total_interactions+1 WHERE user_id=$1', [userId]);

    // Detect action type
    let action = null;
    const lm = safeMessage.toLowerCase();
    if (lm.includes('طلب') && (lm.includes('أضف')||lm.includes('جديد'))) action = { type: 'new_order' };
    else if (lm.includes('منشور')||lm.includes('اكتب')||lm.includes('محتوى')) action = { type: 'create_post', content: response };
    else if (lm.includes('تقرير')||lm.includes('إحصائيات')) action = { type: 'report' };

    return res.json({ success: true, response, action });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/agent/clear', authenticateToken, (req, res) => {
  agentConversations[req.user.id] = [];
  res.json({ success: true });
});

// Ask why — لماذا أجبت هكذا
app.post('/api/agent/explain', authenticateToken, rateLimit(10, 60*1000), async (req, res) => {
  const { last_response, question } = req.body;
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(500).json({ success: false, message: 'OpenRouter غير مفعّل' });
  try {
    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `أنت موظف رقمي ذكي. أجبت بهذا الرد: "${last_response}"
صاحب العمل يسأل: "${question || 'لماذا أجبت هكذا؟'}"
اشرح منطقك بوضوح وإيجاز، وكيف يمكن تحسين الرد.`
        }]
      })
    });
    const data = await aiRes.json();
    res.json({ success: true, explanation: data.choices?.[0]?.message?.content || '' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// BOARD OF DIRECTORS — مجلس الإدارة الذكي
// ============================================================
app.get('/api/board/recommendations', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM board_recommendations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [req.user.id]);
      return res.json({ success: true, recommendations: r.rows });
    }
  } catch (e) {}
  res.json({ success: true, recommendations: [] });
});

app.post('/api/board/generate', authenticateToken, rateLimit(5, 60*1000), async (req, res) => {
  const userId = req.user.id;
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(500).json({ success: false, message: 'OpenRouter غير مفعّل' });
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'قاعدة البيانات غير متاحة' });
    const [orders, products, customers, bp, emp] = await Promise.all([
      pool.query(`SELECT COUNT(*) as cnt, SUM(total) as rev, SUM(CASE WHEN status='new' THEN 1 ELSE 0 END) as new_cnt FROM orders WHERE user_id=$1`, [userId]),
      pool.query('SELECT COUNT(*) as cnt, SUM(CASE WHEN stock<=3 THEN 1 ELSE 0 END) as low FROM products WHERE user_id=$1', [userId]),
      pool.query('SELECT COUNT(DISTINCT customer_phone) as cnt FROM orders WHERE user_id=$1', [userId]),
      pool.query('SELECT * FROM business_profile WHERE user_id=$1', [userId]),
      pool.query('SELECT trust_level, total_interactions, correct_interactions FROM digital_employee WHERE user_id=$1', [userId])
    ]);

    const bpData = bp.rows[0] || {};
    const empData = emp.rows[0] || {};
    const statsStr = `الطلبات: ${orders.rows[0].cnt}، الإيرادات: ${Number(orders.rows[0].rev||0).toLocaleString()}، طلبات جديدة: ${orders.rows[0].new_cnt}، منتجات: ${products.rows[0].cnt}، مخزون منخفض: ${products.rows[0].low}، عملاء: ${customers.rows[0].cnt}، مستوى ثقة الموظف: ${empData.trust_level||1}`;

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4-5',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `أنت مجلس إدارة ذكي لمتجر "${bpData.store_name||'المتجر'}" (${bpData.business_type||''}).
البيانات: ${statsStr}

أرجع JSON فقط بهذا الشكل بدون أي كلام:
[
  {"type":"opportunity","title":"عنوان قصير","content":"التوصية التفصيلية","priority":"high"},
  {"type":"warning","title":"عنوان قصير","content":"التحذير أو المشكلة","priority":"medium"},
  {"type":"strategy","title":"عنوان قصير","content":"الاستراتيجية المقترحة","priority":"low"},
  {"type":"insight","title":"عنوان قصير","content":"ملاحظة ذكية","priority":"medium"},
  {"type":"action","title":"عنوان قصير","content":"إجراء فوري مطلوب","priority":"high"}
]`
        }]
      })
    });
    const data = await aiRes.json();
    let recs = [];
    try {
      const text = data.choices?.[0]?.message?.content || '[]';
      const match = text.match(/\[[\s\S]*\]/);
      recs = match ? JSON.parse(match[0]) : [];
    } catch (e) {}

    // Save to DB
    for (const rec of recs) {
      await pool.query(
        'INSERT INTO board_recommendations (user_id, type, title, content, priority) VALUES ($1,$2,$3,$4,$5)',
        [userId, rec.type, rec.title, rec.content, rec.priority || 'medium']
      );
    }
    const r = await pool.query('SELECT * FROM board_recommendations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [userId]);
    return res.json({ success: true, recommendations: r.rows });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.put('/api/board/:id/read', authenticateToken, async (req, res) => {
  try {
    if (pool) await pool.query('UPDATE board_recommendations SET is_read=true WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// EMERGENCY MODE — وضع الطوارئ والعطلات
// ============================================================
app.get('/api/emergency', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM emergency_mode WHERE user_id=$1', [req.user.id]);
      return res.json({ success: true, emergency: r.rows[0] || { is_active: false } });
    }
  } catch (e) {}
  res.json({ success: true, emergency: { is_active: false } });
});

app.put('/api/emergency', authenticateToken, async (req, res) => {
  const { is_active, mode_type, message, stop_orders, stop_ai, end_at } = req.body;
  const userId = req.user.id;
  try {
    if (pool) {
      await pool.query(`
        INSERT INTO emergency_mode (user_id, is_active, mode_type, message, stop_orders, stop_ai, start_at, end_at)
        VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7)
        ON CONFLICT (user_id) DO UPDATE SET
          is_active=$2, mode_type=$3, message=$4, stop_orders=$5, stop_ai=$6,
          start_at=CASE WHEN $2=true THEN NOW() ELSE emergency_mode.start_at END,
          end_at=$7, updated_at=NOW()
      `, [userId, is_active||false, mode_type||'emergency', message||'', stop_orders||false, stop_ai||false, end_at||null]);
      await auditLog(userId, is_active?'enable_emergency':'disable_emergency', 'emergency', null, mode_type, req.ip);
      return res.json({ success: true });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// APPROVAL REQUESTS — مركز الموافقات
// ============================================================
app.get('/api/approvals', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM approval_requests WHERE user_id=$1 AND status=$2 ORDER BY created_at DESC', [req.user.id, 'pending']);
      return res.json({ success: true, requests: r.rows });
    }
  } catch (e) {}
  res.json({ success: true, requests: [] });
});

app.put('/api/approvals/:id', authenticateToken, async (req, res) => {
  const { status } = req.body; // approved | rejected
  if (!['approved','rejected'].includes(status)) return res.status(400).json({ success: false, message: 'حالة غير صحيحة' });
  try {
    if (pool) {
      await pool.query('UPDATE approval_requests SET status=$1, decided_at=NOW() WHERE id=$2 AND user_id=$3', [status, req.params.id, req.user.id]);
      await auditLog(req.user.id, status === 'approved' ? 'approve_request' : 'reject_request', 'approval', parseInt(req.params.id), '', req.ip);
      return res.json({ success: true });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// PRODUCTS
// ============================================================
app.post('/api/products', authenticateToken, async (req, res) => {
  const { name, description, price, category, stock, image_url, dynamic_attrs } = req.body;
  const userId = req.user.id;
  if (!name || !price) return res.status(400).json({ success: false, message: 'الاسم والسعر مطلوبان' });
  if (parseFloat(price) <= 0) return res.status(400).json({ success: false, message: 'السعر يجب أن يكون أكبر من صفر' });
  try {
    if (pool) {
      const r = await pool.query(
        'INSERT INTO products (user_id, name, description, price, category, stock, image_url, dynamic_attrs) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [userId, name, description||'', parseFloat(price), category||'عام', parseInt(stock)||0, image_url||'', JSON.stringify(dynamic_attrs||{})]
      );
      await auditLog(userId, 'create_product', 'products', r.rows[0].id, name, req.ip);
      return res.json({ success: true, product: r.rows[0] });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/products', authenticateToken, async (req, res) => {
  const { q, category } = req.query;
  try {
    if (pool) {
      let query = 'SELECT * FROM products WHERE user_id=$1';
      const params = [req.user.id];
      if (q) { query += ' AND (name ILIKE $2 OR description ILIKE $2)'; params.push(`%${q}%`); }
      else if (category) { query += ' AND category=$2'; params.push(category); }
      query += ' ORDER BY created_at DESC';
      const r = await pool.query(query, params);
      return res.json({ products: r.rows });
    }
  } catch (e) {}
  res.json({ products: [] });
});

app.put('/api/products/:id', authenticateToken, async (req, res) => {
  const { name, description, price, category, stock, image_url, is_available, dynamic_attrs } = req.body;
  try {
    if (pool) {
      await pool.query(
        'UPDATE products SET name=$1,description=$2,price=$3,category=$4,stock=$5,image_url=$6,is_available=$7,dynamic_attrs=$8 WHERE id=$9 AND user_id=$10',
        [name, description||'', parseFloat(price), category||'عام', parseInt(stock)||0, image_url||'', is_available!==false, JSON.stringify(dynamic_attrs||{}), req.params.id, req.user.id]
      );
      return res.json({ success: true });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/products/:id', authenticateToken, async (req, res) => {
  try {
    if (pool) { await pool.query('DELETE FROM products WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]); }
    return res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.put('/api/products/:id/stock', authenticateToken, async (req, res) => {
  const { quantity, operation } = req.body;
  const userId = req.user.id;
  try {
    if (pool) {
      let q;
      if (operation === 'add') q = 'UPDATE products SET stock=stock+$1 WHERE id=$2 AND user_id=$3 RETURNING *';
      else if (operation === 'subtract') q = 'UPDATE products SET stock=GREATEST(0,stock-$1) WHERE id=$2 AND user_id=$3 RETURNING *';
      else q = 'UPDATE products SET stock=$1 WHERE id=$2 AND user_id=$3 RETURNING *';
      const r = await pool.query(q, [parseInt(quantity), req.params.id, userId]);
      if (r.rows.length > 0) {
        const prod = r.rows[0];
        if (prod.stock === 0) {
          await notify(userId, '🚨 نفذ المخزون!', `${prod.name} نفذ من المخزون`, 'inventory');
          await pool.query('UPDATE products SET is_available=false WHERE id=$1', [req.params.id]);
        } else if (prod.stock <= 5) {
          await notify(userId, '⚠️ مخزون منخفض', `${prod.name} — متبقي ${prod.stock} فقط`, 'inventory');
        }
        return res.json({ success: true, product: prod });
      }
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/inventory/alerts', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM products WHERE user_id=$1 AND stock<=5 ORDER BY stock ASC', [req.user.id]);
      return res.json({ alerts: r.rows });
    }
  } catch (e) {}
  res.json({ alerts: [] });
});

// ============================================================
// ORDERS
// ============================================================
app.post('/api/orders', authenticateToken, async (req, res) => {
  const { customer_name, customer_phone, customer_address, items, total, deposit, deposit_type, payment_method, delivery_company, delivery_link, notes, platform, coupon_code, discount, loyalty_points_used } = req.body;
  const userId = req.user.id;
  if (total !== undefined && (parseFloat(total) < 0 || isNaN(parseFloat(total)))) return res.status(400).json({ success: false, message: 'المبلغ غير صحيح' });
  try {
    if (pool) {
      // Check emergency
      const em = await pool.query('SELECT * FROM emergency_mode WHERE user_id=$1', [userId]);
      if (em.rows[0]?.is_active && em.rows[0]?.stop_orders)
        return res.status(503).json({ success: false, message: em.rows[0].message || 'الطلبات متوقفة مؤقتاً' });

      const r = await pool.query(
        `INSERT INTO orders (user_id,customer_name,customer_phone,customer_address,items,total,deposit,deposit_type,payment_method,delivery_company,delivery_link,notes,platform,coupon_code,discount,loyalty_points_used)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [userId, customer_name, customer_phone, customer_address||'', JSON.stringify(items||[]), total||0, deposit||0, deposit_type||'full', payment_method||'cash', delivery_company||'', delivery_link||'', notes||'', platform||'', coupon_code||'', discount||0, loyalty_points_used||0]
      );
      const order = r.rows[0];
      await notify(userId, '🛒 طلب جديد!', `${customer_name} — ${formatCurrency(total)}`, 'order');
      await auditLog(userId, 'create_order', 'orders', order.id, `${customer_name} - ${total}`, req.ip);

      // WhatsApp notification
      const bpR = await pool.query('SELECT whatsapp_number, currency FROM business_profile WHERE user_id=$1', [userId]);
      let waUrl = null;
      if (bpR.rows[0]?.whatsapp_number) {
        const cleanWa = bpR.rows[0].whatsapp_number.replace(/[^0-9]/g, '');
        const waPhone = cleanWa.startsWith('0') ? '964' + cleanWa.slice(1) : cleanWa;
        const cur = bpR.rows[0]?.currency || 'IQD';
        const waMsg = `🛒 *طلب جديد #${order.id}*\n👤 ${customer_name}\n📱 ${customer_phone}\n💰 ${formatCurrency(total, cur)}\n${notes ? '📝 ' + notes : ''}\n⚡ SocialOS`;
        waUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(waMsg)}`;
      }
      return res.json({ success: true, order, wa_notify_url: waUrl });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/orders', authenticateToken, async (req, res) => {
  const { status, q } = req.query;
  try {
    if (pool) {
      let query = 'SELECT * FROM orders WHERE user_id=$1';
      const params = [req.user.id];
      if (status) { query += ' AND status=$2'; params.push(status); }
      if (q) { query += ` AND (customer_name ILIKE $${params.length+1} OR customer_phone ILIKE $${params.length+1})`; params.push(`%${q}%`); }
      query += ' ORDER BY created_at DESC';
      const r = await pool.query(query, params);
      return res.json({ orders: r.rows });
    }
  } catch (e) {}
  res.json({ orders: [] });
});

app.put('/api/orders/:id', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const allowed = ['status','customer_name','customer_phone','customer_address','items','total','deposit','deposit_type','payment_method','delivery_company','delivery_link','notes','platform'];
      const updates = {};
      for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
      if (!Object.keys(updates).length) return res.status(400).json({ success: false, message: 'لا توجد حقول للتحديث' });
      const fields = Object.keys(updates).map((k, i) => `${k}=$${i+3}`).join(', ');
      await pool.query(`UPDATE orders SET ${fields} WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id, ...Object.values(updates)]);
      await auditLog(req.user.id, 'update_order', 'orders', parseInt(req.params.id), JSON.stringify(updates), req.ip);
      return res.json({ success: true });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/orders/:id', authenticateToken, async (req, res) => {
  try {
    if (pool) { await pool.query('DELETE FROM orders WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]); }
    return res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/orders/:id/whatsapp', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const [r, bpR] = await Promise.all([
        pool.query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]),
        pool.query('SELECT currency FROM business_profile WHERE user_id=$1', [req.user.id])
      ]);
      if (!r.rows.length) return res.status(404).json({ message: 'الطلب غير موجود' });
      const o = r.rows[0];
      const cur = bpR.rows[0]?.currency || 'IQD';
      let items = [];
      try { items = JSON.parse(o.items || '[]'); } catch(e) {}
      const itemsText = items.map(i => i.description||'').filter(Boolean).join(', ') || 'طلب';
      const msg = `🧾 *فاتورة طلب #${o.id}*\n👤 ${o.customer_name}\n📱 ${o.customer_phone}\n📦 ${itemsText}\n💰 ${formatCurrency(o.total, cur)}${o.deposit>0?`\n💵 عربون: ${formatCurrency(o.deposit, cur)}\n💳 متبقي: ${formatCurrency(o.total-o.deposit, cur)}`:''}\n${o.notes?`📝 ${o.notes}\n`:''}\nشكراً! ⚡ SocialOS`;
      const phone = o.customer_phone.replace(/[^0-9]/g, '');
      const waPhone = phone.startsWith('0') ? '964' + phone.slice(1) : phone;
      return res.json({ success: true, url: `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}` });
    }
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ============================================================
// CUSTOMERS
// ============================================================
app.post('/api/customers', authenticateToken, async (req, res) => {
  const { name, phone, address, notes, tags } = req.body;
  if (!name || !phone) return res.status(400).json({ success: false, message: 'الاسم والهاتف مطلوبان' });
  try {
    if (pool) {
      const r = await pool.query(
        'INSERT INTO customers (user_id, name, phone, address, notes, tags) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [req.user.id, name, phone, address||'', notes||'', JSON.stringify(tags||[])]
      );
      return res.json({ success: true, customer: r.rows[0] });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/customers', authenticateToken, async (req, res) => {
  const { q } = req.query;
  try {
    if (pool) {
      let query = 'SELECT * FROM customers WHERE user_id=$1';
      const params = [req.user.id];
      if (q) { query += ' AND (name ILIKE $2 OR phone ILIKE $2)'; params.push(`%${q}%`); }
      query += ' ORDER BY created_at DESC';
      const r = await pool.query(query, params);
      return res.json({ customers: r.rows });
    }
  } catch (e) {}
  res.json({ customers: [] });
});

app.put('/api/customers/:id', authenticateToken, async (req, res) => {
  const { name, phone, address, notes, tags } = req.body;
  try {
    if (pool) {
      await pool.query('UPDATE customers SET name=$1,phone=$2,address=$3,notes=$4,tags=$5 WHERE id=$6 AND user_id=$7',
        [name, phone, address||'', notes||'', JSON.stringify(tags||[]), req.params.id, req.user.id]);
      return res.json({ success: true });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/customers/:id', authenticateToken, async (req, res) => {
  try {
    if (pool) { await pool.query('DELETE FROM customers WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]); }
    return res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/crm/:phone', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const [cust, ords, totals, loyalty] = await Promise.all([
        pool.query('SELECT * FROM customers WHERE user_id=$1 AND phone=$2', [req.user.id, req.params.phone]),
        pool.query('SELECT * FROM orders WHERE user_id=$1 AND customer_phone=$2 ORDER BY created_at DESC', [req.user.id, req.params.phone]),
        pool.query('SELECT SUM(total) as total, COUNT(*) as cnt FROM orders WHERE user_id=$1 AND customer_phone=$2', [req.user.id, req.params.phone]),
        pool.query('SELECT * FROM loyalty_points WHERE user_id=$1 AND customer_phone=$2', [req.user.id, req.params.phone])
      ]);
      return res.json({ success: true, customer: cust.rows[0]||null, orders: ords.rows, stats: { total_orders: parseInt(totals.rows[0]?.cnt||0), total_spent: parseFloat(totals.rows[0]?.total||0), last_order: ords.rows[0]?.created_at||null }, loyalty: loyalty.rows[0]||{ points: 0 } });
    }
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ============================================================
// ANALYTICS
// ============================================================
app.get('/api/analytics/dashboard', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (pool) {
      const [ordersData, revenueChart, topCustomers, products, lowStock] = await Promise.all([
        pool.query('SELECT SUM(total) as revenue, COUNT(*) as count, status FROM orders WHERE user_id=$1 GROUP BY status', [userId]),
        pool.query(`SELECT DATE(created_at) as date, SUM(total) as revenue, COUNT(*) as orders FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '14 days' GROUP BY DATE(created_at) ORDER BY date`, [userId]),
        pool.query(`SELECT customer_name, customer_phone, COUNT(*) as orders_count, SUM(total) as total_spent FROM orders WHERE user_id=$1 GROUP BY customer_name,customer_phone ORDER BY total_spent DESC LIMIT 5`, [userId]),
        pool.query('SELECT COUNT(*) as count FROM products WHERE user_id=$1', [userId]),
        pool.query('SELECT COUNT(*) as count FROM products WHERE user_id=$1 AND stock<=5', [userId])
      ]);
      const revenue = ordersData.rows.reduce((a, r) => a + parseFloat(r.revenue||0), 0);
      const ordersCount = ordersData.rows.reduce((a, r) => a + parseInt(r.count||0), 0);
      return res.json({ success: true, totals: { revenue, orders: ordersCount }, orders_by_status: ordersData.rows, revenue_chart: revenueChart.rows, top_customers: topCustomers.rows, products_count: parseInt(products.rows[0]?.count||0), low_stock: parseInt(lowStock.rows[0]?.count||0) });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
  res.json({ success: true, totals: { revenue: 0, orders: 0 }, revenue_chart: [], top_customers: [] });
});

app.get('/api/analytics/report', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { period } = req.query;
  const days = period === 'month' ? 30 : period === 'year' ? 365 : 7;
  try {
    if (pool) {
      const [orders, prevOrders, topCustomers, daily, statusBreak] = await Promise.all([
        pool.query(`SELECT COUNT(*) as cnt, SUM(total) as rev, SUM(deposit) as dep FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '${days} days'`, [userId]),
        pool.query(`SELECT COUNT(*) as cnt, SUM(total) as rev FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '${days*2} days' AND created_at<NOW()-INTERVAL '${days} days'`, [userId]),
        pool.query(`SELECT customer_name, customer_phone, COUNT(*) as orders, SUM(total) as spent FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '${days} days' GROUP BY customer_name,customer_phone ORDER BY spent DESC LIMIT 10`, [userId]),
        pool.query(`SELECT DATE(created_at) as date, SUM(total) as revenue, COUNT(*) as orders FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '${days} days' GROUP BY DATE(created_at) ORDER BY date`, [userId]),
        pool.query(`SELECT status, COUNT(*) as count, SUM(total) as revenue FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '${days} days' GROUP BY status`, [userId])
      ]);
      const totalRev = parseFloat(orders.rows[0]?.rev||0);
      const totalCnt = parseInt(orders.rows[0]?.cnt||0);
      const prevRev = parseFloat(prevOrders.rows[0]?.rev||0);
      const prevCnt = parseInt(prevOrders.rows[0]?.cnt||0);
      return res.json({
        success: true, days,
        orders: { total: totalCnt, revenue: totalRev, deposits: parseFloat(orders.rows[0]?.dep||0), avg: totalCnt>0?totalRev/totalCnt:0 },
        comparison: { prev_revenue: prevRev, prev_orders: prevCnt, revenue_growth: prevRev>0?((totalRev-prevRev)/prevRev*100).toFixed(1):null, orders_growth: prevCnt>0?((totalCnt-prevCnt)/prevCnt*100).toFixed(1):null },
        top_customers: topCustomers.rows, daily_revenue: daily.rows, status_breakdown: statusBreak.rows
      });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// COUPONS
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
// BACKUP — النسخ الاحتياطية
// ============================================================
app.post('/api/backup/create', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (pool) {
      const [bp, emp, products, customers, orders, knowledge, decisions, coupons] = await Promise.all([
        pool.query('SELECT * FROM business_profile WHERE user_id=$1', [userId]),
        pool.query('SELECT * FROM digital_employee WHERE user_id=$1', [userId]),
        pool.query('SELECT * FROM products WHERE user_id=$1', [userId]),
        pool.query('SELECT * FROM customers WHERE user_id=$1', [userId]),
        pool.query('SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 500', [userId]),
        pool.query('SELECT * FROM knowledge_base WHERE user_id=$1', [userId]),
        pool.query('SELECT * FROM decision_memory WHERE user_id=$1', [userId]),
        pool.query('SELECT * FROM coupons WHERE user_id=$1', [userId])
      ]);
      const backupData = JSON.stringify({
        timestamp: new Date().toISOString(),
        business_profile: bp.rows[0],
        digital_employee: emp.rows[0],
        products: products.rows,
        customers: customers.rows,
        orders: orders.rows,
        knowledge_base: knowledge.rows,
        decision_memory: decisions.rows,
        coupons: coupons.rows
      });
      const r = await pool.query(
        'INSERT INTO backups (user_id, type, data, size) VALUES ($1,$2,$3,$4) RETURNING id, created_at',
        [userId, 'full', backupData, backupData.length]
      );
      await auditLog(userId, 'create_backup', 'backup', r.rows[0].id, `Size: ${backupData.length} bytes`, req.ip);
      return res.json({ success: true, backup_id: r.rows[0].id, created_at: r.rows[0].created_at, size: backupData.length });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/backup/list', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT id, type, size, created_at FROM backups WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10', [req.user.id]);
      return res.json({ success: true, backups: r.rows });
    }
  } catch (e) {}
  res.json({ success: true, backups: [] });
});

app.get('/api/backup/:id/download', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM backups WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
      if (!r.rows.length) return res.status(404).json({ message: 'النسخة غير موجودة' });
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="socialos-backup-${req.params.id}.json"`);
      return res.send(r.rows[0].data);
    }
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ============================================================
// WHATSAPP BULK CAMPAIGNS
// ============================================================
app.post('/api/whatsapp/bulk', authenticateToken, async (req, res) => {
  const { message, target, phones: customPhones } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ success: false, message: 'الرسالة مطلوبة' });
  if (message.length > 1000) return res.status(400).json({ success: false, message: 'الرسالة طويلة جداً' });
  const userId = req.user.id;
  try {
    if (pool) {
      let phones = [];
      if (target === 'all') phones = (await pool.query('SELECT DISTINCT customer_phone as phone, customer_name as name FROM orders WHERE user_id=$1', [userId])).rows;
      else if (target === 'recent') phones = (await pool.query(`SELECT DISTINCT customer_phone as phone, customer_name as name FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '30 days'`, [userId])).rows;
      else if (target === 'loyalty') phones = (await pool.query('SELECT customer_phone as phone, customer_name as name FROM loyalty_points WHERE user_id=$1 AND points>0', [userId])).rows;
      else if (target === 'custom' && customPhones) phones = customPhones.map(p => ({ phone: p, name: '' }));
      if (!phones.length) return res.json({ success: false, message: 'لا يوجد عملاء في هذه الفئة' });
      const links = phones.slice(0, 50).map(c => {
        const clean = (c.phone||'').replace(/[^0-9]/g, '');
        const waPhone = clean.startsWith('0') ? '964' + clean.slice(1) : clean;
        return { phone: waPhone, name: c.name, url: `https://wa.me/${waPhone}?text=${encodeURIComponent(message.replace('{اسم}', c.name||'عزيزي العميل'))}` };
      });
      return res.json({ success: true, links, total: phones.length, shown: links.length });
    }
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/whatsapp/bulk/counts', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const [all, recent, loyalty] = await Promise.all([
        pool.query('SELECT COUNT(DISTINCT customer_phone) as count FROM orders WHERE user_id=$1', [req.user.id]),
        pool.query(`SELECT COUNT(DISTINCT customer_phone) as count FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '30 days'`, [req.user.id]),
        pool.query('SELECT COUNT(*) as count FROM loyalty_points WHERE user_id=$1 AND points>0', [req.user.id])
      ]);
      return res.json({ success: true, counts: { all: parseInt(all.rows[0]?.count||0), recent: parseInt(recent.rows[0]?.count||0), loyalty: parseInt(loyalty.rows[0]?.count||0) } });
    }
  } catch (e) {}
  res.json({ success: true, counts: { all: 0, recent: 0, loyalty: 0 } });
});

// ============================================================
// REPLY TEMPLATES
// ============================================================
app.post('/api/templates', authenticateToken, async (req, res) => {
  const { title, content, category } = req.body;
  if (!title || !content) return res.status(400).json({ success: false, message: 'العنوان والمحتوى مطلوبان' });
  try {
    if (pool) {
      const r = await pool.query('INSERT INTO reply_templates (user_id,title,content,category) VALUES ($1,$2,$3,$4) RETURNING *', [req.user.id, title, content, category||'عام']);
      return res.json({ success: true, template: r.rows[0] });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/templates', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM reply_templates WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
      return res.json({ templates: r.rows });
    }
  } catch (e) {}
  res.json({ templates: [] });
});

app.delete('/api/templates/:id', authenticateToken, async (req, res) => {
  try {
    if (pool) await pool.query('DELETE FROM reply_templates WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// IMAGE UPLOAD (Cloudinary)
// ============================================================
app.post('/api/upload/image', authenticateToken, async (req, res) => {
  const { image, folder } = req.body;
  if (!image) return res.status(400).json({ success: false, message: 'الصورة مطلوبة' });
  if (!image.startsWith('data:image/')) return res.status(400).json({ success: false, message: 'صيغة صورة غير صحيحة' });
  if (image.length > 10 * 1024 * 1024) return res.status(400).json({ success: false, message: 'الصورة أكبر من 7MB' });

  const CLOUD = process.env.CLOUDINARY_CLOUD_NAME;
  const KEY   = process.env.CLOUDINARY_API_KEY;
  const SECRET= process.env.CLOUDINARY_API_SECRET;

  if (!CLOUD || !KEY || !SECRET) {
    return res.json({ success: true, url: image, source: 'base64', message: 'Cloudinary غير مفعّل' });
  }
  try {
    const crypto = require('crypto');
    const timestamp = Math.floor(Date.now() / 1000);
    const uploadFolder = folder || 'socialos';
    const signature = crypto.createHmac('sha256', SECRET).update(`folder=${uploadFolder}&timestamp=${timestamp}`).digest('hex');
    const boundary = '----SocialOSBoundary' + Date.now();
    const formBody = [`--${boundary}`, 'Content-Disposition: form-data; name="file"', '', image, `--${boundary}`, 'Content-Disposition: form-data; name="api_key"', '', KEY, `--${boundary}`, 'Content-Disposition: form-data; name="timestamp"', '', String(timestamp), `--${boundary}`, 'Content-Disposition: form-data; name="signature"', '', signature, `--${boundary}`, 'Content-Disposition: form-data; name="folder"', '', uploadFolder, `--${boundary}--`].join('\r\n');
    const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body: formBody });
    const uploadData = await uploadRes.json();
    if (uploadData.secure_url) return res.json({ success: true, url: uploadData.secure_url, source: 'cloudinary' });
    return res.json({ success: true, url: image, source: 'base64' });
  } catch (e) { return res.json({ success: true, url: image, source: 'base64' }); }
});

// ============================================================
// PUBLIC STORE
// ============================================================
app.get('/store/:userId', async (req, res) => {
  const { userId } = req.params;
  if (!/^\d+$/.test(userId)) return res.status(400).send('<h1>رابط غير صحيح</h1>');
  try {
    if (pool) {
      const [user, products, bp] = await Promise.all([
        pool.query('SELECT name, avatar_url FROM users WHERE id=$1', [userId]),
        pool.query('SELECT * FROM products WHERE user_id=$1 AND is_available=true ORDER BY category, created_at DESC', [userId]),
        pool.query('SELECT * FROM business_profile WHERE user_id=$1', [userId])
      ]);
      if (!user.rows.length) return res.status(404).send('<h1>المتجر غير موجود</h1>');
      const owner = user.rows[0];
      const profile = bp.rows[0] || {};
      const storeName = escapeHtml(profile.store_name || owner.name || 'متجر');
      const cur = escapeHtml(profile.currency || 'IQD');
      const prods = products.rows;
      const categories = [...new Set(prods.map(p => p.category).filter(Boolean))];
      const prodsJson = JSON.stringify(prods.map(p => ({ id: p.id, name: p.name, description: p.description||'', price: parseFloat(p.price)||0, stock: parseInt(p.stock)||0, category: p.category||'', image_url: (p.image_url||'').startsWith('https://')?p.image_url:'' })));

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${storeName}</title><link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;900&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Tajawal,sans-serif;background:#080b14;color:#e8edf5;direction:rtl}.header{background:linear-gradient(135deg,#0d1424,#111827);padding:28px 20px;text-align:center;border-bottom:1px solid #1e2a40}.store-name{font-size:1.6rem;font-weight:900;margin-bottom:6px}.store-desc{color:#6b7a99;font-size:.85rem}.sticky-bar{position:sticky;top:0;background:rgba(8,11,20,.95);backdrop-filter:blur(16px);border-bottom:1px solid #1e2a40;padding:10px 16px;z-index:100}.search-wrap{display:flex;align-items:center;gap:8px;background:#161d2e;border:1px solid #1e2a40;border-radius:12px;padding:8px 14px;margin-bottom:8px}.search-wrap input{flex:1;background:transparent;border:none;color:#e8edf5;font-family:Tajawal,sans-serif;font-size:.9rem;outline:none}.cats{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none}.cat-btn{padding:5px 14px;border-radius:20px;border:1px solid #1e2a40;background:#161d2e;color:#6b7a99;cursor:pointer;font-family:Tajawal,sans-serif;font-size:.78rem;font-weight:700;white-space:nowrap}.cat-btn.active{background:#4f8ef7;border-color:#4f8ef7;color:#fff}.container{max-width:960px;margin:0 auto;padding:20px 14px 100px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}.card{background:#0f1420;border:1px solid #1e2a40;border-radius:14px;overflow:hidden;cursor:pointer;transition:all .2s}.card:hover{border-color:#4f8ef7;transform:translateY(-2px)}.pimg{height:140px;background:#161d2e;display:flex;align-items:center;justify-content:center;font-size:2.2rem;overflow:hidden;position:relative}.pimg img{width:100%;height:100%;object-fit:cover}.pinfo{padding:10px}.pname{font-weight:700;font-size:.84rem;margin-bottom:4px}.pprice{color:#4f8ef7;font-weight:900;font-size:.88rem}.cart-float{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) scale(.95);background:linear-gradient(135deg,#4f8ef7,#7c3aed);border-radius:18px;padding:12px 22px;display:flex;align-items:center;gap:10px;cursor:pointer;z-index:200;opacity:0;pointer-events:none;transition:all .3s}.cart-float.show{opacity:1;pointer-events:all;transform:translateX(-50%) scale(1)}.overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:300;align-items:flex-end;justify-content:center}.overlay.show{display:flex}.sheet{background:#0f1420;border-radius:20px 20px 0 0;width:100%;max-width:500px;max-height:90vh;overflow-y:auto;padding:20px}.inp{width:100%;background:#161d2e;border:1px solid #1e2a40;border-radius:10px;padding:11px 14px;color:#e8edf5;font-size:.9rem;font-family:Tajawal,sans-serif;margin-bottom:10px;outline:none}.btn{width:100%;padding:13px;background:linear-gradient(135deg,#4f8ef7,#7c3aed);color:#fff;border:none;border-radius:12px;font-size:.95rem;font-weight:700;cursor:pointer;font-family:Tajawal,sans-serif;margin-top:6px}.btn2{width:100%;padding:11px;background:transparent;border:1px solid #1e2a40;color:#6b7a99;border-radius:12px;font-size:.9rem;font-weight:700;cursor:pointer;font-family:Tajawal,sans-serif;margin-top:6px}</style></head><body>
<div class="header"><div class="store-name">${storeName}</div>${profile.business_desc?`<div class="store-desc">${escapeHtml(profile.business_desc)}</div>`:''}</div>
<div class="sticky-bar"><div class="search-wrap"><span style="color:#6b7a99">🔍</span><input id="si" placeholder="ابحث..." oninput="filt()"></div><div class="cats"><button class="cat-btn active" onclick="fCat('',this)">الكل</button>${categories.map(c=>`<button class="cat-btn" onclick="fCat(${JSON.stringify(escapeHtml(c))},this)">${escapeHtml(c)}</button>`).join('')}</div></div>
<div class="container"><div class="grid" id="grid"></div></div>
<div class="cart-float" id="cf" onclick="openCart()"><span>🛒</span><span id="cc">0</span><span id="ct">0 ${cur}</span><span style="font-size:.8rem;opacity:.8">السلة ←</span></div>
<div class="overlay" id="co" onclick="if(event.target===this)closeCo()"><div class="sheet"><div style="width:40px;height:4px;background:#1e2a40;border-radius:2px;margin:0 auto 16px"></div><h2 style="margin-bottom:14px">🛒 السلة</h2><div id="ci"></div><button class="btn" onclick="openOrder()">متابعة الطلب</button><button class="btn2" onclick="closeCo()">متابعة التسوق</button></div></div>
<div class="overlay" id="oo" onclick="if(event.target===this)closeOo()"><div class="sheet"><div style="width:40px;height:4px;background:#1e2a40;border-radius:2px;margin:0 auto 16px"></div><div id="oc"><h2 style="margin-bottom:14px">📝 تفاصيل الطلب</h2><input class="inp" id="cn" placeholder="اسمك *"><input class="inp" id="cp" placeholder="هاتفك *" dir="ltr"><input class="inp" id="ca" placeholder="العنوان (اختياري)"><textarea class="inp" id="cno" placeholder="ملاحظات..." style="min-height:60px;resize:none"></textarea><div id="os" style="margin:8px 0"></div><button class="btn" id="sb" onclick="submitO()">✅ تأكيد الطلب</button><button class="btn2" onclick="closeOo()">رجوع</button></div></div></div>
<script>
const UID=${parseInt(userId)},CUR=${JSON.stringify(cur)},PRODS=${prodsJson};
let cart=[],cat='',sq='';
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function sub(){return cart.reduce((s,c)=>s+c.price*c.qty,0);}
function render(){
  let p=PRODS;
  if(cat)p=p.filter(x=>x.category===cat);
  if(sq){const q=sq.toLowerCase();p=p.filter(x=>x.name.toLowerCase().includes(q)||x.description.toLowerCase().includes(q));}
  var html=p.length?p.map(function(x){return '<div class="card" onclick="addC('+x.id+')"><div class="pimg">'+(x.image_url?'<img src="'+esc(x.image_url)+'" loading="lazy">':'&#x1F4E6;')+'</div><div class="pinfo"><div class="pname">'+esc(x.name)+'</div><div class="pprice">'+x.price.toFixed(0)+' '+CUR+'</div></div></div>';}).join(''):'<p style="color:#6b7a99;text-align:center;padding:40px;grid-column:1/-1">&#x644;&#x627; &#x62A;&#x648;&#x62C;&#x62F; &#x645;&#x646;&#x62A;&#x62C;&#x627;&#x62A;</p>';
  document.getElementById('grid').innerHTML=html;
}
function fCat(c,btn){cat=c;document.querySelectorAll('.cat-btn').forEach(function(b){b.classList.remove('active');});btn.classList.add('active');render();}
function filt(){sq=document.getElementById('si').value.trim();render();}
function addC(id){var x=PRODS.find(function(p){return p.id===id;});if(!x||x.stock===0)return;var e=cart.find(function(c){return c.id===id;});if(e)e.qty++;else cart.push({id:x.id,name:x.name,price:x.price,qty:1});updateF();}
function updateF(){var n=cart.reduce(function(s,c){return s+c.qty;},0);document.getElementById('cc').textContent=n;document.getElementById('ct').textContent=sub().toFixed(0)+' '+CUR;document.getElementById('cf').classList.toggle('show',n>0);}
function openCart(){
  var el=document.getElementById('ci');
  var html=cart.length?cart.map(function(c){return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #1e2a40"><span>'+esc(c.name)+'</span><div style="display:flex;align-items:center;gap:8px"><button onclick="chQ('+c.id+',-1)" style="width:26px;height:26px;border-radius:50%;border:1px solid #1e2a40;background:#161d2e;color:#e8edf5;cursor:pointer">&#x2212;</button><span>'+c.qty+'</span><button onclick="chQ('+c.id+',1)" style="width:26px;height:26px;border-radius:50%;border:1px solid #1e2a40;background:#161d2e;color:#e8edf5;cursor:pointer">+</button><span style="color:#4f8ef7;font-weight:700">'+(c.price*c.qty).toFixed(0)+'</span></div></div>';}).join(''):'<p style="text-align:center;color:#6b7a99;padding:20px">&#x627;&#x644;&#x633;&#x644;&#x629; &#x641;&#x627;&#x631;&#x63A;&#x629;</p>';
  el.innerHTML=html;
  document.getElementById('co').classList.add('show');
  document.body.style.overflow='hidden';
}
function closeCo(){document.getElementById('co').classList.remove('show');document.body.style.overflow='';}
function chQ(id,d){var e=cart.find(function(c){return c.id===id;});if(!e)return;e.qty=Math.max(0,e.qty+d);if(e.qty===0)cart=cart.filter(function(c){return c.id!==id;});updateF();openCart();}
function openOrder(){
  if(!cart.length)return;
  closeCo();
  var s=sub();
  var items=cart.map(function(c){return '<div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:3px"><span>'+esc(c.name)+' x'+c.qty+'</span><span>'+(c.price*c.qty).toFixed(0)+' '+CUR+'</span></div>';}).join('');
  document.getElementById('os').innerHTML='<div style="background:#161d2e;border-radius:10px;padding:10px">'+items+'<div style="display:flex;justify-content:space-between;font-weight:900;padding-top:7px;margin-top:4px;border-top:1px solid #1e2a40"><span>&#x627;&#x644;&#x625;&#x62C;&#x645;&#x627;&#x644;&#x64A;</span><span style="color:#4f8ef7">'+s.toFixed(0)+' '+CUR+'</span></div></div>';
  document.getElementById('oo').classList.add('show');
  document.body.style.overflow='hidden';
}
function closeOo(){document.getElementById('oo').classList.remove('show');document.body.style.overflow='';}
async function submitO(){
  var name=document.getElementById('cn').value.trim(),phone=document.getElementById('cp').value.trim();
  if(!name||!phone)return alert('&#x627;&#x644;&#x627;&#x633;&#x645; &#x648;&#x627;&#x644;&#x647;&#x627;&#x62A;&#x641; &#x645;&#x637;&#x644;&#x648;&#x628;&#x627;&#x646;');
  if(!cart.length)return;
  var btn=document.getElementById('sb');btn.disabled=true;btn.textContent='...';
  try{
    var r=await fetch('/api/marketplace/order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({store_user_id:UID,customer_name:name,customer_phone:phone,customer_address:document.getElementById('ca').value.trim(),notes:document.getElementById('cno').value.trim(),items:cart.map(function(c){return {description:c.name+' x'+c.qty,quantity:c.qty,price:c.price};}),total:sub()})});
    var d=await r.json();
    if(d.success){
      document.getElementById('oc').innerHTML='<div style="text-align:center;padding:30px"><div style="font-size:3rem;margin-bottom:12px">&#x1F389;</div><div style="font-size:1.2rem;font-weight:900;margin-bottom:8px">&#x62A;&#x645; &#x627;&#x633;&#x62A;&#x644;&#x627;&#x645; &#x637;&#x644;&#x628;&#x643;!</div><div style="color:#6b7a99;margin-bottom:20px">&#x631;&#x642;&#x645; &#x627;&#x644;&#x637;&#x644;&#x628;: <strong style="color:#4f8ef7">#'+(d.order&&d.order.id?d.order.id:'')+'</strong></div><button class="btn" onclick="closeOo();cart=[];updateF();render()">&#x645;&#x62A;&#x627;&#x628;&#x639;&#x629; &#x627;&#x644;&#x62A;&#x633;&#x648;&#x642;</button></div>';
      cart=[];updateF();
    }else{alert(d.message||'failed');btn.disabled=false;btn.textContent='confirm';}
  }catch(e){alert('error');btn.disabled=false;btn.textContent='confirm';}
}
render();
</script></body></html>`);
    }
  } catch (e) { res.status(500).send('<h1>خطأ</h1>'); }
});

app.post('/api/marketplace/order', async (req, res) => {
  const { store_user_id, customer_name, customer_phone, customer_address, items, total, notes } = req.body;
  if (!store_user_id || !customer_name || !customer_phone) return res.status(400).json({ success: false, message: 'البيانات ناقصة' });
  try {
    if (pool) {
      const r = await pool.query(
        'INSERT INTO orders (user_id,customer_name,customer_phone,customer_address,items,total,notes,platform) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [store_user_id, customer_name, customer_phone, customer_address||'', JSON.stringify(items||[]), total||0, notes||'', 'store']
      );
      await notify(store_user_id, '🛒 طلب جديد من المتجر!', `${customer_name} — ${total}`, 'order');
      return res.json({ success: true, order: r.rows[0] });
    }
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// PROFILE
// ============================================================
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ message: 'DB غير متاحة' });
    const r = await pool.query('SELECT id,name,email,avatar_url,plan,plan_expires_at,role FROM users WHERE id=$1', [req.user.id]);
    if (!r.rows.length) return res.status(404).json({ message: 'المستخدم غير موجود' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/profile', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ message: 'DB غير متاحة' });
    const { name, avatar_url } = req.body;
    await pool.query('UPDATE users SET name=$1, avatar_url=$2 WHERE id=$3', [name||'', avatar_url||'', req.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ============================================================
// STATS
// ============================================================
app.get('/api/stats', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (pool) {
      const [o, p, c, n] = await Promise.all([
        pool.query('SELECT COUNT(*) FROM orders WHERE user_id=$1', [userId]),
        pool.query('SELECT COUNT(*) FROM products WHERE user_id=$1', [userId]),
        pool.query('SELECT COUNT(*) FROM customers WHERE user_id=$1', [userId]),
        pool.query('SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND is_read=false', [userId])
      ]);
      return res.json({ orders: parseInt(o.rows[0].count), products: parseInt(p.rows[0].count), customers: parseInt(c.rows[0].count), unread_notifications: parseInt(n.rows[0].count) });
    }
  } catch (e) {}
  res.json({ orders: 0, products: 0, customers: 0, unread_notifications: 0 });
});

// ============================================================
// CRON JOBS
// ============================================================

// Auto-generate board recommendations weekly
cron.schedule('0 9 * * 1', async () => {
  try {
    if (!pool) return;
    const users = await pool.query('SELECT id FROM users LIMIT 100');
    for (const user of users.rows) {
      const userId = user.id;
      try {
        const [orders, products] = await Promise.all([
          pool.query('SELECT COUNT(*) as cnt, SUM(CASE WHEN status=\'new\' THEN 1 ELSE 0 END) as new_cnt FROM orders WHERE user_id=$1', [userId]),
          pool.query('SELECT COUNT(*) as low FROM products WHERE user_id=$1 AND stock<=3 AND is_available=true', [userId])
        ]);
        if (parseInt(products.rows[0]?.low||0) > 0) {
          await notify(userId, '⚠️ تنبيه مخزون', `${products.rows[0].low} منتج مخزونه منخفض`, 'stock');
        }
        const lastOrder = await pool.query('SELECT created_at FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [userId]);
        if (lastOrder.rows.length > 0) {
          const days = Math.floor((Date.now() - new Date(lastOrder.rows[0].created_at)) / (1000*60*60*24));
          if (days >= 3) await notify(userId, '💡 تحفيز المبيعات', `مرت ${days} أيام بدون طلبات — جرب نشر عرض جديد`, 'tip');
        }
        // Auto-deactivate emergency mode after end_at
        await pool.query(`UPDATE emergency_mode SET is_active=false WHERE user_id=$1 AND end_at IS NOT NULL AND end_at<=NOW() AND is_active=true`, [userId]);
      } catch (e) {}
    }
  } catch (e) { console.error('Cron error:', e.message); }
});

// ============================================================
// SOCIAL ACCOUNTS — ربط حسابات التواصل الاجتماعي
// ============================================================

// جلب جميع الحسابات المربوطة
app.get('/api/social/accounts', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.json({ success: true, accounts: [] });
    const r = await pool.query(
      `SELECT id, platform, account_name, account_username, avatar_url,
              page_id, page_name, whatsapp_phone_id, whatsapp_business_id,
              is_connected, scopes, connected_at, updated_at
       FROM social_accounts WHERE user_id=$1 ORDER BY connected_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, accounts: r.rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ربط حساب يدوياً (Meta/TikTok/WhatsApp)
app.post('/api/social/connect', authenticateToken, async (req, res) => {
  const {
    platform, access_token, account_id, account_name, account_username,
    avatar_url, page_id, page_name, whatsapp_phone_id, whatsapp_business_id,
    scopes, extra_data
  } = req.body;

  const ALLOWED_PLATFORMS = ['instagram', 'facebook', 'tiktok', 'whatsapp'];
  if (!platform || !ALLOWED_PLATFORMS.includes(platform))
    return res.status(400).json({ success: false, message: 'المنصة غير مدعومة' });
  if (!access_token)
    return res.status(400).json({ success: false, message: 'access_token مطلوب' });

  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    // التحقق من صحة التوكن حسب المنصة
    let verifiedData = {};
    if (platform === 'facebook' || platform === 'instagram') {
      try {
        const verifyRes = await fetch(
          `https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${encodeURIComponent(access_token)}`
        );
        const vd = await verifyRes.json();
        if (vd.error) return res.status(401).json({ success: false, message: `التوكن غير صالح: ${vd.error.message}` });
        verifiedData = { account_id: vd.id || account_id, account_name: vd.name || account_name };
      } catch (e) { /* نكمل حتى لو التحقق فشل */ }
    }

    if (platform === 'tiktok') {
      try {
        const verifyRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url', {
          headers: { 'Authorization': `Bearer ${access_token}` }
        });
        const vd = await verifyRes.json();
        if (vd.data?.user) {
          verifiedData = {
            account_id: vd.data.user.open_id || account_id,
            account_name: vd.data.user.display_name || account_name,
            avatar_url: vd.data.user.avatar_url || avatar_url
          };
        }
      } catch (e) {}
    }

    const finalData = { ...{ account_id, account_name, account_username, avatar_url }, ...verifiedData };

    await pool.query(`
      INSERT INTO social_accounts
        (user_id, platform, account_id, account_name, account_username, avatar_url,
         access_token, page_id, page_name, whatsapp_phone_id, whatsapp_business_id,
         is_connected, scopes, extra_data, connected_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12,$13,NOW(),NOW())
      ON CONFLICT (user_id, platform) DO UPDATE SET
        account_id=$3, account_name=$4, account_username=$5, avatar_url=$6,
        access_token=$7, page_id=$8, page_name=$9,
        whatsapp_phone_id=$10, whatsapp_business_id=$11,
        is_connected=true, scopes=$12, extra_data=$13, updated_at=NOW()
    `, [
      req.user.id, platform,
      finalData.account_id || '', finalData.account_name || '', account_username || '', finalData.avatar_url || '',
      access_token,
      page_id || '', page_name || '', whatsapp_phone_id || '', whatsapp_business_id || '',
      JSON.stringify(scopes || []), JSON.stringify(extra_data || {})
    ]);

    await auditLog(req.user.id, 'connect_social', 'social_accounts', null, `ربط ${platform}`, req.ip);
    await notify(req.user.id, '🔗 ربط حساب', `تم ربط حساب ${platform} بنجاح`, 'success');
    res.json({ success: true, message: `تم ربط ${platform} بنجاح` });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// فك ربط حساب
app.delete('/api/social/disconnect/:platform', authenticateToken, async (req, res) => {
  const { platform } = req.params;
  const ALLOWED_PLATFORMS = ['instagram', 'facebook', 'tiktok', 'whatsapp'];
  if (!ALLOWED_PLATFORMS.includes(platform))
    return res.status(400).json({ success: false, message: 'المنصة غير مدعومة' });
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    await pool.query(
      'UPDATE social_accounts SET is_connected=false, access_token=\'\', updated_at=NOW() WHERE user_id=$1 AND platform=$2',
      [req.user.id, platform]
    );
    await auditLog(req.user.id, 'disconnect_social', 'social_accounts', null, `فك ربط ${platform}`, req.ip);
    res.json({ success: true, message: `تم فك ربط ${platform}` });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// تحديث إعدادات حساب موجود
app.put('/api/social/accounts/:platform', authenticateToken, async (req, res) => {
  const { platform } = req.params;
  const ALLOWED_PLATFORMS = ['instagram', 'facebook', 'tiktok', 'whatsapp'];
  if (!ALLOWED_PLATFORMS.includes(platform))
    return res.status(400).json({ success: false, message: 'المنصة غير مدعومة' });
  const { page_id, page_name, whatsapp_phone_id, whatsapp_business_id, extra_data } = req.body;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    await pool.query(`
      UPDATE social_accounts SET
        page_id=COALESCE($3, page_id),
        page_name=COALESCE($4, page_name),
        whatsapp_phone_id=COALESCE($5, whatsapp_phone_id),
        whatsapp_business_id=COALESCE($6, whatsapp_business_id),
        extra_data=COALESCE($7, extra_data),
        updated_at=NOW()
      WHERE user_id=$1 AND platform=$2
    `, [req.user.id, platform, page_id, page_name, whatsapp_phone_id, whatsapp_business_id,
        extra_data ? JSON.stringify(extra_data) : null]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// META OAuth — Facebook & Instagram
// ============================================================

// الخطوة 1: توليد رابط OAuth
app.get('/api/social/meta/auth-url', authenticateToken, (req, res) => {
  const clientId = process.env.META_APP_ID;
  if (!clientId) return res.status(503).json({ success: false, message: 'META_APP_ID غير مضبوط' });
  const redirectUri = `${process.env.APP_URL || 'https://socialos-production-4aa6.up.railway.app'}/api/social/meta/callback`;
  const scopes = [
    'pages_show_list', 'pages_read_engagement', 'pages_manage_posts',
    'instagram_basic', 'instagram_content_publish', 'business_management'
  ].join(',');
  const state = Buffer.from(JSON.stringify({ userId: req.user.id, ts: Date.now() })).toString('base64');
  const url = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&state=${encodeURIComponent(state)}&response_type=code`;
  res.json({ success: true, url });
});

// الخطوة 2: OAuth Callback من Meta
app.get('/api/social/meta/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect(`/?social_error=${encodeURIComponent(error)}`);
  if (!code) return res.redirect('/?social_error=no_code');

  let userId;
  try {
    const s = JSON.parse(Buffer.from(state, 'base64').toString());
    userId = s.userId;
    if (!userId) throw new Error('userId missing');
  } catch (e) { return res.redirect('/?social_error=invalid_state'); }

  const clientId = process.env.META_APP_ID;
  const clientSecret = process.env.META_APP_SECRET;
  const redirectUri = `${process.env.APP_URL || 'https://socialos-production-4aa6.up.railway.app'}/api/social/meta/callback`;

  try {
    // استبدال الكود بتوكن
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${clientSecret}&code=${code}`
    );
    const tokenData = await tokenRes.json();
    if (tokenData.error) return res.redirect(`/?social_error=${encodeURIComponent(tokenData.error.message)}`);

    const accessToken = tokenData.access_token;

    // جلب بيانات المستخدم
    const meRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name,picture&access_token=${accessToken}`);
    const me = await meRes.json();

    // جلب الصفحات
    const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${accessToken}`);
    const pages = await pagesRes.json();
    const firstPage = pages.data?.[0];

    if (pool) {
      // حفظ Facebook
      await pool.query(`
        INSERT INTO social_accounts (user_id,platform,account_id,account_name,avatar_url,access_token,page_id,page_name,is_connected,connected_at,updated_at)
        VALUES ($1,'facebook',$2,$3,$4,$5,$6,$7,true,NOW(),NOW())
        ON CONFLICT(user_id,platform) DO UPDATE SET
          account_id=$2,account_name=$3,avatar_url=$4,access_token=$5,
          page_id=$6,page_name=$7,is_connected=true,updated_at=NOW()
      `, [userId, me.id||'', me.name||'', me.picture?.data?.url||'', accessToken,
          firstPage?.id||'', firstPage?.name||'']);

      // محاولة جلب حساب Instagram المرتبط
      if (firstPage) {
        try {
          const igRes = await fetch(
            `https://graph.facebook.com/v19.0/${firstPage.id}?fields=instagram_business_account&access_token=${firstPage.access_token || accessToken}`
          );
          const igData = await igRes.json();
          const igId = igData.instagram_business_account?.id;
          if (igId) {
            const igProfile = await fetch(
              `https://graph.facebook.com/v19.0/${igId}?fields=name,username,profile_picture_url&access_token=${accessToken}`
            ).then(r => r.json());
            await pool.query(`
              INSERT INTO social_accounts (user_id,platform,account_id,account_name,account_username,avatar_url,access_token,is_connected,connected_at,updated_at)
              VALUES ($1,'instagram',$2,$3,$4,$5,$6,true,NOW(),NOW())
              ON CONFLICT(user_id,platform) DO UPDATE SET
                account_id=$2,account_name=$3,account_username=$4,avatar_url=$5,
                access_token=$6,is_connected=true,updated_at=NOW()
            `, [userId, igId, igProfile.name||'', igProfile.username||'', igProfile.profile_picture_url||'', accessToken]);
          }
        } catch (e) {}
      }

      await notify(userId, '🔗 ربط Meta', 'تم ربط Facebook وInstagram بنجاح', 'success');
    }

    res.redirect('/?social_connected=facebook');
  } catch (e) {
    res.redirect(`/?social_error=${encodeURIComponent(e.message)}`);
  }
});

// ============================================================
// TikTok OAuth
// ============================================================

app.get('/api/social/tiktok/auth-url', authenticateToken, (req, res) => {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  if (!clientKey) return res.status(503).json({ success: false, message: 'TIKTOK_CLIENT_KEY غير مضبوط' });
  const redirectUri = `${process.env.APP_URL || 'https://socialos-production-4aa6.up.railway.app'}/api/social/tiktok/callback`;
  const scopes = 'user.info.basic,video.list,video.upload';
  const state = Buffer.from(JSON.stringify({ userId: req.user.id, ts: Date.now() })).toString('base64');
  const url = `https://www.tiktok.com/v2/auth/authorize?client_key=${clientKey}&scope=${scopes}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
  res.json({ success: true, url });
});

app.get('/api/social/tiktok/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error || !code) return res.redirect(`/?social_error=${encodeURIComponent(error || 'no_code')}`);

  let userId;
  try {
    const s = JSON.parse(Buffer.from(state, 'base64').toString());
    userId = s.userId;
  } catch (e) { return res.redirect('/?social_error=invalid_state'); }

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  const redirectUri = `${process.env.APP_URL || 'https://socialos-production-4aa6.up.railway.app'}/api/social/tiktok/callback`;

  try {
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri })
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) return res.redirect(`/?social_error=${encodeURIComponent(tokenData.error_description || tokenData.error)}`);

    const accessToken = tokenData.access_token;
    const openId = tokenData.open_id;

    const profileRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url,follower_count', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const profileData = await profileRes.json();
    const profile = profileData.data?.user || {};

    if (pool) {
      await pool.query(`
        INSERT INTO social_accounts (user_id,platform,account_id,account_name,avatar_url,access_token,is_connected,connected_at,updated_at)
        VALUES ($1,'tiktok',$2,$3,$4,$5,true,NOW(),NOW())
        ON CONFLICT(user_id,platform) DO UPDATE SET
          account_id=$2,account_name=$3,avatar_url=$4,access_token=$5,is_connected=true,updated_at=NOW()
      `, [userId, openId||profile.open_id||'', profile.display_name||'', profile.avatar_url||'', accessToken]);
      await notify(userId, '🎵 ربط TikTok', 'تم ربط حساب TikTok بنجاح', 'success');
    }

    res.redirect('/?social_connected=tiktok');
  } catch (e) { res.redirect(`/?social_error=${encodeURIComponent(e.message)}`); }
});

// ============================================================
// WhatsApp Business API
// ============================================================

// إرسال رسالة واتساب
app.post('/api/social/whatsapp/send', authenticateToken, async (req, res) => {
  const { to, message, type = 'text', template_name, template_params } = req.body;
  if (!to || (!message && type === 'text'))
    return res.status(400).json({ success: false, message: 'to ومحتوى الرسالة مطلوبان' });

  // تنظيف رقم الهاتف
  const phone = String(to).replace(/[^\d]/g, '');
  if (phone.length < 7) return res.status(400).json({ success: false, message: 'رقم هاتف غير صالح' });

  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query(
      'SELECT access_token, whatsapp_phone_id FROM social_accounts WHERE user_id=$1 AND platform=$2 AND is_connected=true',
      [req.user.id, 'whatsapp']
    );
    if (!r.rows.length || !r.rows[0].access_token)
      return res.status(400).json({ success: false, message: 'حساب واتساب غير مربوط' });

    const { access_token, whatsapp_phone_id } = r.rows[0];
    if (!whatsapp_phone_id)
      return res.status(400).json({ success: false, message: 'Phone Number ID غير مضبوط' });

    let bodyPayload;
    if (type === 'template' && template_name) {
      bodyPayload = {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: template_name,
          language: { code: 'ar' },
          components: template_params ? [{ type: 'body', parameters: template_params.map(p => ({ type: 'text', text: p })) }] : []
        }
      };
    } else {
      bodyPayload = {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body: String(message).substring(0, 4096) }
      };
    }

    const waRes = await fetch(`https://graph.facebook.com/v19.0/${whatsapp_phone_id}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload)
    });
    const waData = await waRes.json();
    if (waData.error) return res.status(400).json({ success: false, message: waData.error.message });
    res.json({ success: true, message_id: waData.messages?.[0]?.id });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Webhook استقبال رسائل واتساب (التحقق)
app.get('/api/social/whatsapp/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'socialos_wa_verify';
  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WhatsApp Webhook verified');
    return res.status(200).send(challenge);
  }
  res.status(403).send('Forbidden');
});

// Webhook استقبال رسائل واتساب (الرسائل الواردة)
app.post('/api/social/whatsapp/webhook', async (req, res) => {
  res.status(200).send('OK'); // يجب الرد فوراً
  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    if (!value?.messages?.length) return;

    const msg = value.messages[0];
    const from = msg.from;
    const text = msg.text?.body || '';
    const phoneNumberId = value.metadata?.phone_number_id;

    if (!pool || !phoneNumberId) return;
    // إيجاد صاحب الحساب
    const r = await pool.query(
      'SELECT user_id FROM social_accounts WHERE whatsapp_phone_id=$1 AND platform=$2 AND is_connected=true',
      [phoneNumberId, 'whatsapp']
    );
    if (!r.rows.length) return;
    const userId = r.rows[0].user_id;
    await notify(userId, '💬 رسالة واتساب جديدة', `من ${from}: ${String(text).substring(0,100)}`, 'whatsapp');
  } catch (e) { console.error('WA webhook error:', e.message); }
});

// ============================================================
// STATIC & ROOT
// ============================================================
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(__dirname + '/app.html'));
app.get('/privacy', (req, res) => res.send('<html><body style="font-family:Arial;padding:40px"><h1>Privacy Policy</h1><p>SocialOS stores user data securely and never sells it.</p></body></html>'));
app.get('/terms', (req, res) => res.send('<html><body style="font-family:Arial;padding:40px"><h1>Terms of Service</h1><p>By using SocialOS, you agree to use it lawfully.</p></body></html>'));

// ============================================================
// CONFIG (public)
// ============================================================
app.get('/api/config', (req, res) => {
  res.json({
    google_client_id: process.env.GOOGLE_CLIENT_ID || '',
    app_name: 'SocialOS',
    version: '2.0'
  });
});

// ============================================================
// START
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SocialOS v2.0 running on port ${PORT}`));
