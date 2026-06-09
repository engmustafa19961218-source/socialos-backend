module.exports = function(app, pool, helpers) {
const { escapeHtml, sanitize, authenticateToken, rateLimit, notify, auditLog, esc } = helpers;

// ============================================================
// DIGITAL EMPLOYEE — الموظف الرقمي
// ============================================================
app.get('/api/employee', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM digital_employee WHERE user_id=$1', [req.user.id]);
      if (r.rows.length === 0) {
        await pool.query('INSERT INTO digital_employee (user_id) VALUES ($1)', [req.user.id]);
        return res.json({ success: true, employee: { user_id: req.user.id, name: 'مساعدي الذكي', trust_level: 1, trust_score: 0 } });
      }
      return res.json({ success: true, employee: r.rows[0] });
    }
  } catch (e) {}
  res.json({ success: true, employee: {} });
});

app.put('/api/employee', authenticateToken, async (req, res) => {
  const { name, personality, sales_style, philosophy, objection_handling, boundaries } = req.body;
  try {
    if (pool) {
      await pool.query(`
        INSERT INTO digital_employee (user_id, name, personality, sales_style, philosophy, objection_handling, boundaries)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (user_id) DO UPDATE SET
          name=$2, personality=$3, sales_style=$4, philosophy=$5,
          objection_handling=$6, boundaries=$7, updated_at=NOW()
      `, [req.user.id, name||'مساعدي الذكي', personality||'', sales_style||'', philosophy||'', objection_handling||'', boundaries||'']);
      return res.json({ success: true });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// Trust Level upgrade
app.post('/api/employee/trust/upgrade', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM digital_employee WHERE user_id=$1', [req.user.id]);
      if (!r.rows.length) return res.status(404).json({ success: false, message: 'الموظف غير موجود' });
      const emp = r.rows[0];
      if (emp.trust_level >= 3) return res.json({ success: false, message: 'الموظف وصل للمستوى الأعلى' });
      // Require min 20 correct interactions per level
      const minRequired = emp.trust_level * 20;
      if (emp.correct_interactions < minRequired)
        return res.json({ success: false, message: `يحتاج ${minRequired - emp.correct_interactions} تفاعل صحيح إضافي للترقية` });
      await pool.query('UPDATE digital_employee SET trust_level=trust_level+1, updated_at=NOW() WHERE user_id=$1', [req.user.id]);
      await notify(req.user.id, '🌟 ترقية الموظف الرقمي!', `وصل موظفك الرقمي للمستوى ${emp.trust_level + 1}`, 'employee');
      return res.json({ success: true, new_level: emp.trust_level + 1 });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// TRAINING — التدريب
// ============================================================

};
