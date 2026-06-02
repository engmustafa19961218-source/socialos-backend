const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

let pool = null;
try {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  pool.query(`
    CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name VARCHAR(255), email VARCHAR(255) UNIQUE, password VARCHAR(255), created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS posts (id SERIAL PRIMARY KEY, content TEXT, created_at TIMESTAMP DEFAULT NOW());
  `).catch(e => console.log('DB init error:', e.message));
} catch(e) {
  console.log('DB not available:', e.message);
}

const users = [];
const posts = [];

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
  res.json({ posts: posts.reverse() });
});

app.get('/api/analytics', async (req, res) => {
  try {
    if (pool) { const r = await pool.query('SELECT COUNT(*) FROM posts'); return res.json({ totalPosts: parseInt(r.rows[0].count), scheduled: 0, published: parseInt(r.rows[0].count) }); }
  } catch (e) {}
  res.json({ totalPosts: posts.length, scheduled: 0, published: posts.length });
});

app.get('/', (req, res) => res.json({ status: 'SocialOS API Running' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
