const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const app = express();

const ALLOWED_ORIGINS = [
  'https://socialos-production-4aa6.up.railway.app',
  'http://localhost:3000',
  ...(process.env.EXTRA_ORIGINS ? process.env.EXTRA_ORIGINS.split(',') : [])
];
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, same-origin)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// ========== SECURITY MIDDLEWARE ==========

// Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Rate Limiting
const rateLimitStore = {};
function rateLimit(maxRequests, windowMs) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const key = ip + req.path;
    const now = Date.now();
    if (!rateLimitStore[key]) rateLimitStore[key] = { count: 0, resetAt: now + windowMs };
    if (now > rateLimitStore[key].resetAt) { rateLimitStore[key] = { count: 0, resetAt: now + windowMs }; }
    rateLimitStore[key].count++;
    if (rateLimitStore[key].count > maxRequests) {
      return res.status(429).json({ success: false, message: 'طلبات كثيرة جداً، حاول لاحقاً' });
    }
    next();
  };
}

// Input Sanitization
function sanitize(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/<script[^>]*>.*?<\/script>/gi, '')
            .replace(/<[^>]*>/g, '')
            .replace(/javascript:/gi, '')
            .trim();
}

// Apply rate limiting to auth routes
const authLimiter = rateLimit(10, 15 * 60 * 1000); // 10 requests per 15 min
const apiLimiter = rateLimit(100, 60 * 1000); // 100 requests per minute

// Blocked IPs store
const blockedIPs = new Set();
app.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (blockedIPs.has(ip)) return res.status(403).json({ success: false, message: 'الوصول محظور' });
  next();
});

// Failed login attempts tracker
const failedAttempts = {};
function trackFailedLogin(ip) {
  if (!failedAttempts[ip]) failedAttempts[ip] = { count: 0, lastAttempt: Date.now() };
  failedAttempts[ip].count++;
  failedAttempts[ip].lastAttempt = Date.now();
  if (failedAttempts[ip].count >= 10) {
    blockedIPs.add(ip);
    console.log(`Blocked IP: ${ip} after ${failedAttempts[ip].count} failed attempts`);
  }
}

// Clean up rate limit store every 10 minutes
setInterval(() => {
  const now = Date.now();
  Object.keys(rateLimitStore).forEach(key => {
    if (now > rateLimitStore[key].resetAt) delete rateLimitStore[key];
  });
}, 10 * 60 * 1000);

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// ========== CURRENCY FORMATTER ==========
function formatCurrency(amount, currency = 'IQD') {
  const num = parseFloat(amount) || 0;
  const symbols = { IQD: 'د.ع', SAR: 'ر.س', USD: '$', EUR: '€', KWD: 'د.ك', AED: 'د.إ' };
  const symbol = symbols[currency] || currency;
  return `${num.toLocaleString('ar-IQ')} ${symbol}`;
}

// ========== HTML ESCAPE ==========
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Exiting.');
  process.exit(1);
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: 'Token required' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ message: err.message });
  }
}

const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || '';
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || '';
const TIKTOK_REDIRECT_URI = 'https://socialos-production-4aa6.up.railway.app/api/tiktok/callback';

let pool = null;
try {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name VARCHAR(255), email VARCHAR(255) UNIQUE, password TEXT, bio TEXT DEFAULT '', avatar_url TEXT DEFAULT '', plan VARCHAR(50) DEFAULT 'trial', plan_expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '7 days'), followers_count INTEGER DEFAULT 0, following_count INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`).catch(e => console.log('users table:', e.message));
  pool.query(`CREATE TABLE IF NOT EXISTS posts (id SERIAL PRIMARY KEY, user_id INTEGER, content TEXT, platforms TEXT DEFAULT '[]', created_at TIMESTAMP DEFAULT NOW())`).catch(e => console.log('posts table:', e.message));
  pool.query(`CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, user_id INTEGER, sender VARCHAR(255), content TEXT, platform VARCHAR(50), created_at TIMESTAMP DEFAULT NOW())`).catch(e => console.log('messages table:', e.message));
  pool.query(`CREATE TABLE IF NOT EXISTS orders (id SERIAL PRIMARY KEY, user_id INTEGER, customer_name VARCHAR(255), customer_phone VARCHAR(50), customer_address TEXT, items TEXT DEFAULT '[]', total DECIMAL(10,2) DEFAULT 0, deposit DECIMAL(10,2) DEFAULT 0, deposit_type VARCHAR(50) DEFAULT 'full', status VARCHAR(50) DEFAULT 'new', payment_method VARCHAR(50) DEFAULT 'cash', delivery_company VARCHAR(255), delivery_link TEXT, notes TEXT, platform VARCHAR(50), created_at TIMESTAMP DEFAULT NOW())`).catch(e => console.log('orders table:', e.message));
  pool.query(`CREATE TABLE IF NOT EXISTS subscriptions (id SERIAL PRIMARY KEY, user_id INTEGER, plan VARCHAR(50), amount DECIMAL(10,2), status VARCHAR(50) DEFAULT 'active', started_at TIMESTAMP DEFAULT NOW(), expires_at TIMESTAMP, payment_ref TEXT, created_at TIMESTAMP DEFAULT NOW())`).catch(e => console.log('subscriptions table:', e.message));
  pool.query(`CREATE TABLE IF NOT EXISTS tiktok_tokens (id SERIAL PRIMARY KEY, user_id VARCHAR(255), access_token TEXT, refresh_token TEXT, open_id TEXT, display_name TEXT, avatar_url TEXT, follower_count INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`).catch(e => console.log('tiktok table:', e.message));
  pool.query(`CREATE TABLE IF NOT EXISTS scheduled_posts (id SERIAL PRIMARY KEY, user_id INTEGER, content TEXT, platforms TEXT, scheduled_at TIMESTAMP, status VARCHAR(50) DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW())`).catch(e => console.log('scheduled table:', e.message));
} catch (e) {
  console.log('DB not available:', e.message);
}

const users = [], posts = [], messages = [], orders = [];
const tiktokTokens = {};

// ========== AUTH ==========
app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ success: false, message: 'يرجى ملء جميع الحقول' });
  if (password.length < 6) return res.status(400).json({ success: false, message: 'كلمة المرور 6 أحرف على الأقل' });
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    if (pool) {
      const result = await pool.query('INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email, plan', [name, email, hashedPassword]);
      const user = result.rows[0];
      const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, plan: user.plan }, token });
    }
    if (users.find(u => u.email === email)) return res.status(400).json({ success: false, message: 'البريد مستخدم' });
    const user = { id: Date.now(), name, email, password: hashedPassword, plan: 'trial' };
    users.push(user);
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, user: { name, email, plan: 'trial' }, token });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message.includes('unique') ? 'البريد مستخدم مسبقاً' : e.message });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ success: false, message: 'يرجى ملء جميع الحقول' });
  try {
    if (pool) {
      const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ success: false, message: 'بيانات غير صحيحة' });
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, plan: user.plan }, token });
      }
      const ip = req.ip || req.connection.remoteAddress;
      trackFailedLogin(ip);
      return res.status(401).json({ success: false, message: 'بيانات غير صحيحة' });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
  const user = users.find(u => u.email === email);
  if (!user) return res.status(401).json({ success: false, message: 'بيانات غير صحيحة' });
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return res.status(401).json({ success: false, message: 'بيانات غير صحيحة' });
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ success: true, user: { name: user.name, email, plan: 'trial' }, token });
});

app.get('/api/auth/me', authenticateToken, (req, res) => res.json({ success: true, user: req.user }));

// ========== STATS ==========
app.get('/api/stats', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (pool) {
      const [p, m, o] = await Promise.all([
        pool.query('SELECT COUNT(*) FROM posts WHERE user_id=$1', [userId]),
        pool.query('SELECT COUNT(*) FROM messages WHERE user_id=$1', [userId]),
        pool.query('SELECT COUNT(*) FROM orders WHERE user_id=$1', [userId])
      ]);
      return res.json({ posts: parseInt(p.rows[0].count), messages: parseInt(m.rows[0].count), orders: parseInt(o.rows[0].count) });
    }
  } catch (e) {}
  res.json({ posts: posts.filter(p=>p.user_id==userId).length, messages: 0, orders: orders.filter(o=>o.user_id==userId).length });
});

// ========== AI ==========
app.post('/api/ai/generate', authenticateToken, rateLimit(30, 60*1000), async (req, res) => {
  const { prompt, type } = req.body;
  const systemPrompts = {
    post: 'أنت خبير محتوى وسائل التواصل الاجتماعي. اكتب منشوراً احترافياً باللغة العربية مع هاشتاقات.',
    caption: 'اكتب كابشن قصير وجذاب باللغة العربية مع إيموجي وهاشتاقات.',
    reply: 'اكتب رداً احترافياً على رسالة العميل باللغة العربية.',
    ad: 'اكتب نص إعلاني مقنع باللغة العربية يحفز على الشراء.',
    default: 'أنت مساعد ذكي متخصص في التسويق الرقمي. أجب باللغة العربية.'
  };
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'anthropic/claude-3-haiku', messages: [{ role: 'system', content: systemPrompts[type] || systemPrompts.default }, { role: 'user', content: prompt }] })
    });
    const data = await response.json();
    res.json({ success: true, content: data.choices?.[0]?.message?.content || '' });
  } catch (e) { res.status(500).json({ success: false, message: 'خطأ في الذكاء الاصطناعي' }); }
});

// ========== POSTS ==========
app.post('/api/posts', authenticateToken, async (req, res) => {
  const { content, platforms } = req.body;
  const userId = req.user.id;
  try {
    if (pool) { await pool.query('INSERT INTO posts (user_id, content, platforms) VALUES ($1, $2, $3)', [userId, content, JSON.stringify(platforms || [])]); return res.json({ success: true }); }
  } catch (e) {}
  posts.push({ id: Date.now(), user_id: userId, content, platforms: JSON.stringify(platforms || []), created_at: new Date() });
  res.json({ success: true });
});

app.get('/api/posts', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (pool) { const r = await pool.query('SELECT * FROM posts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [userId]); return res.json({ posts: r.rows }); }
  } catch (e) {}
  res.json({ posts: posts.filter(p => p.user_id == userId).reverse() });
});

// ========== MESSAGES ==========
app.get('/api/messages', authenticateToken, async (req, res) => {
  try {
    if (pool) { const r = await pool.query('SELECT * FROM messages ORDER BY created_at DESC LIMIT 50'); return res.json({ messages: r.rows }); }
  } catch (e) {}
  res.json({ messages });
});

// ========== ORDERS ==========
app.post('/api/orders', authenticateToken, async (req, res) => {
  const { customer_name, customer_phone, customer_address, items, total, deposit, deposit_type, payment_method, delivery_company, delivery_link, notes, platform } = req.body;
  const userId = req.user.id;
  if (total !== undefined && (parseFloat(total) < 0 || isNaN(parseFloat(total)))) return res.status(400).json({ success: false, message: 'المبلغ لا يمكن أن يكون سالباً' });
  if (deposit !== undefined && (parseFloat(deposit) < 0 || isNaN(parseFloat(deposit)))) return res.status(400).json({ success: false, message: 'العربون لا يمكن أن يكون سالباً' });
  try {
    if (pool) {
      const result = await pool.query('INSERT INTO orders (user_id, customer_name, customer_phone, customer_address, items, total, deposit, deposit_type, payment_method, delivery_company, delivery_link, notes, platform) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',
        [userId, customer_name, customer_phone, customer_address, JSON.stringify(items || []), total || 0, deposit || 0, deposit_type || 'full', payment_method || 'cash', delivery_company || '', delivery_link || '', notes || '', platform || '']);
      const newOrder = result.rows[0];
      // Auto notification داخلي
      try {
        await pool.query(
          'INSERT INTO notifications (user_id, title, message, type) VALUES ($1,$2,$3,$4)',
          [userId, '🛒 طلب جديد!', `طلب جديد من ${customer_name} - ${formatCurrency(total)}`, 'order']
        );
      } catch(e) {}

      // إشعار واتساب تلقائي للمدير
      let waOrderUrl = null;
      try {
        const settingsRes = await pool.query('SELECT whatsapp_number FROM user_settings WHERE user_id=$1', [userId]);
        const waNumber = settingsRes.rows[0]?.whatsapp_number;
        if (waNumber) {
          const cleanWa = waNumber.replace(/[^0-9]/g, '');
          const waPhone = cleanWa.startsWith('0') ? '964' + cleanWa.slice(1) : cleanWa;
          let itemsText = '';
          try { itemsText = (items || []).map(i => i.description || '').filter(Boolean).join(', ') || 'طلب'; } catch(e) {}
          const depositLine = (deposit && parseFloat(deposit) > 0)
            ? `\n💵 العربون: ${formatCurrency(deposit)}\n💳 المتبقي: ${formatCurrency(total - deposit)}`
            : '';
          const waMsg = `🛒 *طلب جديد #${newOrder.id}*\n\n👤 العميل: ${customer_name}\n📱 الهاتف: ${customer_phone}\n📦 الطلب: ${itemsText}\n💰 المبلغ: ${formatCurrency(total)}${depositLine}${notes ? '\n📝 ملاحظات: ' + notes : ''}\n${delivery_company ? '🚚 شركة التوصيل: ' + delivery_company : ''}\n\n⚡ SocialOS`;
          waOrderUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(waMsg)}`;
        }
      } catch(e) {}

      return res.json({ success: true, order: newOrder, wa_notify_url: waOrderUrl });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
  const order = { id: Date.now(), user_id: userId, customer_name, customer_phone, total, status: 'new', created_at: new Date() };
  orders.push(order);
  res.json({ success: true, order });
});

app.get('/api/orders', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { status } = req.query;
  try {
    if (pool) {
      let query = 'SELECT * FROM orders WHERE user_id=$1';
      const params = [userId];
      if (status) { query += ' AND status=$2'; params.push(status); }
      query += ' ORDER BY created_at DESC';
      const r = await pool.query(query, params);
      return res.json({ orders: r.rows });
    }
  } catch (e) {}
  res.json({ orders: orders.filter(o => o.user_id == userId) });
});

app.put('/api/orders/:id', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      // Only allow safe fields to be updated - prevent user_id injection
      const allowedFields = ['status','customer_name','customer_phone','customer_address','items','total','deposit','deposit_type','payment_method','delivery_company','delivery_link','notes','platform'];
      const updates = {};
      for (const key of allowedFields) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      if (Object.keys(updates).length === 0) return res.status(400).json({ success: false, message: 'لا توجد حقول للتحديث' });
      const fields = Object.keys(updates).map((k, i) => `${k}=$${i + 3}`).join(', ');
      await pool.query(`UPDATE orders SET ${fields} WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id, ...Object.values(updates)]);
      return res.json({ success: true });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
  res.json({ success: true });
});

app.delete('/api/orders/:id', authenticateToken, async (req, res) => {
  try { if (pool) { await pool.query('DELETE FROM orders WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]); return res.json({ success: true }); } } catch (e) {}
  res.json({ success: true });
});

// ========== SUBSCRIPTIONS ==========
app.post('/api/subscriptions', authenticateToken, async (req, res) => {
  const { plan, period, payment_ref } = req.body;
  const userId = req.user.id;
  const prices = { basic: { monthly: 49, yearly: 470 }, pro: { monthly: 129, yearly: 1238 }, enterprise: { monthly: 299, yearly: 2870 } };
  if (!prices[plan]) return res.status(400).json({ success: false, message: 'خطة غير صحيحة' });
  const amount = prices[plan][period] || prices[plan].monthly;
  const expiresAt = new Date();
  period === 'yearly' ? expiresAt.setFullYear(expiresAt.getFullYear() + 1) : expiresAt.setMonth(expiresAt.getMonth() + 1);
  try {
    if (pool) {
      await pool.query('UPDATE users SET plan=$1, plan_expires_at=$2 WHERE id=$3', [plan, expiresAt, userId]);
      await pool.query('INSERT INTO subscriptions (user_id, plan, amount, expires_at, payment_ref) VALUES ($1,$2,$3,$4,$5)', [userId, plan, amount, expiresAt, payment_ref || '']);
      return res.json({ success: true, plan, expires_at: expiresAt });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
  res.json({ success: true, plan, expires_at: expiresAt });
});

// ========== ANALYTICS ==========
app.get('/api/analytics/dashboard', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (pool) {
      const [postsData, ordersData, recentOrders, revenueChart, topCustomers, topProducts, hourlyOrders] = await Promise.all([
        // منشورات آخر 30 يوم
        pool.query('SELECT COUNT(*) as total, DATE(created_at) as day FROM posts WHERE user_id=$1 GROUP BY day ORDER BY day DESC LIMIT 30', [userId]),
        // الطلبات حسب الحالة
        pool.query('SELECT SUM(total) as revenue, COUNT(*) as count, status FROM orders WHERE user_id=$1 GROUP BY status', [userId]),
        // آخر الطلبات
        pool.query('SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10', [userId]),
        // الإيرادات اليومية آخر 14 يوم
        pool.query(`SELECT DATE(created_at) as date, SUM(total) as revenue, COUNT(*) as orders 
          FROM orders WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '14 days'
          GROUP BY DATE(created_at) ORDER BY date ASC`, [userId]),
        // أفضل العملاء
        pool.query(`SELECT customer_name, customer_phone, COUNT(*) as orders_count, SUM(total) as total_spent 
          FROM orders WHERE user_id=$1 
          GROUP BY customer_name, customer_phone 
          ORDER BY total_spent DESC LIMIT 5`, [userId]),
        // أكثر المنتجات مبيعاً
        pool.query(`SELECT name, COUNT(*) as sales_count, SUM(price * COALESCE(stock,1)) as total_value
          FROM products WHERE user_id=$1 
          GROUP BY name ORDER BY sales_count DESC LIMIT 5`, [userId]).catch(()=>({rows:[]})),
        // توزيع الطلبات حسب الساعة
        pool.query(`SELECT EXTRACT(HOUR FROM created_at) as hour, COUNT(*) as count
          FROM orders WHERE user_id=$1
          GROUP BY hour ORDER BY hour`, [userId])
      ]);

      const revenue = ordersData.rows.reduce((acc, r) => acc + parseFloat(r.revenue || 0), 0);
      const ordersCount = ordersData.rows.reduce((acc, r) => acc + parseInt(r.count || 0), 0);
      const products_count = await pool.query('SELECT COUNT(*) as count FROM products WHERE user_id=$1', [userId]).then(r=>parseInt(r.rows[0].count||0)).catch(()=>0);

      // ===== تحليل ذكي بـ AI =====
      let aiInsights = null;
      const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
      if (ANTHROPIC_KEY && ordersCount > 0) {
        try {
          // تحليل أفضل وقت للنشر
          const bestHour = hourlyOrders.rows.length > 0 
            ? hourlyOrders.rows.reduce((a,b) => parseInt(a.count) > parseInt(b.count) ? a : b)
            : null;

          // تحليل الأداء
          const weekRevenue = revenueChart.rows.slice(-7).reduce((acc,r) => acc + parseFloat(r.revenue||0), 0);
          const prevWeekRevenue = revenueChart.rows.slice(0, 7).reduce((acc,r) => acc + parseFloat(r.revenue||0), 0);
          const growth = prevWeekRevenue > 0 ? ((weekRevenue - prevWeekRevenue) / prevWeekRevenue * 100).toFixed(1) : 0;

          const insightRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 500,
              messages: [{ role: 'user', content: `أنت محلل أعمال ذكي. بناءً على هذه البيانات قدم 3 توصيات عملية قصيرة:

الإيرادات هذا الأسبوع: ${weekRevenue.toLocaleString('ar-IQ')} د.ع
النمو: ${growth}%
عدد الطلبات: ${ordersCount}
أفضل ساعة للطلبات: ${bestHour ? bestHour.hour + ':00' : 'غير محدد'}
أكثر العملاء: ${topCustomers.rows[0]?.customer_name || 'لا يوجد'}

قدم 3 توصيات عملية ومحددة لزيادة المبيعات، كل توصية في سطر واحد بدون رقم أو نقطة، ابدأ كل واحدة بإيموجي مناسب.` }]
            })
          });
          const insightData = await insightRes.json();
          if (insightData.content?.[0]?.text) {
            aiInsights = insightData.content[0].text.trim();
          }
        } catch(e) {}
      }

      // أفضل وقت للنشر
      let bestPostingTime = null;
      if (hourlyOrders.rows.length > 0) {
        const bestHour = hourlyOrders.rows.reduce((a,b) => parseInt(a.count) > parseInt(b.count) ? a : b);
        const hour = parseInt(bestHour.hour);
        bestPostingTime = {
          hour,
          label: hour < 12 ? `${hour}:00 صباحاً` : hour === 12 ? '12:00 ظهراً' : `${hour-12}:00 مساءً`,
          recommendation: `أفضل وقت للنشر هو ${hour < 12 ? hour + ':00 صباحاً' : (hour-12) + ':00 مساءً'} — معظم طلباتك تأتي في هذا الوقت`
        };
      }

      return res.json({
        success: true,
        posts_chart: postsData.rows,
        orders_by_status: ordersData.rows,
        recent_orders: recentOrders.rows,
        revenue_chart: revenueChart.rows,
        top_customers: topCustomers.rows,
        top_products: topProducts.rows,
        products_count,
        totals: { revenue, orders: ordersCount },
        ai_insights: aiInsights,
        best_posting_time: bestPostingTime
      });
    }
  } catch (e) { console.log('Analytics error:', e.message); }
  res.json({ success: true, posts_chart: [], orders_by_status: [], recent_orders: [], revenue_chart: [], top_customers: [], top_products: [], totals: { revenue: 0, orders: 0 } });
});

