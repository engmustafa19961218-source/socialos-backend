const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const users = [];
const posts = [];

app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ message: 'يرجى ملء جميع الحقول' });
  if (users.find(u => u.email === email)) return res.status(400).json({ message: 'البريد مستخدم' });
  const user = { id: Date.now(), name, email, password };
  users.push(user);
  const token = Buffer.from(`${user.id}:secret`).toString('base64');
  res.json({ user: { name, email }, token });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
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
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'anthropic/claude-3-haiku',
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    res.json({ content });
  } catch (e) {
    res.status(500).json({ message: 'خطأ في AI' });
  }
});

app.post('/api/posts', (req, res) => {
  const { content } = req.body;
  posts.push({ id: Date.now(), content, createdAt: new Date() });
  res.json({ success: true });
});

app.get('/api/analytics', (req, res) => {
  res.json({ totalPosts: posts.length, scheduled: 0, published: posts.length });
});

app.get('/', (req, res) => res.json({ status: 'SocialOS API Running' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
