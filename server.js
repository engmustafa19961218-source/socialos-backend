const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const app = express();

app.use(cors());
app.use(express.json());

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || 'sbawpmxlnd2c1ic5fx'
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || 'nFlkLVf7FSvajkESBriVA7lrE3jTf29q';
const TIKTOK_REDIRECT_URI = 'https://socialos-production-4aa6.up.railway.app/api/tiktok/callback';

let pool = null;
try {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.query(`
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  email VARCHAR(255) UNIQUE,
  password TEXT
);

CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  content TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tiktok_tokens (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255),
  access_token TEXT,
  refresh_token TEXT,
  open_id TEXT,
  display_name TEXT,
  avatar_url TEXT,
  follower_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS social_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  platform VARCHAR(50),
  platform_user_id VARCHAR(255),
  access_token TEXT,
  refresh_token TEXT,
  display_name VARCHAR(255),
  avatar_url TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scheduled_posts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  content TEXT,
  platform VARCHAR(50),
  scheduled_at TIMESTAMP,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);
`).catch(e => console.log('DB init error:', e.message));
  } catch (e) {
  console.log('DB not available:', e.message);
}

const users = [];
const posts = [];
const tiktokTokens = {};
// ========== AUTH ==========
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ message: 'يرجى ملء جميع الحقول' });
  try {
    if (pool) {
      const result = await pool.query('INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email', [name, email, password]);
      const user = result.rows[0];
      const token = Buffer.from(`${user.id}:secret`).toString('base64');
      return res.json({ user: { name: user.name, email: user.email }, token });
    }
  } catch (e) { return res.status(400).json({ message: 'البريد مستخدم مسبقاً' }); }
  if (users.find(u => u.email === email)) return res.status(400).json({ message: 'البريد مستخدم' });
  const user = { id: Date.now(), name, email, password };
  users.push(user);
  const token = Buffer.from(`${user.id}:secret`).toString('base64');
  res.json({ user: { name, email }, token });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    if (pool) {
      const result = await pool.query('SELECT * FROM users WHERE email=$1 AND password=$2', [email, password]);
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const token = Buffer.from(`${user.id}:secret`).toString('base64');
        return res.json({ user: { name: user.name, email: user.email }, token });
      }
      return res.status(401).json({ message: 'بيانات غير صحيحة' });
    }
  } catch (e) {}
  const user = users.find(u => u.email === email && u.password === password);
  if (!user) return res.status(401).json({ message: 'بيانات غير صحيحة' });
  const token = Buffer.from(`${user.id}:secret`).toString('base64');
  res.json({ user: { name: user.name, email }, token });
});

// ========== AI ==========
app.post('/api/ai/generate', async (req, res) => {
  const { prompt } = req.body;
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'anthropic/claude-3-haiku', messages: [{ role: 'user', content: prompt }] })
    });
    const data = await response.json();
    res.json({ content: data.choices?.[0]?.message?.content || '' });
  } catch (e) { res.status(500).json({ message: 'خطأ في AI' }); }
});

// ========== POSTS ==========
app.post('/api/posts', async (req, res) => {
  const { content } = req.body;
  try {
    if (pool) { await pool.query('INSERT INTO posts (content) VALUES ($1)', [content]); return res.json({ success: true }); }
  } catch (e) {}
  posts.push({ id: Date.now(), content, created_at: new Date() });
  res.json({ success: true });
});

app.get('/api/posts', async (req, res) => {
  try {
    if (pool) { const r = await pool.query('SELECT * FROM posts ORDER BY created_at DESC LIMIT 50'); return res.json({ posts: r.rows }); }
  } catch (e) {}
  res.json({ posts: posts.slice().reverse() });
});

