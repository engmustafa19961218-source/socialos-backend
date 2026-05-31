const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const SECRET = 'socialos-secret-2026';
const FB_TOKEN = process.env.FB_ACCESS_TOKEN;
const FB_PAGE_ID = process.env.FB_PAGE_ID;
const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    email VARCHAR(255) UNIQUE,
    password VARCHAR(255),
    plan VARCHAR(50) DEFAULT 'free',
    created_at TIMESTAMP DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS posts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    content TEXT,
    platforms TEXT,
    status VARCHAR(50) DEFAULT 'published',
    fb_post_id VARCHAR(255),
    scheduled_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    platform VARCHAR(50),
    sender VARCHAR(255),
    content TEXT,
    read BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    plan VARCHAR(50),
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS scheduled_posts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    content TEXT,
    platforms TEXT,
    scheduled_at TIMESTAMP,
    status VARCHAR(50) DEFAULT 'pending',
    fb_post_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
  );
`).then(() => console.log('Database ready!'))
  .catch(e => console.log('DB Error:', e.message));

// ── جدولة المنشورات تلقائياً كل دقيقة ──
setInterval(async () => {
  try {
    const now = new Date();
    const result = await pool.query(
      "SELECT * FROM scheduled_posts WHERE status = 'pending' AND scheduled_at <= $1",
      [now]
    );
    for (const post of result.rows) {
      let fb_post_id = null;
      const platforms = JSON.parse(post.platforms || '[]');
      if (platforms.includes('facebook') && FB_PAGE_TOKEN && FB_PAGE_ID) {
        try {
          const fbRes = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}/feed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: post.content, access_token: FB_PAGE_TOKEN })
          });
          const fbData = await fbRes.json();
          if (fbData.id) fb_post_id = fbData.id;
        } catch(e) {
          console.log('FB Scheduled Error:', e.message);
        }
      }
      await pool.query(
        'INSERT INTO posts (user_id, content, platforms, fb_post_id, status) VALUES ($1, $2, $3, $4, $5)',
        [post.user_id, post.content, post.platforms, fb_post_id, 'published']
      );
      await pool.query(
        "UPDATE scheduled_posts SET status = 'published', fb_post_id = $1 WHERE id = $2",
        [fb_post_id, post.id]
      );
      console.log('✅ Scheduled post published:', post.id);
    }
  } catch(e) {
    console.log('Scheduler Error:', e.message);
  }
}, 60000);

app.get('/', (req, res) => {
  res.json({ message: 'SocialOS API v3.0', status: 'ok' });
});

// سياسة الخصوصية
app.get('/privacy', (req, res) => {
  res.send(`<html dir="rtl"><body style="font-family:Arial;padding:40px;max-width:800px;margin:auto;">
    <h1>سياسة الخصوصية - SocialOS</h1>
    <p>آخر تحديث: مايو 2026</p>
    <h2>1. جمع البيانات</h2><p>نجمع البيانات الضرورية فقط لتقديم خدماتنا.</p>
    <h2>2. استخدام البيانات</h2><p>نستخدم بياناتك لإدارة حسابك ونشر المحتوى.</p>
    <h2>3. حماية البيانات</h2><p>نستخدم تشفير SSL لحماية جميع البيانات.</p>
    <h2>4. حذف البيانات</h2><p>يمكنك طلب حذف بياناتك عبر البريد الإلكتروني.</p>
    <h2>5. التواصل</h2><p>للاستفسار: socialos@support.com</p>
    </body></html>`);
});

// شروط الخدمة
app.get('/terms', (req, res) => {
  res.send(`<html dir="rtl"><body style="font-family:Arial;padding:40px;max-width:800px;margin:auto;">
    <h1>شروط الخدمة - SocialOS</h1>
    <p>آخر تحديث: مايو 2026</p>
    <h2>1. قبول الشروط</h2><p>باستخدامك SocialOS فأنت توافق على هذه الشروط.</p>
    <h2>2. الاستخدام المقبول</h2><p>يجب استخدام الخدمة بشكل قانوني ومسؤول.</p>
    <h2>3. الخصوصية</h2><p>نلتزم بحماية خصوصيتك وفق سياسة الخصوصية.</p>
    <h2>4. إنهاء الخدمة</h2><p>نحتفظ بحق إيقاف الحساب عند انتهاك الشروط.</p>
    </body></html>`);
});

// حذف البيانات
app.get('/delete-data', (req, res) => {
  res.send(`<html dir="rtl"><body style="font-family:Arial;padding:40px;max-width:800px;margin:auto;">
    <h1>حذف البيانات - SocialOS</h1>
    <p>لحذف بياناتك، أرسل طلباً إلى: socialos@support.com</p>
    <p>سيتم حذف جميع بياناتك خلال 30 يوم.</p>
    </body></html>`);
});

// تسجيل مستخدم
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email, plan',
      [name, email, hashed]
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id }, SECRET);
    res.json({ success: true, token, user });
  } catch (e) {
    res.json({ success: false, message: 'البريد مستخدم بالفعل' });
  }
});

// تسجيل الدخول
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (!result.rows[0]) return res.json({ success: false, message: 'المستخدم غير موجود' });
    const valid = await bcrypt.compare(password, result.rows[0].password);
    if (!valid) return res.json({ success: false, message: 'كلمة المرور خاطئة' });
    const token = jwt.sign({ id: result.rows[0].id }, SECRET);
    res.json({ success: true, token, user: result.rows[0] });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// جلب المنشورات
app.get('/api/posts', async (req, res) => {
  const result = await pool.query('SELECT * FROM posts ORDER BY created_at DESC');
  res.json({ posts: result.rows });
});

// إنشاء منشور (فوري أو مجدول)
app.post('/api/posts', async (req, res) => {
  try {
    const { content, platforms, user_id, scheduled_at } = req.body;

    // إذا في وقت جدولة → احفظه في scheduled_posts
    if (scheduled_at) {
      const result = await pool.query(
        'INSERT INTO scheduled_posts (user_id, content, platforms, scheduled_at) VALUES ($1, $2, $3, $4) RETURNING *',
        [user_id || 1, content, JSON.stringify(platforms), new Date(scheduled_at)]
      );
      return res.json({ success: true, scheduled: true, post: result.rows[0] });
    }

    // نشر فوري
    let fb_post_id = null;
    if (platforms && platforms.includes('facebook') && FB_PAGE_TOKEN && FB_PAGE_ID) {
      try {
        const fbRes = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}/feed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: content, access_token: FB_PAGE_TOKEN })
        });
        const fbData = await fbRes.json();
        if (fbData.id) fb_post_id = fbData.id;
      } catch(fbErr) {
        console.log('FB Error:', fbErr.message);
      }
    }

    const result = await pool.query(
      'INSERT INTO posts (user_id, content, platforms, fb_post_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [user_id || 1, content, JSON.stringify(platforms), fb_post_id]
    );
    res.json({ success: true, post: result.rows[0], fb_post_id });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// جلب المنشورات المجدولة
app.get('/api/scheduled', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM scheduled_posts WHERE status = 'pending' ORDER BY scheduled_at ASC"
    );
    res.json({ posts: result.rows });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});

// حذف منشور مجدول
app.delete('/api/scheduled/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM scheduled_posts WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});

// جلب الرسائل
app.get('/api/messages', async (req, res) => {
  const result = await pool.query('SELECT * FROM messages ORDER BY created_at DESC');
  res.json({ messages: result.rows });
});

// جلب صفحات فيسبوك
app.get('/api/facebook/pages', async (req, res) => {
  try {
    const fbRes = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${FB_TOKEN}`);
    const data = await fbRes.json();
    res.json({ success: true, pages: data.data || [] });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Webhook Meta (جاهز لما تجي الموافقة)
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'socialos-webhook-2026';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    if (body.object === 'page') {
      for (const entry of body.entry || []) {
        for (const event of entry.messaging || []) {
          if (event.message) {
            await pool.query(
              'INSERT INTO messages (platform, sender, content) VALUES ($1, $2, $3)',
              ['facebook', event.sender.id, event.message.text || '']
            );
          }
        }
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  } catch(e) {
    res.sendStatus(500);
  }
});

// إحصائيات
app.get('/api/stats', async (req, res) => {
  try {
    const users = await pool.query('SELECT COUNT(*) FROM users');
    const posts = await pool.query('SELECT COUNT(*) FROM posts');
    const messages = await pool.query('SELECT COUNT(*) FROM messages');
    const scheduled = await pool.query("SELECT COUNT(*) FROM scheduled_posts WHERE status = 'pending'");
    res.json({
      users: parseInt(users.rows[0].count),
      posts: parseInt(posts.rows[0].count),
      messages: parseInt(messages.rows[0].count),
      scheduled: parseInt(scheduled.rows[0].count)
    });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SocialOS running on port ${PORT}`));