// ===== SMART INSIGHTS API =====
app.get('/api/analytics/insights', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.json({ success: false, message: 'AI غير مفعّل' });
  try {
    if (!pool) return res.json({ success: false });
    
    const [orders, products, posts] = await Promise.all([
      pool.query('SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [userId]),
      pool.query('SELECT * FROM products WHERE user_id=$1', [userId]),
      pool.query('SELECT COUNT(*) as total FROM posts WHERE user_id=$1', [userId])
    ]);

    const totalRevenue = orders.rows.reduce((acc,o) => acc + parseFloat(o.total||0), 0);
    const topProduct = products.rows.sort((a,b) => parseInt(b.stock||0) - parseInt(a.stock||0))[0];

    const insightRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        messages: [{ role: 'user', content: `أنت مستشار أعمال ذكي. حلل هذه البيانات وقدم تقرير قصير:

الطلبات: ${orders.rows.length}
الإيرادات: ${totalRevenue.toLocaleString('ar-IQ')} د.ع
المنتجات: ${products.rows.length}
المنشورات: ${posts.rows[0]?.total || 0}
${topProduct ? 'أبرز منتج: ' + topProduct.name : ''}

قدم:
1. ملخص الأداء (سطر واحد)
2. أقوى نقطة (سطر واحد)
3. أضعف نقطة (سطر واحد)  
4. توصية فورية (سطر واحد)
5. هدف الأسبوع القادم (سطر واحد)

كل نقطة بإيموجي وبدون رقم.` }]
      })
    });
    const data = await insightRes.json();
    res.json({ success: true, insights: data.content?.[0]?.text || '' });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ========== SCHEDULE ==========
app.post('/api/schedule', authenticateToken, async (req, res) => {
  const { content, platforms, scheduled_at } = req.body;
  const userId = req.user.id;
  try {
    if (pool) {
      const result = await pool.query('INSERT INTO scheduled_posts (user_id, content, platforms, scheduled_at) VALUES ($1,$2,$3,$4) RETURNING *', [userId, content, platforms, scheduled_at]);
      return res.json({ success: true, post: result.rows[0] });
    }
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/schedule', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (pool) { const r = await pool.query('SELECT * FROM scheduled_posts WHERE user_id=$1 ORDER BY scheduled_at ASC', [userId]); return res.json({ posts: r.rows }); }
  } catch (e) {}
  res.json({ posts: [] });
});

app.delete('/api/schedule/:id', authenticateToken, async (req, res) => {
  try { if (pool) { await pool.query('DELETE FROM scheduled_posts WHERE id=$1', [req.params.id]); return res.json({ success: true }); } } catch (e) {}
  res.json({ success: true });
});

// ========== TIKTOK ==========
app.get('/api/tiktok/auth', (req, res) => {
  const authUrl = `https://www.tiktok.com/v2/auth/authorize?client_key=${TIKTOK_CLIENT_KEY}&scope=user.info.basic&response_type=code&redirect_uri=${encodeURIComponent(TIKTOK_REDIRECT_URI)}&state=${Date.now()}`;
  res.json({ url: authUrl });
});

app.get('/api/tiktok/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.send(`<script>window.opener.postMessage({type:'TIKTOK_ERROR',error:'${error||'no_code'}'},'*');window.close();</script>`);
  try {
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_key: TIKTOK_CLIENT_KEY, client_secret: TIKTOK_CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri: TIKTOK_REDIRECT_URI })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.send(`<html><body><h2>TikTok Error</h2><pre>${JSON.stringify(tokenData)}</pre></body></html>`);
    const userRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url,follower_count', { headers: { 'Authorization': `Bearer ${tokenData.access_token}` } });
    const userData = await userRes.json();
    const userInfo = userData.data?.user || {};
    if (pool) await pool.query('INSERT INTO tiktok_tokens (user_id,access_token,refresh_token,open_id,display_name,avatar_url) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', ['default', tokenData.access_token, tokenData.refresh_token||'', userInfo.open_id||'', userInfo.display_name||'', userInfo.avatar_url||'']);
    else tiktokTokens['default'] = { ...tokenData, ...userInfo };
    res.send(`<script>window.opener.postMessage({type:'TIKTOK_SUCCESS',user:${JSON.stringify({ display_name: userInfo.display_name||'TikTok User', avatar_url: userInfo.avatar_url||'', open_id: userInfo.open_id||'', follower_count: userInfo.follower_count||0 })}}, '*');window.close();</script>`);
  } catch (e) { res.send(`<script>window.opener.postMessage({type:'TIKTOK_ERROR',error:'server_error'},'*');window.close();</script>`); }
});

app.get('/api/tiktok/status', async (req, res) => {
  try {
    if (pool) { const r = await pool.query('SELECT * FROM tiktok_tokens ORDER BY created_at DESC LIMIT 1'); if (r.rows.length > 0) return res.json({ connected: true, user: r.rows[0] }); }
    else if (tiktokTokens['default']) return res.json({ connected: true, user: tiktokTokens['default'] });
  } catch (e) {}
  res.json({ connected: false });
});

app.delete('/api/tiktok/disconnect', async (req, res) => {
  try { if (pool) await pool.query('DELETE FROM tiktok_tokens'); else delete tiktokTokens['default']; } catch (e) {}
  res.json({ success: true });
});

// ========== PROFILE ==========
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ message: 'قاعدة البيانات غير متاحة' });
    const r = await pool.query('SELECT id,name,email,bio,avatar_url,plan,plan_expires_at FROM users WHERE id=$1', [req.user.id]);
    if (r.rows.length === 0) return res.status(404).json({ message: 'User not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ message: 'Profile error' }); }
});

app.put('/api/profile', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ message: 'قاعدة البيانات غير متاحة' });
    const { name, bio, avatar_url } = req.body;
    await pool.query('UPDATE users SET name=$1, bio=$2, avatar_url=$3 WHERE id=$4', [name||'', bio||'', avatar_url||'', req.user.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: 'Update error' }); }
});