app.get('/api/analytics', async (req, res) => {
  try {
    if (pool) { const r = await pool.query('SELECT COUNT(*) FROM posts'); return res.json({ totalPosts: parseInt(r.rows[0].count), scheduled: 0, published: parseInt(r.rows[0].count) }); }
  } catch (e) {}
  res.json({ totalPosts: posts.length, scheduled: 0, published: posts.length });
});
// ========== SCHEDULED POSTS ==========
app.post('/api/schedule', async (req, res) => {
  const { user_id, content, platforms, scheduled_at } = req.body;

  try {
    if (pool) {
      const result = await pool.query(
        `INSERT INTO scheduled_posts
        (user_id, content, platforms, scheduled_at)
        VALUES ($1,$2,$3,$4)
        RETURNING *`,
        [user_id, content, platforms, scheduled_at]
      );

      return res.json(result.rows[0]);
    }

    res.status(500).json({ message: 'Database not available' });

  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Schedule failed' });
  }
});

app.get('/api/schedule', async (req, res) => {
  try {
    if (pool) {
      const result = await pool.query(
        'SELECT * FROM scheduled_posts ORDER BY scheduled_at ASC'
      );

      return res.json(result.rows);
    }

    res.json([]);
  } catch (e) {
    res.status(500).json({ message: 'Load failed' });
  }
});
app.delete('/api/schedule/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (pool) {
      await pool.query(
        'DELETE FROM scheduled_posts WHERE id = $1',
        [id]
      );

      return res.json({ success: true });
    }

    res.status(500).json({ message: 'Database not available' });

  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Delete failed' });
  }
});
// ========== TIKTOK OAuth ==========
app.get('/api/tiktok/auth', (req, res) => {
  const state = Math.random().toString(36).substring(2, 15);
  const scope = 'user.info.basic';
  const authUrl = `https://www.tiktok.com/v2/auth/authorize?client_key=${TIKTOK_CLIENT_KEY}&scope=${scope}&response_type=code&redirect_uri=${encodeURIComponent(TIKTOK_REDIRECT_URI)}&state=${state}`;
  res.json({ url: authUrl });
});
app.get('/api/tiktok/login', (req, res) => {
  const authUrl =
    `https://www.tiktok.com/v2/auth/authorize` +
    `?client_key=${TIKTOK_CLIENT_KEY}` +
    `&scope=user.info.basic` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(TIKTOK_REDIRECT_URI)}` +
    `&state=${Date.now()}`;

  res.redirect(authUrl);
});
app.get('/api/tiktok/callback', async (req, res) => { console.log('TikTok callback query:', req.query);
console.log('TikTok callback code:', req.query.code);
  const { code, error } = req.query;
  if (error || !code) {
    return res.send(`<script>window.opener.postMessage({type:'TIKTOK_ERROR', error:'${error || 'no_code'}'}, '*'); window.close();</script>`);
  }
try {

  console.log('====================');
  console.log('KEY:', TIKTOK_CLIENT_KEY);
  console.log('SECRET START:', TIKTOK_CLIENT_SECRET.substring(0, 8));
  console.log('REDIRECT URI:', TIKTOK_REDIRECT_URI);
  console.log('CODE EXISTS:', !!code);
  console.log('====================');

  const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_key: TIKTOK_CLIENT_KEY,
      client_secret: TIKTOK_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: TIKTOK_REDIRECT_URI
    })
  });

 
    const tokenData = await tokenRes.json();
   if (!tokenData.access_token) {
  console.log('TOKEN ERROR:', JSON.stringify(tokenData, null, 2));

  return res.send(`
    <html>
      <head>
        <meta charset="utf-8">
        <title>TikTok Error</title>
      </head>
      <body style="font-family:Arial;padding:40px">
        <h2>TikTok Token Error</h2>
        <pre>${JSON.stringify(tokenData, null, 2)}</pre>
      </body>
    </html>
  `);
}
    const userRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url,follower_count', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });
    const userData = await userRes.json();
    const userInfo = userData.data?.user || {};
    if (pool) {
      await pool.query(`
        INSERT INTO tiktok_tokens (user_id, access_token, refresh_token, open_id, display_name, avatar_url)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT DO NOTHING
      `, ['default', tokenData.access_token, tokenData.refresh_token || '', userInfo.open_id || '', userInfo.display_name || '', userInfo.avatar_url || '']);
    } else {
      tiktokTokens['default'] = { ...tokenData, ...userInfo };
    }
    const tiktokUser = {
      display_name: userInfo.display_name || 'مستخدم TikTok',
      avatar_url: userInfo.avatar_url || '',
      open_id: userInfo.open_id || '',
      follower_count: userInfo.follower_count || 0
    };
    res.send(`<script>window.opener.postMessage({type:'TIKTOK_SUCCESS', user: ${JSON.stringify(tiktokUser)}}, '*'); window.close();</script>`);
  } catch (e) {
    console.error('TikTok callback error:', e);
    res.send(`<script>window.opener.postMessage({type:'TIKTOK_ERROR', error:'server_error'}, '*'); window.close();</script>`);
  }
});

app.get('/api/tiktok/status', async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT display_name, avatar_url, open_id, follower_count FROM tiktok_tokens ORDER BY created_at DESC LIMIT 1');
      if (r.rows.length > 0) return res.json({ connected: true, user: r.rows[0] });
    } else if (tiktokTokens['default']) {
      return res.json({ connected: true, user: tiktokTokens['default'] });
    }
  } catch (e) {}
  res.json({ connected: false });
});

app.delete('/api/tiktok/disconnect', async (req, res) => {
  try {
    if (pool) await pool.query('DELETE FROM tiktok_tokens');
    else delete tiktokTokens['default'];
  } catch (e) {}
  res.json({ success: true });
});

// ========== Privacy & Terms ==========
app.get('/privacy', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Privacy Policy - SocialOS</title><meta charset="utf-8"></head><body style="font-family:Arial;padding:40px;"><h1>Privacy Policy</h1><p>SocialOS uses TikTok Login and other social media integrations to allow users to connect and manage their accounts.</p><p>We only access information that users explicitly authorize.</p><p>User data is stored securely and is never sold or shared with unauthorized third parties.</p><p>If you have questions regarding this privacy policy, contact the SocialOS team.</p></body></html>`);
});

