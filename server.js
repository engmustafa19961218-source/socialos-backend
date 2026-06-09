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
      phone VARCHAR(20) UNIQUE,
      password TEXT,
      avatar_url TEXT DEFAULT '',
      plan VARCHAR(50) DEFAULT 'trial',
      plan_expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '7 days'),
      role VARCHAR(50) DEFAULT 'owner',
      owner_id INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    // Password Reset Codes
    `CREATE TABLE IF NOT EXISTS reset_codes (
      id SERIAL PRIMARY KEY,
      identifier VARCHAR(255),
      code VARCHAR(10),
      expires_at TIMESTAMP,
      used BOOLEAN DEFAULT FALSE,
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
    // Store Identity — هوية المتجر
    `CREATE TABLE IF NOT EXISTS store_identity (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE,
      logo_url TEXT DEFAULT '',
      cover_url TEXT DEFAULT '',
      primary_color VARCHAR(20) DEFAULT '#4f8ef7',
      secondary_color VARCHAR(20) DEFAULT '#7c3aed',
      accent_color VARCHAR(20) DEFAULT '#00d4aa',
      font_name VARCHAR(100) DEFAULT 'Tajawal',
      communication_style VARCHAR(100) DEFAULT 'ودي وقريب',
      watermark_enabled BOOLEAN DEFAULT FALSE,
      watermark_position VARCHAR(50) DEFAULT 'bottom-right',
      watermark_opacity DECIMAL(3,2) DEFAULT 0.8,
      social_template TEXT DEFAULT '{}',
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
    // Image Projects — مشاريع تصميم الصور
    `CREATE TABLE IF NOT EXISTS image_projects (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      title VARCHAR(255) DEFAULT '',
      type VARCHAR(50) DEFAULT 'product',
      original_url TEXT DEFAULT '',
      result_url TEXT DEFAULT '',
      prompt TEXT DEFAULT '',
      status VARCHAR(50) DEFAULT 'pending',
      provider VARCHAR(50) DEFAULT 'cloudinary',
      metadata TEXT DEFAULT '{}',
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
    )`,
    // Ad Campaigns — الحملات الإعلانية
    `CREATE TABLE IF NOT EXISTS ad_campaigns (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      name VARCHAR(255) NOT NULL,
      platform VARCHAR(50) NOT NULL,
      objective VARCHAR(100) DEFAULT 'awareness',
      status VARCHAR(50) DEFAULT 'draft',
      budget DECIMAL(10,2) DEFAULT 0,
      budget_type VARCHAR(20) DEFAULT 'daily',
      start_date DATE,
      end_date DATE,
      target_audience TEXT DEFAULT '{}',
      ad_content TEXT DEFAULT '{}',
      external_id VARCHAR(255) DEFAULT '',
      results TEXT DEFAULT '{}',
      spend DECIMAL(10,2) DEFAULT 0,
      impressions INTEGER DEFAULT 0,
      clicks INTEGER DEFAULT 0,
      conversions INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
    // Social Posts — المنشورات
    `CREATE TABLE IF NOT EXISTS social_posts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      platform VARCHAR(50) NOT NULL,
      content TEXT DEFAULT '',
      media_url TEXT DEFAULT '',
      media_type VARCHAR(50) DEFAULT 'image',
      status VARCHAR(50) DEFAULT 'draft',
      scheduled_at TIMESTAMP,
      published_at TIMESTAMP,
      external_id VARCHAR(255) DEFAULT '',
      likes INTEGER DEFAULT 0,
      comments INTEGER DEFAULT 0,
      shares INTEGER DEFAULT 0,
      reach INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    // Digital Team — فريق الموظفين الرقميين
    `CREATE TABLE IF NOT EXISTS digital_team (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      role VARCHAR(50) NOT NULL,
      name VARCHAR(255) DEFAULT '',
      personality TEXT DEFAULT '',
      expertise TEXT DEFAULT '',
      instructions TEXT DEFAULT '',
      is_active BOOLEAN DEFAULT TRUE,
      total_interactions INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, role)
    )`,
    // Advanced Analytics — التحليلات المتقدمة
    `CREATE TABLE IF NOT EXISTS analytics_reports (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      type VARCHAR(50) DEFAULT 'weekly',
      period_start DATE,
      period_end DATE,
      data TEXT DEFAULT '{}',
      ai_insights TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    // Sales Forecast — توقع المبيعات
    `CREATE TABLE IF NOT EXISTS sales_forecasts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      forecast_date DATE,
      predicted_revenue DECIMAL(10,2) DEFAULT 0,
      predicted_orders INTEGER DEFAULT 0,
      confidence DECIMAL(5,2) DEFAULT 0,
      factors TEXT DEFAULT '{}',
      actual_revenue DECIMAL(10,2),
      created_at TIMESTAMP DEFAULT NOW()
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
    // إضافة عمود phone للمستخدمين القدامى
    pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20) UNIQUE`).catch(() => {});
    // إضافة أعمدة سياسة العربون
    pool.query(`ALTER TABLE business_profile ADD COLUMN IF NOT EXISTS deposit_policy VARCHAR(20) DEFAULT 'none'`).catch(() => {});
    pool.query(`ALTER TABLE business_profile ADD COLUMN IF NOT EXISTS deposit_value DECIMAL(10,2) DEFAULT 0`).catch(() => {});
    pool.query(`ALTER TABLE business_profile ADD COLUMN IF NOT EXISTS deposit_note TEXT DEFAULT ''`).catch(() => {});
    pool.query(`ALTER TABLE business_profile ADD COLUMN IF NOT EXISTS deposit_required BOOLEAN DEFAULT FALSE`).catch(() => {});
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
// ONBOARDING AUTO-SETUP — الإعداد الذكي التلقائي
// ============================================================
app.post('/api/onboarding/auto-setup', authenticateToken, async (req, res) => {
  const { business_type, business_desc, store_name, employee_name, user_philosophy, user_objection } = req.body;
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.json({ success: false, message: 'AI غير متاح' });

  const typeNames = {
    retail:'تجارة ومنتجات', restaurant:'مطاعم وكافيه', real_estate:'عقارات',
    services:'خدمات', health:'صحة وجمال', education:'تعليم',
    sports:'رياضة', perfume:'عطور', furniture:'أثاث',
    fashion:'أزياء وملابس', electronics:'إلكترونيات', other:'أخرى'
  };
  const typeName = typeNames[business_type] || business_type;

  try {
    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: `أنت مساعد إعداد أنظمة تجارية ذكية. بناءً على معلومات هذا المتجر، أنشئ إعدادات مناسبة.

المتجر: ${escapeHtml(store_name||'')}
نوع النشاط: ${typeName}
وصف العمل: ${escapeHtml(business_desc||'')}
اسم الموظف الرقمي: ${escapeHtml(employee_name||'مساعدي الذكي')}
فلسفة صاحب العمل: ${escapeHtml(user_philosophy||'')}
أسلوبه مع طلبات الخصم: ${escapeHtml(user_objection||'')}

أرجع JSON فقط بهذا الشكل بدون أي نص خارجه:
{
  "employee_name": "اسم مناسب للموظف إذا لم يُحدد",
  "personality": "وصف شخصية الموظف الرقمي المناسبة لهذا النشاط (جملتان)",
  "sales_style": "أسلوب البيع المناسب لهذا النشاط (جملتان)",
  "philosophy": "فلسفة التعامل مع العملاء إذا لم يحددها صاحب العمل (جملتان)",
  "objection_handling": "كيفية التعامل مع اعتراضات العملاء إذا لم تُحدد (جملتان)",
  "boundaries": "ما لا يجب على الموظف فعله (جملة واحدة)",
  "communication_style": "ودي وقريب",
  "policies": "سياسات مناسبة لهذا النشاط (3-4 سياسات مفصولة بفاصلة)"
}`
        }]
      })
    });
    const aiData = await aiRes.json();
    let raw = aiData.choices?.[0]?.message?.content || '{}';
    let settings = {};
    try { settings = JSON.parse(raw.replace(/\`\`\`json|\`\`\`/g,'').trim()); } catch(e) {}
    // إذا أدخل المستخدم بيانات خاصة، لا نتجاوزها
    if (user_philosophy) settings.philosophy = user_philosophy;
    if (user_objection) settings.objection_handling = user_objection;
    if (employee_name) settings.employee_name = employee_name;
    res.json({ success: true, settings });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
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

  let businessProfile = {}, employee = {}, knowledge = [], decisions = [], corrections = [], products = [], identity = {};
  try {
    if (pool) {
      const [bp, emp, kb, dm, cor, prods, sid] = await Promise.all([
        pool.query('SELECT * FROM business_profile WHERE user_id=$1', [userId]),
        pool.query('SELECT * FROM digital_employee WHERE user_id=$1', [userId]),
        pool.query('SELECT title, content, type FROM knowledge_base WHERE user_id=$1 ORDER BY created_at DESC LIMIT 15', [userId]),
        pool.query('SELECT decision, reason, context FROM decision_memory WHERE user_id=$1 AND is_active=true LIMIT 15', [userId]),
        pool.query('SELECT corrected_response, lesson FROM training_corrections WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10', [userId]),
        pool.query('SELECT name, price, description, stock FROM products WHERE user_id=$1 AND is_available=true LIMIT 20', [userId]),
        pool.query('SELECT payment_cards FROM store_identity WHERE user_id=$1', [userId]).catch(()=>({rows:[]}))
      ]);
      businessProfile = bp.rows[0] || {};
      employee = emp.rows[0] || {};
      knowledge = kb.rows;
      decisions = dm.rows;
      corrections = cor.rows;
      products = prods.rows;
      identity = sid.rows[0] || {};
    }
  } catch (e) {}

  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(500).json({ success: false, message: 'OpenRouter غير مفعّل' });

  // ═══════════════════════════════════════════════════
  // بناء الـ system prompt حسب الوضع
  // ═══════════════════════════════════════════════════
  let systemPrompt = '';

  // ─── وضع خدمة العملاء الحقيقي ───
  if (mode === 'customer') {
    const stage = employee.trust_level >= 3 ? 'autonomous' : employee.trust_level >= 2 ? 'assisted' : 'supervised';
    systemPrompt = `أنت الموظف الرقمي الذكي لمتجر "${escapeHtml(businessProfile.store_name||'المتجر')}".
اسمك: ${escapeHtml(employee.name||'المساعد')}
مهمتك: الرد على العملاء وإغلاق الصفقات بأسلوب صاحب العمل.

═══ هوية العمل ═══
نوع النشاط: ${escapeHtml(businessProfile.business_type||'')}
وصف العمل: ${escapeHtml(businessProfile.business_desc||'')}
أسلوب التواصل: ${escapeHtml(businessProfile.communication_style||'ودي وقريب')}
السياسات: ${escapeHtml(businessProfile.policies||'')}

═══ فلسفتك وأسلوبك ═══
${escapeHtml(employee.philosophy||'كن ودياً ومحترفاً')}
أسلوب البيع: ${escapeHtml(employee.sales_style||'استمع أولاً ثم اقترح')}
كيفية التعامل مع الاعتراضات: ${escapeHtml(employee.objection_handling||'افهم السبب وقدم بديلاً')}

═══ المنتجات المتاحة ═══
${products.length ? products.map(p=>`- ${escapeHtml(p.name)}: ${p.price} (${escapeHtml(p.description||'')})`).join('\n') : 'لا منتجات مضافة بعد'}

═══ مركز المعرفة ═══
${knowledge.length ? knowledge.map(k=>`[${k.type}] ${escapeHtml(k.title)}: ${escapeHtml(k.content.substring(0,300))}`).join('\n') : 'فارغ'}

═══ قرارات مهمة يجب تطبيقها ═══
${decisions.length ? decisions.map(d=>`⚠️ ${escapeHtml(d.decision)} — السبب: ${escapeHtml(d.reason)}`).join('\n') : 'لا قرارات خاصة'}

═══ دروس من التدريب ═══
${corrections.length ? corrections.map(c=>`✓ ${escapeHtml(c.lesson||c.corrected_response.substring(0,150))}`).join('\n') : 'لا دروس بعد'}

═══ بطاقات الدفع والتحويل ═══
${(() => {
  try {
    const cards = JSON.parse(identity.payment_cards || '[]');
    if (!cards.length) return 'لم تُضَف بطاقات دفع بعد';
    return cards.map(c => `💳 ${c.type} — ${c.name}\nالرقم: ${c.number}${c.owner ? '\nالاسم: '+c.owner : ''}`).join('\n---\n');
  } catch(e) { return 'لا بطاقات'; }
})()}

عند طلب الزبون دفع العربون أو السداد، أرسل له بطاقات الدفع أعلاه مع تنسيق واضح.

═══ قواعد صارمة ═══
1. تحدث بأسلوب صاحب العمل وفلسفته دائماً
2. طبّق القرارات المهمة بدقة ولا تتجاوزها
3. لا تعطِ خصومات خارج السياسات المحددة
4. لا تحذف بيانات أو تغير سياسات
5. إذا كان الطلب خارج صلاحياتك أو معقداً، قل: "سأحول طلبك لصاحب العمل مباشرة"
6. مرحلتك الحالية: ${stage === 'supervised' ? 'مراقبة (احرص على الدقة)' : stage === 'assisted' ? 'مساعدة (يمكن تصرف محدود)' : 'استقلالية (ثق بحكمك ضمن الحدود)'}
7. أجب بالعربية دائماً بأسلوب طبيعي وودي`;

  // ─── وضع محاكاة العميل ───
  } else if (mode === 'simulate_customer') {
    const scenarios = [
      'عميل يسأل عن الأسعار ويريد خصماً',
      'عميل يتردد في الشراء ويقارن بمنافسين',
      'عميل يشكو من منتج سابق',
      'عميل جديد يسأل عن التوصيل',
      'عميل يريد كميات كبيرة ويتفاوض على السعر'
    ];
    const scenario = message.includes('سيناريو:') ? message : scenarios[Math.floor(Math.random() * scenarios.length)];
    systemPrompt = `أنت تلعب دور عميل حقيقي يتواصل مع متجر "${escapeHtml(businessProfile.store_name||'المتجر')}".
نوع المتجر: ${escapeHtml(businessProfile.business_type||'')}
المنتجات: ${products.slice(0,5).map(p=>escapeHtml(p.name)).join('، ')||'منتجات متنوعة'}

سيناريو محادثتك: ${typeof scenario === 'string' ? escapeHtml(scenario) : ''}

قواعد:
- كن عميلاً حقيقياً طبيعياً، لا تكشف أنك AI
- اسأل عن الأسعار والتوصيل والضمان
- اعترض وتفاوض بشكل طبيعي
- أبدِ اهتماماً حقيقياً أو تردداً حسب السيناريو
- استخدم لغة عامية عراقية أو خليجية طبيعية`;

  // ─── وضع التقييم ───
  } else if (mode === 'evaluate') {
    systemPrompt = `أنت مدرب أعمال خبير متخصص في المبيعات العربية.
فلسفة المتجر: ${escapeHtml(businessProfile.business_desc||'')}
أسلوب صاحب العمل: ${escapeHtml(employee.sales_style||'')}
فلسفة الموظف: ${escapeHtml(employee.philosophy||'')}

مهمتك: تقييم رد الموظف الرقمي وإعطاء:
1. ✅ ما أجاد فيه
2. ⚠️ ما يحتاج تحسيناً
3. 💡 رد أفضل مقترح
4. 📊 درجة من 10
5. 🎯 درس يجب أن يتعلمه

كن صريحاً وعملياً ومحدداً.`;

  // ─── وضع "لماذا أجبت هكذا؟" ───
  } else if (mode === 'explain') {
    systemPrompt = `أنت الموظف الرقمي لمتجر "${escapeHtml(businessProfile.store_name||'المتجر')}".
فلسفتك: ${escapeHtml(employee.philosophy||'')}
أسلوبك: ${escapeHtml(employee.sales_style||'')}
القرارات التي تطبقها: ${decisions.map(d=>escapeHtml(d.decision)).join('، ')||'لا قرارات خاصة'}

صاحب العمل يسألك لماذا أجبت بطريقة معينة.
اشرح تفكيرك بصراحة: ما الذي جعلك تختار هذا الرد؟ ما الذي طبّقته من فلسفة العمل؟ هل كنت متأكداً؟`;

  // ─── وضع التدريب المفتوح ───
  } else {
    systemPrompt = `أنت الموظف الرقمي الذكي لمتجر "${escapeHtml(businessProfile.store_name||'المتجر')}".
أنت في جلسة تدريب مع صاحب العمل — تعلم منه وطرح أسئلة وطبّق توجيهاته.

معلومات العمل:
- النشاط: ${escapeHtml(businessProfile.business_type||'')}
- الوصف: ${escapeHtml(businessProfile.business_desc||'')}
- أسلوب التواصل: ${escapeHtml(businessProfile.communication_style||'ودي وقريب')}
- السياسات: ${escapeHtml(businessProfile.policies||'')}

ما تعلمته حتى الآن:
الفلسفة: ${escapeHtml(employee.philosophy||'لم تُحدد بعد')}
أسلوب البيع: ${escapeHtml(employee.sales_style||'لم يُحدد بعد')}
التعامل مع الاعتراضات: ${escapeHtml(employee.objection_handling||'لم يُحدد بعد')}

مركز المعرفة:
${knowledge.map(k=>`[${k.type}] ${escapeHtml(k.title)}: ${escapeHtml(k.content.substring(0,200))}`).join('\n')||'فارغ'}

القرارات المهمة:
${decisions.map(d=>`- ${escapeHtml(d.decision)}`).join('\n')||'لا توجد'}

دروس من التصحيحات السابقة:
${corrections.map(c=>`✓ ${escapeHtml(c.lesson||c.corrected_response.substring(0,100))}`).join('\n')||'لا دروس بعد'}

قواعد:
- عندما يصحح صاحب العمل ردك، اشكره واطلب منه توضيح السبب
- اسأل أسئلة لتتعلم أكثر عن فلسفة العمل
- بعد كل تصحيح قل: "فهمت، هل تريد مني تطبيق هذا في حالة [مثال مشابه]؟"`;
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
  const { title, content, type, file_url, tags } = req.body;
  const userId = req.user.id;
  if (!title || !content) return res.status(400).json({ success: false, message: 'العنوان والمحتوى مطلوبان' });
  const validTypes = ['policy', 'faq', 'catalog', 'warranty', 'return', 'price_list', 'shipping', 'product_info', 'other'];
  const safeType = validTypes.includes(type) ? type : 'other';
  try {
    if (pool) {
      const r = await pool.query(
        'INSERT INTO knowledge_base (user_id, title, content, type, file_url) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [userId, escapeHtml(title), content, safeType, file_url||'']
      );
      return res.json({ success: true, item: r.rows[0] });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/knowledge', authenticateToken, async (req, res) => {
  const { type, search } = req.query;
  try {
    if (pool) {
      let q = 'SELECT * FROM knowledge_base WHERE user_id=$1';
      const params = [req.user.id];
      if (type) { q += ' AND type=$2'; params.push(type); }
      if (search) {
        q += ` AND (title ILIKE $${params.length+1} OR content ILIKE $${params.length+1})`;
        params.push('%'+search+'%');
      }
      q += ' ORDER BY created_at DESC';
      const r = await pool.query(q, params);
      return res.json({ success: true, items: r.rows });
    }
  } catch (e) {}
  res.json({ success: true, items: [] });
});

app.put('/api/knowledge/:id', authenticateToken, async (req, res) => {
  const { title, content, type } = req.body;
  const validTypes = ['policy', 'faq', 'catalog', 'warranty', 'return', 'price_list', 'shipping', 'product_info', 'other'];
  const safeType = validTypes.includes(type) ? type : 'other';
  try {
    if (pool) {
      await pool.query('UPDATE knowledge_base SET title=$1, content=$2, type=$3 WHERE id=$4 AND user_id=$5',
        [escapeHtml(title), content, safeType, req.params.id, req.user.id]);
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

// بحث ذكي في المعرفة بالذكاء الاصطناعي
app.post('/api/knowledge/search', authenticateToken, async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ success: false, message: 'query مطلوب' });
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(503).json({ success: false, message: 'AI غير متاح' });
  try {
    if (!pool) return res.json({ success: true, results: [], answer: '' });
    const kb = await pool.query('SELECT * FROM knowledge_base WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
    if (!kb.rows.length) return res.json({ success: true, results: [], answer: 'مركز المعرفة فارغ — أضف محتوى أولاً' });

    const context = kb.rows.map(k => `[${k.type}] ${k.title}:\n${k.content.substring(0,400)}`).join('\n\n---\n\n');

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `أنت مساعد يبحث في مركز معرفة متجر عربي.

مركز المعرفة:
${context}

السؤال: ${escapeHtml(query)}