// ========== PUBLIC STORE PAGE ==========
app.get('/store/:userId', async (req, res) => {
  const { userId } = req.params;
  if (!/^\d+$/.test(userId)) return res.status(400).send('<h1>رابط غير صحيح</h1>');
  try {
    if (pool) {
      const [user, products, settings] = await Promise.all([
        pool.query('SELECT name, bio, avatar_url FROM users WHERE id=$1', [userId]),
        pool.query('SELECT * FROM products WHERE user_id=$1 AND is_available=true ORDER BY category, created_at DESC', [userId]),
        pool.query('SELECT store_name, business_type, business_desc, location, currency FROM user_settings WHERE user_id=$1', [userId])
      ]);
      if (user.rows.length === 0) return res.status(404).send('<h1>المتجر غير موجود</h1>');
      const owner = user.rows[0];
      const set = settings.rows[0] || {};
      const prods = products.rows;
      const storeName = escapeHtml(set.store_name || owner.name || 'متجر');
      const currency = escapeHtml(set.currency || 'IQD');
      const businessDesc = escapeHtml(set.business_desc || '');
      const location = escapeHtml(set.location || '');
      const safeAvatar = (owner.avatar_url || '').startsWith('https://') ? escapeHtml(owner.avatar_url) : '';
      const categories = [...new Set(prods.map(p => p.category).filter(Boolean))];
      const prodsJson = JSON.stringify(prods.map(p => ({
        id: p.id, name: p.name, description: p.description || '',
        price: parseFloat(p.price)||0, stock: parseInt(p.stock)||0,
        category: p.category||'',
        image_url: (p.image_url||'').startsWith('https://') ? p.image_url : ''
      })));

      const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="${businessDesc||storeName}">
<title>${storeName}</title>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
:root{--bg:#080b14;--surface:#0f1420;--surface2:#161d2e;--border:#1e2a40;--accent:#4f8ef7;--accent2:#7c3aed;--text:#e8edf5;--text2:#6b7a99;--danger:#ff4466;--green:#00d4aa;}
body{font-family:'Tajawal',sans-serif;background:var(--bg);color:var(--text);direction:rtl;min-height:100vh;}
.header{background:linear-gradient(135deg,#0d1424,#111827);padding:32px 20px 24px;text-align:center;border-bottom:1px solid var(--border);}
.store-avatar{width:88px;height:88px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:2.2rem;font-weight:900;margin:0 auto 14px;overflow:hidden;border:3px solid rgba(79,142,247,.3);box-shadow:0 0 32px rgba(79,142,247,.2);}
.store-avatar img{width:100%;height:100%;object-fit:cover;}
.store-name{font-size:1.7rem;font-weight:900;}
.store-desc{color:var(--text2);margin-top:6px;font-size:.9rem;max-width:400px;margin-inline:auto;}
.header-stats{display:flex;justify-content:center;gap:20px;margin-top:14px;}
.header-stat{text-align:center;font-size:.78rem;color:var(--text2);}
.header-stat strong{display:block;font-size:1rem;font-weight:900;color:var(--text);}
.sticky-bar{position:sticky;top:0;z-index:100;background:rgba(8,11,20,.95);backdrop-filter:blur(16px);border-bottom:1px solid var(--border);padding:10px 16px;}
.search-wrap{display:flex;align-items:center;gap:8px;background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:8px 14px;margin-bottom:8px;}
.search-wrap input{flex:1;background:transparent;border:none;color:var(--text);font-family:'Tajawal',sans-serif;font-size:.9rem;outline:none;}
.search-wrap input::placeholder{color:var(--text2);}
.cats{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;}
.cats::-webkit-scrollbar{display:none;}
.cat-btn{padding:5px 14px;border-radius:20px;border:1px solid var(--border);background:var(--surface2);color:var(--text2);cursor:pointer;font-family:'Tajawal',sans-serif;font-size:.8rem;font-weight:700;white-space:nowrap;transition:all .15s;flex-shrink:0;}
.cat-btn.active{background:var(--accent);border-color:var(--accent);color:#fff;}
.container{max-width:960px;margin:0 auto;padding:20px 14px;padding-bottom:100px;}
.products-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;}
@media(max-width:480px){.products-grid{grid-template-columns:repeat(2,1fr);gap:10px;}}
.product-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;overflow:hidden;transition:all .2s;cursor:pointer;}
.product-card:hover{border-color:var(--accent);transform:translateY(-3px);box-shadow:0 8px 24px rgba(0,0,0,.4);}
.product-card.out{opacity:.6;cursor:default;}
.pimg-wrap{position:relative;height:150px;background:var(--surface2);overflow:hidden;}
.pimg-wrap img{width:100%;height:100%;object-fit:cover;transition:transform .3s;}
.product-card:hover .pimg-wrap img{transform:scale(1.04);}
.pimg-placeholder{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2.5rem;}
.cat-tag{position:absolute;top:7px;right:7px;background:rgba(8,11,20,.8);backdrop-filter:blur(4px);border-radius:20px;padding:2px 8px;font-size:.68rem;color:var(--text2);}
.out-badge{position:absolute;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font-size:.82rem;font-weight:700;color:var(--danger);}
.pinfo{padding:11px;}
.pname{font-weight:700;font-size:.86rem;margin-bottom:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.pdesc{color:var(--text2);font-size:.74rem;margin-bottom:7px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.pbottom{display:flex;justify-content:space-between;align-items:center;}
.pprice{font-weight:900;font-size:.9rem;color:var(--accent);}
.add-btn{width:30px;height:30px;border-radius:50%;background:var(--accent);border:none;color:#fff;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0;}
.add-btn:hover{background:#3b6fd4;transform:scale(1.1);}
.cart-float{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) scale(.95);background:linear-gradient(135deg,var(--accent),var(--accent2));border-radius:20px;padding:13px 24px;display:flex;align-items:center;gap:12px;cursor:pointer;z-index:200;box-shadow:0 8px 32px rgba(79,142,247,.4);transition:all .3s;opacity:0;pointer-events:none;}
.cart-float.show{opacity:1;pointer-events:all;transform:translateX(-50%) scale(1);}
.cart-count{background:rgba(255,255,255,.25);border-radius:20px;padding:2px 10px;font-weight:900;font-size:.82rem;}
.overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:300;align-items:flex-end;justify-content:center;}
.overlay.show{display:flex;}
@media(min-width:600px){.overlay{align-items:center;}}
.sheet{background:var(--surface);border-radius:24px 24px 0 0;width:100%;max-width:520px;max-height:92vh;overflow-y:auto;padding:22px;animation:slideUp .25s ease;}
@media(min-width:600px){.sheet{border-radius:24px;}}
@keyframes slideUp{from{transform:translateY(30px);opacity:0}to{transform:translateY(0);opacity:1}}
.sheet-handle{width:40px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 18px;}
.sheet h2{font-size:1.1rem;font-weight:700;margin-bottom:14px;}
.inp{width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:11px 14px;color:var(--text);font-size:.9rem;font-family:'Tajawal',sans-serif;margin-bottom:10px;outline:none;}
.inp:focus{border-color:var(--accent);}
.btn-primary{width:100%;padding:13px;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;border:none;border-radius:12px;font-size:.95rem;font-weight:700;cursor:pointer;font-family:'Tajawal',sans-serif;margin-top:6px;transition:all .2s;}
.btn-primary:disabled{opacity:.6;cursor:not-allowed;}
.btn-outline{width:100%;padding:11px;background:transparent;border:1px solid var(--border);color:var(--text2);border-radius:12px;font-size:.9rem;font-weight:700;cursor:pointer;font-family:'Tajawal',sans-serif;margin-top:8px;}
.cart-item{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);}
.ci-img{width:50px;height:50px;border-radius:10px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0;overflow:hidden;}
.ci-img img{width:100%;height:100%;object-fit:cover;}
.ci-info{flex:1;}
.ci-name{font-weight:700;font-size:.85rem;}
.ci-price{color:var(--accent);font-weight:700;font-size:.82rem;margin-top:2px;}
.qty-ctrl{display:flex;align-items:center;gap:7px;}
.qty-btn{width:27px;height:27px;border-radius:50%;border:1px solid var(--border);background:var(--surface2);color:var(--text);cursor:pointer;font-size:1rem;display:flex;align-items:center;justify-content:center;}
.qty-num{font-weight:700;font-size:.88rem;min-width:18px;text-align:center;}
.coupon-row{display:flex;gap:8px;margin-bottom:10px;}
.coupon-row input{flex:1;margin:0;}
.coupon-row button{padding:11px 16px;background:var(--surface2);border:1px solid var(--border);border-radius:10px;color:var(--text2);cursor:pointer;font-family:'Tajawal',sans-serif;font-weight:700;font-size:.82rem;white-space:nowrap;}
.coup-ok{background:rgba(0,212,170,.1);border:1px solid rgba(0,212,170,.3);border-radius:8px;padding:7px 12px;font-size:.8rem;color:var(--green);margin-bottom:8px;}
.srow{display:flex;justify-content:space-between;padding:5px 0;font-size:.86rem;color:var(--text2);}
.srow.total{color:var(--text);font-weight:900;font-size:.95rem;border-top:1px solid var(--border);margin-top:5px;padding-top:8px;}
.srow.disc{color:var(--green);}
.success-screen{text-align:center;padding:28px 10px;}
.success-icon{font-size:3.8rem;margin-bottom:14px;animation:pop .4s ease;}
@keyframes pop{0%{transform:scale(0)}70%{transform:scale(1.15)}100%{transform:scale(1)}}
.detail-img{width:100%;height:200px;object-fit:cover;border-radius:14px;margin-bottom:14px;}
.detail-placeholder{width:100%;height:140px;border-radius:14px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:3.5rem;margin-bottom:14px;}
.toast{position:fixed;bottom:80px;left:50%;transform:translateX(-50%) translateY(40px);background:var(--surface);border:1px solid rgba(79,142,247,.4);border-radius:12px;padding:10px 20px;font-size:.86rem;font-weight:600;z-index:9999;transition:all .3s;opacity:0;pointer-events:none;}
.toast.show{transform:translateX(-50%) translateY(0);opacity:1;}
.empty-state{text-align:center;padding:50px 20px;color:var(--text2);}
</style>
</head>
<body>
<div class="header">
  <div class="store-avatar">${safeAvatar?`<img src="${safeAvatar}" alt="${storeName}" onerror="this.style.display='none'">`:storeName.charAt(0)}</div>
  <div class="store-name">${storeName}</div>
  ${businessDesc?`<div class="store-desc">${businessDesc}</div>`:''}
  ${location?`<div class="store-desc" style="font-size:.8rem">📍 ${location}</div>`:''}
  <div class="header-stats">
    <div class="header-stat"><strong>${prods.length}</strong>منتج</div>
    <div class="header-stat"><strong>${categories.length}</strong>فئة</div>
  </div>
</div>
<div class="sticky-bar">
  <div class="search-wrap">
    <span style="color:var(--text2)">🔍</span>
    <input id="sinp" placeholder="ابحث عن منتج..." oninput="filterP()" autocomplete="off">
    <button id="sclear" onclick="clearS()" style="display:none;background:none;border:none;color:var(--text2);cursor:pointer;font-size:1rem">✕</button>
  </div>
  <div class="cats">
    <button class="cat-btn active" onclick="filterCat('',this)">الكل</button>
    ${categories.map(c=>`<button class="cat-btn" onclick="filterCat(${JSON.stringify(escapeHtml(c))},this)">${escapeHtml(c)}</button>`).join('')}
  </div>
</div>
<div class="container">
  <div class="products-grid" id="pgrid"></div>
  <div class="empty-state" id="nores" style="display:none"><div style="font-size:2.5rem;margin-bottom:10px">🔍</div><p>لا توجد نتائج</p></div>
</div>
<div class="cart-float" id="cfloat" onclick="openCart()">
  <span style="font-size:1.2rem">🛒</span>
  <span class="cart-count" id="ccount">0</span>
  <span id="ctotal" style="font-weight:700;font-size:.88rem">0 ${currency}</span>
  <span style="font-size:.82rem;opacity:.8">السلة ←</span>
</div>
<div class="overlay" id="doverlay" onclick="closeDet(event)"><div class="sheet" id="dsheet"><div class="sheet-handle"></div><div id="dcontent"></div></div></div>
<div class="overlay" id="coverlay" onclick="closeCart(event)">
  <div class="sheet">
    <div class="sheet-handle"></div>
    <h2>🛒 سلة التسوق</h2>
    <div id="citems"></div>
    <div style="margin-top:12px">
      <div class="coupon-row">
        <input class="inp" id="cinp" placeholder="كود خصم (اختياري)" style="margin:0;text-transform:uppercase" oninput="this.value=this.value.toUpperCase()">
        <button onclick="applyC()">تطبيق</button>
      </div>
      <div id="cmsg"></div>
    </div>
    <div id="csum" style="margin-top:8px"></div>
    <button class="btn-primary" onclick="openCO()">💳 متابعة الطلب</button>
    <button class="btn-outline" onclick="closeCart()">متابعة التسوق</button>
  </div>
</div>
<div class="overlay" id="cooverlay" onclick="closeCO(event)">
  <div class="sheet">
    <div class="sheet-handle"></div>
    <div id="cocontent">
      <h2>📝 تفاصيل الطلب</h2>
      <input class="inp" id="cname" placeholder="اسمك الكريم *" autocomplete="name">
      <input class="inp" id="cphone" placeholder="رقم هاتفك *" dir="ltr" type="tel" autocomplete="tel">
      <input class="inp" id="caddr" placeholder="عنوان التوصيل (اختياري)">
      <textarea class="inp" id="cnotes" placeholder="ملاحظات..." style="min-height:65px;resize:none"></textarea>
      <div id="cosum" style="margin:10px 0"></div>
      <button class="btn-primary" id="sbtn" onclick="submitOrder()">✅ تأكيد الطلب</button>
      <button class="btn-outline" onclick="closeCO()">رجوع للسلة</button>
    </div>
  </div>
</div>
<div class="toast" id="toast"></div>
<script>
const UID=${parseInt(userId)},CUR=${JSON.stringify(currency)},PRODS=${prodsJson};
let cart=[],coupon=null,cat='',sq='';
function escH(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function sub(){return cart.reduce((s,c)=>s+c.price*c.qty,0);}
function disc(){if(!coupon)return 0;const s=sub();return coupon.type==='percent'?+(s*coupon.value/100).toFixed(2):Math.min(+coupon.value,s);}
function total(){return Math.max(0,sub()-disc());}
function render(){
  const grid=document.getElementById('pgrid'),nr=document.getElementById('nores');
  let p=PRODS;
  if(cat)p=p.filter(x=>x.category===cat);
  if(sq){const q=sq.toLowerCase();p=p.filter(x=>x.name.toLowerCase().includes(q)||x.description.toLowerCase().includes(q));}
  if(!p.length){grid.innerHTML='';nr.style.display='block';return;}
  nr.style.display='none';
  grid.innerHTML=p.map(x=>{
    const ic=cart.find(c=>c.id===x.id);
    return \`<div class="product-card\${x.stock===0?' out':''}" onclick="openDet(\${x.id})">
      <div class="pimg-wrap">
        \${x.image_url?'<img src="'+escH(x.image_url)+'" loading="lazy" onerror="this.parentElement.innerHTML=\'<div class=pimg-placeholder>📦</div>\'">':'<div class="pimg-placeholder">📦</div>'}
        \${x.category?'<div class="cat-tag">'+escH(x.category)+'</div>':''}
        \${x.stock===0?'<div class="out-badge">نفذ من المخزون</div>':''}
      </div>
      <div class="pinfo">
        <div class="pname">\${escH(x.name)}</div>
        \${x.description?'<div class="pdesc">'+escH(x.description.substring(0,55))+'</div>':''}
        <div class="pbottom">
          <div class="pprice">\${x.price.toFixed(0)} \${CUR}</div>
          \${x.stock>0?'<button class="add-btn" onclick="event.stopPropagation();add(\${x.id})">'+(ic?'✓':'+')+' </button>':''}
        </div>
      </div>
    </div>\`;
  }).join('');
}
function filterCat(c,btn){cat=c;document.querySelectorAll('.cat-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');render();}
function filterP(){sq=document.getElementById('sinp').value.trim();document.getElementById('sclear').style.display=sq?'block':'none';render();}
function clearS(){document.getElementById('sinp').value='';sq='';document.getElementById('sclear').style.display='none';render();}
function openDet(id){
  const x=PRODS.find(p=>p.id===id);if(!x)return;
  const ic=cart.find(c=>c.id===id);
  document.getElementById('dcontent').innerHTML=
    (x.image_url?'<img class="detail-img" src="'+escH(x.image_url)+'" onerror="this.outerHTML=\'<div class=detail-placeholder>📦</div>\'">'
               :'<div class="detail-placeholder">📦</div>')+
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">'+
      '<h2 style="font-size:1.15rem;font-weight:900;flex:1">'+escH(x.name)+'</h2>'+
      (x.category?'<span style="background:var(--surface2);border:1px solid var(--border);border-radius:20px;padding:3px 10px;font-size:.72rem;color:var(--text2)">'+escH(x.category)+'</span>':'')+
    '</div>'+
    (x.description?'<p style="color:var(--text2);font-size:.88rem;line-height:1.7;margin-bottom:14px">'+escH(x.description)+'</p>':'')+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">'+
      '<div style="font-size:1.4rem;font-weight:900;color:var(--accent)">'+x.price.toFixed(0)+' '+CUR+'</div>'+
      '<div style="font-size:.78rem;color:'+(x.stock<=5&&x.stock>0?'var(--danger)':'var(--text2)')+'">متبقي: '+x.stock+'</div>'+
    '</div>'+
    (x.stock>0
      ?'<button class="btn-primary" onclick="add('+x.id+');closeDet()">'+(ic?'✅ في السلة — إضافة كمية':'🛒 أضف للسلة')+'</button>'
      :'<div style="text-align:center;padding:11px;background:rgba(255,68,102,.1);border-radius:10px;color:var(--danger);font-weight:700">نفذ من المخزون</div>')+
    '<button class="btn-outline" onclick="closeDet()">رجوع</button>';
  document.getElementById('doverlay').classList.add('show');
  document.body.style.overflow='hidden';
}
function closeDet(e){if(e&&e.target!==document.getElementById('doverlay'))return;document.getElementById('doverlay').classList.remove('show');document.body.style.overflow='';}
function add(id){
  const x=PRODS.find(p=>p.id===id);if(!x||x.stock===0)return;
  const e=cart.find(c=>c.id===id);
  if(e){if(e.qty>=x.stock){showToast('⚠️ وصلت للحد الأقصى');return;}e.qty++;}
  else cart.push({id:x.id,name:x.name,price:x.price,image_url:x.image_url,qty:1,stock:x.stock});
  coupon=null;updateFloat();showToast('✅ أضيف للسلة');render();
}
function rem(id){cart=cart.filter(c=>c.id!==id);coupon=null;updateFloat();renderCart();render();}
function chQty(id,d){const e=cart.find(c=>c.id===id);if(!e)return;e.qty=Math.max(1,Math.min(e.qty+d,e.stock));coupon=null;updateFloat();renderCart();}
function updateFloat(){
  const n=cart.reduce((s,c)=>s+c.qty,0);
  document.getElementById('ccount').textContent=n;
  document.getElementById('ctotal').textContent=total().toFixed(0)+' '+CUR;
  document.getElementById('cfloat').classList.toggle('show',n>0);
}
function openCart(){renderCart();document.getElementById('coverlay').classList.add('show');document.body.style.overflow='hidden';}
function closeCart(e){if(e&&e.target!==document.getElementById('coverlay'))return;document.getElementById('coverlay').classList.remove('show');document.body.style.overflow='';}
function renderCart(){
  const el=document.getElementById('citems');
  if(!cart.length){el.innerHTML='<div style="text-align:center;padding:24px;color:var(--text2)">السلة فارغة</div>';renderSum();return;}
  el.innerHTML=cart.map(c=>\`<div class="cart-item">
    <div class="ci-img">\${c.image_url?'<img src="'+escH(c.image_url)+'" onerror="this.parentElement.textContent=\'📦\'">':'📦'}</div>
    <div class="ci-info"><div class="ci-name">\${escH(c.name)}</div><div class="ci-price">\${(c.price*c.qty).toFixed(0)} \${CUR}</div></div>
    <div style="display:flex;flex-direction:column;align-items:center;gap:5px">
      <div class="qty-ctrl">
        <button class="qty-btn" onclick="chQty(\${c.id},-1)">−</button>
        <span class="qty-num">\${c.qty}</span>
        <button class="qty-btn" onclick="chQty(\${c.id},1)">+</button>
      </div>
      <button onclick="rem(\${c.id})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:.72rem">حذف</button>
    </div>
  </div>\`).join('');
  renderSum();
}
function renderSum(){
  const s=sub(),d=disc(),t=total();
  document.getElementById('csum').innerHTML=
    '<div class="srow"><span>المجموع</span><span>'+s.toFixed(0)+' '+CUR+'</span></div>'+
    (d>0?'<div class="srow disc"><span>خصم 🎟️</span><span>- '+d.toFixed(0)+' '+CUR+'</span></div>':'')+
    '<div class="srow total"><span>الإجمالي</span><span>'+t.toFixed(0)+' '+CUR+'</span></div>';
}
async function applyC(){
  const code=document.getElementById('cinp').value.trim();if(!code)return;
  const m=document.getElementById('cmsg');
  m.innerHTML='<span style="color:var(--text2);font-size:.8rem">⏳ جاري التحقق...</span>';
  try{
    const r=await fetch('/api/coupons/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,order_total:sub(),store_user_id:UID})});
    const d=await r.json();
    if(d.success){coupon=d.coupon;m.innerHTML='<div class="coup-ok">✅ خصم '+d.discount.toFixed(0)+' '+CUR+'!</div>';renderCart();}
    else{m.innerHTML='<span style="color:var(--danger);font-size:.8rem">❌ '+escH(d.message)+'</span>';coupon=null;}
  }catch(e){m.innerHTML='<span style="color:var(--danger);font-size:.8rem">❌ تعذر التحقق</span>';}
}
function openCO(){
  if(!cart.length)return showToast('⚠️ السلة فارغة');
  closeCart();
  const s=sub(),d=disc(),t=total();
  document.getElementById('cosum').innerHTML=
    '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:11px">'+
    cart.map(c=>'<div style="display:flex;justify-content:space-between;font-size:.8rem;margin-bottom:3px"><span>'+escH(c.name)+' ×'+c.qty+'</span><span>'+(c.price*c.qty).toFixed(0)+' '+CUR+'</span></div>').join('')+
    (d>0?'<div style="display:flex;justify-content:space-between;font-size:.8rem;color:var(--green);margin-top:5px"><span>خصم</span><span>- '+d.toFixed(0)+' '+CUR+'</span></div>':'')+
    '<div style="display:flex;justify-content:space-between;font-weight:900;font-size:.92rem;margin-top:7px;padding-top:7px;border-top:1px solid var(--border)"><span>الإجمالي</span><span style="color:var(--accent)">'+t.toFixed(0)+' '+CUR+'</span></div></div>';
  document.getElementById('cooverlay').classList.add('show');document.body.style.overflow='hidden';
}
function closeCO(e){if(e&&e.target!==document.getElementById('cooverlay'))return;document.getElementById('cooverlay').classList.remove('show');document.body.style.overflow='';}
async function submitOrder(){
  const name=document.getElementById('cname').value.trim(),phone=document.getElementById('cphone').value.trim();
  if(!name||!phone)return showToast('⚠️ الاسم والهاتف مطلوبان');
  if(!cart.length)return showToast('⚠️ السلة فارغة');
  const btn=document.getElementById('sbtn');btn.disabled=true;btn.textContent='⏳ جاري الإرسال...';
  try{
    const r=await fetch('/api/marketplace/order',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({store_user_id:UID,customer_name:name,customer_phone:phone,
        customer_address:document.getElementById('caddr').value.trim(),
        notes:document.getElementById('cnotes').value.trim(),
        items:cart.map(c=>({description:c.name+' ×'+c.qty,quantity:c.qty,price:c.price})),
        total:total(),coupon_code:coupon?.code||null})});
    const d=await r.json();
    if(d.success){
      if(coupon){try{await fetch('/api/coupons/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:coupon.code})});}catch(e){}}
      document.getElementById('cocontent').innerHTML=
        '<div class="success-screen">'+
        '<div class="success-icon">🎉</div>'+
        '<div style="font-size:1.2rem;font-weight:900;margin-bottom:8px">تم استلام طلبك!</div>'+
        '<div style="background:rgba(79,142,247,.1);border:1px solid rgba(79,142,247,.3);border-radius:10px;padding:10px 18px;font-family:monospace;font-size:1.05rem;font-weight:900;color:var(--accent);display:inline-block;margin-bottom:16px">#'+(d.order?.id||'—')+'</div>'+
        '<div style="color:var(--text2);font-size:.88rem;margin-bottom:20px;line-height:1.6">شكراً '+escH(name)+'!<br>سنتواصل معك قريباً.</div>'+
        '<div style="background:var(--surface2);border-radius:10px;padding:12px;margin-bottom:18px;font-size:.85rem">'+
          '<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>رقم الطلب</span><span style="font-family:monospace;color:var(--accent)">#'+(d.order?.id||'—')+'</span></div>'+
          '<div style="display:flex;justify-content:space-between"><span>الإجمالي</span><span style="font-weight:900;color:var(--accent)">'+total().toFixed(0)+' '+CUR+'</span></div>'+
        '</div>'+
        '<button class="btn-primary" onclick="closeCO();cart=[];coupon=null;updateFloat();render()">🛍️ متابعة التسوق</button>'+
        '</div>';
      cart=[];coupon=null;updateFloat();
    }else{showToast('❌ '+(d.message||'فشل'));btn.disabled=false;btn.textContent='✅ تأكيد الطلب';}
  }catch(e){showToast('❌ تعذر الاتصال');btn.disabled=false;btn.textContent='✅ تأكيد الطلب';}
}
function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2800);}
render();
</script>
</body>
</html>`;
      return res.send(html);
    }
  } catch (e) { res.status(500).send('<h1>خطأ في السيرفر</h1>'); }
});

// ========== STATIC & ROOT ==========
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(__dirname + '/app.html'));

// ========== PRIVACY & TERMS ==========
app.get('/privacy', (req, res) => res.send(`<!DOCTYPE html><html><head><title>Privacy</title><meta charset="utf-8"></head><body style="font-family:Arial;padding:40px"><h1>Privacy Policy</h1><p>SocialOS stores user data securely and never sells it.</p></body></html>`));
app.get('/terms', (req, res) => res.send(`<!DOCTYPE html><html><head><title>Terms</title><meta charset="utf-8"></head><body style="font-family:Arial;padding:40px"><h1>Terms of Service</h1><p>By using SocialOS, you agree to use the service in accordance with applicable laws.</p></body></html>`));

// ========== TIKTOK VERIFICATION ==========
['cdU6MT4crP3f2Vc2V4YaYTtKls8SZyjd','R6GxRPWi20pkWFd2xDh3yUVVTTMTAr1t','zQ5nsjbY4ICxzF7xJeyNhWdxRZtg7Zdd','cWO7vuDpya6AcrmlXRgMnxUyc2qTdBik','r6U5TIN70qo1z8ifKN1Bi8FTi3Chhbrb'].forEach(code => {
  app.get(`/tiktok${code}.txt`, (req, res) => { res.setHeader('Content-Type','text/plain'); res.send(`tiktok-developers-site-verification=${code}`); });
});

// ========== CRON ==========
// ===== CRON: نشر المنشورات المجدولة (كل دقيقة) =====
cron.schedule('* * * * *', async () => {
  try {
    if (!pool) return;
    const result = await pool.query(`SELECT * FROM scheduled_posts WHERE status='pending' AND scheduled_at <= NOW()`);
    for (const post of result.rows) await pool.query('UPDATE scheduled_posts SET status=$1 WHERE id=$2', ['published', post.id]);
  } catch (err) { console.error('Scheduler Error:', err); }
});

// ===== CRON: تنبيهات ذكية يومية (كل صباح 8:00) =====
cron.schedule('0 8 * * *', async () => {
  try {
    if (!pool) return;
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_KEY) return;

    // جلب كل المستخدمين النشطين
    const users = await pool.query('SELECT id FROM users LIMIT 100');

    for (const user of users.rows) {
      const userId = user.id;
      try {
        // تحقق من بيانات المستخدم
        const [orders, products, settings] = await Promise.all([
          pool.query(`SELECT COUNT(*) as count, SUM(total) as revenue FROM orders WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '7 days'`, [userId]),
          pool.query('SELECT COUNT(*) as low_stock FROM products WHERE user_id=$1 AND stock <= 3 AND is_available=true', [userId]),
          pool.query('SELECT store_name, content_style FROM user_settings WHERE user_id=$1', [userId])
        ]);

        const weekOrders = parseInt(orders.rows[0].count || 0);
        const weekRevenue = parseFloat(orders.rows[0].revenue || 0);
        const lowStockCount = parseInt(products.rows[0].low_stock || 0);
        const storeName = settings.rows[0]?.store_name || 'متجرك';

        // تنبيه مخزون منخفض
        if (lowStockCount > 0) {
          await pool.query(
            'INSERT INTO notifications (user_id, title, message, type) VALUES ($1,$2,$3,$4)',
            [userId, '⚠️ تنبيه مخزون', `${lowStockCount} منتج مخزونه منخفض (3 أو أقل) — راجع المخزون الآن`, 'stock']
          );
        }

        // تقرير أسبوعي كل إثنين
        const today = new Date().getDay();
        if (today === 1 && weekOrders > 0) {
          // توصية ذكية
          const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 200,
              messages: [{ role: 'user', content: `متجر "${storeName}" هذا الأسبوع: ${weekOrders} طلب، إيرادات ${weekRevenue.toLocaleString('ar-IQ')} د.ع. اكتب توصية واحدة قصيرة جداً (جملة واحدة) لزيادة المبيعات هذا الأسبوع.` }]
            })
          });
          const aiData = await aiRes.json();
          const tip = aiData.content?.[0]?.text || '';

          await pool.query(
            'INSERT INTO notifications (user_id, title, message, type) VALUES ($1,$2,$3,$4)',
            [userId, '📊 تقرير الأسبوع', `${weekOrders} طلب | ${weekRevenue.toLocaleString('ar-IQ')} د.ع${tip ? ' | 💡 ' + tip : ''}`, 'weekly_report']
          );
        }

        // تنبيه لو ما في طلبات منذ 3 أيام
        const lastOrder = await pool.query('SELECT created_at FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [userId]);
        if (lastOrder.rows.length > 0) {
          const daysSinceLastOrder = Math.floor((Date.now() - new Date(lastOrder.rows[0].created_at)) / (1000*60*60*24));
          if (daysSinceLastOrder >= 3) {
            await pool.query(
              'INSERT INTO notifications (user_id, title, message, type) VALUES ($1,$2,$3,$4)',
              [userId, '💡 تحفيز المبيعات', `مرت ${daysSinceLastOrder} أيام بدون طلبات — جرب نشر عرض أو خصم لجذب الزبائن`, 'tip']
            );
          }
        }
      } catch(e) {}
    }
  } catch (err) { console.error('Smart Alerts Error:', err); }
});


// ========== CUSTOMERS ==========
app.post('/api/customers', authenticateToken, async (req, res) => {
  const { name, phone, address, notes } = req.body;
  const userId = req.user.id;
  if (!name || !phone) return res.status(400).json({ success: false, message: 'الاسم والهاتف مطلوبان' });
  try {
    if (pool) {
      const result = await pool.query(
        'INSERT INTO customers (user_id, name, phone, address, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [userId, name, phone, address || '', notes || '']
      );
      return res.json({ success: true, customer: result.rows[0] });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/customers', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { q } = req.query;
  try {
    if (pool) {
      let query = 'SELECT * FROM customers WHERE user_id=$1';
      const params = [userId];
      if (q) { query += ' AND (name ILIKE $2 OR phone ILIKE $2)'; params.push(`%${q}%`); }
      query += ' ORDER BY created_at DESC';
      const r = await pool.query(query, params);
      return res.json({ customers: r.rows });
    }
  } catch (e) {}
  res.json({ customers: [] });
});

app.put('/api/customers/:id', authenticateToken, async (req, res) => {
  const { name, phone, address, notes } = req.body;
  try {
    if (pool) {
      await pool.query('UPDATE customers SET name=$1, phone=$2, address=$3, notes=$4 WHERE id=$5 AND user_id=$6',
        [name, phone, address || '', notes || '', req.params.id, req.user.id]);
      return res.json({ success: true });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/customers/:id', authenticateToken, async (req, res) => {
  try {
    if (pool) { await pool.query('DELETE FROM customers WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]); return res.json({ success: true }); }
  } catch (e) {}
  res.json({ success: true });
});

// ========== REPLY TEMPLATES ==========
app.post('/api/templates', authenticateToken, async (req, res) => {
  const { title, content } = req.body;
  const userId = req.user.id;
  if (!title || !content) return res.status(400).json({ success: false, message: 'العنوان والمحتوى مطلوبان' });
  try {
    if (pool) {
      const result = await pool.query(
        'INSERT INTO reply_templates (user_id, title, content) VALUES ($1,$2,$3) RETURNING *',
        [userId, title, content]
      );
      return res.json({ success: true, template: result.rows[0] });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/templates', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM reply_templates WHERE user_id=$1 ORDER BY created_at DESC', [userId]);
      return res.json({ templates: r.rows });
    }
  } catch (e) {}
  res.json({ templates: [] });
});

app.delete('/api/templates/:id', authenticateToken, async (req, res) => {
  try {
    if (pool) { await pool.query('DELETE FROM reply_templates WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]); return res.json({ success: true }); }
  } catch (e) {}
  res.json({ success: true });
});

// ========== WEEKLY REPORT ==========
app.get('/api/reports/weekly', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { period } = req.query;
  const days = period === 'month' ? 30 : period === 'year' ? 365 : 7;
  const prevDays = days * 2;
  try {
    if (pool) {
      const [orders, posts, topOrders, prevOrders, dailyRevenue, topProducts, statusBreakdown] = await Promise.all([
        // Current period
        pool.query(`SELECT COUNT(*) as count, SUM(total) as revenue, SUM(deposit) as deposits, status FROM orders WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '${days} days' GROUP BY status`, [userId]),
        pool.query(`SELECT COUNT(*) as count FROM posts WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '${days} days'`, [userId]),
        pool.query(`SELECT customer_name, customer_phone, total, status, created_at FROM orders WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '${days} days' ORDER BY total DESC LIMIT 10`, [userId]),
        // Previous period for comparison
        pool.query(`SELECT COUNT(*) as count, SUM(total) as revenue FROM orders WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '${prevDays} days' AND created_at < NOW() - INTERVAL '${days} days'`, [userId]),
        // Daily revenue chart
        pool.query(`SELECT DATE(created_at) as date, SUM(total) as revenue, COUNT(*) as orders FROM orders WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '${days} days' GROUP BY DATE(created_at) ORDER BY date ASC`, [userId]),
        // Top products
        pool.query(`SELECT name, price, stock FROM products WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5`, [userId]),
        // Status breakdown
        pool.query(`SELECT status, COUNT(*) as count, SUM(total) as revenue FROM orders WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '${days} days' GROUP BY status`, [userId])
      ]);

      const totalRevenue = orders.rows.reduce((s, r) => s + parseFloat(r.revenue || 0), 0);
      const totalOrders = orders.rows.reduce((s, r) => s + parseInt(r.count || 0), 0);
      const totalDeposits = orders.rows.reduce((s, r) => s + parseFloat(r.deposits || 0), 0);
      const prevRevenue = parseFloat(prevOrders.rows[0]?.revenue || 0);
      const prevCount = parseInt(prevOrders.rows[0]?.count || 0);
      const revenueGrowth = prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue * 100).toFixed(1) : null;
      const ordersGrowth = prevCount > 0 ? ((totalOrders - prevCount) / prevCount * 100).toFixed(1) : null;
      const avgOrder = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      return res.json({
        success: true,
        period: days === 7 ? 'آخر 7 أيام' : days === 30 ? 'آخر 30 يوم' : 'آخر سنة',
        days,
        orders: { total: totalOrders, revenue: totalRevenue, deposits: totalDeposits, avg: avgOrder, by_status: orders.rows },
        posts: parseInt(posts.rows[0]?.count || 0),
        top_orders: topOrders.rows,
        comparison: { prev_revenue: prevRevenue, prev_orders: prevCount, revenue_growth: revenueGrowth, orders_growth: ordersGrowth },
        daily_revenue: dailyRevenue.rows,
        top_products: topProducts.rows,
        status_breakdown: statusBreakdown.rows
      });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
  res.json({ success: true, period: 'آخر 7 أيام', orders: { total: 0, revenue: 0, by_status: [] }, posts: 0, top_orders: [], comparison: {}, daily_revenue: [], top_products: [], status_breakdown: [] });
});

// ========== CREATE TABLES ==========
if (pool) {
  pool.query(`CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY, user_id INTEGER, name VARCHAR(255), phone VARCHAR(50),
    address TEXT DEFAULT '', notes TEXT DEFAULT '', orders_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
  )`).catch(e => console.log('customers table:', e.message));
  
  pool.query(`CREATE TABLE IF NOT EXISTS reply_templates (
    id SERIAL PRIMARY KEY, user_id INTEGER, title VARCHAR(255), content TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )`).catch(e => console.log('templates table:', e.message));
}


// ========== PENDING ORDERS REMINDER ==========
app.get('/api/orders/pending-reminder', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (pool) {
      const r = await pool.query(
        `SELECT * FROM orders WHERE user_id=$1 AND status IN ('new','confirmed') AND created_at <= NOW() - INTERVAL '24 hours' ORDER BY created_at ASC`,
        [userId]
      );
      return res.json({ orders: r.rows, count: r.rows.length });
    }
  } catch (e) {}
  res.json({ orders: [], count: 0 });
});

// ========== WHATSAPP INVOICE ==========
app.get('/api/orders/:id/whatsapp', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [req.params.id, userId]);
      if (r.rows.length === 0) return res.status(404).json({ message: 'الطلب غير موجود' });
      const order = r.rows[0];
      let items = [];
      try { items = JSON.parse(order.items || '[]'); } catch(e) {}
      const itemsText = items.map(i => i.description || '').filter(Boolean).join(', ') || 'طلب';
      const message = `🧾 *فاتورة طلب #${order.id}*

👤 العميل: ${order.customer_name}
📱 الهاتف: ${order.customer_phone}

📦 التفاصيل: ${itemsText}

💰 المبلغ الإجمالي: ${formatCurrency(order.total)}${order.deposit > 0 ? `
💵 العربون: ${formatCurrency(order.deposit)}
💳 المتبقي: ${formatCurrency(order.total - order.deposit)}` : ''}

${order.notes ? `📝 ملاحظات: ${order.notes}

` : ''}شكراً لتعاملكم معنا! ⚡ SocialOS`;
      const phone = order.customer_phone.replace(/[^0-9]/g, '');
      const waPhone = phone.startsWith('0') ? '966' + phone.slice(1) : phone;
      const waUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(message)}`;
      return res.json({ success: true, url: waUrl, message });
    }
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ========== MOYASAR PAYMENT ==========
app.post('/api/payment/moyasar', authenticateToken, async (req, res) => {
  const { order_id, amount, callback_url } = req.body;
  const MOYASAR_KEY = process.env.MOYASAR_API_KEY;
  if (!MOYASAR_KEY) return res.status(400).json({ success: false, message: 'مفتاح Moyasar غير مضاف في المتغيرات' });
  try {
    const response = await fetch('https://api.moyasar.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(MOYASAR_KEY + ':').toString('base64'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: Math.round(amount * 100),
        currency: 'SAR',
        description: `طلب رقم ${order_id}`,
        callback_url: callback_url || 'https://socialos-production-4aa6.up.railway.app',
        source: { type: 'creditcard' }
      })
    });
    const data = await response.json();
    if (data.id) {
      return res.json({ success: true, payment_url: data.url, payment_id: data.id });
    }
    return res.json({ success: false, message: data.message || 'فشل إنشاء الدفع', data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});


// ========== IRAQI PAYMENT METHODS ==========
app.post('/api/payment/iraqi', authenticateToken, async (req, res) => {
  const { order_id, method, amount, sender_name, sender_phone, transfer_ref, receipt_image } = req.body;
  const userId = req.user.id;
  if (!order_id || !method || !amount) return res.status(400).json({ success: false, message: 'البيانات ناقصة' });
  
  const paymentInfo = {
    zaincash: { name: 'ZainCash', number: process.env.ZAINCASH_NUMBER || '07700000000', instructions: 'حول المبلغ عبر ZainCash ثم أرسل رقم العملية' },
    asia_hawala: { name: 'Asia Hawala', number: process.env.ASIA_HAWALA_NUMBER || '07800000000', instructions: 'حول المبلغ عبر Asia Hawala ثم أرسل رقم الحوالة' },
    master_rafidain: { name: 'ماستر رافدين', number: process.env.MASTER_RAFIDAIN_NUMBER || '4111111111111111', instructions: 'حول المبلغ إلى بطاقة ماستر رافدين ثم أرسل إيصال التحويل' },
    card: { name: 'بطاقة دفع', number: process.env.CARD_NUMBER || '', instructions: 'حول المبلغ إلى رقم البطاقة ثم أرسل رقم العملية' }
  };

  const info = paymentInfo[method];
  if (!info) return res.status(400).json({ success: false, message: 'طريقة دفع غير صحيحة' });

  try {
    if (pool && transfer_ref) {
      const receiptNote = receipt_image ? ' | مع صورة الوصل' : '';
      // Save payment request
      await pool.query(
        `INSERT INTO notifications (user_id, title, message, type) VALUES ($1,$2,$3,$4)`,
        [userId, '💳 طلب تأكيد دفع', `طلب #${order_id} - ${info.name} - ${amount} د.ع - المرجع: ${transfer_ref}${receiptNote}`, 'payment']
      );
      await pool.query("UPDATE orders SET payment_method=$1, notes=COALESCE(notes,'')||$2 WHERE id=$3 AND user_id=$4",
        [method, ` | دفع ${info.name}: ${transfer_ref}`, order_id, userId]);
    }
    return res.json({ 
      success: true, 
      payment_info: info,
      message: transfer_ref ? 'تم إرسال طلب التأكيد' : 'معلومات الدفع'
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/payment/methods', (req, res) => {
  res.json({
    methods: [
      { id: 'zaincash', name: 'ZainCash', icon: '📱', number: process.env.ZAINCASH_NUMBER || 'غير مضاف' },
      { id: 'asia_hawala', name: 'Asia Hawala', icon: '🏦', number: process.env.ASIA_HAWALA_NUMBER || 'غير مضاف' },
      { id: 'master_rafidain', name: 'ماستر رافدين', icon: '💳', number: process.env.MASTER_RAFIDAIN_NUMBER || 'غير مضاف' },
      { id: 'card', name: 'بطاقة دفع أخرى', icon: '💳', number: process.env.CARD_NUMBER || 'غير مضاف' },
      { id: 'cash', name: 'كاش', icon: '💵', number: '' },
    ]
  });
});


// ========== SETTINGS ==========
app.get('/api/settings', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM user_settings WHERE user_id=$1', [userId]);
      if (r.rows.length > 0) return res.json({ success: true, settings: r.rows[0] });
      return res.json({ success: true, settings: {} });
    }
  } catch (e) {}
  res.json({ success: true, settings: {} });
});

app.put('/api/settings', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { store_name, whatsapp_number, zaincash_number, asia_hawala_number, master_rafidain_number, card_number, currency, business_type, business_desc, target_audience, content_style, location } = req.body;
  try {
    if (pool) {
      await pool.query(`
        INSERT INTO user_settings (user_id, store_name, whatsapp_number, zaincash_number, asia_hawala_number, master_rafidain_number, card_number, currency, business_type, business_desc, target_audience, content_style, location)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (user_id) DO UPDATE SET
          store_name=$2, whatsapp_number=$3, zaincash_number=$4,
          asia_hawala_number=$5, master_rafidain_number=$6, card_number=$7, currency=$8,
          business_type=$9, business_desc=$10, target_audience=$11, content_style=$12, location=$13
      `, [userId, store_name||'', whatsapp_number||'', zaincash_number||'', asia_hawala_number||'', master_rafidain_number||'', card_number||'', currency||'IQD', business_type||'', business_desc||'', target_audience||'', content_style||'ودي وقريب', location||'العراق']);
      return res.json({ success: true });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
  res.json({ success: true });
});

// Create settings table
if (pool) {
  pool.query(`CREATE TABLE IF NOT EXISTS user_settings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE,
    store_name VARCHAR(255) DEFAULT '',
    whatsapp_number VARCHAR(50) DEFAULT '',
    zaincash_number VARCHAR(50) DEFAULT '',
    asia_hawala_number VARCHAR(50) DEFAULT '',
    master_rafidain_number VARCHAR(50) DEFAULT '',
    card_number VARCHAR(100) DEFAULT '',
    currency VARCHAR(10) DEFAULT 'IQD',
    business_type VARCHAR(100) DEFAULT '',
    business_desc TEXT DEFAULT '',
    target_audience VARCHAR(100) DEFAULT '',
    content_style VARCHAR(50) DEFAULT 'ودي وقريب',
    location VARCHAR(100) DEFAULT 'العراق',
    created_at TIMESTAMP DEFAULT NOW()
  )`).catch(e => console.log('settings table:', e.message));
  // Add columns if not exist
  pool.query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS business_type VARCHAR(100) DEFAULT ''`).catch(()=>{});
  pool.query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS business_desc TEXT DEFAULT ''`).catch(()=>{});
  pool.query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS target_audience VARCHAR(100) DEFAULT ''`).catch(()=>{});
  pool.query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS content_style VARCHAR(50) DEFAULT 'ودي وقريب'`).catch(()=>{});
  pool.query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS location VARCHAR(100) DEFAULT 'العراق'`).catch(()=>{});
}


// ========== AI AGENT ==========
const agentConversations = {};
// Clean up agent conversations for inactive users every hour
setInterval(() => {
  const now = Date.now();
  Object.keys(agentConversations).forEach(userId => {
    if (agentConversations[userId]._lastActivity && now - agentConversations[userId]._lastActivity > 2 * 60 * 60 * 1000) {
      delete agentConversations[userId];
    }
  });
}, 60 * 60 * 1000);

app.post('/api/agent/chat', authenticateToken, rateLimit(20, 60*1000), async (req, res) => {
  const userId = req.user.id;
  const { message, voice } = req.body;
  if (!message) return res.status(400).json({ success: false, message: 'الرسالة مطلوبة' });
  // Cap message length at 2000 chars
  const safeMessage = message.substring(0, 2000);

  // Initialize conversation history
  if (!agentConversations[userId]) agentConversations[userId] = [];
  agentConversations[userId]._lastActivity = Date.now();
  
  // Get user stats and settings for context
  let context = { orders: 0, posts: 0, messages: 0, revenue: 0 };
  let bizSettings = {};
  try {
    if (pool) {
      const [o, p, m, s, prod] = await Promise.all([
        pool.query('SELECT COUNT(*) as count, SUM(total) as revenue FROM orders WHERE user_id=$1', [userId]),
        pool.query('SELECT COUNT(*) as count FROM posts WHERE user_id=$1', [userId]),
        pool.query('SELECT COUNT(*) as count FROM messages WHERE user_id=$1', [userId]),
        pool.query('SELECT * FROM user_settings WHERE user_id=$1', [userId]),
        pool.query('SELECT name, price, category, stock, is_available FROM products WHERE user_id=$1 AND is_available=true ORDER BY category', [userId])
      ]);
      context = {
        orders: parseInt(o.rows[0]?.count || 0),
        revenue: parseFloat(o.rows[0]?.revenue || 0),
        posts: parseInt(p.rows[0]?.count || 0),
        messages: parseInt(m.rows[0]?.count || 0),
        products: prod.rows
      };
      if (s.rows.length > 0) bizSettings = s.rows[0];
    }
  } catch(e) {}

  const dialectMap = {
    'عراقي':   'اكتب بلهجة عراقية دارجة طبيعية. استخدم مفردات عراقية مثل: هواية، چنه، بس، هسه، ماكو، أكو، شلون، وين، شنو، يبه، عمي. تجنب الفصحى الجافة واجعل الأسلوب قريب ومحبوب.',
    'خليجي':   'اكتب بلهجة خليجية. استخدم مفردات خليجية مثل: زين، وايد، ابد، الحين، شفيك، عيل، يبيلك.',
    'فصحى':    'اكتب بعربية فصحى مبسطة واضحة ومهنية.',
    'ودي وقريب': 'اكتب بأسلوب ودي وقريب من القارئ، مزيج من العامية والفصحى المبسطة.'
  };
  const dialectInstruction = dialectMap[bizSettings.content_style] || dialectMap['ودي وقريب'];

  const systemPrompt = `أنت مدير أعمال رقمي ذكي ومتكامل لمنصة SocialOS. هدفك الوحيد هو مساعدة صاحب العمل على تنمية عمله وزيادة مبيعاته بكل الطرق الممكنة.

━━━━━━━━━━━━━━━━━━━━━━━━
🏪 معلومات العمل:
━━━━━━━━━━━━━━━━━━━━━━━━
- الاسم: ${bizSettings.store_name || 'غير محدد'}
- نوع العمل: ${bizSettings.business_type || 'غير محدد'}
- الوصف: ${bizSettings.business_desc || 'غير محدد'}
- الجمهور: ${bizSettings.target_audience || 'الجميع'}
- المنطقة: ${bizSettings.location || 'العراق'}
- أسلوب التواصل: ${bizSettings.content_style || 'ودي وقريب'}

━━━━━━━━━━━━━━━━━━━━━━━━
📊 الأداء الحالي:
━━━━━━━━━━━━━━━━━━━━━━━━
- الطلبات: ${context.orders} طلب
- الإيرادات: ${Number(context.revenue).toLocaleString('ar-IQ')} د.ع
- المنشورات: ${context.posts} منشور
- الرسائل: ${context.messages} رسالة

━━━━━━━━━━━━━━━━━━━━━━━━
📦 المنتجات والخدمات:
━━━━━━━━━━━━━━━━━━━━━━━━
${context.products && context.products.length > 0 ? context.products.map(p => `• ${p.name} | ${Number(p.price).toLocaleString('ar-IQ')} د.ع | ${p.category} | مخزون: ${p.stock}`).join('\n') : '• لا توجد منتجات مضافة بعد — اقترح على صاحب العمل إضافة منتجاته'}

━━━━━━━━━━━━━━━━━━━━━━━━
🗣️ أسلوب التواصل:
━━━━━━━━━━━━━━━━━━━━━━━━
${dialectInstruction}

━━━━━━━━━━━━━━━━━━━━━━━━
🧠 قدراتك وما تفعله:
━━━━━━━━━━━━━━━━━━━━━━━━

✍️ إنشاء المحتوى:
- اكتب منشورات تسويقية جاهزة للنشر فوراً
- اكتب إعلانات مدفوعة مقنعة
- اكتب كابشن للصور والفيديوهات
- اكتب قصص (stories) جذابة
- اكتب ردود احترافية على تعليقات الزبائن
- اكتب رسائل ترحيب وشكر للزبائن

📈 التسويق والاستراتيجية:
- اقترح استراتيجية تسويق مناسبة لنوع العمل
- حلل المنافسين واقترح ميزات تنافسية
- اقترح أوقات النشر المثالية
- اقترح ميزانيات إعلانية مناسبة
- تابع الترندات واقترح محتوى يناسبها
- اقترح عروض وخصومات لزيادة المبيعات

💼 إدارة الأعمال:
- حلل بيانات المبيعات وقدم توصيات
- تتبع أداء المنتجات وحدد الأكثر مبيعاً
- اقترح أسعار مناسبة للسوق
- ساعد في إدارة المخزون
- أنشئ تقارير يومية وأسبوعية وشهرية

🤝 خدمة الزبائن:
- رد على استفسارات الزبائن بأسلوب صاحب العمل
- تعامل مع الشكاوى باحترافية
- تتبع طلبات الزبائن
- أرسل رسائل متابعة للزبائن

━━━━━━━━━━━━━━━━━━━━━━━━
📝 قواعد الكتابة:
━━━━━━━━━━━━━━━━━━━━━━━━
- اكتب المحتوى كاملاً مباشرةً بدون مقدمات
- استخدم إيموجي بذكاء ولا تبالغ
- أضف هاشتاقات قوية ومناسبة
- اجعل المحتوى قصيراً وجذاباً ومؤثراً
- استخدم الأرقام والإحصاءات عند الإمكان
- اختم المنشورات بـ Call to Action واضح
- التزم دائماً بأسلوب التواصل المحدد

━━━━━━━━━━━━━━━━━━━━━━━━
⚡ قواعد التنفيذ:
━━━━━━━━━━━━━━━━━━━━━━━━
- نفّذ الطلب مباشرةً بدون أسئلة غير ضرورية
- إذا احتجت معلومة اسأل سؤالاً واحداً فقط
- قدم دائماً نتيجة ملموسة وقابلة للاستخدام
- لا تحذف أي شيء بدون موافقة صريحة
- عند عدم اليقين قدم خيارين أو ثلاثة
- كن موجزاً وعملياً ومباشراً`;

  // Add message to history
  agentConversations[userId].push({ role: 'user', content: safeMessage });
  
  // Keep only last 20 messages (10 exchanges)
  if (agentConversations[userId].length > 20) {
    agentConversations[userId] = agentConversations[userId].slice(-20);
  }

  try {
    let aiResponse = '';
    let action = null;

    const agentRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`, 
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4-5',
        max_tokens: 2048,
        messages: [{ role: 'system', content: systemPrompt }, ...agentConversations[userId]]
      })
    });
    const agentData = await agentRes.json();
    if (agentData.error) {
      return res.json({ success: false, message: 'خطأ: ' + (agentData.error.message || JSON.stringify(agentData.error)) });
    }
    aiResponse = agentData.choices?.[0]?.message?.content || 'عذراً، لم أتمكن من المعالجة';

    // Add response to history
    agentConversations[userId].push({ role: 'assistant', content: aiResponse });

    // ===== كشف الإجراءات من الرسالة والرد =====
    const lowerMsg = safeMessage.toLowerCase();
    const lowerResp = aiResponse.toLowerCase();

    // منشور
    if (lowerMsg.includes('منشور') || lowerMsg.includes('اكتب') || lowerMsg.includes('انشر') || lowerMsg.includes('محتوى') || lowerMsg.includes('بوست') || lowerMsg.includes('كابشن')) {
      action = { type: 'create_post', content: aiResponse };
    }
    // تقرير وإحصائيات
    else if (lowerMsg.includes('تقرير') || lowerMsg.includes('إحصائيات') || lowerMsg.includes('احصائيات') || lowerMsg.includes('مبيعات') || lowerMsg.includes('أداء')) {
      action = { type: 'report', data: context };
    }
    // طلب جديد
    else if (lowerMsg.includes('طلب') && (lowerMsg.includes('أضف') || lowerMsg.includes('اضف') || lowerMsg.includes('جديد'))) {
      action = { type: 'suggest_order', requires_confirmation: true };
    }
    // رد على عميل
    else if (lowerMsg.includes('رد') || lowerMsg.includes('عميل') || lowerMsg.includes('زبون')) {
      action = { type: 'customer_reply', content: aiResponse };
    }
    // استراتيجية
    else if (lowerMsg.includes('استراتيج') || lowerMsg.includes('خطة') || lowerMsg.includes('ترويج')) {
      action = { type: 'strategy', content: aiResponse };
    }
    // اقتراحات سريعة بناءً على سياق المحادثة
    const suggestions = [];
    if (lowerResp.includes('منشور') || lowerResp.includes('محتوى')) suggestions.push({ label: '📝 أضف للمنشورات', type: 'create_post', content: aiResponse });
    if (lowerResp.includes('عرض') || lowerResp.includes('خصم')) suggestions.push({ label: '🏷️ إنشاء عرض', type: 'create_offer' });
    if (context.orders < 5) suggestions.push({ label: '🛒 أضف طلب جديد', type: 'new_order' });

    return res.json({ success: true, response: aiResponse, action, suggestions, context });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'خطأ في الـ Agent: ' + e.message });
  }
});

