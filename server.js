const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const app = express();

app.use(cors());
app.use(express.json());

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255),
      email VARCHAR(255) UNIQUE,
      password VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      content TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}
initDB();

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ message: 'يرجى ملء جميع الحقول' });
  try {
    const result = await pool.query('INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email', [name, email, password]);
    const user = result.rows[0];
    const token = Buffer.from(`${user.id}:secret`).toString('base64');
    res.json({ user: { name: user.name, email: user.email }, token });
  } catch (e) {
    res.status(400).json({ message: 'البريد مستخدم مسبقاً' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email=$1 AND password=$2', [email, password]);
    if (result.rows.length === 0) return res.status(401).json({ message: 'بيانات غير صحيحة' });
    const user = result.rows[0];
    const token = Buffer.from(`${user.id}:secret`).toString('base64');
    res.json({ user: { name: user.name, email: user.email }, token });
  } catch (e) {
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
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
  } catch (e) {
    res.status(500).json({ message: 'خطأ في AI' });
  }
});

app.post