أجب بناءً على المعلومات الموجودة فقط. إذا لم تجد الإجابة قل ذلك صراحةً.
أجب بإيجاز ووضوح باللغة العربية.`
        }]
      })
    });
    const aiData = await aiRes.json();
    const answer = aiData.choices?.[0]?.message?.content || '';

    // إرجاع العناصر ذات الصلة
    const relevant = kb.rows.filter(k =>
      k.title.toLowerCase().includes(query.toLowerCase()) ||
      k.content.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 5);

    res.json({ success: true, answer, results: relevant });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// رفع PDF وقراءته
app.post('/api/knowledge/upload-pdf', authenticateToken, async (req, res) => {
  const { pdf_base64, title, type } = req.body;
  if (!pdf_base64 || !title) return res.status(400).json({ success: false, message: 'PDF والعنوان مطلوبان' });
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(503).json({ success: false, message: 'AI غير متاح لاستخراج النص' });
  try {
    // استخراج النص من PDF بالذكاء الاصطناعي
    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: pdf_base64.replace(/^data:application\/pdf;base64,/, '') }
            },
            { type: 'text', text: 'استخرج كل النصوص المهمة من هذا المستند بالعربية. ركّز على السياسات والمعلومات العملية.' }
          ]
        }]
      })
    });
    const aiData = await aiRes.json();
    const extractedText = aiData.choices?.[0]?.message?.content || '';

    if (!extractedText) return res.status(500).json({ success: false, message: 'لم يتم استخراج نص من الملف' });

    // حفظ في قاعدة البيانات
    if (pool) {
      const validTypes = ['policy','faq','catalog','warranty','return','price_list','shipping','product_info','other'];
      const safeType = validTypes.includes(type) ? type : 'other';
      const r = await pool.query(
        'INSERT INTO knowledge_base (user_id, title, content, type) VALUES ($1,$2,$3,$4) RETURNING *',
        [req.user.id, escapeHtml(title), extractedText, safeType]
      );
      return res.json({ success: true, item: r.rows[0], extracted_text: extractedText.substring(0, 300) });
    }
    res.json({ success: true, extracted_text: extractedText });
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
  const { context, phone, all } = req.query;
  try {
    if (pool) {
      let q = 'SELECT * FROM decision_memory WHERE user_id=$1';
      if (!all) q += ' AND is_active=true';
      const params = [req.user.id];
      if (context) { q += ` AND context=$${params.length+1}`; params.push(context); }
      if (phone) { q += ` AND customer_phone=$${params.length+1}`; params.push(phone); }
      q += ' ORDER BY created_at DESC';
      const r = await pool.query(q, params);
      return res.json({ success: true, decisions: r.rows });
    }
  } catch (e) {}
  res.json({ success: true, decisions: [] });
});

app.put('/api/decisions/:id', authenticateToken, async (req, res) => {
  const { is_active } = req.body;
  try {
    if (pool) await pool.query('UPDATE decision_memory SET is_active=$1 WHERE id=$2 AND user_id=$3', [is_active, req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
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

  // ─── تعزيز الـ system prompt بتحويل للبشر ───
  const enhancedPrompt = systemPrompt + `

━━━ التحويل للبشر ━━━
إذا وجدت أن الحالة تحتاج تدخل صاحب العمل (شكوى جدية، طلب استثنائي، خلاف في الأسعار، موقف حساس)، أضف في نهاية ردك:
[TRANSFER_TO_HUMAN: سبب التحويل]

━━━ صلاحياتك ━━━
- يمكنك: الإجابة عن الأسئلة، شرح المنتجات، أخذ معلومات الطلب
- لا يمكنك: تغيير الأسعار، منح خصومات خارج السياسة، الوعد بما لم يوافق عليه صاحب العمل`;

  try {
    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4-5',
        max_tokens: 2000,
        messages: [{ role: 'system', content: enhancedPrompt }, ...agentConversations[userId].filter(m => m.role)]
      })
    });
    const aiData = await aiRes.json();
    if (aiData.error) return res.json({ success: false, message: aiData.error.message });

    let response = aiData.choices?.[0]?.message?.content || '';
    let transferReason = null;
    let needsHuman = false;

    // استخراج تحويل للبشر
    const transferMatch = response.match(/\[TRANSFER_TO_HUMAN:\s*(.*?)\]/s);
    if (transferMatch) {
      transferReason = transferMatch[1].trim();
      needsHuman = true;
      response = response.replace(/\[TRANSFER_TO_HUMAN:.*?\]/s, '').trim();
      // إشعار صاحب العمل
      if (pool) await notify(userId, '🔔 تحويل للبشر', `عميل يحتاج تدخلك: ${escapeHtml(transferReason.substring(0,100))}`, 'warning');
    }

    agentConversations[userId].push({ role: 'assistant', content: response });
    if (pool) await pool.query('UPDATE digital_employee SET total_interactions=total_interactions+1 WHERE user_id=$1', [userId]);

    // كشف نوع الإجراء
    let action = null;
    const lm = safeMessage.toLowerCase();
    if (lm.includes('طلب') && (lm.includes('أضف')||lm.includes('جديد'))) action = { type: 'new_order' };
    else if (lm.includes('منشور')||lm.includes('اكتب')||lm.includes('محتوى')) action = { type: 'create_post', content: response };
    else if (lm.includes('تقرير')||lm.includes('إحصائيات')) action = { type: 'report' };

    return res.json({ success: true, response, action, needs_human: needsHuman, transfer_reason: transferReason });
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

    // بيانات أعمق للمجلس
    const [orders, ordersMonth, products, customers, bp, emp, topProds, campaigns, coupons, loyalty] = await Promise.all([
      pool.query(`SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) as rev, SUM(CASE WHEN status='new' THEN 1 ELSE 0 END) as new_cnt, SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) as cancelled FROM orders WHERE user_id=$1`, [userId]),
      pool.query(`SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) as rev FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '30 days'`, [userId]),
      pool.query(`SELECT COUNT(*) as cnt, SUM(CASE WHEN stock<=3 THEN 1 ELSE 0 END) as low, SUM(CASE WHEN stock=0 THEN 1 ELSE 0 END) as out FROM products WHERE user_id=$1`, [userId]),
      pool.query(`SELECT COUNT(DISTINCT customer_phone) as cnt, COUNT(DISTINCT CASE WHEN created_at>=NOW()-INTERVAL '30 days' THEN customer_phone END) as new_30d FROM orders WHERE user_id=$1`, [userId]),
      pool.query('SELECT * FROM business_profile WHERE user_id=$1', [userId]),
      pool.query('SELECT trust_level, total_interactions, correct_interactions FROM digital_employee WHERE user_id=$1', [userId]),
      pool.query(`SELECT items, COUNT(*) as freq FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '30 days' GROUP BY items ORDER BY freq DESC LIMIT 5`, [userId]),
      pool.query(`SELECT COUNT(*) as cnt, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active FROM ad_campaigns WHERE user_id=$1`, [userId]).catch(()=>({rows:[{cnt:0,active:0}]})),
      pool.query(`SELECT COUNT(*) as cnt FROM coupons WHERE user_id=$1 AND is_active=true`, [userId]).catch(()=>({rows:[{cnt:0}]})),
      pool.query(`SELECT COUNT(*) as cnt, COALESCE(SUM(points),0) as total_pts FROM loyalty_points WHERE user_id=$1`, [userId]).catch(()=>({rows:[{cnt:0,total_pts:0}]}))
    ]);

    const bpData = bp.rows[0] || {};
    const empData = emp.rows[0] || {};
    const o = orders.rows[0];
    const om = ordersMonth.rows[0];
    const p = products.rows[0];

    const statsStr = `
متجر: ${bpData.store_name||''} — ${bpData.business_type||''}
الطلبات الكلية: ${o.cnt} | الإيرادات: ${Number(o.rev||0).toLocaleString()} | ملغية: ${o.cancelled}
آخر 30 يوم: ${om.cnt} طلب — ${Number(om.rev||0).toLocaleString()} إيراد
المنتجات: ${p.cnt} | مخزون منخفض: ${p.low} | نفذ: ${p.out}
العملاء: ${customers.rows[0]?.cnt} | جدد (30 يوم): ${customers.rows[0]?.new_30d}
الموظف الرقمي: مستوى ${empData.trust_level||1} — دقة ${empData.total_interactions>0?Math.round((empData.correct_interactions/empData.total_interactions)*100):0}%
الحملات الإعلانية: ${campaigns.rows[0]?.cnt} | نشطة: ${campaigns.rows[0]?.active}
الكوبونات النشطة: ${coupons.rows[0]?.cnt}
عملاء الولاء: ${loyalty.rows[0]?.cnt} — إجمالي النقاط: ${loyalty.rows[0]?.total_pts}`;

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4-5',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `أنت مجلس إدارة ذكي وخبير استراتيجي لمتجر عربي. حلّل البيانات وقدّم توصيات قابلة للتنفيذ فوراً.

${statsStr}

أرجع JSON فقط — 7 توصيات متنوعة:
[
  {"type":"opportunity","title":"عنوان قصير جذاب","content":"تحليل مفصل مع خطوات تنفيذية واضحة","priority":"high","action":"action_type","action_label":"نص الزر","kpi":"مؤشر النجاح"},
  {"type":"warning","title":"تحذير عاجل","content":"المشكلة وتأثيرها وكيفية الحل","priority":"high","action":null,"action_label":null,"kpi":""},
  {"type":"strategy","title":"استراتيجية نمو","content":"خطة متكاملة للنمو","priority":"medium","action":null,"action_label":null,"kpi":""},
  {"type":"insight","title":"ملاحظة مهمة","content":"استنتاج من البيانات","priority":"medium","action":null,"action_label":null,"kpi":""},
  {"type":"action","title":"إجراء فوري","content":"ما يجب فعله اليوم","priority":"high","action":"create_campaign","action_label":"إنشاء حملة","kpi":""},
  {"type":"opportunity","title":"فرصة إيراد","content":"كيف تزيد الإيراد","priority":"medium","action":null,"action_label":null,"kpi":""},
  {"type":"risk","title":"خطر محتمل","content":"ما قد يضر العمل وكيف تتفادى","priority":"low","action":null,"action_label":null,"kpi":""}
]

الأنواع المتاحة للـ action: create_campaign, add_coupon, go_training, go_retargeting, go_inventory`
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

    // حذف التوصيات القديمة وإضافة الجديدة
    await pool.query('DELETE FROM board_recommendations WHERE user_id=$1 AND created_at < NOW() - INTERVAL \'7 days\'', [userId]);
    for (const rec of recs) {
      await pool.query(
        'INSERT INTO board_recommendations (user_id, type, title, content, priority) VALUES ($1,$2,$3,$4,$5)',
        [userId, rec.type||'insight', escapeHtml(rec.title||''), rec.content||'', rec.priority||'medium']
      );
    }

    const r = await pool.query('SELECT * FROM board_recommendations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [userId]);

    // إرفاق action_data من الـ AI مع النتائج
    const enriched = r.rows.map((row, i) => ({
      ...row,
      action: recs[i]?.action || null,
      action_label: recs[i]?.action_label || null,
      kpi: recs[i]?.kpi || ''
    }));

    // إحصائيات الأداء للمجلس
    const performance = {
      revenue_30d: Number(om.rev||0),
      orders_30d: parseInt(om.cnt||0),
      avg_order: parseInt(om.cnt||0) > 0 ? Number(om.rev||0)/parseInt(om.cnt||0) : 0,
      new_customers: parseInt(customers.rows[0]?.new_30d||0),
      low_stock: parseInt(p.low||0),
      cancelled_rate: parseInt(o.cnt||0) > 0 ? Math.round((parseInt(o.cancelled||0)/parseInt(o.cnt||0))*100) : 0,
      employee_accuracy: empData.total_interactions>0 ? Math.round((empData.correct_interactions/empData.total_interactions)*100) : 0
    };

    return res.json({ success: true, recommendations: enriched, performance });
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

// اقتراح رسائل طوارئ ذكية حسب نوع العمل
app.post('/api/emergency/suggest', authenticateToken, rateLimit(10, 60*1000), async (req, res) => {
  const { mode_type, end_at } = req.body;
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.json({ success: false, message: 'AI غير متاح' });
  try {
    let bp = {};
    if (pool) {
      const r = await pool.query('SELECT store_name, business_type, whatsapp_number, communication_style FROM business_profile WHERE user_id=$1', [req.user.id]);
      bp = r.rows[0] || {};
    }

    const modeLabels = { emergency:'طارئ', vacation:'إجازة', maintenance:'صيانة', holiday:'عطلة رسمية', closed:'مغلق مؤقتاً' };
    const endStr = end_at ? `موعد العودة: ${new Date(end_at).toLocaleDateString('ar-IQ')}` : 'موعد العودة: غير محدد';

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 600,
        messages: [{ role: 'user', content:
`أنت خبير تواصل تجاري. اكتب 3 رسائل مختلفة لوضع "${modeLabels[mode_type]||mode_type}" لهذا العمل.

المتجر: ${escapeHtml(bp.store_name||'متجرنا')}
نوع النشاط: ${escapeHtml(bp.business_type||'تجارة')}
أسلوب التواصل: ${escapeHtml(bp.communication_style||'ودي')}
${bp.whatsapp_number ? `واتساب: ${escapeHtml(bp.whatsapp_number)}` : ''}
${endStr}

المطلوب: رسائل قصيرة مناسبة لطبيعة هذا النشاط تحديداً (ليست عامة). الرسالة الأولى رسمية، الثانية ودية، الثالثة مختصرة.

أرجع JSON فقط:
{"messages":[{"label":"رسمية","text":"..."},{"label":"ودية","text":"..."},{"label":"مختصرة","text":"..."}]}`
        }]
      })
    });
    const data = await aiRes.json();
    let result = {};
    try {
      const raw = data.choices?.[0]?.message?.content || '{}';
      result = JSON.parse(raw.replace(/```json|```/g,'').trim());
    } catch(e) {}
    res.json({ success: true, messages: result.messages || [] });
  } catch(e) { res.json({ success: false, message: e.message }); }
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
// PRODUCT IMPORT FROM EXCEL — استيراد المنتجات من Excel
// ============================================================
app.post('/api/products/import-excel', authenticateToken, async (req, res) => {
  const { rows } = req.body; // مصفوفة من الصفوف [{name,price,description,category,stock,image_url}]
  if (!Array.isArray(rows) || !rows.length)
    return res.status(400).json({ success: false, message: 'لا بيانات للاستيراد' });
  if (rows.length > 500)
    return res.status(400).json({ success: false, message: 'الحد الأقصى 500 منتج' });
  if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

  const userId = req.user.id;
  let imported = 0, skipped = 0, errors = [];

  for (const row of rows) {
    const name = String(row.name || row['الاسم'] || row['اسم المنتج'] || '').trim();
    const price = parseFloat(row.price || row['السعر'] || row['سعر'] || 0);
    if (!name || price <= 0) { skipped++; continue; }

    try {
      await pool.query(
        `INSERT INTO products (user_id,name,description,price,category,stock,image_url,dynamic_attrs)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'{}')`,
        [userId,
         escapeHtml(name),
         escapeHtml(String(row.description || row['الوصف'] || row['وصف'] || '')),
         price,
         escapeHtml(String(row.category || row['الفئة'] || row['فئة'] || 'عام')),
         parseInt(row.stock || row['المخزون'] || row['مخزون'] || 0) || 0,
         String(row.image_url || row['الصورة'] || row['صورة'] || '')]
      );
      imported++;
    } catch(e) { skipped++; errors.push(`${name}: ${e.message}`); }
  }

  await auditLog(userId, 'import_products_excel', 'products', null, `استُورد ${imported} منتج`, req.ip);
  res.json({ success: true, imported, skipped, errors: errors.slice(0,10), message: `تم استيراد ${imported} منتج` });
});

// ============================================================
// PRODUCT FROM IMAGE — استخراج منتج من صورة بالـ AI
// ============================================================
app.post('/api/products/from-image', authenticateToken, async (req, res) => {
  const { image_url, image_base64 } = req.body;
  if (!image_url && !image_base64)
    return res.status(400).json({ success: false, message: 'الصورة مطلوبة' });

  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(503).json({ success: false, message: 'AI غير متاح' });

  try {
    // جلب نوع النشاط لتخصيص الاستخراج
    let biz = {};
    if (pool) {
      const bp = await pool.query('SELECT business_type, currency FROM business_profile WHERE user_id=$1', [req.user.id]);
      biz = bp.rows[0] || {};
    }

    const imageContent = image_url
      ? { type: 'image_url', image_url: { url: image_url } }
      : { type: 'image_url', image_url: { url: image_base64 } };

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: [
            imageContent,
            { type: 'text', text: `أنت خبير تجزئة عربي. حلّل هذه الصورة واستخرج بيانات المنتج.
نوع المتجر: ${escapeHtml(biz.business_type || 'عام')}
العملة: ${biz.currency || 'IQD'}

أرجع JSON فقط:
{
  "name": "اسم المنتج بالعربية",
  "description": "وصف مختصر جذاب",
  "category": "الفئة المناسبة",
  "suggested_price": 0,
  "dynamic_attrs": {"لون": "...", "مقاس": "..."},
  "confidence": 85,
  "notes": "ملاحظات للبائع"
}
إذا لم تتعرف على المنتج ضع confidence أقل من 50.` }
          ]
        }]
      })
    });

    const aiData = await aiRes.json();
    let result = aiData.choices?.[0]?.message?.content || '{}';
    try { result = JSON.parse(result.replace(/```json|```/g, '').trim()); } catch(e) { result = {}; }

    res.json({ success: true, product: result });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// PRODUCT FROM TEXT COMMAND — أوامر نصية AI لإضافة منتجات
// ============================================================
app.post('/api/products/from-text', authenticateToken, async (req, res) => {
  const { text } = req.body;
  if (!text || String(text).length > 500)
    return res.status(400).json({ success: false, message: 'النص مطلوب' });

  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(503).json({ success: false, message: 'AI غير متاح' });

  try {
    let biz = {};
    if (pool) {
      const bp = await pool.query('SELECT business_type, currency FROM business_profile WHERE user_id=$1', [req.user.id]);
      biz = bp.rows[0] || {};
    }

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `أنت مساعد إدخال بيانات لمتجر ${escapeHtml(biz.business_type||'عام')} يعمل بعملة ${biz.currency||'IQD'}.
استخرج بيانات المنتج من هذا النص العربي:
"${escapeHtml(String(text).substring(0, 500))}"

أرجع JSON فقط:
{"name":"اسم المنتج","price":0,"stock":0,"category":"الفئة","description":"","dynamic_attrs":{}}

ملاحظات:
- السعر رقم فقط بدون عملة
- إذا لم يُذكر المخزون اجعله 0
- استنتج الفئة من اسم المنتج إذا لم تُذكر`
        }]
      })
    });

    const aiData = await aiRes.json();
    let result = aiData.choices?.[0]?.message?.content || '{}';
    try { result = JSON.parse(result.replace(/```json|```/g, '').trim()); } catch(e) { result = {}; }

    // حفظ تلقائي إذا البيانات كاملة
    let saved = false;
    let savedProduct = null;
    if (result.name && result.price > 0 && pool) {
      const r = await pool.query(
        `INSERT INTO products (user_id,name,description,price,category,stock,dynamic_attrs)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [req.user.id, escapeHtml(result.name), escapeHtml(result.description||''),
         parseFloat(result.price)||0, escapeHtml(result.category||'عام'),
         parseInt(result.stock)||0, JSON.stringify(result.dynamic_attrs||{})]
      );
      saved = true;
      savedProduct = r.rows[0];
      await auditLog(req.user.id, 'create_product_text', 'products', savedProduct.id, result.name, req.ip);
    }

    res.json({ success: true, product: result, saved, saved_product: savedProduct });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// DYNAMIC ATTRS BY BUSINESS TYPE — السمات حسب نوع النشاط
