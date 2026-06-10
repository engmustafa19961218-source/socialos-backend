module.exports = function(app, pool, helpers) {
const { escapeHtml, sanitize, authenticateToken, rateLimit, notify, auditLog, esc } = helpers;

// ============================================================
// INVOICES — الفواتير
// ============================================================

// إنشاء أعمدة جديدة إذا لم تكن موجودة
async function ensureInvoiceColumns() {
  if (!pool) return;
  try {
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deposit NUMERIC DEFAULT 0`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receipt_image TEXT`);
  } catch(e) {}
}
ensureInvoiceColumns();

// جلب الفواتير
app.get('/api/invoices', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT * FROM invoices WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [req.user.id]);
    res.json({ success: true, invoices: r.rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// إنشاء فاتورة
app.post('/api/invoices', authenticateToken, async (req, res) => {
  const { order_id, customer_name, customer_phone, customer_address, items, tax_rate, discount, deposit, receipt_image, notes, due_date, currency } = req.body;
  const userId = req.user.id;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    // توليد رقم الفاتورة
    const countR = await pool.query('SELECT COUNT(*) FROM invoices WHERE user_id=$1', [userId]);
    const count = parseInt(countR.rows[0].count) + 1;
    const invoice_number = `INV-${new Date().getFullYear()}-${String(count).padStart(4,'0')}`;

    // حساب المبالغ
    const parsedItems = Array.isArray(items) ? items : [];
    const subtotal = parsedItems.reduce((s, i) => s + (parseFloat(i.price)||0) * (parseInt(i.qty)||1), 0);
    const taxRate = parseFloat(tax_rate) || 0;
    const tax_amount = subtotal * taxRate / 100;
    const disc = parseFloat(discount) || 0;
    const total = subtotal + tax_amount - disc;
    const dep = parseFloat(deposit) || 0;

    // تخزين الصورة — إذا كانت base64 نخزنها مباشرة
    const receiptImg = receipt_image || null;

    const r = await pool.query(
      `INSERT INTO invoices (user_id, invoice_number, order_id, customer_name, customer_phone, customer_address, items, subtotal, tax_rate, tax_amount, discount, deposit, total, currency, notes, due_date, receipt_image)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [userId, invoice_number, order_id||null, sanitize(customer_name||''), sanitize(customer_phone||''), sanitize(customer_address||''),
       JSON.stringify(parsedItems), subtotal, taxRate, tax_amount, disc, dep, total, currency||'IQD', sanitize(notes||''), due_date||null, receiptImg]
    );
    res.json({ success: true, invoice: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// تحديث حالة الفاتورة
app.put('/api/invoices/:id', authenticateToken, async (req, res) => {
  const { status, notes } = req.body;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT user_id FROM invoices WHERE id=$1', [req.params.id]);
    if (!r.rows.length || r.rows[0].user_id !== req.user.id) return res.status(403).json({ success: false, message: 'غير مصرح' });
    await pool.query('UPDATE invoices SET status=$1, notes=$2 WHERE id=$3', [status||'draft', sanitize(notes||''), req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// حذف فاتورة
app.delete('/api/invoices/:id', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT user_id FROM invoices WHERE id=$1', [req.params.id]);
    if (!r.rows.length || r.rows[0].user_id !== req.user.id) return res.status(403).json({ success: false, message: 'غير مصرح' });
    await pool.query('DELETE FROM invoices WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// إنشاء فاتورة من طلب موجود
app.post('/api/invoices/from-order/:orderId', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const orderR = await pool.query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [req.params.orderId, userId]);
    if (!orderR.rows.length) return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
    const o = orderR.rows[0];

    const itemsR = await pool.query(
      'SELECT oi.*, p.name FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id WHERE oi.order_id=$1',
      [o.id]
    );
    const items = itemsR.rows.map(i => ({ name: i.name||i.product_name||'منتج', qty: i.quantity, price: i.unit_price }));

    const countR = await pool.query('SELECT COUNT(*) FROM invoices WHERE user_id=$1', [userId]);
    const count = parseInt(countR.rows[0].count) + 1;
    const invoice_number = `INV-${new Date().getFullYear()}-${String(count).padStart(4,'0')}`;
    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    const total = subtotal - (o.discount||0);

    const r = await pool.query(
      `INSERT INTO invoices (user_id, invoice_number, order_id, customer_name, customer_phone, customer_address, items, subtotal, discount, deposit, total, currency, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [userId, invoice_number, o.id, o.customer_name||'', o.customer_phone||'', o.address||'',
       JSON.stringify(items), subtotal, o.discount||0, o.deposit||0, total, o.currency||'IQD', '']
    );
    res.json({ success: true, invoice: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

};