app.get('/terms', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Terms of Service - SocialOS</title><meta charset="utf-8"></head><body style="font-family:Arial;padding:40px;"><h1>Terms of Service</h1><p>By using SocialOS, you agree to use the service in accordance with applicable laws and platform policies.</p><p>SocialOS provides social media management and analytics tools.</p><p>Users are responsible for activities performed through their accounts.</p><p>We reserve the right to update these terms at any time.</p></body></html>`);
});

// ========== TikTok Verification ==========
app.get('/tiktokcdU6MT4crP3f2Vc2V4YaYTtKls8SZyjd.txt', (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.send('tiktok-developers-site-verification=cdU6MT4crP3f2Vc2V4YaYTtKls8SZyjd');
});
app.get('/tiktokR6GxRPWi20pkWFd2xDh3yUVVTTMTAr1t.txt', (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.send('tiktok-developers-site-verification=R6GxRPWi20pkWFd2xDh3yUVVTTMTAr1t');
});
app.get('/tiktokzQ5nsjbY4ICxzF7xJeyNhWdxRZtg7Zdd.txt', (req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    res.send('tiktok-developers-site-verification=zQ5nsjbY4ICxzF7xJeyNhWdxRZtg7Zdd');
});
app.get('/tiktokcWO7vuDpya6AcrmlXRgMnxUyc2qTdBik.txt', (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.send('tiktok-developers-site-verification=cWO7vuDpya6AcrmlXRgMnxUyc2qTdBik');
});
app.get('/tiktokr6U5TIN70qo1z8ifKN1Bi8FTi3Chhbrb.txt', (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.send('tiktok-developers-site-verification=r6U5TIN70qo1z8ifKN1Bi8FTi3Chhbrb');
});
// ========== Root ==========
app.get('/', (req, res) => {
  res.json({ status: 'SocialOS API Running' });
});
cron.schedule('* * * * *', async () => {
  try {
    if (!pool) return;

    const result = await pool.query(`
      SELECT *
      FROM scheduled_posts
      WHERE status = 'pending'
      AND scheduled_at <= NOW()
    `);

    for (const post of result.rows) {

      console.log('Publishing scheduled post:', post.id);

      await pool.query(`
        UPDATE scheduled_posts
        SET status = 'published'
        WHERE id = $1
      `, [post.id]);
    }

  } catch (err) {
    console.error('Scheduler Error:', err);
  }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