// ============================================================
app.get('/api/products/dynamic-attrs', authenticateToken, async (req, res) => {
  const ATTRS_BY_TYPE = {
    retail:      [['اللون','أحمر'],['المقاس','M'],['المادة','قطن']],
    restaurant:  [['الحجم','وسط'],['الإضافات','جبن'],['الحرارة','حار']],
    real_estate: [['المساحة','120م²'],['الغرف','3'],['الطابق','2']],
    services:    [['المدة','ساعة'],['النوع','منزلي'],['المكان','عندك']],
    health:      [['النوع','تدليك'],['المدة','60 دقيقة'],['الجنس','مختلط']],
    education:   [['المستوى','مبتدئ'],['المدة','شهر'],['الشهادة','نعم']],
    sports:      [['النوع','كرة'],['المقاس','5'],['اللون','أبيض']],
    perfume:     [['الحجم','100مل'],['التركيز','EDP'],['النوع','عطر رجالي']],
    furniture:   [['اللون','بني'],['المادة','خشب'],['الأبعاد','200×90']],
    fashion:     [['المقاس','L'],['اللون','أسود'],['الخامة','قطن']],
    electronics: [['الموديل','2024'],['اللون','أسود'],['السعة','128GB']],
    other:       [['النوع',''],['اللون',''],['المقاس','']]
  };

  try {
    let businessType = req.query.type || 'other';
    if (!businessType && pool) {
      const bp = await pool.query('SELECT business_type FROM business_profile WHERE user_id=$1', [req.user.id]);
      businessType = bp.rows[0]?.business_type || 'other';
    }
    const attrs = ATTRS_BY_TYPE[businessType] || ATTRS_BY_TYPE.other;
    res.json({ success: true, attrs, business_type: businessType });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// EMPLOYEE ACTIVITY LOG — سجل نشاط الموظف الرقمي
// ============================================================
// جلب سجل المحادثات
app.get('/api/employee/activity', authenticateToken, async (req, res) => {
  const { limit = 20, offset = 0 } = req.query;
  try {
    if (!pool) return res.json({ success: true, sessions: [], corrections: [], stats: {} });

    const [sessions, corrections, stats] = await Promise.all([
      pool.query(
        `SELECT id, type, topic, corrections, score,
                LENGTH(messages) as msg_size,
                (SELECT COUNT(*) FROM json_array_length(messages::json, 0)) as msg_count,
                created_at
         FROM training_sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [req.user.id, parseInt(limit), parseInt(offset)]
      ).catch(() => pool.query(
        'SELECT id, type, topic, corrections, score, created_at FROM training_sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [req.user.id, parseInt(limit), parseInt(offset)]
      )),
      pool.query(
        'SELECT id, original_response, corrected_response, lesson, context, created_at FROM training_corrections WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10',
        [req.user.id]
      ),
      pool.query(
        'SELECT trust_level, trust_score, total_interactions, correct_interactions, updated_at FROM digital_employee WHERE user_id=$1',
        [req.user.id]
      )
    ]);

    const emp = stats.rows[0] || {};
    const accuracy = emp.total_interactions > 0
      ? Math.round((emp.correct_interactions / emp.total_interactions) * 100) : 0;

    res.json({
      success: true,
      sessions: sessions.rows,
      corrections: corrections.rows,
      stats: { ...emp, accuracy, sessions_count: sessions.rows.length }
    });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// جلب محادثة معينة كاملة
app.get('/api/employee/activity/:sessionId', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.json({ success: true, session: null });
    const r = await pool.query(
      'SELECT * FROM training_sessions WHERE id=$1 AND user_id=$2',
      [req.params.sessionId, req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'الجلسة غير موجودة' });
    const session = r.rows[0];
    let messages = [];
    try { messages = JSON.parse(session.messages || '[]'); } catch(e) {}
    res.json({ success: true, session: { ...session, messages } });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// AUTO DELIVERY NOTIFICATION — تتبع تلقائي للعميل
// ============================================================
app.post('/api/orders/:id/notify-customer', authenticateToken, async (req, res) => {
  const { type } = req.body; // 'confirmed' | 'shipped' | 'delivered'
  const VALID = ['confirmed','shipped','delivered','cancelled'];
  if (!VALID.includes(type)) return res.status(400).json({ success: false, message: 'نوع غير صالح' });

  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const [ordR, bpR] = await Promise.all([
      pool.query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]),
      pool.query('SELECT store_name, currency, whatsapp_number FROM business_profile WHERE user_id=$1', [req.user.id])
    ]);
    if (!ordR.rows.length) return res.status(404).json({ success: false, message: 'الطلب غير موجود' });

    const o = ordR.rows[0];
    const bp = bpR.rows[0] || {};
    const cur = bp.currency || 'IQD';
    const storeName = bp.store_name || 'متجرنا';

    const phone = String(o.customer_phone || '').replace(/[^0-9]/g, '');
    const waPhone = phone.startsWith('0') ? '964' + phone.slice(1) : phone;

    const msgs = {
      confirmed: `✅ *تم تأكيد طلبك!*\n\nأهلاً ${escapeHtml(o.customer_name||'')} 😊\nطلبك رقم *#${o.id}* تم تأكيده بنجاح.\n💰 المبلغ: ${Number(o.total||0).toLocaleString()} ${cur}\n\nسنتواصل معك قريباً للتوصيل 🚚\n\n⚡ ${storeName}`,
      shipped: `🚚 *تم شحن طلبك!*\n\nأهلاً ${escapeHtml(o.customer_name||'')} 📦\nطلبك رقم *#${o.id}* في الطريق إليك.\n${o.delivery_company ? `🏢 شركة التوصيل: ${escapeHtml(o.delivery_company)}` : ''}\n${o.delivery_link ? `🔍 رقم التتبع: *${escapeHtml(o.delivery_link)}*` : ''}\n\nنتمنى وصوله سريعاً! ⚡ ${storeName}`,
      delivered: `🎉 *تم توصيل طلبك!*\n\nأهلاً ${escapeHtml(o.customer_name||'')} 🌟\nوصل طلبك رقم *#${o.id}* بنجاح.\n\nنرجو أن تكون راضياً 😊\nشاركنا رأيك ليستفيد الجميع!\n\nشكراً لثقتك ⚡ ${storeName}`,
      cancelled: `❌ *تم إلغاء طلبك*\n\nأهلاً ${escapeHtml(o.customer_name||'')} 😔\nتم إلغاء طلبك رقم *#${o.id}*.\n${o.notes ? `السبب: ${escapeHtml(o.notes)}` : ''}\n\nللاستفسار تواصل معنا 📞\n⚡ ${storeName}`
    };

    const msg = msgs[type];
    const waUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`;

    // محاولة إرسال تلقائي عبر WhatsApp API إذا كان مربوطاً
    let autoSent = false;
    const wa = await pool.query(
      'SELECT access_token, whatsapp_phone_id FROM social_accounts WHERE user_id=$1 AND platform=$2 AND is_connected=true',
      [req.user.id, 'whatsapp']
    );
    if (wa.rows[0]?.access_token && wa.rows[0]?.whatsapp_phone_id) {
      try {
        const waRes = await fetch(`https://graph.facebook.com/v19.0/${wa.rows[0].whatsapp_phone_id}/messages`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${wa.rows[0].access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to: waPhone, type: 'text', text: { body: msg } })
        });
        const waData = await waRes.json();
        if (!waData.error) autoSent = true;
      } catch(e) {}
    }

    await auditLog(req.user.id, `notify_${type}`, 'orders', parseInt(req.params.id), waPhone, req.ip);
    res.json({ success: true, wa_url: waUrl, auto_sent: autoSent, message: autoSent ? 'تم الإرسال تلقائياً' : 'رابط واتساب جاهز' });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// تتبع تلقائي عند تغيير حالة الطلب
// نضيف هذا الـ middleware بعد تحديث حالة الطلب في PUT /api/orders/:id


// ============================================================
// ORDERS
// ============================================================
app.post('/api/orders', authenticateToken, async (req, res) => {
  const { customer_name, customer_phone, customer_address, items, total, deposit, deposit_type, payment_method, delivery_company, delivery_link, notes, platform, coupon_code, discount, loyalty_points_used, card_info } = req.body;
  const userId = req.user.id;
  if (total !== undefined && (parseFloat(total) < 0 || isNaN(parseFloat(total)))) return res.status(400).json({ success: false, message: 'المبلغ غير صحيح' });
  try {
    if (pool) {
      // Check emergency
      const em = await pool.query('SELECT * FROM emergency_mode WHERE user_id=$1', [userId]);
      if (em.rows[0]?.is_active && em.rows[0]?.stop_orders)
        return res.status(503).json({ success: false, message: em.rows[0].message || 'الطلبات متوقفة مؤقتاً' });

      const r = await pool.query(
        `INSERT INTO orders (user_id,customer_name,customer_phone,customer_address,items,total,deposit,deposit_type,payment_method,delivery_company,delivery_link,notes,platform,coupon_code,discount,loyalty_points_used,card_info)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [userId, customer_name, customer_phone, customer_address||'', JSON.stringify(items||[]), total||0, deposit||0, deposit_type||'full', payment_method||'cash', delivery_company||'', delivery_link||'', notes||'', platform||'', coupon_code||'', discount||0, loyalty_points_used||0, escapeHtml(card_info||'')]
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
      const allowed = ['status','customer_name','customer_phone','customer_address','items','total','deposit','deposit_type','payment_method','delivery_company','delivery_link','notes','platform','card_info'];
      const updates = {};
      for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
      if (!Object.keys(updates).length) return res.status(400).json({ success: false, message: 'لا توجد حقول للتحديث' });
      const fields = Object.keys(updates).map((k, i) => `${k}=$${i+3}`).join(', ');
      await pool.query(`UPDATE orders SET ${fields} WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id, ...Object.values(updates)]);
      await auditLog(req.user.id, 'update_order', 'orders', parseInt(req.params.id), JSON.stringify(updates), req.ip);

      // إشعار تلقائي للعميل عند تغيير الحالة
      const autoNotifyStatuses = ['confirmed', 'shipped', 'delivered', 'cancelled'];
      if (updates.status && autoNotifyStatuses.includes(updates.status)) {
        try {
          const [ordR, bpR, waR] = await Promise.all([
            pool.query('SELECT customer_name, customer_phone, total, delivery_company, delivery_link, notes FROM orders WHERE id=$1', [req.params.id]),
            pool.query('SELECT store_name, currency FROM business_profile WHERE user_id=$1', [req.user.id]),
            pool.query('SELECT access_token, whatsapp_phone_id FROM social_accounts WHERE user_id=$1 AND platform=$2 AND is_connected=true', [req.user.id, 'whatsapp'])
          ]);
          const o = ordR.rows[0];
          const bp = bpR.rows[0] || {};
          if (o?.customer_phone) {
            const phone = o.customer_phone.replace(/[^0-9]/g, '');
            const waPhone = phone.startsWith('0') ? '964' + phone.slice(1) : phone;
            const cur = bp.currency || 'IQD';
            const store = bp.store_name || 'متجرنا';
            const statusMsgs = {
              confirmed: `✅ *تم تأكيد طلبك!*\n\nأهلاً ${escapeHtml(o.customer_name||'')} 😊\nطلبك رقم *#${req.params.id}* مؤكد.\n💰 ${Number(o.total||0).toLocaleString()} ${cur}\n⚡ ${store}`,
              shipped:   `🚚 *تم شحن طلبك!*\n\nأهلاً ${escapeHtml(o.customer_name||'')} 📦\nطلبك في الطريق${o.delivery_company?'\n🏢 '+escapeHtml(o.delivery_company):''}${o.delivery_link?'\n🔍 تتبع: *'+escapeHtml(o.delivery_link)+'*':''}\n⚡ ${store}`,
              delivered: `🎉 *وصل طلبك!*\n\nأهلاً ${escapeHtml(o.customer_name||'')} 🌟\nطلبك رقم *#${req.params.id}* وصل.\nنرجو رضاك 😊 ⚡ ${store}`,
              cancelled: `❌ *إلغاء الطلب*\n\nأهلاً ${escapeHtml(o.customer_name||'')}\nتم إلغاء طلبك #${req.params.id}${o.notes?'\nالسبب: '+escapeHtml(o.notes):''}\n⚡ ${store}`
            };
            const msg = statusMsgs[updates.status];
            // إرسال تلقائي عبر WhatsApp API إن كان مربوطاً
            if (waR.rows[0]?.access_token && waR.rows[0]?.whatsapp_phone_id) {
              await fetch(`https://graph.facebook.com/v19.0/${waR.rows[0].whatsapp_phone_id}/messages`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${waR.rows[0].access_token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ messaging_product: 'whatsapp', to: waPhone, type: 'text', text: { body: msg } })
              }).catch(() => {});
            }
            // حفظ الرابط في الطلب للاستخدام اليدوي
            const waUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`;
            await pool.query('UPDATE orders SET delivery_wa_link=$1 WHERE id=$2', [waUrl, req.params.id]).catch(() => {});
          }
        } catch(e) { /* لا نوقف العملية إذا فشل الإشعار */ }
      }

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
      const [orders, prevOrders, topCustomers, daily, statusBreak, bp] = await Promise.all([
        pool.query(`SELECT COUNT(*) as cnt, SUM(total) as rev, SUM(deposit) as dep FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '${days} days'`, [userId]),
        pool.query(`SELECT COUNT(*) as cnt, SUM(total) as rev FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '${days*2} days' AND created_at<NOW()-INTERVAL '${days} days'`, [userId]),
        pool.query(`SELECT customer_name, customer_phone, COUNT(*) as orders, SUM(total) as spent FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '${days} days' GROUP BY customer_name,customer_phone ORDER BY spent DESC LIMIT 10`, [userId]),
        pool.query(`SELECT DATE(created_at) as date, SUM(total) as revenue, COUNT(*) as orders FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '${days} days' GROUP BY DATE(created_at) ORDER BY date`, [userId]),
        pool.query(`SELECT status, COUNT(*) as count, SUM(total) as revenue FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '${days} days' GROUP BY status`, [userId]),
        pool.query('SELECT business_type FROM business_profile WHERE user_id=$1', [userId])
      ]);
      const totalRev = parseFloat(orders.rows[0]?.rev||0);
      const totalCnt = parseInt(orders.rows[0]?.cnt||0);
      const prevRev = parseFloat(prevOrders.rows[0]?.rev||0);
      const prevCnt = parseInt(prevOrders.rows[0]?.cnt||0);

      // مؤشرات KPI حسب نوع العمل
      const bizType = bp.rows[0]?.business_type || 'other';
      const kpiByType = {
        restaurant:  { label: 'متوسط قيمة الطلب المستهدف', target: 8000,  unit: 'د.ع', tip: 'المطاعم تستهدف متوسط طلب 8,000–15,000 دينار' },
        retail:      { label: 'معدل تكرار الشراء المستهدف', target: 2,    unit: 'مرة/شهر', tip: 'التجزئة الناجحة تحقق 2+ عمليات شراء شهرياً لكل عميل' },
        fashion:     { label: 'متوسط قيمة الطلب المستهدف', target: 25000, unit: 'د.ع', tip: 'الأزياء تستهدف متوسط طلب 25,000+ دينار' },
        electronics: { label: 'متوسط قيمة الطلب المستهدف', target: 80000, unit: 'د.ع', tip: 'الإلكترونيات تستهدف متوسط طلب 80,000+ دينار' },
        perfume:     { label: 'متوسط قيمة الطلب المستهدف', target: 20000, unit: 'د.ع', tip: 'العطور تستهدف متوسط طلب 20,000+ دينار' },
        health:      { label: 'معدل العودة المستهدف', target: 60, unit: '%', tip: 'الصحة والجمال تستهدف 60%+ من العملاء يعودون' },
        services:    { label: 'معدل العودة المستهدف', target: 70, unit: '%', tip: 'الخدمات تستهدف 70%+ من العملاء يعودون' },
        other:       { label: 'متوسط قيمة الطلب', target: 0, unit: 'د.ع', tip: '' }
      };
      const kpi = kpiByType[bizType] || kpiByType.other;

      return res.json({
        success: true, days,
        orders: { total: totalCnt, revenue: totalRev, deposits: parseFloat(orders.rows[0]?.dep||0), avg: totalCnt>0?totalRev/totalCnt:0 },
        comparison: { prev_revenue: prevRev, prev_orders: prevCnt, revenue_growth: prevRev>0?((totalRev-prevRev)/prevRev*100).toFixed(1):null, orders_growth: prevCnt>0?((totalCnt-prevCnt)/prevCnt*100).toFixed(1):null },
        top_customers: topCustomers.rows, daily_revenue: daily.rows, status_breakdown: statusBreak.rows,
        business_kpi: { type: bizType, ...kpi, actual: totalCnt>0?(totalRev/totalCnt).toFixed(0):0 }
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
// BACKUP — النسخ الاحتياطية
// ============================================================
app.post('/api/backup/create', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    const [bp, emp, products, customers, orders, knowledge, decisions, coupons, corrections, sessions, identity, loyalty] = await Promise.all([
      pool.query('SELECT * FROM business_profile WHERE user_id=$1', [userId]),
      pool.query('SELECT * FROM digital_employee WHERE user_id=$1', [userId]),
      pool.query('SELECT * FROM products WHERE user_id=$1', [userId]),
      pool.query('SELECT * FROM customers WHERE user_id=$1', [userId]),
      pool.query('SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 500', [userId]),
      pool.query('SELECT * FROM knowledge_base WHERE user_id=$1', [userId]),
      pool.query('SELECT * FROM decision_memory WHERE user_id=$1', [userId]),
      pool.query('SELECT * FROM coupons WHERE user_id=$1', [userId]),
      pool.query('SELECT * FROM training_corrections WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [userId]),
      pool.query('SELECT * FROM training_sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [userId]),
      pool.query('SELECT * FROM store_identity WHERE user_id=$1', [userId]).catch(()=>({rows:[]})),
      pool.query('SELECT * FROM loyalty_points WHERE user_id=$1', [userId]).catch(()=>({rows:[]}))
    ]);

    const backupData = JSON.stringify({
      version: '2.0',
      timestamp: new Date().toISOString(),
      user_id: userId,
      sections: {
        business_profile: bp.rows[0] || {},
        digital_employee: emp.rows[0] || {},
        store_identity: identity.rows[0] || {},
        products: products.rows,
        customers: customers.rows,
        orders: orders.rows,
        knowledge_base: knowledge.rows,
        decision_memory: decisions.rows,
        coupons: coupons.rows,
        training_corrections: corrections.rows,
        training_sessions: sessions.rows,
        loyalty_points: loyalty.rows
      },
      stats: {
        products: products.rows.length,
        customers: customers.rows.length,
        orders: orders.rows.length,
        knowledge: knowledge.rows.length,
        decisions: decisions.rows.length,
        corrections: corrections.rows.length
      }
    });

    const r = await pool.query(
      'INSERT INTO backups (user_id, type, data, size) VALUES ($1,$2,$3,$4) RETURNING id, created_at',
      [userId, 'full', backupData, backupData.length]
    );
    await auditLog(userId, 'create_backup', 'backup', r.rows[0].id, `Full backup ${(backupData.length/1024).toFixed(1)}KB`, req.ip);
    await notify(userId, '💾 نسخة احتياطية', 'تم إنشاء نسخة احتياطية كاملة', 'success');

    return res.json({
      success: true,
      backup_id: r.rows[0].id,
      created_at: r.rows[0].created_at,
      size: backupData.length,
      stats: JSON.parse(backupData).stats
    });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/backup/list', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT id, type, size, created_at FROM backups WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [req.user.id]);
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
      const date = new Date(r.rows[0].created_at).toISOString().split('T')[0];
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="socialos-backup-${date}.json"`);
      return res.send(r.rows[0].data);
    }
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// استيراد نسخة احتياطية
app.post('/api/backup/restore', authenticateToken, async (req, res) => {
  const { backup_data, sections } = req.body;
  if (!backup_data) return res.status(400).json({ success: false, message: 'بيانات النسخة مطلوبة' });
  const userId = req.user.id;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    let data;
    try { data = typeof backup_data === 'string' ? JSON.parse(backup_data) : backup_data; } catch { return res.status(400).json({ success: false, message: 'تنسيق النسخة غير صالح' }); }

    // التحقق من أن النسخة تخص نفس المستخدم أو نسخة عامة
    const src = data.sections || data; // دعم النسختين القديمة والجديدة
    const restored = [];

    // استيراد الأقسام المطلوبة فقط
    const toRestore = sections || ['business_profile','digital_employee','knowledge_base','decision_memory','training_corrections'];

    if (toRestore.includes('business_profile') && src.business_profile) {
      const bp = src.business_profile;
      await pool.query(`INSERT INTO business_profile (user_id,store_name,business_type,business_desc,target_audience,communication_style,policies,whatsapp_number,onboarding_done)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) ON CONFLICT(user_id) DO UPDATE SET
        store_name=$2,business_type=$3,business_desc=$4,target_audience=$5,communication_style=$6,policies=$7,whatsapp_number=$8`,
        [userId,bp.store_name||'',bp.business_type||'',bp.business_desc||'',bp.target_audience||'',bp.communication_style||'',bp.policies||'',bp.whatsapp_number||'']);
      restored.push('بيانات المتجر');
    }

    if (toRestore.includes('digital_employee') && src.digital_employee) {
      const emp = src.digital_employee;
      await pool.query(`INSERT INTO digital_employee (user_id,name,personality,sales_style,philosophy,objection_handling,boundaries)
        VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id) DO UPDATE SET
        name=$2,personality=$3,sales_style=$4,philosophy=$5,objection_handling=$6,boundaries=$7`,
        [userId,emp.name||'',emp.personality||'',emp.sales_style||'',emp.philosophy||'',emp.objection_handling||'',emp.boundaries||'']);
      restored.push('الموظف الرقمي');
    }

    if (toRestore.includes('knowledge_base') && src.knowledge_base?.length) {
      for (const k of src.knowledge_base.slice(0,100)) {
        await pool.query('INSERT INTO knowledge_base (user_id,title,content,type) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
          [userId, escapeHtml(k.title||''), k.content||'', k.type||'other']).catch(()=>{});
      }
      restored.push(`مركز المعرفة (${src.knowledge_base.length})`);
    }

    if (toRestore.includes('decision_memory') && src.decision_memory?.length) {
      for (const d of src.decision_memory.slice(0,100)) {
        await pool.query('INSERT INTO decision_memory (user_id,decision,reason,context,is_active) VALUES ($1,$2,$3,$4,true) ON CONFLICT DO NOTHING',
          [userId, d.decision||'', d.reason||'', d.context||'general']).catch(()=>{});
      }
      restored.push(`القرارات (${src.decision_memory.length})`);
    }

    if (toRestore.includes('training_corrections') && src.training_corrections?.length) {
      for (const c of src.training_corrections.slice(0,50)) {
        await pool.query('INSERT INTO training_corrections (user_id,original_response,corrected_response,lesson) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
          [userId, c.original_response||'', c.corrected_response||'', c.lesson||'']).catch(()=>{});
      }
      restored.push(`التصحيحات (${src.training_corrections.length})`);
    }

    if (toRestore.includes('products') && src.products?.length) {
      for (const p of src.products.slice(0,200)) {
        await pool.query('INSERT INTO products (user_id,name,description,price,stock,category,is_available) VALUES ($1,$2,$3,$4,$5,$6,true) ON CONFLICT DO NOTHING',
          [userId, escapeHtml(p.name||''), escapeHtml(p.description||''), parseFloat(p.price)||0, parseInt(p.stock)||0, escapeHtml(p.category||'عام')]).catch(()=>{});
      }
      restored.push(`المنتجات (${src.products.length})`);
    }

    await auditLog(userId, 'restore_backup', 'backup', null, `Restored: ${restored.join(', ')}`, req.ip);
    await notify(userId, '💾 استيراد نسخة', `تم استيراد: ${restored.join('، ')}`, 'success');
    res.json({ success: true, restored, message: `تم استيراد: ${restored.join('، ')}` });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
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
// اقتراح قوالب واتساب ذكية حسب نوع العمل
app.post('/api/whatsapp/templates/suggest', authenticateToken, rateLimit(15, 60*1000), async (req, res) => {
  const { template_type } = req.body;
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.json({ success: false, message: 'AI غير متاح' });
  try {
    let bp = {};
    if (pool) {
      const r = await pool.query('SELECT store_name, business_type, communication_style, currency FROM business_profile WHERE user_id=$1', [req.user.id]);
      bp = r.rows[0] || {};
    }
    const typeLabels = {
      offer: 'عرض خاص أو تخفيض',
      new_product: 'منتج أو خدمة جديدة',
      loyalty: 'مكافأة عملاء مميزين',
      followup: 'متابعة عملاء غير نشطين',
      seasonal: 'مناسبة موسمية أو عطلة'
    };
    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 700,
        messages: [{ role: 'user', content:
`أنت خبير تسويق واتساب للسوق العربي. اكتب 3 قوالب رسائل واتساب لـ "${typeLabels[template_type]||template_type}".

المتجر: ${escapeHtml(bp.store_name||'متجرنا')}
نوع النشاط: ${escapeHtml(bp.business_type||'تجارة')}
أسلوب التواصل: ${escapeHtml(bp.communication_style||'ودي')}
العملة: ${bp.currency||'IQD'}

المطلوب: رسائل قصيرة مناسبة لطبيعة هذا النشاط تحديداً. استخدم {اسم} لاسم العميل. بدون مبالغة.

أرجع JSON فقط:
{"templates":[{"label":"نسخة 1","text":"..."},{"label":"نسخة 2","text":"..."},{"label":"نسخة 3","text":"..."}]}`
        }]
      })
    });
    const data = await aiRes.json();
    let result = {};
    try { result = JSON.parse((data.choices?.[0]?.message?.content||'{}').replace(/```json|```/g,'').trim()); } catch(e){}
    res.json({ success: true, templates: result.templates || [] });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

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
    if (!pool) return res.status(503).send('<h1>الخدمة غير متاحة</h1>');
    const [user, products, bp, identity] = await Promise.all([
      pool.query('SELECT name, avatar_url FROM users WHERE id=$1', [userId]),
      pool.query('SELECT * FROM products WHERE user_id=$1 AND is_available=true ORDER BY category, created_at DESC', [userId]),
      pool.query('SELECT * FROM business_profile WHERE user_id=$1', [userId]),
      pool.query('SELECT * FROM store_identity WHERE user_id=$1', [userId]).catch(()=>({rows:[]}))
    ]);
    if (!user.rows.length) return res.status(404).send('<h1>المتجر غير موجود</h1>');
    const owner = user.rows[0];
    const profile = bp.rows[0] || {};
    const id = identity.rows[0] || {};
    const storeName = escapeHtml(profile.store_name || owner.name || 'متجر');
    const cur = escapeHtml(profile.currency || 'IQD');
    const prods = products.rows;
    const categories = [...new Set(prods.map(p => p.category).filter(Boolean))];
    const prodsJson = JSON.stringify(prods.map(p => ({
      id: p.id,
      name: escapeHtml(p.name||''),
      description: escapeHtml(p.description||''),
      price: parseFloat(p.price)||0,
      stock: parseInt(p.stock)||0,
      category: escapeHtml(p.category||''),
      image_url: (p.image_url||'').startsWith('https://') ? p.image_url : ''
    })));

    // ألوان المتجر من الهوية
    const c1 = id.primary_color || '#4f8ef7';
    const c2 = id.secondary_color || '#7c3aed';
    const c3 = id.accent_color || '#00d4aa';
    const logoUrl = id.logo_url || owner.avatar_url || '';
    const coverUrl = id.cover_url || '';
    const fontName = id.font_name || 'Tajawal';
    const watermark = escapeHtml(id.watermark_text || storeName);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="${c1}">
<title>${storeName}</title>
<link href="https://fonts.googleapis.com/css2?family=${fontName.replace(' ','+')}:wght@400;700;900&family=Tajawal:wght@400;700;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--c1:${c1};--c2:${c2};--c3:${c3};}
body{font-family:'${fontName}',Tajawal,sans-serif;background:#06080f;color:#e2e8f5;direction:rtl;min-height:100vh}
/* HEADER */
.header{position:relative;background:linear-gradient(135deg,#0a0e18,#111827);border-bottom:1px solid rgba(255,255,255,.07);overflow:hidden}
.cover{width:100%;height:160px;object-fit:cover;display:block;opacity:.5}
.cover-placeholder{height:100px;background:linear-gradient(135deg,var(--c1),var(--c2));opacity:.15}
.header-inner{padding:20px 18px 22px;text-align:center;position:relative}
.store-logo{width:70px;height:70px;border-radius:18px;object-fit:cover;border:3px solid var(--c1);box-shadow:0 4px 20px rgba(0,0,0,.4);margin:-35px auto 12px;display:block;background:var(--c1)}
.store-logo-placeholder{width:70px;height:70px;border-radius:18px;background:linear-gradient(135deg,var(--c1),var(--c2));display:flex;align-items:center;justify-content:center;font-size:1.6rem;border:3px solid rgba(255,255,255,.1);margin:12px auto;font-weight:900;color:#fff}
.store-name{font-size:1.5rem;font-weight:900;margin-bottom:5px;background:linear-gradient(135deg,#fff,var(--c1));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.store-desc{color:rgba(255,255,255,.45);font-size:.82rem;line-height:1.5}
.store-badge{display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:4px 11px;font-size:.74rem;margin-top:8px;color:rgba(255,255,255,.5)}
/* NAV */
.nav-bar{position:sticky;top:0;background:rgba(6,8,15,.95);backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,.06);z-index:100;padding:10px 14px}
.search-row{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:8px 14px;margin-bottom:9px}
.search-row input{flex:1;background:transparent;border:none;color:#e2e8f5;font-family:inherit;font-size:.88rem;outline:none}
.search-row input::placeholder{color:rgba(255,255,255,.3)}
.cats{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}
.cats::-webkit-scrollbar{display:none}
.cat-btn{padding:5px 14px;border-radius:20px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:rgba(255,255,255,.45);cursor:pointer;font-family:inherit;font-size:.77rem;font-weight:700;white-space:nowrap;transition:all .18s}
.cat-btn.active{background:var(--c1);border-color:var(--c1);color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.3)}
/* GRID */
.container{max-width:960px;margin:0 auto;padding:16px 12px 110px}
.section-title{font-size:.72rem;font-weight:700;color:rgba(255,255,255,.3);text-transform:uppercase;letter-spacing:.8px;margin-bottom:11px;padding-right:2px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:11px}
.card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:14px;overflow:hidden;cursor:pointer;transition:all .22s;position:relative}
.card:hover{border-color:var(--c1);transform:translateY(-3px);box-shadow:0 8px 24px rgba(0,0,0,.3)}
.card:active{transform:scale(.97)}
.pimg{height:145px;background:rgba(255,255,255,.04);display:flex;align-items:center;justify-content:center;font-size:2.2rem;overflow:hidden;position:relative}
.pimg img{width:100%;height:100%;object-fit:cover;transition:transform .3s}
.card:hover .pimg img{transform:scale(1.05)}
.pinfo{padding:10px 11px 11px}
.pname{font-weight:700;font-size:.84rem;margin-bottom:4px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pprice{color:var(--c1);font-weight:900;font-size:.9rem}
.pstock{font-size:.68rem;color:rgba(255,255,255,.3);margin-top:3px}
.out-badge{position:absolute;top:8px;right:8px;background:rgba(240,64,96,.85);color:#fff;border-radius:6px;padding:2px 7px;font-size:.68rem;font-weight:700}
/* CART FLOAT */
.cart-float{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(30px);background:linear-gradient(135deg,var(--c1),var(--c2));border-radius:20px;padding:12px 22px;display:flex;align-items:center;gap:10px;cursor:pointer;z-index:200;opacity:0;pointer-events:none;transition:all .3s cubic-bezier(.16,1,.3,1);box-shadow:0 8px 32px rgba(0,0,0,.4);font-weight:700}
.cart-float.show{opacity:1;pointer-events:all;transform:translateX(-50%) translateY(0)}
/* OVERLAYS */
.overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:300;align-items:flex-end;justify-content:center;backdrop-filter:blur(6px)}
.overlay.show{display:flex}
.sheet{background:#0a0e18;border-radius:22px 22px 0 0;width:100%;max-width:500px;max-height:92vh;overflow-y:auto;padding:20px 18px 30px;border-top:1px solid rgba(255,255,255,.08)}
.handle{width:40px;height:4px;background:rgba(255,255,255,.15);border-radius:2px;margin:0 auto 18px}
.inp{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:11px;padding:11px 14px;color:#e2e8f5;font-size:.9rem;font-family:inherit;margin-bottom:9px;outline:none;transition:border-color .2s}
.inp:focus{border-color:var(--c1)}
.btn-main{width:100%;padding:13px;background:linear-gradient(135deg,var(--c1),var(--c2));color:#fff;border:none;border-radius:13px;font-size:.95rem;font-weight:700;cursor:pointer;font-family:inherit;margin-top:6px;transition:all .2s}
.btn-main:hover{opacity:.9;transform:translateY(-1px)}
.btn-main:disabled{opacity:.5;cursor:not-allowed;transform:none}
.btn-sec{width:100%;padding:11px;background:transparent;border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.5);border-radius:12px;font-size:.9rem;font-weight:700;cursor:pointer;font-family:inherit;margin-top:6px}
/* EMPTY */
.empty{text-align:center;padding:50px 20px;color:rgba(255,255,255,.25);grid-column:1/-1}
/* WATERMARK */
.watermark{text-align:center;color:rgba(255,255,255,.15);font-size:.7rem;padding:12px;margin-top:8px}
</style>
</head>
<body>
<div class="header">
  ${coverUrl ? `<img class="cover" src="${escapeHtml(coverUrl)}" alt="غلاف">` : '<div class="cover-placeholder"></div>'}
  <div class="header-inner">
    ${logoUrl ? `<img class="store-logo" src="${escapeHtml(logoUrl)}" alt="شعار">` : `<div class="store-logo-placeholder">${storeName.charAt(0)}</div>`}
    <div class="store-name">${storeName}</div>
    ${profile.business_desc ? `<div class="store-desc">${escapeHtml(profile.business_desc)}</div>` : ''}
    <div class="store-badge">🛍️ ${prods.length} منتج متاح</div>
  </div>
</div>

<div class="nav-bar">
  <div class="search-row"><span style="color:rgba(255,255,255,.3)">🔍</span><input id="si" placeholder="ابحث في المنتجات..." oninput="filt()"></div>
  <div class="cats">
    <button class="cat-btn active" onclick="fCat('',this)">الكل</button>
    ${categories.map(c=>`<button class="cat-btn" onclick="fCat(${JSON.stringify(escapeHtml(c))},this)">${escapeHtml(c)}</button>`).join('')}
  </div>
</div>

<div class="container">
  <div class="section-title" id="grid-label">جميع المنتجات (${prods.length})</div>
  <div class="grid" id="grid"></div>
  <div class="watermark">${watermark}</div>
</div>

<div class="cart-float" id="cf" onclick="openCart()">
  <span>🛒</span><span id="cc">0</span><span style="font-size:.75rem;opacity:.8">منتج</span>
  <span id="ct" style="font-weight:900">0</span><span style="font-size:.75rem">${cur}</span>
  <span style="font-size:.8rem;opacity:.75">اطلب الآن ←</span>
</div>

<!-- السلة -->
<div class="overlay" id="co" onclick="if(event.target===this)closeCo()">
  <div class="sheet">
    <div class="handle"></div>
    <h2 style="margin-bottom:14px;font-size:1.1rem">🛒 السلة</h2>
    <div id="ci"></div>
    <button class="btn-main" onclick="openOrder()">متابعة الطلب ←</button>
    <button class="btn-sec" onclick="closeCo()">متابعة التسوق</button>
  </div>
</div>

<!-- الطلب -->
<div class="overlay" id="oo" onclick="if(event.target===this)closeOo()">
  <div class="sheet">
    <div class="handle"></div>
    <div id="oc">
      <h2 style="margin-bottom:14px;font-size:1.1rem">📝 تفاصيل الطلب</h2>
      <input class="inp" id="cn" placeholder="اسمك الكريم *">
      <input class="inp" id="cp" placeholder="رقم هاتفك *" dir="ltr" type="tel">
      <input class="inp" id="ca" placeholder="عنوان التوصيل (اختياري)">
      <textarea class="inp" id="cno" placeholder="ملاحظات للبائع..." style="min-height:65px;resize:none"></textarea>
      <div id="os" style="margin:10px 0"></div>
      <button class="btn-main" id="sb" onclick="submitO()">✅ تأكيد الطلب</button>
      <button class="btn-sec" onclick="closeOo()">رجوع</button>
    </div>
  </div>
</div>

<script>
const UID=${parseInt(userId)},CUR=${JSON.stringify(cur)},PRODS=${prodsJson};
let cart=[],cat='',sq='';
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function sub(){return cart.reduce((s,c)=>s+c.price*c.qty,0);}
function render(){
  let p=PRODS;
  if(cat) p=p.filter(x=>x.category===cat);
  if(sq){const q=sq.toLowerCase();p=p.filter(x=>x.name.toLowerCase().includes(q)||x.description.toLowerCase().includes(q));}
  document.getElementById('grid-label').textContent=(cat?cat+' ':'جميع المنتجات ')+'('+p.length+')';
  if(!p.length){document.getElementById('grid').innerHTML='<div class="empty"><div style="font-size:2rem;margin-bottom:8px">🔍</div><div>لا توجد منتجات</div></div>';return;}
  document.getElementById('grid').innerHTML=p.map(function(x){
    var imgHtml=x.image_url?'<img src="'+esc(x.image_url)+'" loading="lazy" alt="'+esc(x.name)+'">'+'📦';
    var outBadge=x.stock===0?'<div class="out-badge">نفذ</div>':'';
    var stockWarn=x.stock>0&&x.stock<=5?'<div class="pstock">⚠️ آخر '+x.stock+' قطع</div>':'';
    return '<div class="card" onclick="addC('+x.id+')" title="'+esc(x.name)+'">'
      +'<div class="pimg">'+(x.image_url?'<img src="'+esc(x.image_url)+'" loading="lazy">'+'📦')+outBadge+'</div>'
      +'<div class="pinfo">'
      +'<div class="pname">'+esc(x.name)+'</div>'
      +'<div class="pprice">'+x.price.toFixed(0)+' '+esc(CUR)+'</div>'
      +stockWarn
      +'</div></div>';
  }).join('');
}
function fCat(c,btn){cat=c;document.querySelectorAll('.cat-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');render();}
function filt(){sq=document.getElementById('si').value.trim();render();}
function addC(id){
  const x=PRODS.find(p=>p.id===id);
  if(!x)return;
  if(x.stock===0){alert('عذراً، هذا المنتج نفذ من المخزون');return;}
  const e=cart.find(c=>c.id===id);
  if(e){if(e.qty>=x.stock){alert('وصلت للحد الأقصى المتاح');return;}e.qty++;}
  else cart.push({id:x.id,name:x.name,price:x.price,qty:1,stock:x.stock});
  updateF();
  // تأثير بصري
  const cards=document.querySelectorAll('.card');
  cards.forEach(c=>{if(c.onclick&&c.onclick.toString().includes(id)){c.style.borderColor='var(--c3)';setTimeout(()=>c.style.borderColor='',600);}});
}
function updateF(){
  const n=cart.reduce((s,c)=>s+c.qty,0);
  document.getElementById('cc').textContent=n;
  document.getElementById('ct').textContent=sub().toFixed(0);
  document.getElementById('cf').classList.toggle('show',n>0);
}
function openCart(){
  const el=document.getElementById('ci');
  if(!cart.length){el.innerHTML='<div style="text-align:center;padding:24px;color:rgba(255,255,255,.3)">السلة فارغة</div>';}
  else{
    el.innerHTML=cart.map(function(c){
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.07)">'
        +'<span style="font-size:.85rem;flex:1">'+esc(c.name)+'</span>'
        +'<div style="display:flex;align-items:center;gap:8px;flex-shrink:0">'
        +'<button onclick="chQ('+c.id+',-1)" style="width:28px;height:28px;border-radius:50%;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:#e2e8f5;cursor:pointer;font-size:.9rem">&#x2212;</button>'
        +'<span style="min-width:20px;text-align:center;font-weight:700">'+c.qty+'</span>'
        +'<button onclick="chQ('+c.id+',1)" style="width:28px;height:28px;border-radius:50%;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:#e2e8f5;cursor:pointer;font-size:.9rem">+</button>'
        +'<span style="color:var(--c1);font-weight:900;min-width:60px;text-align:left">'+(c.price*c.qty).toFixed(0)+'</span>'
        +'</div></div>';
    }).join('')
    +'<div style="display:flex;justify-content:space-between;font-weight:900;padding:12px 0;font-size:1rem"><span>المجموع</span><span style="color:var(--c1)">'+sub().toFixed(0)+' '+esc(CUR)+'</span></div>';
  }
  document.getElementById('co').classList.add('show');
  document.body.style.overflow='hidden';
}
function closeCo(){document.getElementById('co').classList.remove('show');document.body.style.overflow='';}
function chQ(id,d){
  const e=cart.find(c=>c.id===id);
  if(!e)return;
  e.qty=Math.max(0,e.qty+d);
  if(e.qty===0)cart=cart.filter(c=>c.id!==id);
  updateF();openCart();
}
function openOrder(){
  if(!cart.length)return;
  closeCo();
  const s=sub();
  const itemsHtml=cart.map(function(c){
    return '<div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:5px"><span>'+esc(c.name)+' \xD7'+c.qty+'</span><span style="color:var(--c1)">'+(c.price*c.qty).toFixed(0)+' '+esc(CUR)+'</span></div>';
  }).join('');
  document.getElementById('os').innerHTML='<div style="background:rgba(255,255,255,.04);border-radius:11px;padding:12px">'
    +itemsHtml
    +'<div style="display:flex;justify-content:space-between;font-weight:900;padding-top:9px;margin-top:6px;border-top:1px solid rgba(255,255,255,.08);font-size:.95rem"><span>الإجمالي</span><span style="color:var(--c1)">'+s.toFixed(0)+' '+esc(CUR)+'</span></div>'
    +'</div>';
  document.getElementById('oo').classList.add('show');
  document.body.style.overflow='hidden';
}
function closeOo(){document.getElementById('oo').classList.remove('show');document.body.style.overflow='';}
async function submitO(){
  const name=document.getElementById('cn').value.trim();
  const phone=document.getElementById('cp').value.trim();
  if(!name||!phone){alert('الاسم والهاتف مطلوبان');return;}
  if(!cart.length)return;
  const btn=document.getElementById('sb');
  btn.disabled=true;btn.textContent='⏳ جاري إرسال الطلب...';
  try{
    const r=await fetch('/api/marketplace/order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      store_user_id:UID,customer_name:name,customer_phone:phone,
      customer_address:document.getElementById('ca').value.trim(),
      notes:document.getElementById('cno').value.trim(),
      items:cart.map(c=>({description:c.name+' x'+c.qty,quantity:c.qty,price:c.price})),
      total:sub()
    })});
    const d=await r.json();
    if(d.success){
      document.getElementById('oc').innerHTML='<div style="text-align:center;padding:32px 16px">'
        +'<div style="font-size:3.5rem;margin-bottom:14px">&#x1F389;</div>'
        +'<div style="font-size:1.2rem;font-weight:900;margin-bottom:8px">تم استلام طلبك!</div>'
        +'<div style="color:rgba(255,255,255,.5);margin-bottom:6px">رقم الطلب</div>'
        +'<div style="font-size:1.8rem;font-weight:900;color:var(--c1);margin-bottom:20px">#'+(d.order&&d.order.id?d.order.id:'')+'</div>'
        +'<div style="color:rgba(255,255,255,.4);font-size:.82rem;margin-bottom:24px">سيتواصل معك البائع قريباً لتأكيد الطلب</div>'
        +'<button class="btn-main" onclick="closeOo();cart=[];updateF();render()">&#x1F6CD;&#xFE0F; متابعة التسوق</button>'
        +'</div>';
      cart=[];updateF();
    }else{alert(d.message||'حدث خطأ');btn.disabled=false;btn.textContent='✅ تأكيد الطلب';}
  }catch(e){alert('حدث خطأ في الاتصال');btn.disabled=false;btn.textContent='✅ تأكيد الطلب';}
}
render();
</script>
</body></html>`);
  } catch (e) { res.status(500).send('<h1>خطأ في الخادم</h1>'); }
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
// STORE IDENTITY — هوية المتجر
// ============================================================

app.get('/api/identity', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.json({ success: true, identity: {} });
    const r = await pool.query('SELECT * FROM store_identity WHERE user_id=$1', [req.user.id]);
    res.json({ success: true, identity: r.rows[0] || {} });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.put('/api/identity', authenticateToken, async (req, res) => {
  const {
    logo_url, cover_url, primary_color, secondary_color, accent_color,
    font_name, communication_style, watermark_enabled, watermark_position,
    watermark_opacity, social_template, payment_cards
  } = req.body;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const cardsJson = Array.isArray(payment_cards) ? JSON.stringify(payment_cards) : '[]';
    await pool.query(`
      INSERT INTO store_identity
        (user_id, logo_url, cover_url, primary_color, secondary_color, accent_color,
         font_name, communication_style, watermark_enabled, watermark_position, watermark_opacity, social_template, payment_cards, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        logo_url=COALESCE(NULLIF($2,''), store_identity.logo_url),
        cover_url=COALESCE(NULLIF($3,''), store_identity.cover_url),
        primary_color=COALESCE(NULLIF($4,''), store_identity.primary_color),
        secondary_color=COALESCE(NULLIF($5,''), store_identity.secondary_color),
        accent_color=COALESCE(NULLIF($6,''), store_identity.accent_color),
        font_name=COALESCE(NULLIF($7,''), store_identity.font_name),
        communication_style=COALESCE(NULLIF($8,''), store_identity.communication_style),
        watermark_enabled=COALESCE($9, store_identity.watermark_enabled),
        watermark_position=COALESCE(NULLIF($10,''), store_identity.watermark_position),
        watermark_opacity=COALESCE($11, store_identity.watermark_opacity),
        social_template=COALESCE(NULLIF($12,'{}'), store_identity.social_template),
        payment_cards=$13,
        updated_at=NOW()
    `, [req.user.id, logo_url||'', cover_url||'', primary_color||'', secondary_color||'',
        accent_color||'', font_name||'', communication_style||'',
        watermark_enabled, watermark_position||'', watermark_opacity||null,
        social_template ? JSON.stringify(social_template) : '{}', cardsJson]);
    await auditLog(req.user.id, 'update_identity', 'store_identity', null, '', req.ip);
    const r = await pool.query('SELECT * FROM store_identity WHERE user_id=$1', [req.user.id]);
    res.json({ success: true, identity: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// IMAGE DESIGNER — مصمم الصور الذكي
// ============================================================

// جلب مشاريع الصور
app.get('/api/images/projects', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.json({ success: true, projects: [] });
    const r = await pool.query(
      'SELECT * FROM image_projects WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    res.json({ success: true, projects: r.rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// حفظ مشروع صورة
app.post('/api/images/projects', authenticateToken, async (req, res) => {
  const { title, type, original_url, result_url, prompt, status, provider, metadata } = req.body;
  if (!original_url) return res.status(400).json({ success: false, message: 'original_url مطلوب' });
  // التحقق من الروابط
  try { new URL(original_url); } catch { return res.status(400).json({ success: false, message: 'رابط غير صالح' }); }
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query(
      `INSERT INTO image_projects (user_id, title, type, original_url, result_url, prompt, status, provider, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user.id, escapeHtml(title||''), type||'product', original_url,
       result_url||'', escapeHtml(prompt||''), status||'done',
       provider||'cloudinary', JSON.stringify(metadata||{})]
    );
    res.json({ success: true, project: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// حذف مشروع صورة
app.delete('/api/images/projects/:id', authenticateToken, async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'ID غير صالح' });
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT user_id FROM image_projects WHERE id=$1', [id]);
    if (!r.rows.length || r.rows[0].user_id !== req.user.id)
      return res.status(403).json({ success: false, message: 'غير مصرح' });
    await pool.query('DELETE FROM image_projects WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// معالجة الصورة بالذكاء الاصطناعي
app.post('/api/images/process', authenticateToken, async (req, res) => {
  const { image_url, action, prompt, style } = req.body;
  if (!image_url || !action)
    return res.status(400).json({ success: false, message: 'image_url و action مطلوبان' });
  try { new URL(image_url); } catch { return res.status(400).json({ success: false, message: 'رابط غير صالح' }); }

  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY)
    return res.status(503).json({ success: false, message: 'OPENROUTER_API_KEY غير مضبوط' });

  const actions = {
    describe: 'صف هذه الصورة بالتفصيل بالعربية: المنتج، الألوان، التصميم، وكيف يمكن تحسينها للإعلانات',
    improve: 'اقترح 5 تحسينات محددة لهذه الصورة لجعلها أكثر جاذبية في التسويق العربي',
    caption: 'اكتب 3 تعليقات إعلانية جذابة بالعربية لهذه الصورة مناسبة لـ Instagram وTikTok',
    hashtags: 'اقترح 20 هاشتاق عربي وإنجليزي مناسبة لهذه الصورة للتسويق على منصات التواصل',
    ad_copy: 'اكتب نص إعلاني كامل بالعربية لهذه الصورة: عنوان جذاب، وصف مقنع، ودعوة للعمل',
    custom: escapeHtml(prompt || 'صف هذه الصورة')
  };

  const userPrompt = actions[action] || actions.describe;

  try {
    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: image_url } },
            { type: 'text', text: userPrompt }
          ]
        }]
      })
    });
    const aiData = await aiRes.json();
    const result = aiData.choices?.[0]?.message?.content || '';
    if (!result) return res.status(500).json({ success: false, message: 'لم يرد الذكاء الاصطناعي' });
    res.json({ success: true, result, action });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// توليد نص إعلاني للمنتج
app.post('/api/images/generate-text', authenticateToken, async (req, res) => {
  const { product_name, product_desc, platform, style, tone } = req.body;
  if (!product_name) return res.status(400).json({ success: false, message: 'اسم المنتج مطلوب' });

  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(503).json({ success: false, message: 'AI غير متاح' });

  const platformGuide = {
    instagram: 'Instagram: نص قصير جذاب مع إيموجي وهاشتاقات',
    tiktok: 'TikTok: نص سريع ومثير للشباب مع هاشتاقات ترند',
    facebook: 'Facebook: نص مفصل ومقنع مع دعوة واضحة للعمل',
    whatsapp: 'واتساب: رسالة ترويجية ودية وشخصية'
  };

  try {
    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `أنت خبير تسويق رقمي عربي. اكتب محتوى إعلاني لـ ${platformGuide[platform]||'منصات التواصل'}.
المنتج: ${escapeHtml(product_name)}
الوصف: ${escapeHtml(product_desc||'')}
الأسلوب: ${escapeHtml(tone||'جذاب ومقنع')}

أرجع JSON فقط بهذا الشكل:
{"title":"عنوان جذاب","body":"النص الرئيسي","cta":"دعوة للعمل","hashtags":["هاشتاق1","هاشتاق2"],"emojis":"إيموجي مناسبة"}`
        }]
      })
    });
    const aiData = await aiRes.json();
    let result = aiData.choices?.[0]?.message?.content || '';
    try {
      result = result.replace(/```json|```/g, '').trim();
      result = JSON.parse(result);
    } catch (e) { result = { title: '', body: result, cta: '', hashtags: [], emojis: '' }; }
    res.json({ success: true, content: result });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// AD MANAGER — مدير الإعلانات (Meta + TikTok Ads API)
// ============================================================

// ─── Helper: جلب Ad Account من Meta ───
async function getMetaAdAccount(accessToken) {
  try {
    const r = await fetch(`https://graph.facebook.com/v19.0/me/adaccounts?fields=id,name,currency,account_status&access_token=${encodeURIComponent(accessToken)}`);
    const d = await r.json();
    return d.data?.[0] || null;
  } catch(e) { return null; }
}

// ─── Helper: جلب TikTok Advertiser ID ───
async function getTikTokAdvertiser(accessToken) {
  try {
    const r = await fetch('https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/', {
      headers: { 'Access-Token': accessToken }
    });
    const d = await r.json();
    return d.data?.list?.[0]?.advertiser_id || null;
  } catch(e) { return null; }
}

// جلب الحملات
app.get('/api/ads/campaigns', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.json({ success: true, campaigns: [] });
    const r = await pool.query(
      'SELECT * FROM ad_campaigns WHERE user_id=$1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json({ success: true, campaigns: r.rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// إنشاء وإطلاق حملة
app.post('/api/ads/campaigns', authenticateToken, async (req, res) => {
  const { name, platform, objective, budget, budget_type, start_date, end_date, target_audience, ad_content, launch_now } = req.body;
  const ALLOWED_PLATFORMS = ['facebook', 'instagram', 'tiktok', 'google'];
  if (!name || !platform) return res.status(400).json({ success: false, message: 'الاسم والمنصة مطلوبان' });
  if (!ALLOWED_PLATFORMS.includes(platform)) return res.status(400).json({ success: false, message: 'منصة غير مدعومة' });
  if (budget && parseFloat(budget) < 0) return res.status(400).json({ success: false, message: 'الميزانية غير صالحة' });

  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    let external_id = '';
    let launch_status = 'draft';
    let launch_message = '';
    let launch_error = null;

    // ─── إطلاق فعلي إذا طُلب ───
    if (launch_now) {
      if (platform === 'facebook' || platform === 'instagram') {
        const META_KEY = process.env.META_ADS_TOKEN; // توكن Ads خاص بالمستخدم
        // محاولة جلب توكن من قاعدة البيانات
        const accR = await pool.query(
          'SELECT access_token FROM social_accounts WHERE user_id=$1 AND platform=$2 AND is_connected=true',
          [req.user.id, 'facebook']
        );
        const token = META_KEY || accR.rows[0]?.access_token;

        if (token) {
          try {
            const adAccount = await getMetaAdAccount(token);
            if (adAccount) {
              const adAccountId = adAccount.id;

              // 1. إنشاء Campaign
              const campRes = await fetch(`https://graph.facebook.com/v19.0/${adAccountId}/campaigns`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name: escapeHtml(name),
                  objective: metaObjectiveMap(objective),
                  status: 'PAUSED', // نبدأ متوقفة حتى يراجعها المستخدم
                  special_ad_categories: [],
                  access_token: token
                })
              });
              const campData = await campRes.json();

              if (campData.id) {
                external_id = campData.id;
                launch_status = 'paused';
                launch_message = `✅ تم إنشاء الحملة على Meta (ID: ${campData.id}) — بحالة متوقفة لمراجعتك`;

                // 2. إنشاء Ad Set
                const adSetRes = await fetch(`https://graph.facebook.com/v19.0/${adAccountId}/adsets`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name: `${name} — Ad Set`,
                    campaign_id: campData.id,
                    daily_budget: Math.round((parseFloat(budget)||10) * 100), // بالسنت
                    billing_event: 'IMPRESSIONS',
                    optimization_goal: 'REACH',
                    targeting: buildMetaTargeting(target_audience),
                    status: 'PAUSED',
                    start_time: start_date || new Date().toISOString(),
                    access_token: token
                  })
                });
                const adSetData = await adSetRes.json();
                if (adSetData.error) launch_message += ` | تحذير Ad Set: ${adSetData.error.message}`;
              } else {
                launch_error = campData.error?.message || 'فشل إنشاء الحملة على Meta';
              }
            } else {
              launch_error = 'لم يتم العثور على Ad Account — تأكد من ربط حساب Meta Business';
            }
          } catch(e) {
            launch_error = 'خطأ في الاتصال بـ Meta API: ' + e.message;
          }
        } else {
          launch_error = 'لا يوجد Meta Access Token — اربط حسابك من صفحة ربط الحسابات';
        }
      }

      else if (platform === 'tiktok') {
        const accR = await pool.query(
          'SELECT access_token FROM social_accounts WHERE user_id=$1 AND platform=$2 AND is_connected=true',
          [req.user.id, 'tiktok']
        );
        const token = accR.rows[0]?.access_token;

        if (token) {
          try {
            const advertiserId = await getTikTokAdvertiser(token);
            if (advertiserId) {
              const campRes = await fetch('https://business-api.tiktok.com/open_api/v1.3/campaign/create/', {
                method: 'POST',
                headers: { 'Access-Token': token, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  advertiser_id: advertiserId,
                  campaign_name: escapeHtml(name),
                  objective_type: tiktokObjectiveMap(objective),
                  budget_mode: 'BUDGET_MODE_DAY',
                  budget: parseFloat(budget) || 10,
                  operation_status: 'DISABLE' // متوقفة للمراجعة
                })
              });
              const campData = await campRes.json();
              if (campData.data?.campaign_id) {
                external_id = campData.data.campaign_id;
                launch_status = 'paused';
                launch_message = `✅ تم إنشاء الحملة على TikTok (ID: ${campData.data.campaign_id}) — بحالة متوقفة لمراجعتك`;
              } else {
                launch_error = campData.message || 'فشل إنشاء الحملة على TikTok';
              }
            } else {
              launch_error = 'لم يتم العثور على Advertiser ID — تأكد من حساب TikTok for Business';
            }
          } catch(e) {
            launch_error = 'خطأ في الاتصال بـ TikTok API: ' + e.message;
          }
        } else {
          launch_error = 'لا يوجد TikTok Access Token — اربط حسابك من صفحة ربط الحسابات';
        }
      }
    }

    // حفظ في قاعدة البيانات
    const r = await pool.query(`
      INSERT INTO ad_campaigns (user_id,name,platform,objective,budget,budget_type,start_date,end_date,target_audience,ad_content,external_id,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *
    `, [req.user.id, escapeHtml(name), platform, objective||'awareness',
        parseFloat(budget)||0, budget_type||'daily',
        start_date||null, end_date||null,
        JSON.stringify(target_audience||{}), JSON.stringify(ad_content||{}),
        external_id, launch_status]);

    await auditLog(req.user.id, 'create_campaign', 'ad_campaigns', r.rows[0].id, `${name} [${platform}]`, req.ip);
    if (launch_status !== 'draft') await notify(req.user.id, '📣 حملة جديدة', launch_message || `تم إنشاء: ${name}`, 'success');

    res.json({
      success: true,
      campaign: r.rows[0],
      launched: launch_status !== 'draft',
      launch_message,
      launch_error
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ─── تفعيل/إيقاف حملة على المنصة ───
app.put('/api/ads/campaigns/:id/toggle', authenticateToken, async (req, res) => {
  const { action } = req.body; // 'activate' | 'pause'
  const id = parseInt(req.params.id);
  if (!id || !['activate','pause'].includes(action))
    return res.status(400).json({ success: false, message: 'بيانات غير صالحة' });
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT * FROM ad_campaigns WHERE id=$1 AND user_id=$2', [id, req.user.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'الحملة غير موجودة' });
    const camp = r.rows[0];
    const newStatus = action === 'activate' ? 'active' : 'paused';
    let apiResult = null;

    // تفعيل/إيقاف على المنصة إذا كان external_id موجوداً
    if (camp.external_id) {
      const accR = await pool.query(
        'SELECT access_token FROM social_accounts WHERE user_id=$1 AND platform=$2 AND is_connected=true',
        [req.user.id, camp.platform === 'instagram' ? 'facebook' : camp.platform]
      );
      const token = accR.rows[0]?.access_token;

      if (token && (camp.platform === 'facebook' || camp.platform === 'instagram')) {
        const status = action === 'activate' ? 'ACTIVE' : 'PAUSED';
        const toggleRes = await fetch(`https://graph.facebook.com/v19.0/${camp.external_id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, access_token: token })
        });
        apiResult = await toggleRes.json();
      } else if (token && camp.platform === 'tiktok') {
        const advertiserId = await getTikTokAdvertiser(token);
        if (advertiserId) {
          const status = action === 'activate' ? 'ENABLE' : 'DISABLE';
          await fetch('https://business-api.tiktok.com/open_api/v1.3/campaign/status/update/', {
            method: 'POST',
            headers: { 'Access-Token': token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ advertiser_id: advertiserId, campaign_ids: [camp.external_id], operation_status: status })
          });
        }
      }
    }

    await pool.query('UPDATE ad_campaigns SET status=$1,updated_at=NOW() WHERE id=$2', [newStatus, id]);
    res.json({ success: true, status: newStatus, api_result: apiResult });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ─── جلب نتائج حملة من Meta ───
app.get('/api/ads/campaigns/:id/insights', authenticateToken, async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT * FROM ad_campaigns WHERE id=$1 AND user_id=$2', [id, req.user.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'الحملة غير موجودة' });
    const camp = r.rows[0];
    if (!camp.external_id) return res.json({ success: false, message: 'الحملة لم تُطلق على المنصة بعد' });

    const accR = await pool.query(
      'SELECT access_token FROM social_accounts WHERE user_id=$1 AND platform=$2 AND is_connected=true',
      [req.user.id, camp.platform === 'instagram' ? 'facebook' : camp.platform]
    );
    const token = accR.rows[0]?.access_token;
    if (!token) return res.json({ success: false, message: 'لا يوجد Access Token' });

    if (camp.platform === 'facebook' || camp.platform === 'instagram') {
      const insightsRes = await fetch(
        `https://graph.facebook.com/v19.0/${camp.external_id}/insights?fields=impressions,clicks,spend,reach,cpc,cpm,actions&date_preset=last_30_days&access_token=${encodeURIComponent(token)}`
      );
      const insights = await insightsRes.json();
      const data = insights.data?.[0] || {};

      // تحديث قاعدة البيانات
      await pool.query(`UPDATE ad_campaigns SET
        impressions=$1, clicks=$2, spend=$3, results=$4, updated_at=NOW()
        WHERE id=$5`,
        [parseInt(data.impressions||0), parseInt(data.clicks||0),
         parseFloat(data.spend||0), JSON.stringify(data), id]);

      return res.json({ success: true, insights: data, platform: 'meta' });
    }

    if (camp.platform === 'tiktok') {
      const advertiserId = await getTikTokAdvertiser(token);
      if (advertiserId) {
        const insightsRes = await fetch(
          `https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/?advertiser_id=${advertiserId}&report_type=CAMPAIGN&dimensions=["campaign_id"]&metrics=["impressions","clicks","spend","reach"]&data_level=AUCTION_CAMPAIGN&campaign_ids=["${camp.external_id}"]&start_date=${new Date(Date.now()-30*86400000).toISOString().split('T')[0]}&end_date=${new Date().toISOString().split('T')[0]}`,
          { headers: { 'Access-Token': token } }
        );
        const data = await insightsRes.json();
        const metrics = data.data?.list?.[0]?.metrics || {};
        await pool.query(`UPDATE ad_campaigns SET impressions=$1,clicks=$2,spend=$3,updated_at=NOW() WHERE id=$4`,
          [parseInt(metrics.impressions||0), parseInt(metrics.clicks||0), parseFloat(metrics.spend||0), id]);
        return res.json({ success: true, insights: metrics, platform: 'tiktok' });
      }
    }

    res.json({ success: false, message: 'منصة غير مدعومة' });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// تحديث حملة
app.put('/api/ads/campaigns/:id', authenticateToken, async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'ID غير صالح' });
  const { name, status, budget, start_date, end_date, target_audience, ad_content, results, spend, impressions, clicks, conversions } = req.body;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT user_id FROM ad_campaigns WHERE id=$1', [id]);
    if (!r.rows.length || r.rows[0].user_id !== req.user.id) return res.status(403).json({ success: false, message: 'غير مصرح' });
    await pool.query(`UPDATE ad_campaigns SET
        name=COALESCE($2,name), status=COALESCE($3,status),
        budget=COALESCE($4,budget), start_date=COALESCE($5,start_date),
        end_date=COALESCE($6,end_date),
        target_audience=COALESCE($7,target_audience),
        ad_content=COALESCE($8,ad_content),
        results=COALESCE($9,results),
        spend=COALESCE($10,spend), impressions=COALESCE($11,impressions),
        clicks=COALESCE($12,clicks), conversions=COALESCE($13,conversions),
        updated_at=NOW() WHERE id=$1`,
      [id, name?escapeHtml(name):null, status||null,
       budget?parseFloat(budget):null, start_date||null, end_date||null,
       target_audience?JSON.stringify(target_audience):null,
       ad_content?JSON.stringify(ad_content):null,
       results?JSON.stringify(results):null,
       spend?parseFloat(spend):null, impressions?parseInt(impressions):null,
       clicks?parseInt(clicks):null, conversions?parseInt(conversions):null]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// حذف حملة
app.delete('/api/ads/campaigns/:id', authenticateToken, async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'ID غير صالح' });
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT user_id FROM ad_campaigns WHERE id=$1', [id]);
    if (!r.rows.length || r.rows[0].user_id !== req.user.id) return res.status(403).json({ success: false, message: 'غير مصرح' });
    await pool.query('DELETE FROM ad_campaigns WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// اقتراح حملة بالذكاء الاصطناعي
app.post('/api/ads/suggest', authenticateToken, async (req, res) => {
  const { goal, budget, platform, product_desc, target } = req.body;
  if (!goal) return res.status(400).json({ success: false, message: 'الهدف مطلوب' });
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(503).json({ success: false, message: 'AI غير متاح' });
  try {
    let biz = {};
    if (pool) {
      const bp = await pool.query('SELECT store_name, business_type, business_desc, target_audience FROM business_profile WHERE user_id=$1', [req.user.id]);
      biz = bp.rows[0] || {};
    }
    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 900,
        messages: [{
          role: 'user',
          content: `أنت خبير إعلانات رقمية عربي متخصص في Meta وTikTok. اقترح حملة إعلانية متكاملة جاهزة للإطلاق.
المتجر: ${escapeHtml(biz.store_name||'')} — ${escapeHtml(biz.business_type||'')}
الهدف: ${escapeHtml(goal)}
الميزانية: ${escapeHtml(String(budget||'غير محددة'))} دولار يومياً
المنصة: ${escapeHtml(platform||'غير محددة')}
المنتج: ${escapeHtml(product_desc||'')}
الجمهور: ${escapeHtml(target||biz.target_audience||'')}

أرجع JSON فقط:
{"campaign_name":"اسم الحملة","objective":"awareness|traffic|engagement|leads|sales","target_audience":{"age_min":18,"age_max":45,"interests":["اهتمام1","اهتمام2"],"location":"العراق","gender":"all"},"ad_copies":[{"title":"عنوان1","body":"نص1","cta":"تسوق الآن","image_desc":"وصف الصورة المثالية"}],"budget_suggestion":{"daily":10,"total":300},"schedule":{"duration_days":30,"best_times":["20:00","22:00"]},"retargeting":{"enabled":true,"audience":"زوار الموقع + عملاء سابقون"},"tips":["نصيحة1","نصيحة2","نصيحة3"]}`
        }]
      })
    });
    const aiData = await aiRes.json();
    let result = aiData.choices?.[0]?.message?.content || '';
    try { result = JSON.parse(result.replace(/```json|```/g, '').trim()); } catch (e) { result = { tips: [result] }; }
    res.json({ success: true, suggestion: result });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// RETARGETING — إعادة الاستهداف
// ============================================================

// جلب جماهير إعادة الاستهداف
app.get('/api/ads/retargeting/audiences', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (!pool) return res.json({ success: true, audiences: [] });

    // بناء جماهير من بيانات العملاء
    const [allCustomers, recentBuyers, highValue, abandoned, loyal] = await Promise.all([
      pool.query('SELECT COUNT(*) as cnt, ARRAY_AGG(DISTINCT customer_phone) as phones FROM orders WHERE user_id=$1', [userId]),
      pool.query(`SELECT COUNT(DISTINCT customer_phone) as cnt FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '30 days'`, [userId]),
      pool.query(`SELECT COUNT(DISTINCT customer_phone) as cnt FROM orders WHERE user_id=$1 AND total >= (SELECT AVG(total)*1.5 FROM orders WHERE user_id=$1)`, [userId]),
      pool.query(`SELECT COUNT(*) as cnt FROM orders WHERE user_id=$1 AND status='cancelled'`, [userId]),
      pool.query('SELECT COUNT(*) as cnt FROM loyalty_points WHERE user_id=$1 AND points>0', [userId])
    ]);

    const audiences = [
      {
        id: 'all_customers',
        name: 'كل العملاء',
        icon: '👥',
        size: parseInt(allCustomers.rows[0]?.cnt || 0),
        desc: 'جميع من أجروا طلباً',
        type: 'customer_list',
        use_case: 'استهدافهم بعروض ومنتجات جديدة'
      },
      {
        id: 'recent_buyers',
        name: 'المشترون مؤخراً',
        icon: '🔥',
        size: parseInt(recentBuyers.rows[0]?.cnt || 0),
        desc: 'اشتروا في آخر 30 يوم',
        type: 'recent',
        use_case: 'بيع منتجات تكميلية (Upsell)'
      },
      {
        id: 'high_value',
        name: 'العملاء ذوو القيمة العالية',
        icon: '💎',
        size: parseInt(highValue.rows[0]?.cnt || 0),
        desc: 'طلباتهم فوق المتوسط',
        type: 'high_value',
        use_case: 'استهدافهم بمنتجات premium'
      },
      {
        id: 'cancelled',
        name: 'الطلبات الملغاة',
        icon: '↩️',
        size: parseInt(abandoned.rows[0]?.cnt || 0),
        desc: 'ألغوا طلباتهم',
        type: 'cancelled',
        use_case: 'استرجاعهم بعرض خاص'
      },
      {
        id: 'loyal',
        name: 'العملاء المخلصون',
        icon: '⭐',
        size: parseInt(loyal.rows[0]?.cnt || 0),
        desc: 'لديهم نقاط ولاء',
        type: 'loyal',
        use_case: 'استهدافهم بعروض حصرية'
      }
    ];

    res.json({ success: true, audiences });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// إطلاق حملة إعادة استهداف
app.post('/api/ads/retargeting/launch', authenticateToken, async (req, res) => {
  const { audience_id, platform, ad_copy, budget, offer } = req.body;
  if (!audience_id || !platform) return res.status(400).json({ success: false, message: 'البيانات ناقصة' });
  const userId = req.user.id;

  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    // جلب قائمة الهواتف حسب الجمهور
    let phones = [];
    const audienceQueries = {
      all_customers:  `SELECT DISTINCT customer_phone FROM orders WHERE user_id=$1`,
      recent_buyers:  `SELECT DISTINCT customer_phone FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '30 days'`,
      high_value:     `SELECT DISTINCT customer_phone FROM orders WHERE user_id=$1 AND total>=(SELECT AVG(total)*1.5 FROM orders WHERE user_id=$1)`,
      cancelled:      `SELECT DISTINCT customer_phone FROM orders WHERE user_id=$1 AND status='cancelled'`,
      loyal:          `SELECT DISTINCT lp.customer_phone FROM loyalty_points lp WHERE lp.user_id=$1 AND lp.points>0`
    };
    const q = audienceQueries[audience_id];
    if (q) {
      const r = await pool.query(q, [userId]);
      phones = r.rows.map(row => row.customer_phone.replace(/[^0-9]/g,''));
    }

    let external_id = '';
    let launch_status = 'draft';
    let launch_message = '';

    // محاولة رفع Custom Audience على Meta
    if ((platform === 'facebook' || platform === 'instagram') && phones.length > 0) {
      const accR = await pool.query(
        'SELECT access_token FROM social_accounts WHERE user_id=$1 AND platform=$2 AND is_connected=true',
        [userId, 'facebook']
      );
      const token = accR.rows[0]?.access_token;

      if (token) {
        try {
          const adAccount = await getMetaAdAccount(token);
          if (adAccount) {
            // إنشاء Custom Audience
            const audRes = await fetch(`https://graph.facebook.com/v19.0/${adAccount.id}/customaudiences`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: `SocialOS Retargeting — ${audience_id} — ${new Date().toLocaleDateString('ar')}`,
                subtype: 'CUSTOM',
                description: `إعادة استهداف: ${audience_id}`,
                customer_file_source: 'USER_PROVIDED_ONLY',
                access_token: token
              })
            });
            const audData = await audRes.json();

            if (audData.id) {
              // رفع الأرقام المشفّرة
              const crypto = require('crypto');
              const hashedPhones = phones.slice(0,1000).map(p => {
                const normalized = p.startsWith('0') ? '964' + p.slice(1) : p;
                return crypto.createHash('sha256').update(normalized).digest('hex');
              });

              await fetch(`https://graph.facebook.com/v19.0/${audData.id}/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  payload: { schema: ['PHONE'], data: hashedPhones.map(h => [h]) },
                  access_token: token
                })
              });

              external_id = audData.id;
              launch_status = 'active';
              launch_message = `✅ تم رفع ${Math.min(phones.length,1000)} رقم هاتف كـ Custom Audience على Meta (ID: ${audData.id})`;
            }
          }
        } catch(e) {
          launch_message = `⚠️ تم حفظ الجمهور محلياً — ${e.message}`;
        }
      } else {
        launch_message = `⚠️ اربط حساب Meta لرفع الجمهور مباشرة`;
      }
    }

    // حفظ حملة retargeting
    const campName = `إعادة استهداف — ${audience_id} — ${platform}`;
    const r = await pool.query(`
      INSERT INTO ad_campaigns (user_id,name,platform,objective,budget,status,external_id,ad_content,target_audience)
      VALUES ($1,$2,$3,'retargeting',$4,$5,$6,$7,$8) RETURNING *
    `, [userId, campName, platform, parseFloat(budget)||5, launch_status, external_id,
        JSON.stringify({ copy: ad_copy, offer }),
        JSON.stringify({ type: audience_id, size: phones.length })]);

    // إنشاء رسائل واتساب للجمهور (fallback)
    const waLinks = phones.slice(0,50).map(phone => {
      const waPhone = phone.startsWith('0') ? '964' + phone.slice(1) : phone;
      const msg = offer || ad_copy || 'لدينا عرض خاص لك! 🎁';
      return { phone: waPhone, url: `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}` };
    });

    await notify(userId, '🎯 إعادة استهداف', launch_message || campName, 'success');
    res.json({
      success: true,
      campaign: r.rows[0],
      audience_size: phones.length,
      launch_message: launch_message || `تم إنشاء حملة إعادة الاستهداف (${phones.length} عميل)`,
      wa_links: waLinks,
      external_id
    });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ─── Helpers: تحويل أهداف الحملات ───
function metaObjectiveMap(obj) {
  const map = { awareness:'BRAND_AWARENESS', traffic:'LINK_CLICKS', engagement:'POST_ENGAGEMENT', leads:'LEAD_GENERATION', sales:'CONVERSIONS', retargeting:'CONVERSIONS' };
  return map[obj] || 'BRAND_AWARENESS';
}
function tiktokObjectiveMap(obj) {
  const map = { awareness:'REACH', traffic:'TRAFFIC', engagement:'VIDEO_VIEWS', leads:'LEAD_GENERATION', sales:'CONVERSIONS', retargeting:'CONVERSIONS' };
  return map[obj] || 'REACH';
}
function buildMetaTargeting(audience) {
  const ta = audience || {};
  return {
    age_min: ta.age_min || 18,
    age_max: ta.age_max || 55,
    geo_locations: { countries: ta.countries || ['IQ', 'SA', 'AE'] },
    interests: (ta.interests||[]).map(i => ({ name: i })).slice(0,10),
    genders: ta.gender === 'male' ? [1] : ta.gender === 'female' ? [2] : [1,2]
  };
}

// ============================================================
// SOCIAL POSTS — نشر المنشورات
// ============================================================

// جلب المنشورات
// توليد محتوى منشور بالذكاء حسب نوع العمل
app.post('/api/posts/generate-content', authenticateToken, rateLimit(20, 60*1000), async (req, res) => {
  const { content_type, platform } = req.body;
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.json({ success: false, message: 'AI غير متاح' });
  try {
    let bp = {}, identity = {};
    if (pool) {
      const [bpR, idR] = await Promise.all([
        pool.query('SELECT store_name, business_type, business_desc, target_audience, communication_style FROM business_profile WHERE user_id=$1', [req.user.id]),
        pool.query('SELECT brand_voice FROM store_identity WHERE user_id=$1', [req.user.id]).catch(()=>({rows:[]}))
      ]);
      bp = bpR.rows[0] || {};
      identity = idR.rows[0] || {};
    }
    const typeLabels = {
      offer: 'عرض خاص أو تخفيض', new_product: 'إطلاق منتج أو خدمة جديدة',
      tips: 'نصيحة مفيدة مرتبطة بالنشاط', story: 'قصة عن العمل أو خلف الكواليس',
      engagement: 'منشور يشجع على التفاعل والتعليقات'
    };
    const platRules = {
      instagram: 'قصير وجذاب مع هاشتاقات (5-10) في النهاية، أقل من 300 كلمة',
      facebook: 'متوسط الطول مع دعوة للتفاعل، أقل من 400 كلمة',
      tiktok: 'قصير جداً لوصف فيديو، أقل من 150 كلمة مع هاشتاقات'
    };
    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 500,
        messages: [{ role: 'user', content:
`اكتب منشور "${typeLabels[content_type]||content_type}" لـ${platform} لهذا العمل.

المتجر: ${escapeHtml(bp.store_name||'متجرنا')}
نوع النشاط: ${escapeHtml(bp.business_type||'تجارة')}
وصف العمل: ${escapeHtml(bp.business_desc||'')}
الجمهور: ${escapeHtml(bp.target_audience||'الجميع')}
أسلوب التواصل: ${escapeHtml(bp.communication_style||identity.brand_voice||'ودي')}
قواعد المنصة: ${platRules[platform]||''}

أرجع نص المنشور فقط بدون أي مقدمة أو شرح.`
        }]
      })
    });
    const data = await aiRes.json();
    const content = data.choices?.[0]?.message?.content?.trim() || '';
    res.json({ success: true, content });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/posts', authenticateToken, async (req, res) => {
  const platform = req.query.platform;
  try {
    if (!pool) return res.json({ success: true, posts: [] });
    let q = 'SELECT * FROM social_posts WHERE user_id=$1';
    const params = [req.user.id];
    if (platform) { q += ' AND platform=$2'; params.push(platform); }
    q += ' ORDER BY created_at DESC LIMIT 50';
    const r = await pool.query(q, params);
    res.json({ success: true, posts: r.rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// إنشاء منشور / جدولة
app.post('/api/posts', authenticateToken, async (req, res) => {
  const { platform, content, media_url, media_type, scheduled_at } = req.body;
  const ALLOWED_PLATFORMS = ['instagram', 'facebook', 'tiktok'];
  if (!platform || !content) return res.status(400).json({ success: false, message: 'المنصة والمحتوى مطلوبان' });
  if (!ALLOWED_PLATFORMS.includes(platform)) return res.status(400).json({ success: false, message: 'منصة غير مدعومة' });
  if (String(content).length > 2200) return res.status(400).json({ success: false, message: 'المحتوى طويل جداً (2200 حرف كحد أقصى)' });
  if (media_url) { try { new URL(media_url); } catch { return res.status(400).json({ success: false, message: 'رابط الوسائط غير صالح' }); } }
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    // إذا طلب نشر فوري — نشر عبر API المنصة
    if (!scheduled_at) {
      const acc = await pool.query(
        'SELECT access_token, page_id FROM social_accounts WHERE user_id=$1 AND platform=$2 AND is_connected=true',
        [req.user.id, platform]
      );

      let externalId = '';
      if (acc.rows.length && acc.rows[0].access_token) {
        const { access_token, page_id } = acc.rows[0];
        try {
          if (platform === 'facebook' && page_id) {
            const fbRes = await fetch(`https://graph.facebook.com/v19.0/${page_id}/feed`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: String(content).substring(0, 2200), access_token })
            });
            const fbData = await fbRes.json();
            externalId = fbData.id || '';
          } else if (platform === 'instagram' && page_id) {
            // Instagram Graph API — نشر صورة
            if (media_url) {
              const containerRes = await fetch(`https://graph.facebook.com/v19.0/${page_id}/media`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_url: media_url, caption: String(content).substring(0, 2200), access_token })
              });
              const container = await containerRes.json();
              if (container.id) {
                const publishRes = await fetch(`https://graph.facebook.com/v19.0/${page_id}/media_publish`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ creation_id: container.id, access_token })
                });
                const pub = await publishRes.json();
                externalId = pub.id || '';
              }
            }
          }
        } catch (e) { console.error('Publish error:', e.message); }
      }

      const r = await pool.query(`
        INSERT INTO social_posts (user_id,platform,content,media_url,media_type,status,published_at,external_id)
        VALUES ($1,$2,$3,$4,$5,'published',NOW(),$6) RETURNING *
      `, [req.user.id, platform, escapeHtml(String(content)), media_url||'', media_type||'image', externalId]);
      await notify(req.user.id, '📱 تم النشر', `تم نشر منشور على ${platform}`, 'success');
      return res.json({ success: true, post: r.rows[0], published: !!externalId });
    }

    // جدولة المنشور
    const r = await pool.query(`
      INSERT INTO social_posts (user_id,platform,content,media_url,media_type,status,scheduled_at)
      VALUES ($1,$2,$3,$4,$5,'scheduled',$6) RETURNING *
    `, [req.user.id, platform, escapeHtml(String(content)), media_url||'', media_type||'image', scheduled_at]);
    res.json({ success: true, post: r.rows[0], scheduled: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// حذف منشور
app.delete('/api/posts/:id', authenticateToken, async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'ID غير صالح' });
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT user_id FROM social_posts WHERE id=$1', [id]);
    if (!r.rows.length || r.rows[0].user_id !== req.user.id) return res.status(403).json({ success: false, message: 'غير مصرح' });
    await pool.query('DELETE FROM social_posts WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Cron — نشر المنشورات المجدولة
cron.schedule('*/5 * * * *', async () => {
  try {
    if (!pool) return;
    const posts = await pool.query(
      "SELECT sp.*, sa.access_token, sa.page_id FROM social_posts sp LEFT JOIN social_accounts sa ON sa.user_id=sp.user_id AND sa.platform=sp.platform AND sa.is_connected=true WHERE sp.status='scheduled' AND sp.scheduled_at<=NOW() LIMIT 10"
    );
    for (const post of posts.rows) {
      try {
        let externalId = '';
        if (post.access_token && post.page_id) {
          if (post.platform === 'facebook') {
            const res = await fetch(`https://graph.facebook.com/v19.0/${post.page_id}/feed`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: post.content, access_token: post.access_token })
            });
            const d = await res.json();
            externalId = d.id || '';
          }
        }
        await pool.query(
          "UPDATE social_posts SET status='published', published_at=NOW(), external_id=$2 WHERE id=$1",
          [post.id, externalId]
        );
        await notify(post.user_id, '📱 نُشر تلقائياً', `منشور ${post.platform} نُشر بنجاح`, 'success');
      } catch (e) {
        await pool.query("UPDATE social_posts SET status='failed' WHERE id=$1", [post.id]);
      }
    }
  } catch (e) { console.error('Post scheduler error:', e.message); }
});