app.delete('/api/agent/clear', authenticateToken, (req, res) => {
  const userId = req.user.id;
  agentConversations[userId] = [];
  res.json({ success: true });
});


// ========== GOOGLE LOGIN ==========
app.post('/api/auth/google', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, message: 'Token مطلوب' });
  try {
    // Verify Google token
    const googleRes = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?id_token=${token}`);
    const googleData = await googleRes.json();
    if (googleData.error) return res.status(401).json({ success: false, message: 'Token غير صالح' });
    const { email, name, picture, sub } = googleData;
    if (!email) return res.status(401).json({ success: false, message: 'البريد غير موجود' });
    if (pool) {
      // Check if user exists
      let result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
      let user;
      if (result.rows.length === 0) {
        // Create new user
        const newUser = await pool.query(
          'INSERT INTO users (name, email, password, avatar_url) VALUES ($1,$2,$3,$4) RETURNING id, name, email, plan, avatar_url',
          [name || email.split('@')[0], email, await require('bcrypt').hash(sub, 10), picture || '']
        );
        user = newUser.rows[0];
      } else {
        user = result.rows[0];
        // Update avatar if empty
        if (picture && !user.avatar_url) {
          await pool.query('UPDATE users SET avatar_url=$1 WHERE id=$2', [picture, user.id]);
          user.avatar_url = picture;
        }
      }
      const jwtToken = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, plan: user.plan, avatar_url: user.avatar_url }, token: jwtToken });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});


// ========== OTP via WhatsApp ==========
const otpCodes = {};

app.post('/api/auth/send-otp', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ success: false, message: 'رقم الهاتف مطلوب' });
  
  // Clean phone number
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  const waPhone = cleanPhone.startsWith('0') ? '964' + cleanPhone.slice(1) : cleanPhone;
  
  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otpCodes[cleanPhone] = { otp, expires: Date.now() + 10 * 60 * 1000 };
  
  // Create WhatsApp link with OTP message
  const message = `🔐 رمز التحقق الخاص بك في SocialOS:

*${otp}*

صالح لمدة 10 دقائق.
لا تشارك هذا الرمز مع أحد.`;
  const waUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(message)}`;
  
  console.log(`OTP for ${phone}: ${otp}`);
  
  return res.json({ 
    success: true, 
    wa_url: waUrl,
    message: 'افتح واتساب وأرسل الرسالة للحصول على الرمز'
  });
});

