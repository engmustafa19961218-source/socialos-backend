module.exports = function(app, pool, helpers) {
const { escapeHtml, sanitize, authenticateToken, rateLimit, notify, auditLog, esc } = helpers;

// ============================================================
// DECISION MEMORY — سجل القرارات
// ============================================================
app.post('/api/decisions', authenticateToken, async (req, res) => {
  const { decision, reason, context, customer_phone } = req.body;
  if (!decision || !reason) return res.status(400).json({ success: false, message: 'القرار والسبب مطلوبان' });
  try {
    if (pool) {
      const r = await pool.query(
        'INSERT INTO decision_memory (user_id, decision, reason, context, customer_phone) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [req.user.id, decision, reason, context || 'general', customer_phone || '']
      );
      return res.json({ success: true, decision: r.rows[0] });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/decisions', authenticateToken, async (req, res) => {
  const { context, phone, all } = req.query;
  try {
    if (pool) {
      let q = 'SELECT * FROM decision_memory WHERE user_id=$1';
      if (!all) q += ' AND is_active=true';
      const params = [req.user.id];
      if (context) { q += ` AND context=$${params.length+1}`; params.push(context); }
      if (phone) { q += ` AND customer_phone=$${params.length+1}`; params.push(phone); }
      q += ' ORDER BY created_at DESC';
      const r = await pool.query(q, params);
      return res.json({ success: true, decisions: r.rows });
    }
  } catch (e) {}
  res.json({ success: true, decisions: [] });
});

app.put('/api/decisions/:id', authenticateToken, async (req, res) => {
  const { is_active } = req.body;
  try {
    if (pool) await pool.query('UPDATE decision_memory SET is_active=$1 WHERE id=$2 AND user_id=$3', [is_active, req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/decisions/:id', authenticateToken, async (req, res) => {
  try {
    if (pool) { await pool.query('UPDATE decision_memory SET is_active=false WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]); }
    return res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

};
