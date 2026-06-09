module.exports = function(app, pool, helpers, cron) {
const { escapeHtml, sanitize, authenticateToken, rateLimit, notify, auditLog, esc } = helpers;

// ============================================================
// STATS
// ============================================================
app.get('/api/stats', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (pool) {
      const [o, p, c, n] = await Promise.all([
        pool.query('SELECT COUNT(*) FROM orders WHERE user_id=$1', [userId]),
        pool.query('SELECT COUNT(*) FROM products WHERE user_id=$1', [userId]),
        pool.query('SELECT COUNT(*) FROM customers WHERE user_id=$1', [userId]),
        pool.query('SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND is_read=false', [userId])
      ]);
      return res.json({ orders: parseInt(o.rows[0].count), products: parseInt(p.rows[0].count), customers: parseInt(c.rows[0].count), unread_notifications: parseInt(n.rows[0].count) });
    }
  } catch (e) {}
  res.json({ orders: 0, products: 0, customers: 0, unread_notifications: 0 });
});

// ============================================================
// CRON JOBS
// ============================================================

// Auto-generate board recommendations weekly
cron.schedule('0 9 * * 1', async () => {
  try {
    if (!pool) return;
    const users = await pool.query('SELECT id FROM users LIMIT 100');
    for (const user of users.rows) {
      const userId = user.id;
      try {
        const [orders, products] = await Promise.all([
          pool.query('SELECT COUNT(*) as cnt, SUM(CASE WHEN status=\'new\' THEN 1 ELSE 0 END) as new_cnt FROM orders WHERE user_id=$1', [userId]),
          pool.query('SELECT COUNT(*) as low FROM products WHERE user_id=$1 AND stock<=3 AND is_available=true', [userId])
        ]);
        if (parseInt(products.rows[0]?.low||0) > 0) {
          await notify(userId, '⚠️ تنبيه مخزون', `${products.rows[0].low} منتج مخزونه منخفض`, 'stock');
        }
        const lastOrder = await pool.query('SELECT created_at FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [userId]);
        if (lastOrder.rows.length > 0) {
          const days = Math.floor((Date.now() - new Date(lastOrder.rows[0].created_at)) / (1000*60*60*24));
          if (days >= 3) await notify(userId, '💡 تحفيز المبيعات', `مرت ${days} أيام بدون طلبات — جرب نشر عرض جديد`, 'tip');
        }
        // Auto-deactivate emergency mode after end_at
        await pool.query(`UPDATE emergency_mode SET is_active=false WHERE user_id=$1 AND end_at IS NOT NULL AND end_at<=NOW() AND is_active=true`, [userId]);
      } catch (e) {}
    }
  } catch (e) { console.error('Cron error:', e.message); }
});

// ============================================================
// SOCIAL ACCOUNTS — ربط حسابات التواصل الاجتماعي
// ============================================================

};