app.post('/api/auth/verify-otp', async (req, res) => {
  const { phone, otp, name } = req.body;
  if (!phone || !otp) return res.status(400).json({ success: false, message: 'البيانات ناقصة' });
  
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  const stored = otpCodes[cleanPhone];
  
  if (!stored) return res.status(400).json({ success: false, message: 'لم يتم إرسال رمز لهذا الرقم' });
  if (stored.otp !== otp) return res.status(400).json({ success: false, message: 'رمز التحقق غير صحيح' });
  if (Date.now() > stored.expires) return res.status(400).json({ success: false, message: 'انتهت صلاحية الرمز' });
  
  delete otpCodes[cleanPhone];
  
  try {
    if (pool) {
      // Check if user exists by phone (stored in bio field temporarily)
      let result = await pool.query('SELECT * FROM users WHERE email=$1', [cleanPhone + '@phone.socialos']);
      let user;
      
      if (result.rows.length === 0) {
        // Create new user
        const hashedPass = await bcrypt.hash(otp + cleanPhone, 10);
        const newUser = await pool.query(
          'INSERT INTO users (name, email, password) VALUES ($1,$2,$3) RETURNING id, name, email, plan',
          [name || 'مستخدم جديد', cleanPhone + '@phone.socialos', hashedPass]
        );
        user = newUser.rows[0];
      } else {
        user = result.rows[0];
      }
      
      const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, plan: user.plan }, token });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
  
  res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
});


