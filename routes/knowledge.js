module.exports = function(app, pool, helpers) {
const { escapeHtml, sanitize, authenticateToken, rateLimit, notify, auditLog, esc } = helpers;

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

};
