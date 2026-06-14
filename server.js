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
  'https://socialos.store',
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
    // Training Memory — ذاكرة التدريب الدائمة
    `CREATE TABLE IF NOT EXISTS training_memory (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      summary TEXT,
      session_date DATE DEFAULT CURRENT_DATE,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    // Mike Memory — ذاكرة Mike الدائمة
    `CREATE TABLE IF NOT EXISTS mike_memory (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      memory_type VARCHAR(50) DEFAULT 'general',
      content TEXT NOT NULL,
      importance INTEGER DEFAULT 1,
      source VARCHAR(50) DEFAULT 'conversation',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
    // Employee Memory — ذاكرة الموظف الرقمي
    `CREATE TABLE IF NOT EXISTS employee_memory (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      memory_type VARCHAR(50) DEFAULT 'general',
      content TEXT NOT NULL,
      importance INTEGER DEFAULT 1,
      source VARCHAR(50) DEFAULT 'training',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
    // Voice Profile — ملف الصوت
    `CREATE TABLE IF NOT EXISTS voice_profile (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE,
      voice_style TEXT DEFAULT '',
      voice_speed DECIMAL(3,2) DEFAULT 1.0,
      voice_tone TEXT DEFAULT 'alloy',
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
    // Mike Gallery — معرض صور مايك
    `CREATE TABLE IF NOT EXISTS mike_gallery (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      image_url TEXT,
      image_base64 TEXT,
      label TEXT DEFAULT '',
      description TEXT DEFAULT '',
      ai_analysis TEXT DEFAULT '',
      category VARCHAR(50) DEFAULT 'general',
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    // Invoices — الفواتير
    `CREATE TABLE IF NOT EXISTS invoices (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      invoice_number VARCHAR(50),
      order_id INTEGER,
      customer_name TEXT,
      customer_phone TEXT,
      customer_address TEXT,
      items JSONB DEFAULT '[]',
      subtotal DECIMAL(10,2) DEFAULT 0,
      tax_rate DECIMAL(5,2) DEFAULT 0,
      tax_amount DECIMAL(10,2) DEFAULT 0,
      discount DECIMAL(10,2) DEFAULT 0,
      total DECIMAL(10,2) DEFAULT 0,
      currency VARCHAR(10) DEFAULT 'IQD',
      notes TEXT DEFAULT '',
      status VARCHAR(20) DEFAULT 'draft',
      issued_at TIMESTAMP DEFAULT NOW(),
      due_date DATE,
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
    )`,

    // ============================================================
    // WORKFLOW TASKS — تدفق المهام بين الأقسام
    // ============================================================
    `CREATE TABLE IF NOT EXISTS workflow_tasks (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      from_dept VARCHAR(50),
      to_dept VARCHAR(50),
      task_type VARCHAR(100),
      title TEXT,
      description TEXT DEFAULT '',
      data JSONB DEFAULT '{}',
      priority VARCHAR(20) DEFAULT 'normal',
      status VARCHAR(20) DEFAULT 'pending',
      requires_mike_approval BOOLEAN DEFAULT FALSE,
      requires_owner_approval BOOLEAN DEFAULT FALSE,
      approved_by VARCHAR(50),
      approved_at TIMESTAMP,
      rejection_reason TEXT DEFAULT '',
      completed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`,

    // ============================================================
    // PAYMENT CARDS — بطاقات الدفع
    // ============================================================
    `CREATE TABLE IF NOT EXISTS payment_cards (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      card_type VARCHAR(100) NOT NULL,
      card_number VARCHAR(100) NOT NULL,
      card_holder VARCHAR(255) NOT NULL,
      notes TEXT DEFAULT '',
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW()
    )`,

    // ============================================================
    // AI FEATURES — جداول الذكاء الاصطناعي
    // ============================================================
    `CREATE TABLE IF NOT EXISTS sentiment_analysis (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      text TEXT,
      source VARCHAR(50) DEFAULT 'manual',
      customer_phone VARCHAR(50) DEFAULT '',
      order_id INTEGER,
      sentiment VARCHAR(20),
      score DECIMAL(4,3) DEFAULT 0.5,
      emotion VARCHAR(50),
      summary TEXT DEFAULT '',
      action VARCHAR(30) DEFAULT 'reply',
      suggested_reply TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS chatbot_conversations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      customer_phone VARCHAR(50),
      customer_name VARCHAR(255),
      message TEXT,
      reply TEXT,
      action VARCHAR(50) DEFAULT 'none',
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS video_renders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      render_id VARCHAR(255),
      type VARCHAR(50) DEFAULT 'slideshow',
      platform VARCHAR(50) DEFAULT 'instagram',
      product_name VARCHAR(255) DEFAULT '',
      status VARCHAR(50) DEFAULT 'rendering',
      video_url TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS referral_settings (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE,
      is_active BOOLEAN DEFAULT TRUE,
      referrer_reward_type VARCHAR(20) DEFAULT 'points',
      referrer_reward_value DECIMAL(10,2) DEFAULT 500,
      referee_reward_type VARCHAR(20) DEFAULT 'discount',
      referee_reward_value DECIMAL(10,2) DEFAULT 10,
      min_order DECIMAL(10,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS referral_codes (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      customer_phone VARCHAR(50),
      customer_name VARCHAR(255) DEFAULT '',
      code VARCHAR(20) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS referral_uses (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      code VARCHAR(20),
      referrer_phone VARCHAR(50),
      new_customer_phone VARCHAR(50),
      order_id INTEGER,
      reward_given DECIMAL(10,2) DEFAULT 0,
      status VARCHAR(20) DEFAULT 'completed',
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(code, new_customer_phone)
    )`,
    `CREATE TABLE IF NOT EXISTS service_reviews (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      order_id INTEGER,
      customer_phone VARCHAR(50),
      customer_name VARCHAR(255),
      rating INTEGER CHECK(rating BETWEEN 1 AND 5),
      comment TEXT DEFAULT '',
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
    // أعمدة الفاتورة الجديدة
    pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS delivery_cost DECIMAL(10,2) DEFAULT 0`).catch(() => {});
    pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receipt_image TEXT`).catch(() => {});
    pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deposit DECIMAL(10,2) DEFAULT 0`).catch(() => {});
    pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS remaining_amount DECIMAL(10,2) DEFAULT 0`).catch(() => {});
    pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS order_details TEXT DEFAULT ''`).catch(() => {});
    // أعمدة الطلبات الجديدة
    pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS receipt_image TEXT`).catch(() => {});
    pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_wa_link TEXT`).catch(() => {});
    pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_wa_link TEXT`).catch(() => {});
    pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS track_token VARCHAR(64) UNIQUE`).catch(() => {});
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
// ROUTES
// ============================================================

const helpers = {
  escapeHtml, sanitize, formatCurrency,
  authenticateToken, authLimiter, rateLimit,
  bcrypt, jwt, JWT_SECRET,
  trackFailedLogin, notify, auditLog,
  blockedIPs,
  esc: escapeHtml
};

require('./routes/auth')(app, pool, helpers);
require('./routes/business')(app, pool, helpers);
require('./routes/employee')(app, pool, helpers);
require('./routes/training')(app, pool, helpers);
require('./routes/voice')(app, pool, helpers);
require('./routes/invoices')(app, pool, helpers);
require('./routes/knowledge')(app, pool, helpers);
require('./routes/decisions')(app, pool, helpers);
require('./routes/agent')(app, pool, helpers);
require('./routes/board')(app, pool, helpers);
require('./routes/products')(app, pool, helpers);
require('./routes/orders')(app, pool, helpers);
require('./routes/store')(app, pool, helpers);
require('./routes/backup')(app, pool, helpers);
require('./routes/stats')(app, pool, helpers, cron);
require('./routes/social')(app, pool, helpers);
require('./routes/identity')(app, pool, helpers);
require('./routes/ads')(app, pool, helpers);
require('./routes/posts')(app, pool, helpers, cron);
require('./routes/analytics')(app, pool, helpers);
require('./routes/mike')(app, pool, helpers);
require('./routes/images')(app, pool, helpers);
require('./routes/settings')(app, pool, helpers);
require('./routes/departments')(app, pool, helpers);
require('./routes/ai_features')(app, pool, helpers);
require('./routes/team')(app, pool, helpers);
require('./routes/referral')(app, pool, helpers);
require('./routes/video')(app, pool, helpers);


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
// PROXY IMAGE — لتجاوز CORS في مولّد الإعلانات
// ============================================================
app.get('/api/proxy-image', authenticateToken, async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ message: 'URL required' });
  // السماح فقط بـ Unsplash
  if (!url.startsWith('https://images.unsplash.com/')) {
    return res.status(403).json({ message: 'Domain not allowed' });
  }
  try {
    const r = await fetch(url);
    if (!r.ok) return res.status(502).json({ message: 'Failed to fetch image' });
    const contentType = r.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    r.body.pipe(res);
  } catch(e) {
    res.status(500).json({ message: e.message });
  }
});

// ============================================================
// START
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SocialOS v2.0 running on port ${PORT}`));