// ========== PRODUCTS CATALOG ==========
app.post('/api/products', authenticateToken, async (req, res) => {
  const { name, description, price, category, stock, image_url } = req.body;
  const userId = req.user.id;
  if (!name || !price) return res.status(400).json({ success: false, message: 'الاسم والسعر مطلوبان' });
  if (parseFloat(price) <= 0 || isNaN(parseFloat(price))) return res.status(400).json({ success: false, message: 'السعر يجب أن يكون أكبر من صفر' });
  try {
    if (pool) {
      const result = await pool.query(
        'INSERT INTO products (user_id, name, description, price, category, stock, image_url) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [userId, name, description||'', parseFloat(price), category||'عام', parseInt(stock)||0, image_url||'']
      );
      return res.json({ success: true, product: result.rows[0] });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/products', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { q, category } = req.query;
  try {
    if (pool) {
      let query = 'SELECT * FROM products WHERE user_id=$1';
      const params = [userId];
      if (q) { query += ' AND (name ILIKE $2 OR description ILIKE $2)'; params.push(`%${q}%`); }
      if (category && !q) { query += ' AND category=$2'; params.push(category); }
      query += ' ORDER BY created_at DESC';
      const r = await pool.query(query, params);
      return res.json({ products: r.rows });
    }
  } catch (e) {}
  res.json({ products: [] });
});

app.put('/api/products/:id', authenticateToken, async (req, res) => {
  const { name, description, price, category, stock, image_url, is_available } = req.body;
  try {
    if (pool) {
      await pool.query(
        'UPDATE products SET name=$1, description=$2, price=$3, category=$4, stock=$5, image_url=$6, is_available=$7 WHERE id=$8 AND user_id=$9',
        [name, description||'', parseFloat(price), category||'عام', parseInt(stock)||0, image_url||'', is_available!==false, req.params.id, req.user.id]
      );
      return res.json({ success: true });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/products/:id', authenticateToken, async (req, res) => {
  try {
    if (pool) { await pool.query('DELETE FROM products WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]); return res.json({ success: true }); }
  } catch (e) {}
  res.json({ success: true });
});

// Create products table
if (pool) {
  pool.query(`CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    price DECIMAL(10,2) NOT NULL,
    category VARCHAR(100) DEFAULT 'عام',
    stock INTEGER DEFAULT 0,
    image_url TEXT DEFAULT '',
    is_available BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
  )`).catch(e => console.log('products table:', e.message));
}


// ========== TEAM MEMBERS & PERMISSIONS ==========
app.post('/api/team', authenticateToken, async (req, res) => {
  const { name, email, password, role } = req.body;
  const ownerId = req.user.id;
  if (!name || !email || !password || !role) return res.status(400).json({ success: false, message: 'جميع الحقول مطلوبة' });
  const validRoles = ['admin', 'sales', 'content', 'viewer'];
  if (!validRoles.includes(role)) return res.status(400).json({ success: false, message: 'صلاحية غير صحيحة' });
  try {
    if (pool) {
      const hashedPass = await bcrypt.hash(password, 10);
      const result = await pool.query(
        'INSERT INTO team_members (owner_id, name, email, password, role) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, email, role',
        [ownerId, name, email, hashedPass, role]
      );
      return res.json({ success: true, member: result.rows[0] });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message.includes('unique') ? 'البريد مستخدم' : e.message }); }
});

app.get('/api/team', authenticateToken, async (req, res) => {
  const ownerId = req.user.id;
  try {
    if (pool) {
      const r = await pool.query('SELECT id, name, email, role, created_at FROM team_members WHERE owner_id=$1 ORDER BY created_at DESC', [ownerId]);
      return res.json({ members: r.rows });
    }
  } catch (e) {}
  res.json({ members: [] });
});

app.delete('/api/team/:id', authenticateToken, async (req, res) => {
  try {
    if (pool) { await pool.query('DELETE FROM team_members WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]); return res.json({ success: true }); }
  } catch (e) {}
  res.json({ success: true });
});

// ========== INVENTORY ==========
app.put('/api/products/:id/stock', authenticateToken, async (req, res) => {
  const { quantity, operation } = req.body;
  const userId = req.user.id;
  try {
    if (pool) {
      let query;
      if (operation === 'add') query = 'UPDATE products SET stock=stock+$1 WHERE id=$2 AND user_id=$3 RETURNING *';
      else if (operation === 'subtract') query = 'UPDATE products SET stock=GREATEST(0,stock-$1) WHERE id=$2 AND user_id=$3 RETURNING *';
      else query = 'UPDATE products SET stock=$1 WHERE id=$2 AND user_id=$3 RETURNING *';
      const r = await pool.query(query, [parseInt(quantity), req.params.id, userId]);
      if (r.rows.length > 0) {
        const product = r.rows[0];
        // Auto notification if low stock
        if (product.stock <= 5 && product.stock > 0) {
          await pool.query('INSERT INTO notifications (user_id, title, message, type) VALUES ($1,$2,$3,$4)',
            [userId, '⚠️ مخزون منخفض!', `${product.name} - متبقي ${product.stock} فقط`, 'inventory']);
        } else if (product.stock === 0) {
          await pool.query('INSERT INTO notifications (user_id, title, message, type) VALUES ($1,$2,$3,$4)',
            [userId, '🚨 نفذ المخزون!', `${product.name} - نفذ من المخزون`, 'inventory']);
          await pool.query('UPDATE products SET is_available=false WHERE id=$1', [req.params.id]);
        }
        return res.json({ success: true, product });
      }
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/inventory/alerts', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM products WHERE user_id=$1 AND stock <= 5 ORDER BY stock ASC', [userId]);
      return res.json({ alerts: r.rows });
    }
  } catch (e) {}
  res.json({ alerts: [] });
});

// ========== ADVANCED ANALYTICS ==========
app.get('/api/analytics/advanced', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { period } = req.query;
  const days = period === 'month' ? 30 : period === 'year' ? 365 : 7;
  try {
    if (pool) {
      const [daily, topProducts, ordersByPlatform, revenueGrowth] = await Promise.all([
        pool.query(`SELECT DATE(created_at) as date, COUNT(*) as orders, SUM(total) as revenue FROM orders WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '${days} days' GROUP BY DATE(created_at) ORDER BY date`, [userId]),
        pool.query(`SELECT items::text, COUNT(*) as count, SUM(total) as revenue FROM orders WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '${days} days' GROUP BY items ORDER BY count DESC LIMIT 5`, [userId]),
        pool.query(`SELECT platform, COUNT(*) as count, SUM(total) as revenue FROM orders WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '${days} days' AND platform IS NOT NULL GROUP BY platform`, [userId]),
        pool.query(`SELECT DATE_TRUNC('week', created_at) as week, SUM(total) as revenue FROM orders WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '${days} days' GROUP BY week ORDER BY week`, [userId])
      ]);
      return res.json({
        success: true, period: days,
        daily: daily.rows,
        top_products: topProducts.rows,
        by_platform: ordersByPlatform.rows,
        revenue_growth: revenueGrowth.rows
      });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
  res.json({ success: true, daily: [], top_products: [], by_platform: [], revenue_growth: [] });
});

// Create team table
if (pool) {
  pool.query(`CREATE TABLE IF NOT EXISTS team_members (
    id SERIAL PRIMARY KEY, owner_id INTEGER, name VARCHAR(255),
    email VARCHAR(255) UNIQUE, password TEXT, role VARCHAR(50) DEFAULT 'viewer',
    created_at TIMESTAMP DEFAULT NOW()
  )`).catch(e => console.log('team table:', e.message));
}


// ========== CRM - CUSTOMER HISTORY ==========
app.get('/api/crm/:phone', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { phone } = req.params;
  try {
    if (pool) {
      const [customer, orders, totalSpent] = await Promise.all([
        pool.query('SELECT * FROM customers WHERE user_id=$1 AND phone=$2', [userId, phone]),
        pool.query('SELECT * FROM orders WHERE user_id=$1 AND customer_phone=$2 ORDER BY created_at DESC', [userId, phone]),
        pool.query('SELECT SUM(total) as total, COUNT(*) as count FROM orders WHERE user_id=$1 AND customer_phone=$2', [userId, phone])
      ]);
      return res.json({
        success: true,
        customer: customer.rows[0] || null,
        orders: orders.rows,
        stats: {
          total_orders: parseInt(totalSpent.rows[0]?.count || 0),
          total_spent: parseFloat(totalSpent.rows[0]?.total || 0),
          last_order: orders.rows[0]?.created_at || null
        }
      });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/crm/notes', authenticateToken, async (req, res) => {
  const { customer_phone, note } = req.body;
  const userId = req.user.id;
  try {
    if (pool) {
      await pool.query(
        'UPDATE customers SET notes=CONCAT(COALESCE(notes,\'\'),\' | \', $1) WHERE user_id=$2 AND phone=$3',
        [note + ' (' + new Date().toLocaleDateString('ar') + ')', userId, customer_phone]
      );
      return res.json({ success: true });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// ========== DELIVERY TRACKING ==========
app.post('/api/delivery/track', authenticateToken, async (req, res) => {
  const { company, tracking_number } = req.body;
  const trackingUrls = {
    aramex: `https://www.aramex.com/track/results?ShipmentNumber=${tracking_number}`,
    dhl: `https://www.dhl.com/en/express/tracking.html?AWB=${tracking_number}`,
    fedex: `https://www.fedex.com/apps/fedextrack/?tracknumbers=${tracking_number}`,
    ups: `https://www.ups.com/track?tracknum=${tracking_number}`,
    smsa: `https://www.smsaexpress.com/trackshipment?awbno=${tracking_number}`,
    naqel: `https://www.naqelexpress.com/tracking?trackingNumber=${tracking_number}`,
    custom: tracking_number
  };
  const url = trackingUrls[company?.toLowerCase()] || tracking_number;
  return res.json({ success: true, tracking_url: url, company, tracking_number });
});

// ========== PDF REPORT ==========
app.get('/api/reports/pdf', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { period } = req.query;
  const days = period === 'month' ? 30 : period === 'year' ? 365 : 7;
  const prevDays = days * 2;
  try {
    if (pool) {
      const [orders, products, topCustomers, prevPeriod, dailyRevenue, statusBreakdown] = await Promise.all([
        pool.query(`SELECT * FROM orders WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '${days} days' ORDER BY created_at DESC`, [userId]),
        pool.query(`SELECT COUNT(*) as total, SUM(CASE WHEN stock=0 THEN 1 ELSE 0 END) as out_of_stock FROM products WHERE user_id=$1`, [userId]),
        pool.query(`SELECT customer_name, customer_phone, COUNT(*) as orders, SUM(total) as spent FROM orders WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '${days} days' GROUP BY customer_name, customer_phone ORDER BY spent DESC LIMIT 10`, [userId]),
        pool.query(`SELECT COUNT(*) as count, SUM(total) as revenue FROM orders WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '${prevDays} days' AND created_at < NOW() - INTERVAL '${days} days'`, [userId]),
        pool.query(`SELECT DATE(created_at) as date, SUM(total) as revenue, COUNT(*) as orders FROM orders WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '${days} days' GROUP BY DATE(created_at) ORDER BY date ASC`, [userId]),
        pool.query(`SELECT status, COUNT(*) as count, SUM(total) as revenue FROM orders WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '${days} days' GROUP BY status`, [userId])
      ]);

      const totalRevenue = orders.rows.reduce((s, o) => s + parseFloat(o.total || 0), 0);
      const totalOrders = orders.rows.length;
      const avgOrder = totalOrders > 0 ? totalRevenue / totalOrders : 0;
      const prevRevenue = parseFloat(prevPeriod.rows[0]?.revenue || 0);
      const prevCount = parseInt(prevPeriod.rows[0]?.count || 0);
      const revenueGrowth = prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue * 100).toFixed(1) : null;
      const ordersGrowth = prevCount > 0 ? ((totalOrders - prevCount) / prevCount * 100).toFixed(1) : null;
      const periodLabel = period === 'month' ? 'آخر 30 يوم' : period === 'year' ? 'آخر سنة' : 'آخر 7 أيام';
      const statusLabels = { new: 'جديد', confirmed: 'مؤكد', processing: 'قيد التجهيز', delivered: 'تم التوصيل', cancelled: 'ملغي' };
      const statusColors = { new: '#3b82f6', confirmed: '#10b981', processing: '#f59e0b', delivered: '#8b5cf6', cancelled: '#ef4444' };

      // Build mini bar chart for daily revenue (text-based for print)
      const maxRev = Math.max(...dailyRevenue.rows.map(d => parseFloat(d.revenue || 0)), 1);
      const chartBars = dailyRevenue.rows.map(d => {
        const pct = Math.round((parseFloat(d.revenue || 0) / maxRev) * 60);
        const date = new Date(d.date).toLocaleDateString('ar', { day: 'numeric', month: 'short' });
        return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <div style="width:70px;font-size:.75rem;color:#64748b;text-align:right">${date}</div>
          <div style="flex:1;height:18px;background:#f1f5f9;border-radius:4px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#4f8ef7,#7c3aed);border-radius:4px"></div>
          </div>
          <div style="width:90px;font-size:.75rem;color:#1e293b;font-weight:700;text-align:left">${formatCurrency(d.revenue)} (${d.orders})</div>
        </div>`;
      }).join('');

      const growthBadge = (growth) => {
        if (growth === null) return '<span style="color:#94a3b8;font-size:.8rem">لا مقارنة</span>';
        const positive = parseFloat(growth) >= 0;
        return `<span style="color:${positive?'#10b981':'#ef4444'};font-weight:700;font-size:.9rem">${positive?'↑':'↓'} ${Math.abs(growth)}%</span>`;
      };

      const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>تقرير SocialOS — ${periodLabel}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;900&display=swap');
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Tajawal',Arial,sans-serif;background:#f8fafc;color:#1e293b;direction:rtl;font-size:14px;}
.header{background:linear-gradient(135deg,#4f8ef7,#7c3aed);color:#fff;padding:36px 40px;display:flex;justify-content:space-between;align-items:center;}
.header h1{font-size:1.6rem;font-weight:900;}
.header p{opacity:.85;font-size:.9rem;margin-top:4px;}
.header-badge{background:rgba(255,255,255,.2);border-radius:12px;padding:10px 20px;text-align:center;}
.header-badge div{font-size:1.4rem;font-weight:900;}
.header-badge small{font-size:.78rem;opacity:.8;}
.container{max-width:1000px;margin:0 auto;padding:28px 24px;}
.stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px;}
.stat-box{background:#fff;border-radius:12px;padding:18px;box-shadow:0 1px 6px rgba(0,0,0,.08);border-top:3px solid transparent;}
.stat-box.blue{border-top-color:#4f8ef7;}
.stat-box.green{border-top-color:#10b981;}
.stat-box.purple{border-top-color:#8b5cf6;}
.stat-box.amber{border-top-color:#f59e0b;}
.stat-value{font-size:1.5rem;font-weight:900;color:#1e293b;margin-bottom:3px;}
.stat-label{font-size:.75rem;color:#64748b;}
.stat-growth{font-size:.78rem;margin-top:6px;}
.section{background:#fff;border-radius:12px;padding:22px;margin-bottom:18px;box-shadow:0 1px 6px rgba(0,0,0,.08);}
.section-title{font-size:1rem;font-weight:700;margin-bottom:16px;padding-bottom:10px;border-bottom:2px solid #f1f5f9;display:flex;align-items:center;gap:8px;}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:18px;}
table{width:100%;border-collapse:collapse;}
th{background:#f8fafc;padding:9px 12px;text-align:right;font-size:.78rem;color:#64748b;font-weight:700;border-bottom:2px solid #f1f5f9;}
td{padding:9px 12px;border-bottom:1px solid #f8fafc;font-size:.85rem;}
tr:hover td{background:#fafafa;}
.badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:.72rem;font-weight:700;}
.status-row{display:flex;align-items:center;gap:8px;margin-bottom:8px;}
.status-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;}
.status-bar{flex:1;height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden;}
.status-bar-fill{height:100%;border-radius:4px;}
.footer{text-align:center;padding:24px;color:#94a3b8;font-size:.8rem;border-top:1px solid #e2e8f0;margin-top:8px;}
@media print{body{background:#fff;}.header{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>⚡ SocialOS — تقرير الأداء</h1>
    <p>${periodLabel} · أُنشئ ${new Date().toLocaleDateString('ar', {year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'})}</p>
  </div>
  <div class="header-badge">
    <div>${totalOrders}</div>
    <small>إجمالي الطلبات</small>
  </div>
</div>

<div class="container">
  <!-- STATS -->
  <div class="stats-grid">
    <div class="stat-box blue">
      <div class="stat-value">${formatCurrency(totalRevenue)}</div>
      <div class="stat-label">إجمالي الإيرادات</div>
      <div class="stat-growth">${growthBadge(revenueGrowth)} مقارنةً بالفترة السابقة</div>
    </div>
    <div class="stat-box green">
      <div class="stat-value">${totalOrders}</div>
      <div class="stat-label">إجمالي الطلبات</div>
      <div class="stat-growth">${growthBadge(ordersGrowth)} مقارنةً بالفترة السابقة</div>
    </div>
    <div class="stat-box purple">
      <div class="stat-value">${formatCurrency(avgOrder)}</div>
      <div class="stat-label">متوسط قيمة الطلب</div>
      <div class="stat-growth" style="color:#94a3b8;font-size:.78rem">لكل طلب</div>
    </div>
    <div class="stat-box amber">
      <div class="stat-value">${products.rows[0]?.total || 0}</div>
      <div class="stat-label">المنتجات المسجلة</div>
      <div class="stat-growth" style="color:#ef4444;font-size:.78rem">${products.rows[0]?.out_of_stock || 0} نفذت</div>
    </div>
  </div>

  <div class="grid-2">
    <!-- CHART -->
    <div class="section">
      <div class="section-title">📈 الإيرادات اليومية</div>
      ${dailyRevenue.rows.length ? chartBars : '<p style="color:#94a3b8;text-align:center;padding:20px">لا توجد بيانات</p>'}
    </div>

    <!-- STATUS BREAKDOWN -->
    <div class="section">
      <div class="section-title">🥧 توزيع الطلبات</div>
      ${statusBreakdown.rows.length ?
        statusBreakdown.rows.map(s => {
          const pct = totalOrders > 0 ? ((parseInt(s.count)/totalOrders)*100).toFixed(0) : 0;
          return `<div class="status-row">
            <div class="status-dot" style="background:${statusColors[s.status]||'#94a3b8'}"></div>
            <div style="width:80px;font-size:.82rem">${statusLabels[s.status]||s.status}</div>
            <div class="status-bar"><div class="status-bar-fill" style="width:${pct}%;background:${statusColors[s.status]||'#94a3b8'}"></div></div>
            <div style="width:40px;text-align:left;font-size:.78rem;color:#64748b">${pct}%</div>
            <div style="width:50px;text-align:left;font-size:.78rem;font-weight:700">${s.count}</div>
          </div>`;
        }).join('') :
        '<p style="color:#94a3b8;text-align:center;padding:20px">لا توجد بيانات</p>'
      }
    </div>
  </div>

  <!-- TOP CUSTOMERS -->
  <div class="section">
    <div class="section-title">🏆 أفضل العملاء</div>
    <table>
      <tr><th>العميل</th><th>الهاتف</th><th>الطلبات</th><th>الإجمالي</th></tr>
      ${topCustomers.rows.map((c,i) => `
        <tr>
          <td><span style="background:#f1f5f9;border-radius:20px;padding:1px 8px;font-size:.72rem;margin-left:6px">${i+1}</span>${escapeHtml(c.customer_name)}</td>
          <td dir="ltr" style="color:#64748b">${escapeHtml(c.customer_phone)}</td>
          <td style="text-align:center;font-weight:700">${c.orders}</td>
          <td style="font-weight:700;color:#4f8ef7">${formatCurrency(c.spent)}</td>
        </tr>`).join('')}
    </table>
  </div>

  <!-- ORDERS TABLE -->
  <div class="section">
    <div class="section-title">📋 تفاصيل الطلبات (أحدث ${Math.min(orders.rows.length,30)})</div>
    <table>
      <tr><th>#</th><th>العميل</th><th>الهاتف</th><th>المبلغ</th><th>العربون</th><th>الحالة</th><th>التاريخ</th></tr>
      ${orders.rows.slice(0,30).map(o => `
        <tr>
          <td style="color:#94a3b8;font-family:monospace">${o.id}</td>
          <td>${escapeHtml(o.customer_name)}</td>
          <td dir="ltr" style="color:#64748b;font-size:.82rem">${escapeHtml(o.customer_phone)}</td>
          <td style="font-weight:700">${formatCurrency(o.total)}</td>
          <td style="color:#64748b">${parseFloat(o.deposit||0)>0?formatCurrency(o.deposit):'-'}</td>
          <td><span class="badge" style="background:${statusColors[o.status]||'#94a3b8'}22;color:${statusColors[o.status]||'#94a3b8'}">${statusLabels[o.status]||o.status}</span></td>
          <td style="color:#64748b;font-size:.82rem">${new Date(o.created_at).toLocaleDateString('ar',{day:'numeric',month:'short',year:'numeric'})}</td>
        </tr>`).join('')}
    </table>
  </div>
</div>
<div class="footer">
  تم إنشاء هذا التقرير تلقائياً بواسطة SocialOS ⚡ · ${new Date().toLocaleDateString('ar')}
  <button onclick="window.print()" style="margin-right:16px;padding:6px 16px;background:#4f8ef7;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:'Tajawal',sans-serif;font-size:.82rem">🖨️ طباعة</button>
</div>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="socialos-report-${period||'weekly'}-${new Date().toISOString().split('T')[0]}.html"`);
      return res.send(html);
    }
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ========== MARKETPLACE ==========
app.get('/api/marketplace/store/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    if (pool) {
      const [user, products, settings] = await Promise.all([
        pool.query('SELECT name, bio, avatar_url FROM users WHERE id=$1', [userId]),
        pool.query('SELECT * FROM products WHERE user_id=$1 AND is_available=true ORDER BY created_at DESC', [userId]),
        pool.query('SELECT store_name, business_type, business_desc, location FROM user_settings WHERE user_id=$1', [userId])
      ]);
      if (user.rows.length === 0) return res.status(404).json({ message: 'المتجر غير موجود' });
      return res.json({
        success: true,
        store: {
          owner: user.rows[0],
          settings: settings.rows[0] || {},
          products: products.rows
        }
      });
    }
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/marketplace/order', async (req, res) => {
  const { store_user_id, customer_name, customer_phone, customer_address, product_id, quantity, notes } = req.body;
  if (!store_user_id || !customer_name || !customer_phone || !product_id) {
    return res.status(400).json({ success: false, message: 'البيانات ناقصة' });
  }
  try {
    if (pool) {
      const product = await pool.query('SELECT * FROM products WHERE id=$1 AND user_id=$2 AND is_available=true', [product_id, store_user_id]);
      if (product.rows.length === 0) return res.status(404).json({ success: false, message: 'المنتج غير متاح' });
      const prod = product.rows[0];
      const qty = parseInt(quantity) || 1;
      const total = parseFloat(prod.price) * qty;
      const result = await pool.query(
        'INSERT INTO orders (user_id, customer_name, customer_phone, customer_address, items, total, platform) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [store_user_id, customer_name, customer_phone, customer_address || '', JSON.stringify([{description: prod.name, quantity: qty, price: prod.price}]), total, 'marketplace']
      );
      // Update stock
      await pool.query('UPDATE products SET stock=GREATEST(0,stock-$1) WHERE id=$2', [qty, product_id]);
      // Notify store owner
      await pool.query('INSERT INTO notifications (user_id, title, message, type) VALUES ($1,$2,$3,$4)',
        [store_user_id, '🛒 طلب جديد من المتجر!', `${customer_name} طلب ${prod.name} × ${qty} — ${total}`, 'marketplace']);
      return res.json({ success: true, order: result.rows[0] });
    }
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ========== TRANSLATIONS ==========
const translations = {
  ar: {
    dashboard: 'لوحة التحكم', orders: 'الطلبات', products: 'المنتجات',
    customers: 'العملاء', analytics: 'التحليلات', settings: 'الإعدادات',
    new_order: 'طلب جديد', save: 'حفظ', cancel: 'إلغاء', delete: 'حذف',
    search: 'بحث', loading: 'جاري التحميل', success: 'تم بنجاح',
    error: 'حدث خطأ', login: 'دخول', register: 'تسجيل', logout: 'خروج'
  },
  en: {
    dashboard: 'Dashboard', orders: 'Orders', products: 'Products',
    customers: 'Customers', analytics: 'Analytics', settings: 'Settings',
    new_order: 'New Order', save: 'Save', cancel: 'Cancel', delete: 'Delete',
    search: 'Search', loading: 'Loading', success: 'Success',
    error: 'Error occurred', login: 'Login', register: 'Register', logout: 'Logout'
  },
  ku: {
    dashboard: 'داشبۆرد', orders: 'داواکاریەکان', products: 'بەرهەمەکان',
    customers: 'کڕیارەکان', analytics: 'شیکاری', settings: 'ڕێکخستن',
    new_order: 'داواکاری نوێ', save: 'پاشەکەوت بکە', cancel: 'هەڵوەشاندنەوە', delete: 'سڕینەوە',
    search: 'گەڕان', loading: 'چاوەڕوان بە', success: 'سەرکەفتووانە',
    error: 'هەڵە ڕوویدا', login: 'چوونەژوورەوە', register: 'تۆمارکردن', logout: 'چوونەدەرەوە'
  }
};

app.get('/api/translations/:lang', (req, res) => {
  const lang = req.params.lang;
  if (!translations[lang]) return res.status(404).json({ message: 'اللغة غير متاحة' });
  res.json({ success: true, translations: translations[lang], lang });
});

// ========== MOBILE APP FEATURES ==========
app.get('/api/mobile/dashboard', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (pool) {
      const [orders, revenue, notifications, lowStock] = await Promise.all([
        pool.query('SELECT COUNT(*) as count FROM orders WHERE user_id=$1 AND DATE(created_at)=CURRENT_DATE', [userId]),
        pool.query('SELECT SUM(total) as total FROM orders WHERE user_id=$1 AND DATE(created_at)=CURRENT_DATE', [userId]),
        pool.query('SELECT COUNT(*) as count FROM notifications WHERE user_id=$1 AND is_read=false', [userId]),
        pool.query('SELECT COUNT(*) as count FROM products WHERE user_id=$1 AND stock<=5', [userId])
      ]);
      return res.json({
        success: true,
        today: {
          orders: parseInt(orders.rows[0]?.count || 0),
          revenue: parseFloat(revenue.rows[0]?.total || 0),
          unread_notifications: parseInt(notifications.rows[0]?.count || 0),
          low_stock_alerts: parseInt(lowStock.rows[0]?.count || 0)
        }
      });
    }
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ========== VOICE COMMAND (Claude AI) ==========
app.post('/api/voice-command', authenticateToken, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ success: false });

    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_KEY) return res.status(500).json({ success: false, message: 'Anthropic key missing' });

    const systemPrompt = `أنت منفذ أوامر لتطبيق سوشيال ميديا. مهمتك الوحيدة: تحليل الأمر وإرجاع JSON فقط بدون أي كلام أو أسئلة.

قواعد صارمة:
1. لا تسأل أي أسئلة أبداً
2. نفذ الأمر فوراً بناءً على فهمك
3. أرجع JSON فقط

الأوامر:
- design: تصميم صورة. prompt = وصف بالإنجليزي (ترجم أنت)
- create_post: إنشاء منشور. content = نص المنشور
- new_order: طلب جديد
- new_product: منتج جديد  
- navigate: انتقال. page = orders/analytics/messages/profile/products/customers/schedule/settings/design/ai/report/create
- generate_content: توليد محتوى. prompt = الموضوع
- answer: رد نصي. text = الرد

أمثلة:
"صمم لي صورة كنبات فاخرة" → {"action":"design","prompt":"luxury sofa set, elegant living room furniture, professional photography, dark background","message":"🎨 جاري تصميم الكنب الفاخر..."}
"صمم شعار لمتجر عطور" → {"action":"design","prompt":"luxury perfume store logo, elegant, gold and black, minimal design","message":"🎨 جاري تصميم الشعار..."}
"افتح الطلبات" → {"action":"navigate","page":"orders","message":"✅ تم فتح الطلبات"}
"كم عدد طلباتي" → {"action":"navigate","page":"analytics","message":"✅ جاري فتح التحليلات"}
"اكتب منشور عن خصم 50%" → {"action":"create_post","content":"🎉 خصم 50% على جميع المنتجات! لا تفوت الفرصة","message":"✅ تم كتابة المنشور"}
"أضف طلب جديد" → {"action":"new_order","message":"✅ فتح نموذج الطلب"}

أرجع JSON فقط بدون أي نص إضافي.`;


    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        system: systemPrompt,
        messages: [{ role: 'user', content: text }]
      })
    });

    const aiData = await response.json();
    console.log('Voice AI response:', JSON.stringify(aiData.content?.[0]?.text?.substring(0,200)));
    let rawText = aiData.content?.[0]?.text || '';
    
    let command;
    try {
      // Extract complete JSON object
      const jsonMatch = rawText.match(/\{[\s\S]*?\}/);
      command = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      if(!command || !command.action) throw new Error('no action');
    } catch(e) {
      // Smart fallback based on user text
      if(/صمم|تصميم|صورة/.test(text)) {
        // Keep original Arabic text - server will translate it
        const imageDesc = text.replace(/صمم لي صورة|صمم لي|صمم|اعمل لي صورة|اعمل صورة|ولد صورة|تصميم صورة عن|تصميم صورة/g,'').trim();
        command = { action: 'design', prompt: imageDesc || text, message: '🎨 جاري التصميم...' };
      } else if(/منشور|انشر/.test(text)) {
        command = { action: 'create_post', content: text.replace(/اكتب منشور عن|منشور عن|انشر/g,'').trim(), message: '✅ تم كتابة المنشور' };
      } else if(/طلب/.test(text)) {
        command = { action: 'new_order', message: '✅ فتح نموذج الطلب' };
      } else if(/منتج/.test(text)) {
        command = { action: 'new_product', message: '✅ فتح نموذج المنتج' };
      } else if(/تحليل|إحصائيات/.test(text)) {
        command = { action: 'navigate', page: 'analytics', message: '✅ فتح التحليلات' };
      } else {
        command = { action: 'navigate', page: 'ai', message: '✅ تم الفتح' };
      }
    }

    res.json({ success: true, command, message: command.message || '✅ تم التنفيذ' });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ========== GENERATE IMAGE (DALL-E 3 PRIMARY + FLUX FALLBACK) ==========
app.post('/api/generate-image', authenticateToken, async (req, res) => {
  try {
    let { prompt, width = 1024, height = 1024 } = req.body;
    if (!prompt) return res.status(400).json({ message: 'prompt required' });

    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

    // ===== تحسين الـ prompt بـ Claude أولاً =====
    let enhancedPrompt = prompt;
    if (ANTHROPIC_KEY) {
      try {
        const enhRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 400,
            messages: [{ role: 'user', content: `You are an expert DALL-E 3 image generation prompt engineer. Your task is to convert any Arabic or English request into a perfect DALL-E 3 prompt.

User request: "${prompt}"

Step 1 - Identify the exact subject and type:
- كنبة/أريكة/sofa → luxury sofa/couch
- طقم كنب → sofa set, living room furniture
- غرفة/ديكور → interior room
- شعار/لوغو → logo design
- منتج → product photography
- بوستر/إعلان → advertising poster
- طعام/أكل → food photography
- ملابس → fashion/clothing

Step 2 - Build a detailed English prompt:
- For furniture/sofa: "Professional interior photography of [exact item], elegant luxury design, [color], [style], showroom quality, soft professional lighting, no people, photorealistic"
- For logo: "Minimalist flat vector logo, [subject], clean design, white background, no text, no words"
- For product: "Professional commercial product photography, [item], studio lighting, clean background"
- For poster: "Professional advertising poster design, [subject], bold layout, no Arabic text"
- For food: "Professional food photography, [dish], beautiful plating, soft lighting"
- For interior: "Professional interior design photography, [room type], [style], natural lighting"

Step 3 - CRITICAL RULES:
- NEVER add any text, letters, Arabic writing, or numbers to the image description
- Always add at the end: "no text, no letters, no Arabic, no watermark, high quality, 8k"
- Be very specific about colors, materials, and style

Return ONLY the final English prompt. No explanation.` }]
          })
        });
        const enhData = await enhRes.json();
        if (enhData.content?.[0]?.text) enhancedPrompt = enhData.content[0].text.trim();
      } catch(e) { console.log('Prompt enhancement failed'); }
    }

    // ===== DALL-E 3 (الأفضل والأذكى) =====
    if (OPENAI_KEY) {
      try {
        const size = width === height ? '1024x1024' : width > height ? '1792x1024' : '1024x1792';
        const dalleRes = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'dall-e-3',
            prompt: enhancedPrompt,
            n: 1,
            size,
            quality: 'standard',
            response_format: 'url'
          })
        });
        const dalleData = await dalleRes.json();
        if (dalleData.data?.[0]?.url) {
          return res.json({ success: true, image_url: dalleData.data[0].url, model: 'dall-e-3' });
        }
        console.log('DALL-E 3 failed:', JSON.stringify(dalleData).substring(0, 200));
      } catch(e) { console.log('DALL-E 3 error:', e.message); }
    }

    // ===== Flux Fallback =====
    if (!REPLICATE_TOKEN) return res.status(500).json({ success: false, message: 'فشل التوليد — تحقق من OPENAI_API_KEY' });

    const https = require('https');
    const body = JSON.stringify({
      input: { prompt: enhancedPrompt, width: parseInt(width), height: parseInt(height), num_outputs: 1, num_inference_steps: 4, output_format: 'jpg', output_quality: 90 }
    });
    const makeRequest = (url, options, postData) => new Promise((resolve, reject) => {
      const req = https.request(url, options, (r) => {
        let data = ''; r.on('data', c => data += c);
        r.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
      });
      req.on('error', reject);
      if (postData) req.write(postData);
      req.end();
    });
    let prediction = await makeRequest(
      'https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions',
      { method: 'POST', headers: { 'Authorization': `Bearer ${REPLICATE_TOKEN}`, 'Content-Type': 'application/json', 'Prefer': 'wait' } },
      body
    );
    let attempts = 0;
    while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && attempts < 30) {
      await new Promise(r => setTimeout(r, 1500));
      prediction = await makeRequest(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
        method: 'GET', headers: { 'Authorization': `Bearer ${REPLICATE_TOKEN}` }
      });
      attempts++;
    }
    if (prediction.status === 'succeeded' && prediction.output?.[0]) {
      return res.json({ success: true, image_url: prediction.output[0], model: 'flux' });
    }
    res.status(500).json({ success: false, message: prediction.error || 'فشل التوليد' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// PORT defined here but listen called at end of file
const PORT = process.env.PORT || 3000;

// ========== SEARCH ORDERS ==========
app.get('/api/orders/search', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { q } = req.query;
  if (!q) return res.json({ orders: [] });
  try {
    if (pool) {
      const r = await pool.query(
        `SELECT * FROM orders WHERE user_id=$1 AND (
          customer_name ILIKE $2 OR 
          customer_phone ILIKE $2 OR 
          items::text ILIKE $2 OR
          notes ILIKE $2
        ) ORDER BY created_at DESC LIMIT 20`,
        [userId, `%${q}%`]
      );
      return res.json({ orders: r.rows });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
  res.json({ orders: [] });
});

// ========== EXPORT ORDERS ==========
app.get('/api/orders/export', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { format, period } = req.query;
  const days = period === 'month' ? 30 : period === 'year' ? 365 : null;
  try {
    if (pool) {
      let query = 'SELECT * FROM orders WHERE user_id=$1';
      const params = [userId];
      if (days) { query += ` AND created_at >= NOW() - INTERVAL '${days} days'`; }
      query += ' ORDER BY created_at DESC';
      const r = await pool.query(query, params);
      const orders = r.rows;

      // Proper CSV with quoting for Arabic/special chars
      const csvEscape = (val) => {
        const str = String(val == null ? '' : val).replace(/"/g, '""');
        return `"${str}"`;
      };
      const statusLabels = { new: 'جديد', confirmed: 'مؤكد', processing: 'قيد التجهيز', delivered: 'تم التوصيل', cancelled: 'ملغي' };
      const headers = ['رقم الطلب', 'اسم العميل', 'الهاتف', 'العنوان', 'المبلغ الإجمالي', 'العربون', 'المتبقي', 'الحالة', 'طريقة الدفع', 'شركة التوصيل', 'المنصة', 'ملاحظات', 'التاريخ'];
      const rows = orders.map(o => [
        o.id,
        o.customer_name,
        o.customer_phone,
        o.customer_address || '',
        parseFloat(o.total || 0).toFixed(2),
        parseFloat(o.deposit || 0).toFixed(2),
        (parseFloat(o.total || 0) - parseFloat(o.deposit || 0)).toFixed(2),
        statusLabels[o.status] || o.status,
        o.payment_method || '',
        o.delivery_company || '',
        o.platform || '',
        o.notes || '',
        new Date(o.created_at).toLocaleString('ar')
      ]);
      const csv = [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\r\n');
      const filename = `orders-${new Date().toISOString().split('T')[0]}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send('\uFEFF' + csv); // BOM for Excel Arabic
    }
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ========== EXPORT PRODUCTS ==========
app.get('/api/products/export', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM products WHERE user_id=$1 ORDER BY category, name', [userId]);
      const csvEscape = (val) => `"${String(val == null ? '' : val).replace(/"/g, '""')}"`;
      const headers = ['رقم', 'اسم المنتج', 'الفئة', 'السعر', 'المخزون', 'الوصف', 'متاح', 'التاريخ'];
      const rows = r.rows.map(p => [
        p.id, p.name, p.category || '', parseFloat(p.price||0).toFixed(2),
        p.stock || 0, p.description || '', p.is_available ? 'نعم' : 'لا',
        new Date(p.created_at).toLocaleDateString('ar')
      ]);
      const csv = [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="products-${new Date().toISOString().split('T')[0]}.csv"`);
      return res.send('\uFEFF' + csv);
    }
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ========== EXPORT CUSTOMERS ==========
app.get('/api/customers/export', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (pool) {
      const r = await pool.query(`
        SELECT c.*, 
          COUNT(o.id) as orders_count, 
          COALESCE(SUM(o.total),0) as total_spent,
          MAX(o.created_at) as last_order
        FROM customers c
        LEFT JOIN orders o ON o.user_id=c.user_id AND o.customer_phone=c.phone
        WHERE c.user_id=$1
        GROUP BY c.id ORDER BY total_spent DESC`, [userId]);
      const csvEscape = (val) => `"${String(val == null ? '' : val).replace(/"/g, '""')}"`;
      const headers = ['رقم', 'الاسم', 'الهاتف', 'العنوان', 'عدد الطلبات', 'إجمالي الإنفاق', 'آخر طلب', 'ملاحظات'];
      const rows = r.rows.map(c => [
        c.id, c.name, c.phone, c.address || '',
        c.orders_count || 0, parseFloat(c.total_spent||0).toFixed(2),
        c.last_order ? new Date(c.last_order).toLocaleDateString('ar') : '-',
        c.notes || ''
      ]);
      const csv = [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="customers-${new Date().toISOString().split('T')[0]}.csv"`);
      return res.send('\uFEFF' + csv);
    }
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ========== CHANGE PASSWORD ==========
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  const { current_password, new_password } = req.body;
  const userId = req.user.id;
  if (!current_password || !new_password) return res.status(400).json({ success: false, message: 'جميع الحقول مطلوبة' });
  if (new_password.length < 6) return res.status(400).json({ success: false, message: 'كلمة المرور 6 أحرف على الأقل' });
  try {
    if (pool) {
      const result = await pool.query('SELECT password FROM users WHERE id=$1', [userId]);
      if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
      const isMatch = await bcrypt.compare(current_password, result.rows[0].password);
      if (!isMatch) return res.status(401).json({ success: false, message: 'كلمة المرور الحالية غير صحيحة' });
      const hashedNew = await bcrypt.hash(new_password, 10);
      await pool.query('UPDATE users SET password=$1 WHERE id=$2', [hashedNew, userId]);
      return res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح' });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// ========== AUDIT LOG ==========
app.get('/api/security/status', authenticateToken, async (req, res) => {
  res.json({
    success: true,
    security: {
      blocked_ips: blockedIPs.size,
      rate_limit_active: true,
      headers_active: true,
      jwt_active: true,
      bcrypt_active: true
    }
  });
});

// ========== NOTIFICATIONS ==========
const notifications = {};

app.get('/api/notifications', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (pool) {
      const r = await pool.query(
        'SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20',
        [userId]
      );
      return res.json({ notifications: r.rows });
    }
  } catch (e) {}
  res.json({ notifications: notifications[userId] || [] });
});

app.put('/api/notifications/read', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (pool) {
      await pool.query('UPDATE notifications SET is_read=true WHERE user_id=$1', [userId]);
      return res.json({ success: true });
    }
  } catch (e) {}
  res.json({ success: true });
});

// ========== PASSWORD RESET ==========
const resetCodes = {};

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'البريد مطلوب' });
  try {
    if (pool) {
      const result = await pool.query('SELECT id, name FROM users WHERE email=$1', [email]);
      if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'البريد غير موجود' });
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      resetCodes[email] = { code, expires: Date.now() + 15 * 60 * 1000 };
      console.log(`Reset code for ${email}: ${code}`);
      return res.json({ success: true, message: 'تم إرسال رمز التحقق' });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
  res.status(404).json({ success: false, message: 'البريد غير موجود' });
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { email, code, new_password } = req.body;
  if (!email || !code || !new_password) return res.status(400).json({ success: false, message: 'جميع الحقول مطلوبة' });
  if (new_password.length < 6) return res.status(400).json({ success: false, message: 'كلمة المرور 6 أحرف على الأقل' });
  const stored = resetCodes[email];
  if (!stored) return res.status(400).json({ success: false, message: 'لا يوجد طلب إعادة تعيين' });
  if (stored.code !== code) return res.status(400).json({ success: false, message: 'رمز التحقق غير صحيح' });
  if (Date.now() > stored.expires) return res.status(400).json({ success: false, message: 'انتهت صلاحية الرمز' });
  try {
    const hashedPassword = await bcrypt.hash(new_password, 10);
    if (pool) {
      await pool.query('UPDATE users SET password=$1 WHERE email=$2', [hashedPassword, email]);
      delete resetCodes[email];
      return res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح' });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
  res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
});

// ========== PDF INVOICE ==========
app.get('/api/orders/:id/invoice', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [req.params.id, userId]);
      if (r.rows.length === 0) return res.status(404).json({ message: 'الطلب غير موجود' });
      const order = r.rows[0];
      let items = [];
      try { items = JSON.parse(order.items || '[]'); } catch(e) {}
      const itemsText = items.map(i => i.description || '').filter(Boolean).join(', ') || 'لا تفاصيل';
      const invoiceHTML = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="UTF-8"><title>فاتورة #${order.id}</title>
<style>
body{font-family:Arial,sans-serif;padding:40px;color:#333;direction:rtl;}
.header{text-align:center;margin-bottom:30px;border-bottom:3px solid #00ff88;padding-bottom:20px;}
.header h1{color:#00ff88;font-size:2rem;margin:0;}
.header p{color:#666;margin:5px 0;}
.invoice-info{display:flex;justify-content:space-between;margin-bottom:30px;}
.info-block{background:#f9f9f9;padding:15px;border-radius:8px;flex:1;margin:0 5px;}
.info-block h3{margin:0 0 10px;color:#333;font-size:.9rem;text-transform:uppercase;}
.items-table{width:100%;border-collapse:collapse;margin-bottom:30px;}
.items-table th{background:#00ff88;color:#000;padding:10px;text-align:right;}
.items-table td{padding:10px;border-bottom:1px solid #eee;}
.total-section{text-align:left;margin-top:20px;}
.total-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee;}
.total-final{font-size:1.3rem;font-weight:bold;color:#00ff88;border-top:2px solid #00ff88;padding-top:10px;}
.footer{text-align:center;margin-top:40px;color:#999;font-size:.85rem;}
.status-badge{padding:5px 15px;border-radius:20px;font-size:.8rem;font-weight:bold;background:#e8fff4;color:#00cc70;}
</style>
</head>
<body>
<div class="header">
  <h1>⚡ SocialOS</h1>
  <p>فاتورة رسمية</p>
</div>
<div class="invoice-info">
  <div class="info-block">
    <h3>معلومات الفاتورة</h3>
    <p><strong>رقم الفاتورة:</strong> #${order.id}</p>
    <p><strong>التاريخ:</strong> ${new Date(order.created_at).toLocaleDateString('ar')}</p>
    <p><strong>الحالة:</strong> <span class="status-badge">${order.status}</span></p>
  </div>
  <div class="info-block">
    <h3>معلومات العميل</h3>
    <p><strong>الاسم:</strong> ${order.customer_name}</p>
    <p><strong>الهاتف:</strong> ${order.customer_phone}</p>
    <p><strong>العنوان:</strong> ${order.customer_address || 'غير محدد'}</p>
  </div>
</div>
<table class="items-table">
  <thead><tr><th>الوصف</th><th>المبلغ</th></tr></thead>
  <tbody>
    <tr><td>${itemsText}</td><td>${formatCurrency(order.total)}</td></tr>
  </tbody>
</table>
<div class="total-section">
  <div class="total-row"><span>المجموع:</span><span>${formatCurrency(order.total)}</span></div>
  ${order.deposit > 0 ? `<div class="total-row"><span>العربون المدفوع:</span><span>${formatCurrency(order.deposit)}</span></div><div class="total-row total-final"><span>المتبقي:</span><span>${formatCurrency(order.total - order.deposit)}</span></div>` : `<div class="total-row total-final"><span>الإجمالي:</span><span>${formatCurrency(order.total)}</span></div>`}
</div>
${order.delivery_company ? `<p><strong>شركة التوصيل:</strong> ${order.delivery_company}</p>` : ''}
${order.notes ? `<p><strong>ملاحظات:</strong> ${order.notes}</p>` : ''}
<div class="footer">
  <p>شكراً لتعاملكم معنا | SocialOS ⚡</p>
  <p>تم إنشاء هذه الفاتورة تلقائياً</p>
</div>
</body>
</html>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(invoiceHTML);
    }
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ========== CREATE NOTIFICATIONS TABLE ==========
if (pool) {
  pool.query(`CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    title VARCHAR(255),
    message TEXT,
    type VARCHAR(50) DEFAULT 'info',
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
  )`).catch(e => console.log('notifications table:', e.message));
}

// ========== COUPONS ==========
if (pool) {
  pool.query(`CREATE TABLE IF NOT EXISTS coupons (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    code VARCHAR(50) UNIQUE NOT NULL,
    type VARCHAR(20) DEFAULT 'percent',
    value DECIMAL(10,2) NOT NULL,
    min_order DECIMAL(10,2) DEFAULT 0,
    max_uses INTEGER DEFAULT 100,
    used_count INTEGER DEFAULT 0,
    expires_at TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
  )`).catch(e => console.log('coupons table:', e.message));
}

// Create coupon
app.post('/api/coupons', authenticateToken, async (req, res) => {
  const { code, type, value, min_order, max_uses, expires_at } = req.body;
  const userId = req.user.id;
  if (!code || !value) return res.status(400).json({ success: false, message: 'الكود والقيمة مطلوبان' });
  if (!['percent', 'fixed'].includes(type)) return res.status(400).json({ success: false, message: 'نوع غير صحيح' });
  if (parseFloat(value) <= 0) return res.status(400).json({ success: false, message: 'القيمة يجب أن تكون أكبر من صفر' });
  if (type === 'percent' && parseFloat(value) > 100) return res.status(400).json({ success: false, message: 'النسبة لا تتجاوز 100%' });
  try {
    if (pool) {
      const result = await pool.query(
        'INSERT INTO coupons (user_id, code, type, value, min_order, max_uses, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [userId, code.toUpperCase().trim(), type || 'percent', parseFloat(value), parseFloat(min_order) || 0, parseInt(max_uses) || 100, expires_at || null]
      );
      return res.json({ success: true, coupon: result.rows[0] });
    }
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message.includes('unique') ? 'هذا الكود مستخدم مسبقاً' : e.message });
  }
});

// Get all coupons
app.get('/api/coupons', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM coupons WHERE user_id=$1 ORDER BY created_at DESC', [userId]);
      return res.json({ success: true, coupons: r.rows });
    }
  } catch (e) {}
  res.json({ success: true, coupons: [] });
});

// Validate coupon (public - used by store customers)
app.post('/api/coupons/validate', async (req, res) => {
  const { code, order_total, store_user_id } = req.body;
  if (!code || !store_user_id) return res.status(400).json({ success: false, message: 'البيانات ناقصة' });
  try {
    if (pool) {
      const r = await pool.query(
        `SELECT * FROM coupons WHERE user_id=$1 AND code=$2 AND is_active=true
         AND (expires_at IS NULL OR expires_at > NOW())
         AND used_count < max_uses`,
        [store_user_id, code.toUpperCase().trim()]
      );
      if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'الكود غير صحيح أو منتهي الصلاحية' });
      const coupon = r.rows[0];
      const total = parseFloat(order_total) || 0;
      if (total < parseFloat(coupon.min_order)) {
        return res.status(400).json({ success: false, message: `الحد الأدنى للطلب ${coupon.min_order}` });
      }
      const discount = coupon.type === 'percent'
        ? (total * parseFloat(coupon.value) / 100)
        : Math.min(parseFloat(coupon.value), total);
      return res.json({ success: true, coupon, discount: parseFloat(discount.toFixed(2)), final_total: parseFloat((total - discount).toFixed(2)) });
    }
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Apply coupon (increment used_count)
app.post('/api/coupons/apply', authenticateToken, async (req, res) => {
  const { code } = req.body;
  const userId = req.user.id;
  try {
    if (pool) {
      await pool.query('UPDATE coupons SET used_count=used_count+1 WHERE user_id=$1 AND code=$2', [userId, code.toUpperCase().trim()]);
      return res.json({ success: true });
    }
  } catch (e) {}
  res.json({ success: true });
});

// Delete coupon
app.delete('/api/coupons/:id', authenticateToken, async (req, res) => {
  try {
    if (pool) { await pool.query('DELETE FROM coupons WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]); }
    return res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Toggle coupon active
app.put('/api/coupons/:id/toggle', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      await pool.query('UPDATE coupons SET is_active=NOT is_active WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
      return res.json({ success: true });
    }
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ========== LOYALTY POINTS ==========
if (pool) {
  pool.query(`CREATE TABLE IF NOT EXISTS loyalty_points (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    customer_phone VARCHAR(50),
    customer_name VARCHAR(255),
    points INTEGER DEFAULT 0,
    total_earned INTEGER DEFAULT 0,
    total_redeemed INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, customer_phone)
  )`).catch(e => console.log('loyalty table:', e.message));

  pool.query(`CREATE TABLE IF NOT EXISTS loyalty_transactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    customer_phone VARCHAR(50),
    points INTEGER,
    type VARCHAR(20),
    order_id INTEGER,
    note TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )`).catch(e => console.log('loyalty_tx table:', e.message));

  pool.query(`CREATE TABLE IF NOT EXISTS loyalty_settings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE,
    points_per_currency DECIMAL(10,4) DEFAULT 1,
    redeem_rate DECIMAL(10,4) DEFAULT 100,
    min_redeem INTEGER DEFAULT 100,
    is_active BOOLEAN DEFAULT TRUE
  )`).catch(e => console.log('loyalty_settings table:', e.message));
}

// Get loyalty settings
app.get('/api/loyalty/settings', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM loyalty_settings WHERE user_id=$1', [req.user.id]);
      return res.json({ success: true, settings: r.rows[0] || { points_per_currency: 1, redeem_rate: 100, min_redeem: 100, is_active: true } });
    }
  } catch (e) {}
  res.json({ success: true, settings: { points_per_currency: 1, redeem_rate: 100, min_redeem: 100, is_active: true } });
});

// Save loyalty settings
app.put('/api/loyalty/settings', authenticateToken, async (req, res) => {
  const { points_per_currency, redeem_rate, min_redeem, is_active } = req.body;
  try {
    if (pool) {
      await pool.query(`INSERT INTO loyalty_settings (user_id, points_per_currency, redeem_rate, min_redeem, is_active)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (user_id) DO UPDATE SET points_per_currency=$2, redeem_rate=$3, min_redeem=$4, is_active=$5`,
        [req.user.id, parseFloat(points_per_currency)||1, parseFloat(redeem_rate)||100, parseInt(min_redeem)||100, is_active!==false]
      );
      return res.json({ success: true });
    }
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Get customer loyalty points
app.get('/api/loyalty/customer/:phone', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM loyalty_points WHERE user_id=$1 AND customer_phone=$2', [req.user.id, req.params.phone]);
      const txs = await pool.query('SELECT * FROM loyalty_transactions WHERE user_id=$1 AND customer_phone=$2 ORDER BY created_at DESC LIMIT 20', [req.user.id, req.params.phone]);
      return res.json({ success: true, loyalty: r.rows[0] || { points: 0, total_earned: 0, total_redeemed: 0 }, transactions: txs.rows });
    }
  } catch (e) {}
  res.json({ success: true, loyalty: { points: 0 }, transactions: [] });
});

// Add points (called after order completion)
app.post('/api/loyalty/add', authenticateToken, async (req, res) => {
  const { customer_phone, customer_name, order_id, order_total } = req.body;
  const userId = req.user.id;
  if (!customer_phone || !order_total) return res.status(400).json({ success: false, message: 'البيانات ناقصة' });
  try {
    if (pool) {
      const settingsRes = await pool.query('SELECT * FROM loyalty_settings WHERE user_id=$1', [userId]);
      const settings = settingsRes.rows[0] || { points_per_currency: 1, is_active: true };
      if (!settings.is_active) return res.json({ success: false, message: 'نظام النقاط غير مفعّل' });
      const points = Math.floor(parseFloat(order_total) * parseFloat(settings.points_per_currency));
      if (points <= 0) return res.json({ success: false, message: 'لا نقاط لهذا الطلب' });
      await pool.query(`INSERT INTO loyalty_points (user_id, customer_phone, customer_name, points, total_earned)
        VALUES ($1,$2,$3,$4,$4)
        ON CONFLICT (user_id, customer_phone) DO UPDATE SET
          points=loyalty_points.points+$4,
          total_earned=loyalty_points.total_earned+$4,
          customer_name=COALESCE($3, loyalty_points.customer_name),
          updated_at=NOW()`,
        [userId, customer_phone, customer_name || '', points]
      );
      await pool.query('INSERT INTO loyalty_transactions (user_id, customer_phone, points, type, order_id, note) VALUES ($1,$2,$3,$4,$5,$6)',
        [userId, customer_phone, points, 'earn', order_id || null, `طلب #${order_id || '?'} — ${parseFloat(order_total).toFixed(0)}`]
      );
      return res.json({ success: true, points_added: points });
    }
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Redeem points
app.post('/api/loyalty/redeem', authenticateToken, async (req, res) => {
  const { customer_phone, points_to_redeem } = req.body;
  const userId = req.user.id;
  if (!customer_phone || !points_to_redeem) return res.status(400).json({ success: false, message: 'البيانات ناقصة' });
  try {
    if (pool) {
      const [loyaltyRes, settingsRes] = await Promise.all([
        pool.query('SELECT * FROM loyalty_points WHERE user_id=$1 AND customer_phone=$2', [userId, customer_phone]),
        pool.query('SELECT * FROM loyalty_settings WHERE user_id=$1', [userId])
      ]);
      const loyalty = loyaltyRes.rows[0];
      const settings = settingsRes.rows[0] || { redeem_rate: 100, min_redeem: 100 };
      if (!loyalty || loyalty.points < parseInt(points_to_redeem)) return res.status(400).json({ success: false, message: 'رصيد النقاط غير كافٍ' });
      if (parseInt(points_to_redeem) < parseInt(settings.min_redeem)) return res.status(400).json({ success: false, message: `الحد الأدنى للاسترداد ${settings.min_redeem} نقطة` });
      const discount = parseFloat((parseInt(points_to_redeem) / parseFloat(settings.redeem_rate)).toFixed(2));
      await pool.query('UPDATE loyalty_points SET points=points-$1, total_redeemed=total_redeemed+$1, updated_at=NOW() WHERE user_id=$2 AND customer_phone=$3',
        [parseInt(points_to_redeem), userId, customer_phone]
      );
      await pool.query('INSERT INTO loyalty_transactions (user_id, customer_phone, points, type, note) VALUES ($1,$2,$3,$4,$5)',
        [userId, customer_phone, -parseInt(points_to_redeem), 'redeem', `استرداد ${points_to_redeem} نقطة = خصم ${discount}`]
      );
      return res.json({ success: true, discount, points_redeemed: parseInt(points_to_redeem) });
    }
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Get all loyalty customers
app.get('/api/loyalty/customers', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM loyalty_points WHERE user_id=$1 ORDER BY points DESC', [req.user.id]);
      return res.json({ success: true, customers: r.rows });
    }
  } catch (e) {}
  res.json({ success: true, customers: [] });
});

// ========== BULK WHATSAPP ==========
app.post('/api/whatsapp/bulk', authenticateToken, async (req, res) => {
  const { message, target } = req.body;
  const userId = req.user.id;
  if (!message || !message.trim()) return res.status(400).json({ success: false, message: 'الرسالة مطلوبة' });
  if (message.length > 1000) return res.status(400).json({ success: false, message: 'الرسالة طويلة جداً (أقصى 1000 حرف)' });
  try {
    if (pool) {
      let phones = [];
      if (target === 'all_customers') {
        const r = await pool.query('SELECT DISTINCT customer_phone, customer_name FROM orders WHERE user_id=$1', [userId]);
        phones = r.rows;
      } else if (target === 'loyalty') {
        const r = await pool.query('SELECT customer_phone, customer_name FROM loyalty_points WHERE user_id=$1 AND points > 0', [userId]);
        phones = r.rows;
      } else if (target === 'recent') {
        const r = await pool.query(`SELECT DISTINCT customer_phone, customer_name FROM orders WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '30 days'`, [userId]);
        phones = r.rows;
      } else if (target === 'custom' && req.body.phones) {
        phones = req.body.phones.map(p => ({ customer_phone: p, customer_name: '' }));
      }
      if (phones.length === 0) return res.json({ success: false, message: 'لا يوجد عملاء في هذه الفئة' });
      // Build WhatsApp links (max 50 at a time to avoid spam detection)
      const links = phones.slice(0, 50).map(c => {
        const cleanPhone = (c.customer_phone || '').replace(/[^0-9]/g, '');
        const waPhone = cleanPhone.startsWith('0') ? '964' + cleanPhone.slice(1) : cleanPhone;
        const personalizedMsg = message.replace('{اسم}', c.customer_name || 'عزيزي العميل');
        return { phone: waPhone, name: c.customer_name, url: `https://wa.me/${waPhone}?text=${encodeURIComponent(personalizedMsg)}` };
      });
      return res.json({ success: true, links, total: phones.length, shown: links.length });
    }
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Get bulk targets count
app.get('/api/whatsapp/bulk/counts', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (pool) {
      const [all, recent, loyalty] = await Promise.all([
        pool.query('SELECT COUNT(DISTINCT customer_phone) as count FROM orders WHERE user_id=$1', [userId]),
        pool.query(`SELECT COUNT(DISTINCT customer_phone) as count FROM orders WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '30 days'`, [userId]),
        pool.query('SELECT COUNT(*) as count FROM loyalty_points WHERE user_id=$1 AND points > 0', [userId])
      ]);
      return res.json({
        success: true,
        counts: {
          all: parseInt(all.rows[0]?.count || 0),
          recent: parseInt(recent.rows[0]?.count || 0),
          loyalty: parseInt(loyalty.rows[0]?.count || 0)
        }
      });
    }
  } catch (e) {}
  res.json({ success: true, counts: { all: 0, recent: 0, loyalty: 0 } });
});

// ========== CLOUDINARY IMAGE UPLOAD ==========
app.post('/api/upload/image', authenticateToken, async (req, res) => {
  const { image, folder } = req.body; // image = base64 data URL
  if (!image) return res.status(400).json({ success: false, message: 'الصورة مطلوبة' });

  const CLOUDINARY_CLOUD = process.env.CLOUDINARY_CLOUD_NAME;
  const CLOUDINARY_KEY   = process.env.CLOUDINARY_API_KEY;
  const CLOUDINARY_SECRET= process.env.CLOUDINARY_API_SECRET;

  // If Cloudinary not configured → return the base64 as-is (fallback)
  if (!CLOUDINARY_CLOUD || !CLOUDINARY_KEY || !CLOUDINARY_SECRET) {
    // Validate it's actually an image base64
    if (!image.startsWith('data:image/')) {
      return res.status(400).json({ success: false, message: 'صيغة صورة غير صحيحة' });
    }
    // Size check: base64 ~1.37x actual size, limit 2MB actual
    if (image.length > 2.8 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: 'الصورة أكبر من 2MB' });
    }
    return res.json({ success: true, url: image, source: 'base64', message: 'تم الحفظ (Cloudinary غير مفعّل)' });
  }

  try {
    // Validate image size before upload (base64 ~1.37x actual)
    if (image.length > 10 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: 'الصورة أكبر من 7MB' });
    }

    // Use Cloudinary REST API directly (no SDK needed)
    const crypto = require('crypto');
    const timestamp = Math.floor(Date.now() / 1000);
    const uploadFolder = folder || 'socialos';
    const paramsToSign = `folder=${uploadFolder}&timestamp=${timestamp}`;
    const signature = crypto.createHmac('sha256', CLOUDINARY_SECRET)
      .update(paramsToSign)
      .digest('hex');

    // Build form data manually
    const boundary = '----CloudinaryBoundary' + Date.now();
    const base64Data = image.includes(',') ? image.split(',')[1] : image;
    const mimeType = image.includes('data:') ? image.split(';')[0].split(':')[1] : 'image/jpeg';

    const formBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"',
      '',
      image, // send full data URL
      `--${boundary}`,
      'Content-Disposition: form-data; name="api_key"',
      '',
      CLOUDINARY_KEY,
      `--${boundary}`,
      'Content-Disposition: form-data; name="timestamp"',
      '',
      String(timestamp),
      `--${boundary}`,
      'Content-Disposition: form-data; name="signature"',
      '',
      signature,
      `--${boundary}`,
      'Content-Disposition: form-data; name="folder"',
      '',
      uploadFolder,
      `--${boundary}--`
    ].join('\r\n');

    const uploadRes = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`,
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: formBody
      }
    );
    const uploadData = await uploadRes.json();

    if (uploadData.secure_url) {
      return res.json({ success: true, url: uploadData.secure_url, public_id: uploadData.public_id, source: 'cloudinary' });
    }
    // Cloudinary returned error → fallback to base64
    console.log('Cloudinary error:', uploadData.error?.message);
    return res.json({ success: true, url: image, source: 'base64', message: 'تم الحفظ (Cloudinary فشل مؤقتاً)' });
  } catch (e) {
    console.log('Upload error:', e.message);
    // Fallback: return base64
    return res.json({ success: true, url: image, source: 'base64' });
  }
});

// Cloudinary status check
app.get('/api/upload/status', authenticateToken, (req, res) => {
  const configured = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
  res.json({ configured, message: configured ? '✅ Cloudinary مفعّل' : '⚠️ Cloudinary غير مفعّل — الصور تُحفظ كـ Base64' });
});

// ========== PUSH NOTIFICATIONS ==========
// Store push subscriptions in DB
if (pool) {
  pool.query(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    endpoint TEXT UNIQUE,
    p256dh TEXT,
    auth TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )`).catch(e => console.log('push_subscriptions table:', e.message));
}

