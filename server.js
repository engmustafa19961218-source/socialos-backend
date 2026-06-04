const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const app = express();

app.use(cors());
app.use(express.json());

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
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
app.post('/api/auth/register', async (req, res) => {
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

app.post('/api/auth/login', async (req, res) => {
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
app.get('/api/stats', async (req, res) => {
  try {
    if (pool) {
      const [u, p, m, o] = await Promise.all([
        pool.query('SELECT COUNT(*) FROM users'),
        pool.query('SELECT COUNT(*) FROM posts'),
        pool.query('SELECT COUNT(*) FROM messages'),
        pool.query('SELECT COUNT(*) FROM orders')
      ]);
      return res.json({ users: parseInt(u.rows[0].count), posts: parseInt(p.rows[0].count), messages: parseInt(m.rows[0].count), orders: parseInt(o.rows[0].count) });
    }
  } catch (e) {}
  res.json({ users: users.length, posts: posts.length, messages: messages.length, orders: orders.length });
});

// ========== AI ==========
app.post('/api/ai/generate', authenticateToken, async (req, res) => {
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
      return res.json({ success: true, order: result.rows[0] });
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
      const [postsData, ordersData, recentOrders] = await Promise.all([
        pool.query('SELECT COUNT(*) as total, DATE(created_at) as day FROM posts WHERE user_id=$1 GROUP BY day ORDER BY day DESC LIMIT 30', [userId]),
        pool.query('SELECT SUM(total) as revenue, COUNT(*) as count, status FROM orders WHERE user_id=$1 GROUP BY status', [userId]),
        pool.query('SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5', [userId])
      ]);
      const revenue = ordersData.rows.reduce((acc, r) => acc + parseFloat(r.revenue || 0), 0);
      const ordersCount = ordersData.rows.reduce((acc, r) => acc + parseInt(r.count || 0), 0);
      return res.json({ success: true, posts_chart: postsData.rows, orders_by_status: ordersData.rows, recent_orders: recentOrders.rows, totals: { revenue, orders: ordersCount } });
    }
  } catch (e) {}
  res.json({ success: true, posts_chart: [], orders_by_status: [], recent_orders: [], totals: { revenue: 0, orders: 0 } });
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
cron.schedule('* * * * *', async () => {
  try {
    if (!pool) return;
    const result = await pool.query(`SELECT * FROM scheduled_posts WHERE status='pending' AND scheduled_at <= NOW()`);
    for (const post of result.rows) await pool.query('UPDATE scheduled_posts SET status=$1 WHERE id=$2', ['published', post.id]);
  } catch (err) { console.error('Scheduler Error:', err); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SocialOS running on port ${PORT}`));