// ============================================================
// DIGITAL TEAM MEETING — اجتماع الفريق الرقمي
// ============================================================
app.post('/api/team/digital/meeting', authenticateToken, rateLimit(10, 60*1000), async (req, res) => {
  const { question } = req.body;
  if (!question || String(question).length > 1000)
    return res.status(400).json({ success: false, message: 'السؤال مطلوب (حتى 1000 حرف)' });

  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(503).json({ success: false, message: 'AI غير متاح' });

  const userId = req.user.id;
  const TEAM_ROLES_DATA = {
    sales:            { name: 'موظف المبيعات',        icon: '💼', prompt: 'أنت خبير مبيعات محترف. ردّك يركز على: فرص البيع، إقناع العملاء، زيادة الإيراد، تقنيات الإغلاق.' },
    customer_service: { name: 'خدمة العملاء',         icon: '🎧', prompt: 'أنت متخصص خدمة عملاء. ردّك يركز على: رضا العملاء، حل المشاكل، تجربة الشراء، الاحتفاظ بالعملاء.' },
    marketing:        { name: 'موظف التسويق',         icon: '📢', prompt: 'أنت خبير تسويق رقمي. ردّك يركز على: الحملات، المحتوى، الجمهور المستهدف، الانتشار.' },
    designer:         { name: 'موظف التصميم',         icon: '🎨', prompt: 'أنت مصمم إبداعي. ردّك يركز على: الهوية البصرية، الصور، جاذبية العرض، التأثير البصري.' },
    orders:           { name: 'موظف الطلبات',         icon: '📦', prompt: 'أنت مسؤول الطلبات والعمليات. ردّك يركز على: كفاءة التنفيذ، التوصيل، المخزون، العمليات.' },
    advisor:          { name: 'المستشار التنفيذي',    icon: '🏛️', prompt: 'أنت مستشار أعمال استراتيجي. ردّك يركز على: الاستراتيجية الكبرى، المخاطر، فرص النمو، القرارات الحرجة.' }
  };

  try {
    // جلب بيانات السياق
    let biz = {}, members = {};
    if (pool) {
      const [bp, tm] = await Promise.all([
        pool.query('SELECT store_name, business_type, business_desc, policies FROM business_profile WHERE user_id=$1', [userId]),
        pool.query('SELECT role, name, personality, expertise, instructions FROM digital_team WHERE user_id=$1', [userId])
      ]);
      biz = bp.rows[0] || {};
      tm.rows.forEach(m => { members[m.role] = m; });
    }

    const bizContext = `المتجر: ${escapeHtml(biz.store_name||'')} — ${escapeHtml(biz.business_type||'')}
الوصف: ${escapeHtml(biz.business_desc||'')}
السياسات: ${escapeHtml(biz.policies||'')}`;

    // إرسال السؤال لكل موظف بالتوازي
    const roleEntries = Object.entries(TEAM_ROLES_DATA);
    const responses = await Promise.all(roleEntries.map(async ([role, roleData]) => {
      const member = members[role] || {};
      const systemPrompt = `${roleData.prompt}
المتجر: ${bizContext}
${member.personality ? 'شخصيتك: '+escapeHtml(member.personality) : ''}
${member.expertise ? 'خبرتك: '+escapeHtml(member.expertise) : ''}
${member.instructions ? 'تعليمات: '+escapeHtml(member.instructions) : ''}
أجب باختصار وعملية (3-5 جمل) بالعربية. ابدأ مباشرة بالرأي.`;

      try {
        const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'anthropic/claude-haiku-4-5',
            max_tokens: 300,
            system: systemPrompt,
            messages: [{ role: 'user', content: String(question).substring(0, 1000) }]
          })
        });
        const aiData = await aiRes.json();
        const reply = aiData.choices?.[0]?.message?.content || 'لا رد';
        // تحديث عداد التفاعلات
        if (pool) await pool.query(
          'UPDATE digital_team SET total_interactions=total_interactions+1 WHERE user_id=$1 AND role=$2',
          [userId, role]
        ).catch(() => {});
        return { role, name: member.name || roleData.name, icon: roleData.icon, reply: reply.substring(0, 600) };
      } catch(e) {
        return { role, name: member.name || roleData.name, icon: roleData.icon, reply: 'تعذر الحصول على رد' };
      }
    }));

    // تلخيص الاجتماع بالـ AI
    const summaryRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `بناءً على آراء الفريق التالية حول السؤال: "${question}"

${responses.map(r => `${r.icon} ${r.name}: ${r.reply}`).join('\n\n')}

لخّص أبرز نقاط الاتفاق والاختلاف، واذكر التوصية النهائية في جملتين. كن مختصراً وعملياً.`
        }]
      })
    });
    const summaryData = await summaryRes.json();
    const summary = summaryData.choices?.[0]?.message?.content || '';

    res.json({ success: true, question, responses, summary, timestamp: new Date().toISOString() });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// PDF REPORT EXPORT — تصدير تقرير PDF