// Save push subscription
app.post('/api/push/subscribe', authenticateToken, async (req, res) => {
  const { endpoint, keys } = req.body;
  const userId = req.user.id;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ success: false, message: 'بيانات الاشتراك ناقصة' });
  }
  try {
    if (pool) {
      await pool.query(`
        INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (endpoint) DO UPDATE SET user_id=$1, p256dh=$3, auth=$4`,
        [userId, endpoint, keys.p256dh, keys.auth]
      );
      return res.json({ success: true });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
  res.json({ success: true });
});

// Remove push subscription
app.delete('/api/push/unsubscribe', authenticateToken, async (req, res) => {
  const { endpoint } = req.body;
  try {
    if (pool && endpoint) {
      await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1 AND user_id=$2', [endpoint, req.user.id]);
    }
  } catch (e) {}
  res.json({ success: true });
});

// Send push notification to user (internal helper + API)
async function sendPushToUser(userId, title, body, url = '/') {
  const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY;
  const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
  const VAPID_EMAIL   = process.env.VAPID_EMAIL || 'mailto:admin@socialos.app';
  if (!VAPID_PUBLIC || !VAPID_PRIVATE || !pool) return;
  try {
    const subs = await pool.query('SELECT * FROM push_subscriptions WHERE user_id=$1', [userId]);
    if (!subs.rows.length) return;
    // Use web-push if available, otherwise skip gracefully
    let webpush;
    try { webpush = require('web-push'); } catch(e) { return; }
    webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
    const payload = JSON.stringify({ title, body, url, icon: '/icon-192.png' });
    for (const sub of subs.rows) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
      } catch (e) {
        // Subscription expired → remove it
        if (e.statusCode === 410) {
          await pool.query('DELETE FROM push_subscriptions WHERE id=$1', [sub.id]).catch(()=>{});
        }
      }
    }
  } catch (e) { console.log('Push error:', e.message); }
}

