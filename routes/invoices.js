module.exports = function(app, pool, helpers) {
const { escapeHtml, sanitize, authenticateToken, rateLimit, notify, auditLog, esc } = helpers;

// ============================================================
// INVOICES — الفواتير
// ============================================================

async function ensureInvoiceColumns() {
  if (!pool) return;
  try {
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deposit NUMERIC DEFAULT 0`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receipt_image TEXT`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS delivery_cost DECIMAL(10,2) DEFAULT 0`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS remaining_amount DECIMAL(10,2) DEFAULT 0`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS order_details TEXT DEFAULT ''`);
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
  const {
    order_id, customer_name, customer_phone, customer_address,
    items, tax_rate, discount, deposit, receipt_image, notes,
    due_date, currency, delivery_cost, order_details
  } = req.body;
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
    const deliveryCost = parseFloat(delivery_cost) || 0;
    const total = subtotal + tax_amount - disc + deliveryCost;
    const dep = parseFloat(deposit) || 0;
    const remaining = total - dep;

    const r = await pool.query(
      `INSERT INTO invoices (user_id, invoice_number, order_id, customer_name, customer_phone, customer_address,
       items, subtotal, tax_rate, tax_amount, discount, deposit, delivery_cost, total, remaining_amount,
       currency, notes, order_details, due_date, receipt_image)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
      [userId, invoice_number, order_id||null,
       sanitize(customer_name||''), sanitize(customer_phone||''), sanitize(customer_address||''),
       JSON.stringify(parsedItems), subtotal, taxRate, tax_amount, disc, dep, deliveryCost,
       total, remaining, currency||'IQD',
       sanitize(notes||''), sanitize(order_details||''), due_date||null, receipt_image||null]
    );
    res.json({ success: true, invoice: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// تحديث حالة الفاتورة
app.put('/api/invoices/:id', authenticateToken, async (req, res) => {
  const { status, notes, receipt_image } = req.body;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT user_id FROM invoices WHERE id=$1', [req.params.id]);
    if (!r.rows.length || r.rows[0].user_id !== req.user.id) return res.status(403).json({ success: false, message: 'غير مصرح' });
    await pool.query(
      'UPDATE invoices SET status=$1, notes=$2, receipt_image=COALESCE($3, receipt_image) WHERE id=$4',
      [status||'draft', sanitize(notes||''), receipt_image||null, req.params.id]
    );
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

    let items = [];
    try { items = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || []); } catch(e) {}

    const countR = await pool.query('SELECT COUNT(*) FROM invoices WHERE user_id=$1', [userId]);
    const count = parseInt(countR.rows[0].count) + 1;
    const invoice_number = `INV-${new Date().getFullYear()}-${String(count).padStart(4,'0')}`;

    const subtotal = items.reduce((s, i) => s + (parseFloat(i.price)||0) * (parseInt(i.qty||i.quantity)||1), 0);
    const deliveryCost = parseFloat(o.delivery_cost) || 0;
    const disc = parseFloat(o.discount) || 0;
    const total = subtotal + deliveryCost - disc;
    const dep = parseFloat(o.deposit) || 0;
    const remaining = total - dep;

    const r = await pool.query(
      `INSERT INTO invoices (user_id, invoice_number, order_id, customer_name, customer_phone, customer_address,
       items, subtotal, discount, deposit, delivery_cost, total, remaining_amount, currency, order_details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [userId, invoice_number, o.id,
       o.customer_name||'', o.customer_phone||'', o.customer_address||'',
       JSON.stringify(items), subtotal, disc, dep, deliveryCost, total, remaining,
       o.currency||'IQD', o.notes||'']
    );

    // إرسال نسخة للزبون على WhatsApp تلقائياً
    const invoice = r.rows[0];
    const bpR = await pool.query('SELECT store_name, currency, whatsapp_number FROM business_profile WHERE user_id=$1', [userId]);
    const bp = bpR.rows[0] || {};
    const storeName = bp.store_name || 'متجرنا';
    const currency = bp.currency || 'IQD';

    const phone = String(o.customer_phone||'').replace(/[^0-9]/g, '');
    const waPhone = phone.startsWith('0') ? '964' + phone.slice(1) : phone;

    let waMsg = `🧾 *فاتورة من ${storeName}*\n`;
    waMsg += `📋 رقم الفاتورة: *${invoice_number}*\n\n`;
    waMsg += `👤 الاسم: ${escapeHtml(o.customer_name||'')}\n`;
    waMsg += `📍 العنوان: ${escapeHtml(o.customer_address||'')}\n`;
    waMsg += `📱 الهاتف: ${o.customer_phone||''}\n\n`;
    if (o.notes) waMsg += `📝 التفاصيل: ${escapeHtml(o.notes)}\n\n`;
    waMsg += `━━━━━━━━━━━━━━\n`;
    waMsg += `💵 السعر الكلي: *${Number(total).toLocaleString()} ${currency}*\n`;
    if (deliveryCost > 0) waMsg += `🚚 التوصيل: ${Number(deliveryCost).toLocaleString()} ${currency}\n`;
    if (dep > 0) waMsg += `💳 العربون المدفوع: *${Number(dep).toLocaleString()} ${currency}*\n`;
    waMsg += `💰 المبلغ المتبقي: *${Number(remaining).toLocaleString()} ${currency}*\n`;
    waMsg += `━━━━━━━━━━━━━━\n`;
    waMsg += `شكراً لثقتك ⚡ ${storeName}`;

    const waUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(waMsg)}`;

    res.json({ success: true, invoice, wa_url: waUrl });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// إرسال فاتورة موجودة للزبون على WhatsApp
app.post('/api/invoices/:id/send-whatsapp', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const [invR, bpR] = await Promise.all([
      pool.query('SELECT * FROM invoices WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]),
      pool.query('SELECT store_name, currency FROM business_profile WHERE user_id=$1', [req.user.id])
    ]);
    if (!invR.rows.length) return res.status(404).json({ success: false, message: 'الفاتورة غير موجودة' });

    const inv = invR.rows[0];
    const bp = bpR.rows[0] || {};
    const storeName = bp.store_name || 'متجرنا';
    const currency = inv.currency || bp.currency || 'IQD';

    const phone = String(inv.customer_phone||'').replace(/[^0-9]/g, '');
    const waPhone = phone.startsWith('0') ? '964' + phone.slice(1) : phone;

    let waMsg = `🧾 *فاتورة من ${storeName}*\n`;
    waMsg += `📋 رقم: *${inv.invoice_number}*\n\n`;
    waMsg += `👤 ${escapeHtml(inv.customer_name||'')}\n`;
    waMsg += `📍 ${escapeHtml(inv.customer_address||'')}\n`;
    waMsg += `📱 ${inv.customer_phone||''}\n`;
    if (inv.order_details) waMsg += `\n📝 ${escapeHtml(inv.order_details)}\n`;
    waMsg += `\n━━━━━━━━━━━━━━\n`;
    waMsg += `💵 الإجمالي: *${Number(inv.total||0).toLocaleString()} ${currency}*\n`;
    if (Number(inv.delivery_cost||0) > 0) waMsg += `🚚 التوصيل: ${Number(inv.delivery_cost).toLocaleString()} ${currency}\n`;
    if (Number(inv.deposit||0) > 0) waMsg += `💳 العربون: *${Number(inv.deposit).toLocaleString()} ${currency}*\n`;
    waMsg += `💰 المتبقي: *${Number(inv.remaining_amount||0).toLocaleString()} ${currency}*\n`;
    waMsg += `━━━━━━━━━━━━━━\n`;
    waMsg += `⚡ ${storeName}`;

    const waUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(waMsg)}`;
    res.json({ success: true, wa_url: waUrl });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

};
