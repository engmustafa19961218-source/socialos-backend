const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const app = express();

app.use(cors());
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
const JWT_SECRET = process.env.JWT_SECRET || 'socialos_secret_key';

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

const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || 'sbawpmxlnd2c1ic5fx';
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || 'nFlkLVf7FSvajkESBriVA7lrE3jTf29q';
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
      const fields = Object.keys(req.body).map((k, i) => `${k}=$${i + 2}`).join(', ');
      await pool.query(`UPDATE orders SET ${fields} WHERE id=$1`, [req.params.id, ...Object.values(req.body)]);
      return res.json({ success: true });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
  res.json({ success: true });
});

app.delete('/api/orders/:id', authenticateToken, async (req, res) => {
  try { if (pool) { await pool.query('DELETE FROM orders WHERE id=$1', [req.params.id]); return res.json({ success: true }); } } catch (e) {}
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
    const r = await pool.query('SELECT id,name,email,bio,avatar_url,plan,plan_expires_at FROM users WHERE id=$1', [req.user.id]);
    if (r.rows.length === 0) return res.status(404).json({ message: 'User not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ message: 'Profile error' }); }
});

app.put('/api/profile', authenticateToken, async (req, res) => {
  try {
    const { name, bio, avatar_url } = req.body;
    await pool.query('UPDATE users SET name=$1, bio=$2, avatar_url=$3 WHERE id=$4', [name||'', bio||'', avatar_url||'', req.user.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: 'Update error' }); }
});

// ========== PUBLIC STORE PAGE ==========
app.get('/store/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    if (pool) {
      const [user, products, settings] = await Promise.all([
        pool.query('SELECT name, bio, avatar_url FROM users WHERE id=$1', [userId]),
        pool.query('SELECT * FROM products WHERE user_id=$1 AND is_available=true ORDER BY created_at DESC', [userId]),
        pool.query('SELECT store_name, business_type, business_desc, location, currency FROM user_settings WHERE user_id=$1', [userId])
      ]);
      if (user.rows.length === 0) return res.status(404).send('<h1>المتجر غير موجود</h1>');
      const owner = user.rows[0];
      const set = settings.rows[0] || {};
      const prods = products.rows;
      const storeName = set.store_name || owner.name || 'متجر';
      const currency = set.currency || 'IQD';

      const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${storeName}</title>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Tajawal',sans-serif;background:#080b14;color:#e8edf5;direction:rtl;}
.header{background:linear-gradient(135deg,#0f1420,#161d2e);padding:40px 20px;text-align:center;border-bottom:1px solid #1e2a40;}
.store-avatar{width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,#4f8ef7,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:700;margin:0 auto 16px;overflow:hidden;}
.store-avatar img{width:100%;height:100%;object-fit:cover;}
.store-name{font-size:1.8rem;font-weight:900;}
.store-desc{color:#6b7a99;margin-top:8px;font-size:.95rem;}
.container{max-width:900px;margin:0 auto;padding:24px 16px;}
.products-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin-top:24px;}
.product-card{background:#0f1420;border:1px solid #1e2a40;border-radius:16px;overflow:hidden;transition:all .2s;}
.product-card:hover{border-color:#4f8ef7;transform:translateY(-3px);}
.product-img{height:180px;object-fit:cover;width:100%;background:#161d2e;display:flex;align-items:center;justify-content:center;font-size:3rem;}
.product-info{padding:16px;}
.product-name{font-weight:700;font-size:.95rem;margin-bottom:4px;}
.product-desc{color:#6b7a99;font-size:.82rem;margin-bottom:10px;}
.product-price{color:#4f8ef7;font-weight:900;font-size:1.2rem;}
.order-btn{width:100%;padding:10px;background:linear-gradient(135deg,#4f8ef7,#7c3aed);color:#fff;border:none;border-radius:10px;font-size:.9rem;font-weight:700;cursor:pointer;margin-top:10px;font-family:'Tajawal',sans-serif;}
.order-btn:hover{opacity:.9;}
.modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1000;align-items:center;justify-content:center;padding:20px;}
.modal.show{display:flex;}
.modal-box{background:#0f1420;border:1px solid #1e2a40;border-radius:20px;padding:28px;width:100%;max-width:440px;}
.modal-box h2{font-size:1.2rem;font-weight:700;margin-bottom:20px;}
.inp{width:100%;background:#161d2e;border:1px solid #1e2a40;border-radius:10px;padding:12px;color:#e8edf5;font-size:.95rem;font-family:'Tajawal',sans-serif;margin-bottom:12px;outline:none;}
.inp:focus{border-color:#4f8ef7;}
.btn-row{display:flex;gap:10px;margin-top:8px;}
.btn-cancel{flex:1;padding:12px;background:transparent;border:1px solid #1e2a40;color:#6b7a99;border-radius:10px;cursor:pointer;font-family:'Tajawal',sans-serif;}
.btn-submit{flex:2;padding:12px;background:linear-gradient(135deg,#4f8ef7,#7c3aed);color:#fff;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:'Tajawal',sans-serif;}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(80px);background:#0f1420;border:1px solid #4f8ef7;border-radius:12px;padding:12px 24px;transition:transform .3s;z-index:9999;}
.toast.show{transform:translateX(-50%) translateY(0);}
.empty{text-align:center;padding:60px 20px;color:#6b7a99;}
</style>
</head>
<body>
<div class="header">
  <div class="store-avatar">${owner.avatar_url?`<img src="${owner.avatar_url}" onerror="this.parentElement.textContent='${storeName.charAt(0)}'">`:storeName.charAt(0)}</div>
  <div class="store-name">${storeName}</div>
  ${set.business_desc?`<div class="store-desc">${set.business_desc}</div>`:''}
  ${set.location?`<div class="store-desc">📍 ${set.location}</div>`:''}
</div>

<div class="container">
  ${prods.length === 0 ? '<div class="empty"><div style="font-size:3rem;margin-bottom:12px">📦</div><p>لا توجد منتجات متاحة حالياً</p></div>' : 
  `<div class="products-grid">
    ${prods.map(p=>`
      <div class="product-card">
        ${p.image_url?`<img class="product-img" src="${p.image_url}" alt="${p.name}" onerror="this.style.display='none'">`:
        `<div class="product-img">📦</div>`}
        <div class="product-info">
          <div class="product-name">${p.name}</div>
          ${p.description?`<div class="product-desc">${p.description.substring(0,80)}</div>`:''}
          <div class="product-price">${parseFloat(p.price).toFixed(0)} ${currency}</div>
          ${p.stock>0?`<button class="order-btn" onclick="openOrder(${p.id},'${p.name.replace(/'/g,"\'")}',${p.price})">🛒 اطلب الآن</button>`:'<div style="color:#ff4466;font-size:.85rem;margin-top:8px;text-align:center">نفذ من المخزون</div>'}
        </div>
      </div>`).join('')}
  </div>`}
</div>

<div class="modal" id="order-modal">
  <div class="modal-box">
    <h2 id="modal-title">🛒 طلب منتج</h2>
    <input id="c-name" class="inp" placeholder="اسمك الكريم *">
    <input id="c-phone" class="inp" placeholder="رقم هاتفك *" dir="ltr">
    <input id="c-address" class="inp" placeholder="عنوان التوصيل">
    <input id="c-qty" class="inp" type="number" value="1" min="1" placeholder="الكمية" dir="ltr">
    <input id="c-notes" class="inp" placeholder="ملاحظات إضافية">
    <div class="btn-row">
      <button class="btn-cancel" onclick="closeOrder()">إلغاء</button>
      <button class="btn-submit" onclick="submitOrder()">✅ تأكيد الطلب</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
let selectedProduct = null;
function openOrder(id, name, price){
  selectedProduct = {id, name, price};
  document.getElementById('modal-title').textContent = '🛒 طلب: ' + name;
  document.getElementById('order-modal').classList.add('show');
}
function closeOrder(){ document.getElementById('order-modal').classList.remove('show'); }
async function submitOrder(){
  const name=document.getElementById('c-name').value.trim();
  const phone=document.getElementById('c-phone').value.trim();
  if(!name||!phone){showToast('⚠️ الاسم والهاتف مطلوبان');return;}
  try{
    const res=await fetch('/api/marketplace/order',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({store_user_id:${userId},customer_name:name,customer_phone:phone,
        customer_address:document.getElementById('c-address').value,
        product_id:selectedProduct.id,quantity:document.getElementById('c-qty').value,
        notes:document.getElementById('c-notes').value})});
    const data=await res.json();
    if(data.success){closeOrder();showToast('✅ تم إرسال طلبك بنجاح! سنتواصل معك قريباً');}
    else showToast('❌ '+(data.message||'فشل الطلب'));
  }catch(e){showToast('❌ تعذر الاتصال');}
}
function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3000);}
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
          pool.query('SELECT COUNT(*) as count, SUM(total) as revenue FROM orders WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '7 days'', [userId]),
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
  try {
    if (pool) {
      const [orders, posts, topOrders] = await Promise.all([
        pool.query(`SELECT COUNT(*) as count, SUM(total) as revenue, status FROM orders WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '7 days' GROUP BY status`, [userId]),
        pool.query(`SELECT COUNT(*) as count FROM posts WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '7 days'`, [userId]),
        pool.query(`SELECT customer_name, total, status FROM orders WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '7 days' ORDER BY total DESC LIMIT 5`, [userId])
      ]);
      const totalRevenue = orders.rows.reduce((s, r) => s + parseFloat(r.revenue || 0), 0);
      const totalOrders = orders.rows.reduce((s, r) => s + parseInt(r.count || 0), 0);
      return res.json({
        success: true,
        period: 'آخر 7 أيام',
        orders: { total: totalOrders, revenue: totalRevenue, by_status: orders.rows },
        posts: parseInt(posts.rows[0]?.count || 0),
        top_orders: topOrders.rows
      });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
  res.json({ success: true, period: 'آخر 7 أيام', orders: { total: 0, revenue: 0, by_status: [] }, posts: 0, top_orders: [] });
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

app.post('/api/agent/chat', authenticateToken, rateLimit(20, 60*1000), async (req, res) => {
  const userId = req.user.id;
  const { message, voice } = req.body;
  if (!message) return res.status(400).json({ success: false, message: 'الرسالة مطلوبة' });

  // Initialize conversation history
  if (!agentConversations[userId]) agentConversations[userId] = [];
  
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
  agentConversations[userId].push({ role: 'user', content: message });
  
  // Keep only last 10 messages
  if (agentConversations[userId].length > 20) {
    agentConversations[userId] = agentConversations[userId].slice(-30);
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
    const lowerMsg = message.toLowerCase();
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
    dev_otp: otp, // Remove in production
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
  try {
    if (pool) {
      const [orders, products, topCustomers] = await Promise.all([
        pool.query(`SELECT * FROM orders WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '${days} days' ORDER BY created_at DESC`, [userId]),
        pool.query(`SELECT COUNT(*) as total, SUM(CASE WHEN stock=0 THEN 1 ELSE 0 END) as out_of_stock FROM products WHERE user_id=$1`, [userId]),
        pool.query(`SELECT customer_name, customer_phone, COUNT(*) as orders, SUM(total) as spent FROM orders WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '${days} days' GROUP BY customer_name, customer_phone ORDER BY spent DESC LIMIT 10`, [userId])
      ]);

      const totalRevenue = orders.rows.reduce((s, o) => s + parseFloat(o.total || 0), 0);
      const totalOrders = orders.rows.length;
      const avgOrder = totalOrders > 0 ? formatCurrency(totalRevenue / totalOrders) : formatCurrency(0);
      const periodLabel = period === 'month' ? 'الشهر الماضي' : period === 'year' ? 'السنة الماضية' : 'الأسبوع الماضي';

      const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>تقرير SocialOS</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Tajawal',Arial,sans-serif; background:#f8fafc; color:#1e293b; direction:rtl; }
  .header { background:linear-gradient(135deg,#4f8ef7,#7c3aed); color:#fff; padding:40px; text-align:center; }
  .header h1 { font-size:2rem; font-weight:900; margin-bottom:8px; }
  .header p { opacity:.8; font-size:1rem; }
  .container { max-width:900px; margin:0 auto; padding:30px; }
  .stats-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin:24px 0; }
  .stat-box { background:#fff; border-radius:12px; padding:20px; text-align:center; box-shadow:0 2px 8px rgba(0,0,0,.08); }
  .stat-value { font-size:1.8rem; font-weight:900; color:#4f8ef7; }
  .stat-label { font-size:.8rem; color:#64748b; margin-top:4px; }
  .section { background:#fff; border-radius:12px; padding:24px; margin-bottom:20px; box-shadow:0 2px 8px rgba(0,0,0,.08); }
  .section h2 { font-size:1.1rem; font-weight:700; margin-bottom:16px; color:#1e293b; padding-bottom:8px; border-bottom:2px solid #4f8ef7; }
  table { width:100%; border-collapse:collapse; }
  th { background:#f1f5f9; padding:10px; text-align:right; font-size:.85rem; color:#64748b; }
  td { padding:10px; border-bottom:1px solid #f1f5f9; font-size:.9rem; }
  .badge { padding:3px 10px; border-radius:20px; font-size:.75rem; font-weight:700; }
  .badge-new { background:#dbeafe; color:#1d4ed8; }
  .badge-confirmed { background:#d1fae5; color:#065f46; }
  .badge-delivered { background:#ede9fe; color:#5b21b6; }
  .badge-cancelled { background:#fee2e2; color:#991b1b; }
  .footer { text-align:center; padding:20px; color:#94a3b8; font-size:.85rem; }
</style>
</head>
<body>
<div class="header">
  <h1>⚡ SocialOS — تقرير الأداء</h1>
  <p>${periodLabel} | ${new Date().toLocaleDateString('ar', {year:'numeric',month:'long',day:'numeric'})}</p>
</div>
<div class="container">
  <div class="stats-grid">
    <div class="stat-box"><div class="stat-value">${formatCurrency(totalRevenue)}</div><div class="stat-label">إجمالي الإيرادات</div></div>
    <div class="stat-box"><div class="stat-value">${totalOrders}</div><div class="stat-label">إجمالي الطلبات</div></div>
    <div class="stat-box"><div class="stat-value">${avgOrder}</div><div class="stat-label">متوسط قيمة الطلب</div></div>
    <div class="stat-box"><div class="stat-value">${products.rows[0]?.total || 0}</div><div class="stat-label">المنتجات</div></div>
  </div>

  <div class="section">
    <h2>🏆 أفضل العملاء</h2>
    <table>
      <tr><th>العميل</th><th>الهاتف</th><th>الطلبات</th><th>الإجمالي</th></tr>
      ${topCustomers.rows.map(c => `<tr><td>${c.customer_name}</td><td dir="ltr">${c.customer_phone}</td><td>${c.orders}</td><td>${formatCurrency(c.spent)}</td></tr>`).join('')}
    </table>
  </div>

  <div class="section">
    <h2>📋 آخر الطلبات</h2>
    <table>
      <tr><th>#</th><th>العميل</th><th>المبلغ</th><th>الحالة</th><th>التاريخ</th></tr>
      ${orders.rows.slice(0,20).map(o => `<tr><td>${o.id}</td><td>${o.customer_name}</td><td>${formatCurrency(o.total)}</td><td><span class="badge badge-${o.status}">${o.status}</span></td><td>${new Date(o.created_at).toLocaleDateString('ar')}</td></tr>`).join('')}
    </table>
  </div>
</div>
<div class="footer">تم إنشاء هذا التقرير تلقائياً بواسطة SocialOS ⚡</div>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="report-${period || 'weekly'}.html"`);
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
    // prefilled with '{' so we prepend it back
    let rawText = '{' + (aiData.content?.[0]?.text || '"}');
    
    let command;
    try {
      // Extract complete JSON object
      const jsonMatch = rawText.match(/\{[^{}]*\}/);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SocialOS running on port ${PORT}`));

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
  try {
    if (pool) {
      const r = await pool.query(
        'SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC',
        [userId]
      );
      const orders = r.rows;
      // CSV format
      const headers = ['ID', 'العميل', 'الهاتف', 'العنوان', 'المبلغ', 'العربون', 'الحالة', 'المنصة', 'التاريخ'];
      const rows = orders.map(o => [
        o.id, o.customer_name, o.customer_phone, o.customer_address || '',
        o.total, o.deposit, o.status, o.platform || '',
        new Date(o.created_at).toLocaleDateString('ar')
      ]);
      const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=orders.csv');
      return res.send('﻿' + csv); // BOM for Arabic Excel
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
      return res.json({ success: true, message: 'تم إرسال رمز التحقق', dev_code: code });
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