// Send test push
app.post('/api/push/test', authenticateToken, async (req, res) => {
  try {
    await sendPushToUser(req.user.id, '🔔 SocialOS', 'الإشعارات تعمل بنجاح! ⚡', '/');
    res.json({ success: true, message: 'تم إرسال الإشعار التجريبي' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Get VAPID public key (needed by browser to subscribe)
app.get('/api/push/vapid-public', authenticateToken, (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.json({ success: false, message: 'VAPID غير مضبوط' });
  res.json({ success: true, key });
});

// Hook push into new order notification
const originalSendOrderNotif = async (userId, orderId, customerName, total) => {
  await sendPushToUser(userId, '🛒 طلب جديد!', `طلب من ${customerName} — ${formatCurrency(total)}`, '/?page=orders');
};

// ========== ENHANCED DELIVERY TRACKING ==========
// Iraqi + Gulf delivery companies + live status fetch
app.post('/api/delivery/track', authenticateToken, async (req, res) => {
  const { company, tracking_number, order_id } = req.body;
  if (!tracking_number) return res.status(400).json({ success: false, message: 'رقم التتبع مطلوب' });

  const trackingUrls = {
    // العراق
    madar:     `https://madarexpress.com/track/${tracking_number}`,
    alozon:    `https://alozon.iq/track?awb=${tracking_number}`,
    almada:    `https://almada-express.com/tracking?id=${tracking_number}`,
    // الخليج
    aramex:    `https://www.aramex.com/track/results?ShipmentNumber=${tracking_number}`,
    dhl:       `https://www.dhl.com/en/express/tracking.html?AWB=${tracking_number}`,
    fedex:     `https://www.fedex.com/apps/fedextrack/?tracknumbers=${tracking_number}`,
    ups:       `https://www.ups.com/track?tracknum=${tracking_number}`,
    smsa:      `https://www.smsaexpress.com/trackshipment?awbno=${tracking_number}`,
    naqel:     `https://www.naqelexpress.com/tracking?trackingNumber=${tracking_number}`,
    imile:     `https://www.imile.com/tracking?trackingNumber=${tracking_number}`,
    zajil:     `https://zajil.com/track?awb=${tracking_number}`,
    custom:    tracking_number // treat as direct URL
  };

  const companyNames = {
    madar: 'مدار إكسبرس', alozon: 'الوزن', almada: 'المدى إكسبرس',
    aramex: 'أرامكس', dhl: 'DHL', fedex: 'FedEx', ups: 'UPS',
    smsa: 'SMSA', naqel: 'ناقل', imile: 'iMile', zajil: 'زاجل', custom: 'مخصص'
  };

  const key = (company || '').toLowerCase();
  const url = trackingUrls[key] || tracking_number;
  const companyName = companyNames[key] || company || 'غير محدد';

  // Update order with tracking link if order_id provided
  if (order_id && pool) {
    try {
      await pool.query(
        'UPDATE orders SET delivery_link=$1, delivery_company=$2 WHERE id=$3 AND user_id=$4',
        [url, companyName, order_id, req.user.id]
      );
    } catch(e) {}
  }

  return res.json({ success: true, tracking_url: url, company: companyName, tracking_number });
});

// Get all supported delivery companies
app.get('/api/delivery/companies', authenticateToken, (req, res) => {
  res.json({
    success: true,
    companies: [
      { id: 'madar',   name: 'مدار إكسبرس',    flag: '🇮🇶', region: 'العراق' },
      { id: 'alozon',  name: 'الوزن',            flag: '🇮🇶', region: 'العراق' },
      { id: 'almada',  name: 'المدى إكسبرس',    flag: '🇮🇶', region: 'العراق' },
      { id: 'aramex',  name: 'أرامكس',           flag: '🌍', region: 'الخليج' },
      { id: 'dhl',     name: 'DHL',              flag: '🌍', region: 'دولي' },
      { id: 'fedex',   name: 'FedEx',            flag: '🌍', region: 'دولي' },
      { id: 'smsa',    name: 'SMSA',             flag: '🇸🇦', region: 'السعودية' },
      { id: 'naqel',   name: 'ناقل',             flag: '🇸🇦', region: 'السعودية' },
      { id: 'imile',   name: 'iMile',            flag: '🌍', region: 'الخليج' },
      { id: 'zajil',   name: 'زاجل',             flag: '🇸🇦', region: 'السعودية' },
      { id: 'ups',     name: 'UPS',              flag: '🌍', region: 'دولي' },
      { id: 'custom',  name: 'رابط مخصص',        flag: '🔗', region: 'أخرى' }
    ]
  });
});

// ========== START SERVER ==========
app.listen(PORT, () => console.log(`SocialOS running on port ${PORT}`));