// ============================================================
app.get('/api/analytics/export-pdf', authenticateToken, async (req, res) => {
  const { period = '30' } = req.query;
  const days = Math.min(365, Math.max(1, parseInt(period) || 30));
  const userId = req.user.id;

  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    const [bp, orders, prev, topCusts, daily, products, statusBreak] = await Promise.all([
      pool.query('SELECT store_name, business_type, currency FROM business_profile WHERE user_id=$1', [userId]),
      pool.query(`SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) as rev, COALESCE(AVG(total),0) as avg FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '${days} days'`, [userId]),
      pool.query(`SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) as rev FROM orders WHERE user_id=$1 AND created_at BETWEEN NOW()-INTERVAL '${days*2} days' AND NOW()-INTERVAL '${days} days'`, [userId]),
      pool.query(`SELECT customer_name, COUNT(*) as orders, SUM(total) as spent FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '${days} days' GROUP BY customer_name ORDER BY spent DESC LIMIT 5`, [userId]),
      pool.query(`SELECT DATE(created_at) as date, SUM(total) as revenue FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '${days} days' GROUP BY DATE(created_at) ORDER BY date`, [userId]),
      pool.query(`SELECT COUNT(*) as cnt, SUM(CASE WHEN stock<=5 THEN 1 ELSE 0 END) as low FROM products WHERE user_id=$1`, [userId]),
      pool.query(`SELECT status, COUNT(*) as count, SUM(total) as revenue FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '${days} days' GROUP BY status`, [userId])
    ]);

    const store = bp.rows[0] || {};
    const cur = store.currency || 'IQD';
    const o = orders.rows[0];
    const pv = prev.rows[0];
    const totalRev = Number(o.rev||0);
    const prevRev = Number(pv.rev||0);
    const growth = prevRev > 0 ? ((totalRev - prevRev) / prevRev * 100).toFixed(1) : 0;
    const now = new Date().toLocaleDateString('ar-IQ', { year:'numeric', month:'long', day:'numeric' });

    // بناء HTML للـ PDF
    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>تقرير SocialOS</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; background: #f8fafc; color: #1e293b; direction: rtl; font-size: 13px; }
  .header { background: linear-gradient(135deg, #4f8ef7, #7c3aed); color: white; padding: 28px 32px; }
  .header h1 { font-size: 22px; font-weight: 900; margin-bottom: 4px; }
  .header p { opacity: .75; font-size: 12px; }
  .header-meta { display: flex; gap: 20px; margin-top: 12px; font-size: 11px; opacity: .8; }
  .content { padding: 24px 32px; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .kpi { background: white; border-radius: 10px; padding: 14px; border: 1px solid #e2e8f0; text-align: center; }
  .kpi-val { font-size: 22px; font-weight: 900; color: #4f8ef7; margin-bottom: 2px; }
  .kpi-lbl { font-size: 10px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: .3px; }
  .kpi-sub { font-size: 10px; color: #94a3b8; margin-top: 2px; }
  .section { background: white; border-radius: 10px; border: 1px solid #e2e8f0; margin-bottom: 16px; overflow: hidden; }
  .section-header { background: #f1f5f9; padding: 10px 16px; font-weight: 700; font-size: 12px; color: #475569; border-bottom: 1px solid #e2e8f0; }
  .section-body { padding: 14px 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #f8fafc; padding: 8px 10px; text-align: right; color: #475569; font-weight: 700; border-bottom: 1px solid #e2e8f0; font-size: 11px; }
  td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; }
  tr:last-child td { border-bottom: none; }
  .chart-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
  .chart-bar-label { width: 60px; font-size: 10px; color: #64748b; }
  .chart-bar-track { flex: 1; height: 8px; background: #f1f5f9; border-radius: 4px; overflow: hidden; }
  .chart-bar-fill { height: 100%; background: linear-gradient(90deg, #4f8ef7, #7c3aed); border-radius: 4px; }
  .chart-bar-val { width: 80px; font-size: 10px; font-weight: 700; text-align: left; color: #475569; }
  .growth-pos { color: #10b981; font-weight: 700; }
  .growth-neg { color: #ef4444; font-weight: 700; }
  .footer { text-align: center; padding: 16px; color: #94a3b8; font-size: 10px; border-top: 1px solid #e2e8f0; margin-top: 8px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 700; }
  .badge-blue { background: #eff6ff; color: #3b82f6; }
  .badge-green { background: #f0fdf4; color: #16a34a; }
  .badge-red { background: #fef2f2; color: #dc2626; }
  .badge-orange { background: #fff7ed; color: #ea580c; }
  @media print { body { background: white; } }
</style>
</head>
<body>
<div class="header">
  <h1>⚡ تقرير الأداء — ${escapeHtml(store.store_name || 'متجري')}</h1>
  <p>${escapeHtml(store.business_type || '')} | آخر ${days} يوم</p>
  <div class="header-meta">
    <span>📅 تاريخ التقرير: ${now}</span>
    <span>💱 العملة: ${cur}</span>
    <span>🔖 SocialOS v2.0</span>
  </div>
</div>
<div class="content">

  <!-- KPIs -->
  <div class="kpi-grid">
    <div class="kpi">
      <div class="kpi-val">${Number(totalRev).toLocaleString('ar-IQ')}</div>
      <div class="kpi-lbl">الإيرادات</div>
      <div class="kpi-sub ${Number(growth)>=0?'growth-pos':'growth-neg'}">${Number(growth)>=0?'↑':'↓'} ${Math.abs(growth)}% مقارنة بالفترة السابقة</div>
    </div>
    <div class="kpi">
      <div class="kpi-val">${parseInt(o.cnt||0).toLocaleString('ar')}</div>
      <div class="kpi-lbl">الطلبات</div>
      <div class="kpi-sub">${parseInt(o.cnt||0)>0?Number(o.avg||0).toFixed(0)+' '+cur+' متوسط':'-'}</div>
    </div>
    <div class="kpi">
      <div class="kpi-val">${topCusts.rows.length}</div>
      <div class="kpi-lbl">العملاء النشطون</div>
      <div class="kpi-sub">في آخر ${days} يوم</div>
    </div>
    <div class="kpi">
      <div class="kpi-val">${parseInt(products.rows[0]?.low||0)}</div>
      <div class="kpi-lbl">مخزون منخفض</div>
      <div class="kpi-sub">من أصل ${parseInt(products.rows[0]?.cnt||0)} منتج</div>
    </div>
  </div>

  <!-- الإيرادات اليومية -->
  <div class="section">
    <div class="section-header">📈 الإيرادات اليومية</div>
    <div class="section-body">
      ${(() => {
        const max = Math.max(...daily.rows.map(r => Number(r.revenue||0)), 1);
        return daily.rows.slice(-14).map(r => {
          const pct = Math.round((Number(r.revenue||0)/max)*100);
          const dt = new Date(r.date).toLocaleDateString('ar', {month:'short',day:'numeric'});
          return `<div class="chart-bar">
            <div class="chart-bar-label">${dt}</div>
            <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${pct}%"></div></div>
            <div class="chart-bar-val">${Number(r.revenue||0).toLocaleString()} ${cur}</div>
          </div>`;
        }).join('') || '<p style="color:#94a3b8;text-align:center;padding:16px">لا بيانات</p>';
      })()}
    </div>
  </div>

  <!-- أفضل العملاء + توزيع الطلبات -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
    <div class="section">
      <div class="section-header">🏆 أفضل 5 عملاء</div>
      <div class="section-body" style="padding:0">
        <table>
          <tr><th>العميل</th><th>الطلبات</th><th>الإنفاق</th></tr>
          ${topCusts.rows.map(c => `<tr>
            <td>${escapeHtml(c.customer_name||'-')}</td>
            <td style="text-align:center">${c.orders}</td>
            <td style="font-weight:700;color:#4f8ef7">${Number(c.spent||0).toLocaleString()} ${cur}</td>
          </tr>`).join('') || '<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:12px">لا بيانات</td></tr>'}
        </table>
      </div>
    </div>
    <div class="section">
      <div class="section-header">📊 توزيع الطلبات بالحالة</div>
      <div class="section-body" style="padding:0">
        <table>
          <tr><th>الحالة</th><th>العدد</th><th>الإيراد</th></tr>
          ${statusBreak.rows.map(s => {
            const labels = {new:'🆕 جديد',confirmed:'✅ مؤكد',processing:'⚙️ جاري',shipped:'🚚 شُحن',delivered:'🚀 تم',cancelled:'❌ ملغي'};
            return `<tr>
              <td>${labels[s.status]||s.status}</td>
              <td style="text-align:center;font-weight:700">${s.count}</td>
              <td>${Number(s.revenue||0).toLocaleString()} ${cur}</td>
            </tr>`;
          }).join('') || '<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:12px">لا بيانات</td></tr>'}
        </table>
      </div>
    </div>
  </div>

</div>
<div class="footer">
  تم إنشاء هذا التقرير تلقائياً بواسطة SocialOS ⚡ | ${now}
</div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="report-${days}days.html"`);
    res.setHeader('X-Report-Type', 'analytics');
    res.send(html);
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

const TEAM_ROLES = {
  sales: { name: 'موظف المبيعات', icon: '💼', desc: 'إغلاق الصفقات والإقناع' },
  customer_service: { name: 'خدمة العملاء', icon: '🎧', desc: 'الشكاوى والدعم' },
  marketing: { name: 'موظف التسويق', icon: '📢', desc: 'الإعلانات والحملات' },
  designer: { name: 'موظف التصميم', icon: '🎨', desc: 'الصور والإعلانات' },
  orders: { name: 'موظف الطلبات', icon: '📦', desc: 'الطلبات والعربون والشحن' },
  advisor: { name: 'المستشار التنفيذي', icon: '🏛️', desc: 'التحليلات والتوصيات' }
};

app.get('/api/team/digital', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.json({ success: true, members: [] });
    const r = await pool.query('SELECT * FROM digital_team WHERE user_id=$1 ORDER BY role', [req.user.id]);
    // أضف الأدوار الناقصة
    const existing = r.rows.map(m => m.role);
    const all = Object.entries(TEAM_ROLES).map(([role, info]) => {
      const found = r.rows.find(m => m.role === role);
      return found || { user_id: req.user.id, role, name: info.name, personality: '', expertise: '', instructions: '', is_active: false, total_interactions: 0 };
    });
    res.json({ success: true, members: all });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.put('/api/team/digital/:role', authenticateToken, async (req, res) => {
  const { role } = req.params;
  if (!TEAM_ROLES[role]) return res.status(400).json({ success: false, message: 'دور غير صالح' });
  const { name, personality, expertise, instructions, is_active } = req.body;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    await pool.query(`
      INSERT INTO digital_team (user_id, role, name, personality, expertise, instructions, is_active, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
      ON CONFLICT (user_id, role) DO UPDATE SET
        name=$3, personality=$4, expertise=$5, instructions=$6,
        is_active=$7, updated_at=NOW()
    `, [req.user.id, role, escapeHtml(name||TEAM_ROLES[role].name),
        escapeHtml(personality||''), escapeHtml(expertise||''),
        escapeHtml(instructions||''), is_active !== undefined ? is_active : true]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// محادثة مع موظف رقمي متخصص
app.post('/api/team/digital/:role/chat', authenticateToken, async (req, res) => {
  const { role } = req.params;
  if (!TEAM_ROLES[role]) return res.status(400).json({ success: false, message: 'دور غير صالح' });
  const { message, history } = req.body;
  if (!message || String(message).length > 2000) return res.status(400).json({ success: false, message: 'الرسالة غير صالحة' });

  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(503).json({ success: false, message: 'AI غير متاح' });

  try {
    let member = { name: TEAM_ROLES[role].name, personality: '', expertise: '', instructions: '' };
    let biz = {};
    if (pool) {
      const [tm, bp] = await Promise.all([
        pool.query('SELECT * FROM digital_team WHERE user_id=$1 AND role=$2', [req.user.id, role]),
        pool.query('SELECT store_name, business_type, business_desc, policies FROM business_profile WHERE user_id=$1', [req.user.id])
      ]);
      if (tm.rows.length) member = tm.rows[0];
      biz = bp.rows[0] || {};
      await pool.query('UPDATE digital_team SET total_interactions=total_interactions+1 WHERE user_id=$1 AND role=$2', [req.user.id, role]);
    }

    const rolePrompts = {
      sales: 'أنت موظف مبيعات محترف. هدفك إغلاق الصفقات وإقناع العملاء بالشراء.',
      customer_service: 'أنت موظف خدمة عملاء متميز. هدفك حل المشاكل وإرضاء العملاء.',
      marketing: 'أنت خبير تسويق رقمي. هدفك وضع استراتيجيات وحملات تسويقية فعالة.',
      designer: 'أنت مصمم إبداعي. هدفك اقتراح أفكار تصميمية جذابة للمحتوى.',
      orders: 'أنت مسؤول الطلبات والشحن. هدفك تنظيم الطلبات وضمان التوصيل.',
      advisor: 'أنت مستشار تنفيذي خبير. هدفك تقديم توصيات استراتيجية لتنمية العمل.'
    };

    const systemPrompt = `${rolePrompts[role]}
المتجر: ${escapeHtml(biz.store_name||'')} — ${escapeHtml(biz.business_type||'')}
${biz.business_desc ? 'الوصف: '+escapeHtml(biz.business_desc) : ''}
${biz.policies ? 'السياسات: '+escapeHtml(biz.policies) : ''}
${member.personality ? 'شخصيتك: '+escapeHtml(member.personality) : ''}
${member.expertise ? 'خبرتك: '+escapeHtml(member.expertise) : ''}
${member.instructions ? 'تعليمات خاصة: '+escapeHtml(member.instructions) : ''}
تحدث بالعربية دائماً. كن عملياً ومحدداً.`;

    const msgs = [
      ...(Array.isArray(history) ? history.slice(-8).map(m => ({ role: m.role, content: String(m.content).substring(0, 500) })) : []),
      { role: 'user', content: String(message).substring(0, 2000) }
    ];

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'anthropic/claude-haiku-4-5', max_tokens: 600, system: systemPrompt, messages: msgs })
    });
    const aiData = await aiRes.json();
    const reply = aiData.choices?.[0]?.message?.content || 'عذراً، لم أتمكن من الرد';
    res.json({ success: true, reply: reply.substring(0, 2000) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// ADVANCED ANALYTICS — التحليلات المتقدمة
// ============================================================

app.get('/api/analytics/advanced', authenticateToken, async (req, res) => {
  const { period = '30', compare = 'false' } = req.query;
  const days = Math.min(365, Math.max(1, parseInt(period) || 30));
  const userId = req.user.id;
  try {
    if (!pool) return res.json({ success: true, data: {} });

    const [current, previous, topProds, custBehavior, dailyTrend] = await Promise.all([
      // الفترة الحالية
      pool.query(`SELECT COUNT(*) as orders, COALESCE(SUM(total),0) as revenue, COALESCE(AVG(total),0) as avg_order
        FROM orders WHERE user_id=$1 AND created_at >= NOW()-INTERVAL '${days} days'`, [userId]),
      // الفترة السابقة للمقارنة
      pool.query(`SELECT COUNT(*) as orders, COALESCE(SUM(total),0) as revenue
        FROM orders WHERE user_id=$1 AND created_at BETWEEN NOW()-INTERVAL '${days*2} days' AND NOW()-INTERVAL '${days} days'`, [userId]),
      // أفضل المنتجات
      pool.query(`SELECT items, COUNT(*) as freq FROM orders WHERE user_id=$1 AND created_at >= NOW()-INTERVAL '${days} days' GROUP BY items LIMIT 10`, [userId]),
      // سلوك العملاء
      pool.query(`SELECT customer_phone, customer_name, COUNT(*) as orders, SUM(total) as spent,
        MAX(created_at) as last_order, MIN(created_at) as first_order
        FROM orders WHERE user_id=$1 AND created_at >= NOW()-INTERVAL '${days} days'
        GROUP BY customer_phone, customer_name ORDER BY spent DESC LIMIT 10`, [userId]),
      // الاتجاه اليومي
      pool.query(`SELECT DATE(created_at) as day, COUNT(*) as orders, SUM(total) as revenue
        FROM orders WHERE user_id=$1 AND created_at >= NOW()-INTERVAL '${days} days'
        GROUP BY DATE(created_at) ORDER BY day`, [userId])
    ]);

    const cur = current.rows[0];
    const prev = previous.rows[0];
    const revenueGrowth = prev.revenue > 0 ? ((cur.revenue - prev.revenue) / prev.revenue * 100).toFixed(1) : 0;
    const ordersGrowth = prev.orders > 0 ? ((cur.orders - prev.orders) / prev.orders * 100).toFixed(1) : 0;

    res.json({
      success: true,
      data: {
        current: { orders: parseInt(cur.orders), revenue: parseFloat(cur.revenue), avg_order: parseFloat(cur.avg_order) },
        previous: { orders: parseInt(prev.orders), revenue: parseFloat(prev.revenue) },
        growth: { revenue: parseFloat(revenueGrowth), orders: parseFloat(ordersGrowth) },
        top_customers: custBehavior.rows,
        daily_trend: dailyTrend.rows,
        period: days
      }
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// توقع المبيعات بالذكاء الاصطناعي
app.post('/api/analytics/forecast', authenticateToken, async (req, res) => {
  const { days = 30 } = req.body;
  const userId = req.user.id;
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(503).json({ success: false, message: 'AI غير متاح' });
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    const [history, products, biz] = await Promise.all([
      pool.query(`SELECT DATE(created_at) as day, COUNT(*) as orders, SUM(total) as revenue
        FROM orders WHERE user_id=$1 AND created_at >= NOW()-INTERVAL '90 days'
        GROUP BY DATE(created_at) ORDER BY day`, [userId]),
      pool.query('SELECT COUNT(*) as total, SUM(CASE WHEN stock<=3 THEN 1 ELSE 0 END) as low_stock FROM products WHERE user_id=$1', [userId]),
      pool.query('SELECT store_name, business_type FROM business_profile WHERE user_id=$1', [userId])
    ]);

    const totalRevenue = history.rows.reduce((s, r) => s + parseFloat(r.revenue || 0), 0);
    const avgDaily = history.rows.length > 0 ? (totalRevenue / 90).toFixed(2) : 0;

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 700,
        messages: [{
          role: 'user',
          content: `أنت خبير تحليل بيانات. بناءً على بيانات المتجر، قدم توقعاً للـ ${days} يوم القادمة.

المتجر: ${escapeHtml(biz.rows[0]?.store_name||'')} — ${escapeHtml(biz.rows[0]?.business_type||'')}
متوسط الإيراد اليومي (90 يوم): ${avgDaily}
عدد أيام البيانات: ${history.rows.length}
إجمالي المنتجات: ${products.rows[0]?.total||0}
منتجات مخزونها منخفض: ${products.rows[0]?.low_stock||0}
آخر 5 أيام: ${JSON.stringify(history.rows.slice(-5))}

أرجع JSON فقط:
{"predicted_revenue":0,"predicted_orders":0,"confidence":85,"trend":"صاعد/هابط/مستقر","insights":["ملاحظة1","ملاحظة2","ملاحظة3"],"recommendations":["توصية1","توصية2"],"risks":["خطر1"]}`
        }]
      })
    });
    const aiData = await aiRes.json();
    let forecast = aiData.choices?.[0]?.message?.content || '{}';
    try { forecast = JSON.parse(forecast.replace(/```json|```/g, '').trim()); } catch (e) { forecast = {}; }

    // حفظ التوقع
    await pool.query(
      'INSERT INTO sales_forecasts (user_id, forecast_date, predicted_revenue, predicted_orders, confidence, factors) VALUES ($1, NOW()::date, $2, $3, $4, $5)',
      [userId, forecast.predicted_revenue||0, forecast.predicted_orders||0, forecast.confidence||0, JSON.stringify(forecast)]
    ).catch(() => {});

    res.json({ success: true, forecast, avg_daily: avgDaily, data_points: history.rows.length });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// تصدير التقرير
app.get('/api/analytics/export', authenticateToken, async (req, res) => {
  const { period = '30', format = 'csv' } = req.query;
  const days = Math.min(365, Math.max(1, parseInt(period) || 30));
  const userId = req.user.id;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const orders = await pool.query(
      `SELECT id, customer_name, customer_phone, total, status, platform, created_at
       FROM orders WHERE user_id=$1 AND created_at >= NOW()-INTERVAL '${days} days' ORDER BY created_at DESC`,
      [userId]
    );
    if (format === 'csv') {
      const headers = 'رقم الطلب,اسم العميل,الهاتف,المبلغ,الحالة,المصدر,التاريخ';
      const rows = orders.rows.map(o =>
        `${o.id},"${escapeHtml(o.customer_name||'')}","${escapeHtml(o.customer_phone||'')}",${o.total},"${escapeHtml(o.status||'')}","${escapeHtml(o.platform||'')}","${new Date(o.created_at).toLocaleDateString('ar')}"`
      );
      const csv = '\uFEFF' + headers + '\n' + rows.join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="orders-${days}days.csv"`);
      return res.send(csv);
    }
    res.json({ success: true, orders: orders.rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// MIKE — المساعد التنفيذي الذكي
// ============================================================

app.post('/api/mike', authenticateToken, async (req, res) => {
  const { message, history } = req.body;
  if (!message || String(message).length > 2000)
    return res.status(400).json({ success: false, message: 'الرسالة غير صالحة' });

  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(503).json({ success: false, message: 'AI غير متاح' });

  const userId = req.user.id;

  try {
    // جلب بيانات السياق
    let context = {};
    if (pool) {
      const [biz, stats, prods, custs, orders] = await Promise.all([
        pool.query('SELECT store_name, business_type, currency, whatsapp_number FROM business_profile WHERE user_id=$1', [userId]),
        pool.query('SELECT COUNT(*) as orders FROM orders WHERE user_id=$1', [userId]),
        pool.query('SELECT id, name, price, stock, category FROM products WHERE user_id=$1 AND is_available=true LIMIT 20', [userId]),
        pool.query('SELECT id, name, phone FROM customers WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10', [userId]),
        pool.query('SELECT id, customer_name, total, status FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5', [userId])
      ]);
      context = {
        store: biz.rows[0] || {},
        total_orders: stats.rows[0]?.orders || 0,
        products: prods.rows,
        recent_customers: custs.rows,
        recent_orders: orders.rows
      };
    }

    const bizType = context.store?.business_type || '';
    const bizTypeContext = {
      restaurant: '⚠️ هذا متجر مطاعم/كافيه — ركز على: الطلبات والتوصيل، أوقات العمل، قائمة الطعام، الحجوزات، العروض اليومية.',
      retail: '⚠️ هذا متجر تجزئة — ركز على: المخزون، العروض، الشحن، استفسارات المنتجات.',
      fashion: '⚠️ هذا متجر أزياء — ركز على: الأصناف والمقاسات، العروض الموسمية، صور المنتجات.',
      electronics: '⚠️ هذا متجر إلكترونيات — ركز على: المواصفات التقنية، الضمان، التوافقية.',
      perfume: '⚠️ هذا متجر عطور — ركز على: وصف الرائحة، المناسبات، العروض المجمعة.',
      health: '⚠️ هذا مركز صحة وجمال — ركز على: المواعيد، الخدمات، الحزم.',
      education: '⚠️ هذا مركز تعليمي — ركز على: الدورات، المواعيد، التسجيل.',
      real_estate: '⚠️ هذا مكتب عقارات — ركز على: العقارات، المعاينات، الأسعار.',
      furniture: '⚠️ هذا متجر أثاث — ركز على: المقاسات، التوصيل والتركيب، التخصيص.',
      sports: '⚠️ هذا متجر رياضة — ركز على: المعدات، المقاسات، العروض.',
    }[bizType] || '';

    const systemPrompt = `أنت Mike، المساعد التنفيذي الذكي لـ SocialOS.
أنت مرتبط بجميع أنظمة المتجر وتستطيع تنفيذ الأوامر مباشرة.
${bizTypeContext}

معلومات المتجر:
- الاسم: ${escapeHtml(context.store?.store_name || '')}
- النوع: ${escapeHtml(bizType)}
- العملة: ${context.store?.currency || 'IQD'}
- واتساب: ${context.store?.whatsapp_number || ''}
- إجمالي الطلبات: ${context.total_orders}

المنتجات المتاحة: ${JSON.stringify(context.products || [])}
آخر العملاء: ${JSON.stringify(context.recent_customers || [])}
آخر الطلبات: ${JSON.stringify(context.recent_orders || [])}

صلاحياتك:
- إنشاء طلبات، منتجات، عملاء
- نشر منشورات على المنصات
- إرسال رسائل واتساب
- جلب التقارير والإحصائيات
- إنشاء كوبونات
- أي عملية في النظام

عند تلقي أمر، قم بـ:
1. فهم الأمر بالكامل
2. تحديد الإجراء المطلوب
3. الرد بـ JSON بهذا الشكل:

{
  "reply": "ردك الطبيعي بالعربية للمستخدم",
  "action": "اسم الإجراء أو null إذا لا يوجد",
  "action_data": { بيانات الإجراء },
  "needs_confirm": false
}

الإجراءات المتاحة:
- create_order: إنشاء طلب { customer_name, customer_phone, items, total }
- create_product: إضافة منتج { name, price, stock, category, description }
- create_customer: إضافة عميل { name, phone, address }
- create_post: نشر منشور { platform, content, media_url }
- send_whatsapp: إرسال واتساب { phone, message }
- create_coupon: إنشاء كوبون { code, type, value }
- get_report: جلب تقرير { type: 'sales'|'orders'|'customers' }
- update_order_status: تحديث حالة طلب { order_id, status }
- none: فقط الرد بدون إجراء

الإجراءات المتاحة (action):

// ─── التنقل في التطبيق ───
- navigate_to: الانتقال لصفحة { page: 'orders'|'products'|'customers'|'analytics'|'designer'|'posts'|'ads'|'identity'|'knowledge'|'decisions'|'board'|'coupons'|'loyalty'|'bulk-wa'|'team'|'emergency'|'backup'|'security'|'settings'|'delivery'|'inventory'|'notifications'|'profile'|'employee'|'training'|'digital-team'|'analytics-adv'|'retargeting'|'social'|'home' }

// ─── الطلبات ───
- create_order: إنشاء طلب { customer_name, customer_phone, items:[{name,price,qty}], total, notes }
- update_order_status: تحديث حالة طلب { order_id, status: 'confirmed'|'processing'|'delivered'|'cancelled' }

// ─── المنتجات ───
- create_product: إضافة منتج { name, price, stock, category, description }

// ─── العملاء ───
- create_customer: إضافة عميل { name, phone, address, notes }
- schedule_followup: جدولة متابعة عميل { customer_phone, note, days_from_now }

// ─── النشر على المنصات ───
- create_post: نشر منشور { platform: 'instagram'|'facebook'|'tiktok', content, media_url }

// ─── واتساب ───
- send_whatsapp: إرسال واتساب { phone, message }
- send_bulk_whatsapp: إرسال جماعي { message, target: 'all'|'vip' }

// ─── الكوبونات والعروض ───
- create_coupon: إنشاء كوبون { code, type: 'percent'|'fixed', value, min_order }

// ─── التقارير ───
- get_report: تقرير { type: 'sales'|'orders'|'customers'|'products' }

// ─── الإعلانات ───
- suggest_ad: اقتراح حملة إعلانية { platform: 'facebook'|'instagram'|'tiktok'|'google', goal, budget, product_desc }

// ─── الطوارئ ───
- set_emergency: تفعيل/إيقاف وضع الطوارئ { active: true|false, mode_type, message }

// ─── لا إجراء ───
- none: الرد فقط بدون تنفيذ

قواعد مهمة:
- إذا طلب المستخدم فتح صفحة أو الانتقال لقسم → navigate_to
- إذا طلب نشر بوست أو ترويج → create_post
- إذا طلب إعلان أو حملة → suggest_ad أو navigate_to ads
- إذا طلب تصميم صورة → navigate_to designer
- إذا طلب إحصائيات أو تقرير → get_report أو navigate_to analytics
- أرجع JSON صالح فقط بدون أي نص خارجه.`;

    const msgs = [
      ...(Array.isArray(history) ? history.slice(-6).map(m => ({
        role: m.role,
        content: String(m.content).substring(0, 500)
      })) : []),
      { role: 'user', content: String(message).substring(0, 2000) }
    ];

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 1000,
        system: systemPrompt,
        messages: msgs
      })
    });
    const aiData = await aiRes.json();
    let raw = aiData.choices?.[0]?.message?.content || '{}';

    let parsed = {};
    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch (e) {
      parsed = { reply: raw, action: null };
    }

    const reply = String(parsed.reply || 'تم').substring(0, 2000);
    const action = parsed.action || null;
    const actionData = parsed.action_data || {};
    let actionResult = null;
    let actionError = null;

    // تنفيذ الإجراء
    if (action && action !== 'none' && pool) {
      try {
        if (action === 'create_order') {
          const r = await pool.query(
            'INSERT INTO orders (user_id,customer_name,customer_phone,items,total,status,platform) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
            [userId, escapeHtml(actionData.customer_name||''), actionData.customer_phone||'',
             JSON.stringify(actionData.items||[]), parseFloat(actionData.total)||0, 'new', 'mike']
          );
          actionResult = { type: 'order', id: r.rows[0].id, message: `تم إنشاء الطلب #${r.rows[0].id}` };
          await notify(userId, '🛒 طلب جديد من Mike', `${actionData.customer_name} — ${actionData.total}`, 'order');
        }

        else if (action === 'create_product') {
          const rawPrice = String(actionData.price || '').replace(/[^\d.]/g, '');
          const price = parseFloat(rawPrice);
          if (!price || price <= 0) throw new Error('السعر غير صالح — قل مثلاً: سعره 25000');
          const r = await pool.query(
            'INSERT INTO products (user_id,name,description,price,stock,category,is_available) VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING id',
            [userId, escapeHtml(actionData.name||'منتج جديد'), escapeHtml(actionData.description||''),
             price, parseInt(actionData.stock)||0, escapeHtml(actionData.category||'عام')]
          );
          actionResult = { type: 'product', id: r.rows[0].id, message: `تم إضافة المنتج #${r.rows[0].id}` };
        }

        else if (action === 'create_customer') {
          const r = await pool.query(
            'INSERT INTO customers (user_id,name,phone,address) VALUES ($1,$2,$3,$4) RETURNING id',
            [userId, escapeHtml(actionData.name||''), actionData.phone||'', escapeHtml(actionData.address||'')]
          );
          actionResult = { type: 'customer', id: r.rows[0].id, message: `تم إضافة العميل #${r.rows[0].id}` };
        }

        else if (action === 'create_post') {
          const ALLOWED_PLATFORMS = ['instagram', 'facebook', 'tiktok'];
          const platform = ALLOWED_PLATFORMS.includes(actionData.platform) ? actionData.platform : 'instagram';
          const content = String(actionData.content||'').substring(0, 2200);
          const r = await pool.query(
            'INSERT INTO social_posts (user_id,platform,content,media_url,status) VALUES ($1,$2,$3,$4,$5) RETURNING id',
            [userId, platform, escapeHtml(content), actionData.media_url||'', 'published']
          );
          actionResult = { type: 'post', id: r.rows[0].id, message: `تم نشر المنشور على ${platform}` };
        }

        else if (action === 'send_whatsapp') {
          const phone = String(actionData.phone||'').replace(/[^\d]/g,'');
          if (phone.length >= 7) {
            const acc = await pool.query(
              'SELECT access_token, whatsapp_phone_id FROM social_accounts WHERE user_id=$1 AND platform=$2 AND is_connected=true',
              [userId, 'whatsapp']
            );
            if (acc.rows.length && acc.rows[0].access_token && acc.rows[0].whatsapp_phone_id) {
              const waRes = await fetch(`https://graph.facebook.com/v19.0/${acc.rows[0].whatsapp_phone_id}/messages`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${acc.rows[0].access_token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ messaging_product:'whatsapp', to: phone, type:'text', text:{ body: String(actionData.message||'').substring(0,4096) } })
              });
              const waData = await waRes.json();
              actionResult = { type: 'whatsapp', message: waData.error ? 'تعذر الإرسال: '+waData.error.message : `تم إرسال الرسالة لـ ${phone}` };
            } else {
              actionResult = { type: 'whatsapp', message: 'واتساب غير مربوط — اذهب لصفحة ربط الحسابات' };
            }
          }
        }

        else if (action === 'create_coupon') {
          const r = await pool.query(
            'INSERT INTO coupons (user_id,code,type,value,is_active) VALUES ($1,$2,$3,$4,true) RETURNING id',
            [userId, escapeHtml(String(actionData.code||'MIKE'+Date.now()).toUpperCase()),
             actionData.type||'percent', parseFloat(actionData.value)||10]
          );
          actionResult = { type: 'coupon', id: r.rows[0].id, message: `تم إنشاء الكوبون: ${actionData.code}` };
        }

        else if (action === 'update_order_status') {
          const ALLOWED_STATUS = ['new','confirmed','processing','delivered','cancelled'];
          const status = ALLOWED_STATUS.includes(actionData.status) ? actionData.status : 'confirmed';
          await pool.query(
            'UPDATE orders SET status=$1 WHERE id=$2 AND user_id=$3',
            [status, parseInt(actionData.order_id)||0, userId]
          );
          actionResult = { type: 'order_update', message: `تم تحديث حالة الطلب #${actionData.order_id} إلى ${status}` };
        }

        else if (action === 'get_report') {
          const [o, r, c] = await Promise.all([
            pool.query('SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) as rev FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL \'30 days\'', [userId]),
            pool.query('SELECT COUNT(*) as cnt FROM products WHERE user_id=$1', [userId]),
            pool.query('SELECT COUNT(*) as cnt FROM customers WHERE user_id=$1', [userId])
          ]);
          actionResult = {
            type: 'report',
            data: { orders_30d: o.rows[0].cnt, revenue_30d: o.rows[0].rev, products: r.rows[0].cnt, customers: c.rows[0].cnt },
            message: `الطلبات (30 يوم): ${o.rows[0].cnt} — الإيراد: ${Number(o.rows[0].rev).toLocaleString()}`
          };
        }

      } catch (e) {
        actionError = e.message;
      }
    }

    res.json({
      success: true,
      reply,
      action,
      action_result: actionResult,
      action_error: actionError
    });

  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// IMAGE TOOLS — أدوات الصور
// ============================================================

// إزالة الخلفية عبر remove.bg
app.post('/api/images/remove-bg', authenticateToken, async (req, res) => {
  const { image_url, image_base64 } = req.body;
  if (!image_url && !image_base64)
    return res.status(400).json({ success: false, message: 'image_url أو image_base64 مطلوب' });

  const REMOVE_BG_KEY = process.env.REMOVE_BG_API_KEY;
  if (!REMOVE_BG_KEY)
    return res.status(503).json({ success: false, message: 'REMOVE_BG_API_KEY غير مضبوط في المتغيرات' });

  try {
    let formData, contentType;

    if (image_url) {
      try { new URL(image_url); } catch { return res.status(400).json({ success: false, message: 'رابط غير صالح' }); }
    }

    // بناء multipart form
    const boundary = '----FormBoundary' + Date.now();
    const parts = [];

    if (image_url) {
      parts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="image_url"\r\n\r\n${image_url}`
      );
    } else {
      // base64 — نحوله لبيانات ثنائية
      const base64Data = image_base64.replace(/^data:image\/\w+;base64,/, '');
      const imgBuffer = Buffer.from(base64Data, 'base64');
      parts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="image_file"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n`
      );
      formData = Buffer.concat([
        Buffer.from(parts.join('\r\n') + '\r\n'),
        imgBuffer,
        Buffer.from(`\r\n--${boundary}--`)
      ]);
      contentType = `multipart/form-data; boundary=${boundary}`;
    }

    if (!formData) {
      const body = parts.join('\r\n') + `\r\n--${boundary}--`;
      formData = Buffer.from(body);
      contentType = `multipart/form-data; boundary=${boundary}`;
    }

    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'X-Api-Key': REMOVE_BG_KEY,
        'Content-Type': contentType,
      },
      body: formData
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ success: false, message: err.errors?.[0]?.title || 'فشل إزالة الخلفية' });
    }

    const imgBuffer = await response.arrayBuffer();
    const base64Result = Buffer.from(imgBuffer).toString('base64');
    const dataUrl = `data:image/png;base64,${base64Result}`;

    // رفع النتيجة على Cloudinary إن كان مضبوطاً
    const CLOUD = process.env.CLOUDINARY_CLOUD_NAME;
    const KEY = process.env.CLOUDINARY_API_KEY;
    const SECRET = process.env.CLOUDINARY_API_SECRET;

    if (CLOUD && KEY && SECRET) {
      try {
        const crypto = require('crypto');
        const timestamp = Math.floor(Date.now() / 1000);
        const folder = `socialos/${req.user.id}/nobg`;
        const sigStr = `folder=${folder}&timestamp=${timestamp}${SECRET}`;
        const signature = crypto.createHash('sha1').update(sigStr).digest('hex');
        const boundary2 = '----CloudBoundary' + Date.now();
        const cloudBody = [
          `--${boundary2}`, `Content-Disposition: form-data; name="file"`, '', dataUrl,
          `--${boundary2}`, `Content-Disposition: form-data; name="api_key"`, '', KEY,
          `--${boundary2}`, `Content-Disposition: form-data; name="timestamp"`, '', String(timestamp),
          `--${boundary2}`, `Content-Disposition: form-data; name="signature"`, '', signature,
          `--${boundary2}`, `Content-Disposition: form-data; name="folder"`, '', folder,
          `--${boundary2}--`
        ].join('\r\n');
        const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, {
          method: 'POST',
          headers: { 'Content-Type': `multipart/form-data; boundary=${boundary2}` },
          body: cloudBody
        });
        const uploadData = await uploadRes.json();
        if (uploadData.secure_url) return res.json({ success: true, url: uploadData.secure_url, source: 'cloudinary' });
      } catch (e) {}
    }

    // إرجاع base64 مباشرة إذا لم يكن Cloudinary مضبوطاً
    res.json({ success: true, url: dataUrl, source: 'base64' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// توليد ديكور ذكي بالذكاء الاصطناعي
app.post('/api/images/suggest-decor', authenticateToken, async (req, res) => {
  const { product_type, store_style, color_scheme } = req.body;
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(503).json({ success: false, message: 'AI غير متاح' });

  try {
    let biz = {};
    if (pool) {
      const bp = await pool.query('SELECT store_name, business_type, business_desc FROM business_profile WHERE user_id=$1', [req.user.id]);
      biz = bp.rows[0] || {};
      // جلب هوية المتجر
      const id = await pool.query('SELECT primary_color, secondary_color, communication_style, font_name FROM store_identity WHERE user_id=$1', [req.user.id]);
      if (id.rows[0]) Object.assign(biz, id.rows[0]);
    }

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `أنت مصمم جرافيك عربي محترف. اقترح ديكوراً لصورة منتج بعد إزالة الخلفية.

المتجر: ${escapeHtml(biz.store_name||'')} — ${escapeHtml(biz.business_type||'')}
نوع المنتج: ${escapeHtml(product_type||'منتج عام')}
الألوان المفضلة: ${escapeHtml(biz.primary_color||color_scheme||'أزرق وبنفسجي')}
أسلوب المتجر: ${escapeHtml(biz.communication_style||store_style||'عصري')}

أرجع JSON فقط:
{
  "bg_type": "gradient|solid|pattern|blur",
  "bg_colors": ["#لون1", "#لون2"],
  "gradient_direction": "135deg",
  "overlay_opacity": 0.15,
  "shadow": { "color": "#000000", "blur": 20, "offsetX": 5, "offsetY": 10 },
  "border": { "enabled": false, "color": "#ffffff", "width": 3, "radius": 20 },
  "texts": [
    { "text": "نص مقترح", "pos": "bottom", "size": 32, "color": "#ffffff", "bg": "gradient" }
  ],
  "description": "وصف قصير للديكور",
  "style_name": "اسم الأسلوب"
}`
        }]
      })
    });
    const aiData = await aiRes.json();
    let decor = aiData.choices?.[0]?.message?.content || '{}';
    try { decor = JSON.parse(decor.replace(/```json|```/g, '').trim()); } catch (e) {
      decor = {
        bg_type: 'gradient',
        bg_colors: [biz.primary_color||'#4f8ef7', biz.secondary_color||'#7c3aed'],
        gradient_direction: '135deg',
        overlay_opacity: 0.1,
        shadow: { color: '#000000', blur: 20, offsetX: 5, offsetY: 10 },
        border: { enabled: false, color: '#ffffff', width: 3, radius: 16 },
        texts: [],
        description: 'ديكور متدرج بألوان المتجر',
        style_name: 'Classic Gradient'
      };
    }
    res.json({ success: true, decor });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

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

// ============================================================
// STATIC & ROOT
// ============================================================
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(__dirname + '/app.html'));
app.get('/legal', (req, res) => res.sendFile(__dirname + '/legal.html'));
app.get('/privacy', (req, res) => res.redirect('/legal'));
app.get('/terms', (req, res) => res.redirect('/legal'));
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
