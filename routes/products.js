module.exports = function(app, pool, helpers) {
const { escapeHtml, sanitize, authenticateToken, rateLimit, notify, auditLog, esc } = helpers;

// ============================================================
// PRODUCTS
// ============================================================
app.post('/api/products', authenticateToken, async (req, res) => {
  const { name, description, price, category, stock, image_url, dynamic_attrs } = req.body;
  const userId = req.user.id;
  if (!name || !price) return res.status(400).json({ success: false, message: 'الاسم والسعر مطلوبان' });
  if (parseFloat(price) <= 0) return res.status(400).json({ success: false, message: 'السعر يجب أن يكون أكبر من صفر' });
  try {
    if (pool) {
      const r = await pool.query(
        'INSERT INTO products (user_id, name, description, price, category, stock, image_url, dynamic_attrs) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [userId, name, description||'', parseFloat(price), category||'عام', parseInt(stock)||0, image_url||'', JSON.stringify(dynamic_attrs||{})]
      );
      await auditLog(userId, 'create_product', 'products', r.rows[0].id, name, req.ip);
      return res.json({ success: true, product: r.rows[0] });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/products', authenticateToken, async (req, res) => {
  const { q, category } = req.query;
  try {
    if (pool) {
      let query = 'SELECT * FROM products WHERE user_id=$1';
      const params = [req.user.id];
      if (q) { query += ' AND (name ILIKE $2 OR description ILIKE $2)'; params.push(`%${q}%`); }
      else if (category) { query += ' AND category=$2'; params.push(category); }
      query += ' ORDER BY created_at DESC';
      const r = await pool.query(query, params);
      return res.json({ products: r.rows });
    }
  } catch (e) {}
  res.json({ products: [] });
});

app.put('/api/products/:id', authenticateToken, async (req, res) => {
  const { name, description, price, category, stock, image_url, is_available, dynamic_attrs } = req.body;
  try {
    if (pool) {
      await pool.query(
        'UPDATE products SET name=$1,description=$2,price=$3,category=$4,stock=$5,image_url=$6,is_available=$7,dynamic_attrs=$8 WHERE id=$9 AND user_id=$10',
        [name, description||'', parseFloat(price), category||'عام', parseInt(stock)||0, image_url||'', is_available!==false, JSON.stringify(dynamic_attrs||{}), req.params.id, req.user.id]
      );
      return res.json({ success: true });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/products/:id', authenticateToken, async (req, res) => {
  try {
    if (pool) { await pool.query('DELETE FROM products WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]); }
    return res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.put('/api/products/:id/stock', authenticateToken, async (req, res) => {
  const { quantity, operation } = req.body;
  const userId = req.user.id;
  try {
    if (pool) {
      let q;
      if (operation === 'add') q = 'UPDATE products SET stock=stock+$1 WHERE id=$2 AND user_id=$3 RETURNING *';
      else if (operation === 'subtract') q = 'UPDATE products SET stock=GREATEST(0,stock-$1) WHERE id=$2 AND user_id=$3 RETURNING *';
      else q = 'UPDATE products SET stock=$1 WHERE id=$2 AND user_id=$3 RETURNING *';
      const r = await pool.query(q, [parseInt(quantity), req.params.id, userId]);
      if (r.rows.length > 0) {
        const prod = r.rows[0];
        if (prod.stock === 0) {
          await notify(userId, '🚨 نفذ المخزون!', `${prod.name} نفذ من المخزون`, 'inventory');
          await pool.query('UPDATE products SET is_available=false WHERE id=$1', [req.params.id]);
        } else if (prod.stock <= 5) {
          await notify(userId, '⚠️ مخزون منخفض', `${prod.name} — متبقي ${prod.stock} فقط`, 'inventory');
        }
        return res.json({ success: true, product: prod });
      }
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/inventory/alerts', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM products WHERE user_id=$1 AND stock<=5 ORDER BY stock ASC', [req.user.id]);
      return res.json({ alerts: r.rows });
    }
  } catch (e) {}
  res.json({ alerts: [] });
});

// ============================================================
// PRODUCT IMPORT FROM EXCEL — استيراد المنتجات من Excel
// ============================================================
app.post('/api/products/import-excel', authenticateToken, async (req, res) => {
  const { rows } = req.body; // مصفوفة من الصفوف [{name,price,description,category,stock,image_url}]
  if (!Array.isArray(rows) || !rows.length)
    return res.status(400).json({ success: false, message: 'لا بيانات للاستيراد' });
  if (rows.length > 500)
    return res.status(400).json({ success: false, message: 'الحد الأقصى 500 منتج' });
  if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

  const userId = req.user.id;
  let imported = 0, skipped = 0, errors = [];

  for (const row of rows) {
    const name = String(row.name || row['الاسم'] || row['اسم المنتج'] || '').trim();
    const price = parseFloat(row.price || row['السعر'] || row['سعر'] || 0);
    if (!name || price <= 0) { skipped++; continue; }

    try {
      await pool.query(
        `INSERT INTO products (user_id,name,description,price,category,stock,image_url,dynamic_attrs)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'{}')`,
        [userId,
         escapeHtml(name),
         escapeHtml(String(row.description || row['الوصف'] || row['وصف'] || '')),
         price,
         escapeHtml(String(row.category || row['الفئة'] || row['فئة'] || 'عام')),
         parseInt(row.stock || row['المخزون'] || row['مخزون'] || 0) || 0,
         String(row.image_url || row['الصورة'] || row['صورة'] || '')]
      );
      imported++;
    } catch(e) { skipped++; errors.push(`${name}: ${e.message}`); }
  }

  await auditLog(userId, 'import_products_excel', 'products', null, `استُورد ${imported} منتج`, req.ip);
  res.json({ success: true, imported, skipped, errors: errors.slice(0,10), message: `تم استيراد ${imported} منتج` });
});

// ============================================================
// PRODUCT FROM IMAGE — استخراج منتج من صورة بالـ AI
// ============================================================
app.post('/api/products/from-image', authenticateToken, async (req, res) => {
  const { image_url, image_base64 } = req.body;
  if (!image_url && !image_base64)
    return res.status(400).json({ success: false, message: 'الصورة مطلوبة' });

  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(503).json({ success: false, message: 'AI غير متاح' });

  try {
    // جلب نوع النشاط لتخصيص الاستخراج
    let biz = {};
    if (pool) {
      const bp = await pool.query('SELECT business_type, currency FROM business_profile WHERE user_id=$1', [req.user.id]);
      biz = bp.rows[0] || {};
    }

    const imageContent = image_url
      ? { type: 'image_url', image_url: { url: image_url } }
      : { type: 'image_url', image_url: { url: image_base64 } };

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: [
            imageContent,
            { type: 'text', text: `أنت خبير تجزئة عربي. حلّل هذه الصورة واستخرج بيانات المنتج.
نوع المتجر: ${escapeHtml(biz.business_type || 'عام')}
العملة: ${biz.currency || 'IQD'}

أرجع JSON فقط:
{
  "name": "اسم المنتج بالعربية",
  "description": "وصف مختصر جذاب",
  "category": "الفئة المناسبة",
  "suggested_price": 0,
  "dynamic_attrs": {"لون": "...", "مقاس": "..."},
  "confidence": 85,
  "notes": "ملاحظات للبائع"
}
إذا لم تتعرف على المنتج ضع confidence أقل من 50.` }
          ]
        }]
      })
    });

    const aiData = await aiRes.json();
    let result = aiData.choices?.[0]?.message?.content || '{}';
    try { result = JSON.parse(result.replace(/```json|```/g, '').trim()); } catch(e) { result = {}; }

    res.json({ success: true, product: result });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// PRODUCT FROM TEXT COMMAND — أوامر نصية AI لإضافة منتجات
// ============================================================
app.post('/api/products/from-text', authenticateToken, async (req, res) => {
  const { text } = req.body;
  if (!text || String(text).length > 500)
    return res.status(400).json({ success: false, message: 'النص مطلوب' });

  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(503).json({ success: false, message: 'AI غير متاح' });

  try {
    let biz = {};
    if (pool) {
      const bp = await pool.query('SELECT business_type, currency FROM business_profile WHERE user_id=$1', [req.user.id]);
      biz = bp.rows[0] || {};
    }

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `أنت مساعد إدخال بيانات لمتجر ${escapeHtml(biz.business_type||'عام')} يعمل بعملة ${biz.currency||'IQD'}.
استخرج بيانات المنتج من هذا النص العربي:
"${escapeHtml(String(text).substring(0, 500))}"

أرجع JSON فقط:
{"name":"اسم المنتج","price":0,"stock":0,"category":"الفئة","description":"","dynamic_attrs":{}}

ملاحظات:
- السعر رقم فقط بدون عملة
- إذا لم يُذكر المخزون اجعله 0
- استنتج الفئة من اسم المنتج إذا لم تُذكر`
        }]
      })
    });

    const aiData = await aiRes.json();
    let result = aiData.choices?.[0]?.message?.content || '{}';
    try { result = JSON.parse(result.replace(/```json|```/g, '').trim()); } catch(e) { result = {}; }

    // حفظ تلقائي إذا البيانات كاملة
    let saved = false;
    let savedProduct = null;
    if (result.name && result.price > 0 && pool) {
      const r = await pool.query(
        `INSERT INTO products (user_id,name,description,price,category,stock,dynamic_attrs)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [req.user.id, escapeHtml(result.name), escapeHtml(result.description||''),
         parseFloat(result.price)||0, escapeHtml(result.category||'عام'),
         parseInt(result.stock)||0, JSON.stringify(result.dynamic_attrs||{})]
      );
      saved = true;
      savedProduct = r.rows[0];
      await auditLog(req.user.id, 'create_product_text', 'products', savedProduct.id, result.name, req.ip);
    }

    res.json({ success: true, product: result, saved, saved_product: savedProduct });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// DYNAMIC ATTRS BY BUSINESS TYPE — السمات حسب نوع النشاط
// ============================================================
app.get('/api/products/dynamic-attrs', authenticateToken, async (req, res) => {
  const ATTRS_BY_TYPE = {
    retail:      [['اللون','أحمر'],['المقاس','M'],['المادة','قطن']],
    restaurant:  [['الحجم','وسط'],['الإضافات','جبن'],['الحرارة','حار']],
    real_estate: [['المساحة','120م²'],['الغرف','3'],['الطابق','2']],
    services:    [['المدة','ساعة'],['النوع','منزلي'],['المكان','عندك']],
    health:      [['النوع','تدليك'],['المدة','60 دقيقة'],['الجنس','مختلط']],
    education:   [['المستوى','مبتدئ'],['المدة','شهر'],['الشهادة','نعم']],
    sports:      [['النوع','كرة'],['المقاس','5'],['اللون','أبيض']],
    perfume:     [['الحجم','100مل'],['التركيز','EDP'],['النوع','عطر رجالي']],
    furniture:   [['اللون','بني'],['المادة','خشب'],['الأبعاد','200×90']],
    fashion:     [['المقاس','L'],['اللون','أسود'],['الخامة','قطن']],
    electronics: [['الموديل','2024'],['اللون','أسود'],['السعة','128GB']],
    other:       [['النوع',''],['اللون',''],['المقاس','']]
  };

  try {
    let businessType = req.query.type || 'other';
    if (!businessType && pool) {
      const bp = await pool.query('SELECT business_type FROM business_profile WHERE user_id=$1', [req.user.id]);
      businessType = bp.rows[0]?.business_type || 'other';
    }
    const attrs = ATTRS_BY_TYPE[businessType] || ATTRS_BY_TYPE.other;
    res.json({ success: true, attrs, business_type: businessType });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// EMPLOYEE ACTIVITY LOG — سجل نشاط الموظف الرقمي
// ============================================================
// جلب سجل المحادثات
app.get('/api/employee/activity', authenticateToken, async (req, res) => {
  const { limit = 20, offset = 0 } = req.query;
  try {
    if (!pool) return res.json({ success: true, sessions: [], corrections: [], stats: {} });

    const [sessions, corrections, stats] = await Promise.all([
      pool.query(
        `SELECT id, type, topic, corrections, score,
                LENGTH(messages) as msg_size,
                (SELECT COUNT(*) FROM json_array_length(messages::json, 0)) as msg_count,
                created_at
         FROM training_sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [req.user.id, parseInt(limit), parseInt(offset)]
      ).catch(() => pool.query(
        'SELECT id, type, topic, corrections, score, created_at FROM training_sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [req.user.id, parseInt(limit), parseInt(offset)]
      )),
      pool.query(
        'SELECT id, original_response, corrected_response, lesson, context, created_at FROM training_corrections WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10',
        [req.user.id]
      ),
      pool.query(
        'SELECT trust_level, trust_score, total_interactions, correct_interactions, updated_at FROM digital_employee WHERE user_id=$1',
        [req.user.id]
      )
    ]);

    const emp = stats.rows[0] || {};
    const accuracy = emp.total_interactions > 0
      ? Math.round((emp.correct_interactions / emp.total_interactions) * 100) : 0;

    res.json({
      success: true,
      sessions: sessions.rows,
      corrections: corrections.rows,
      stats: { ...emp, accuracy, sessions_count: sessions.rows.length }
    });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// جلب محادثة معينة كاملة
app.get('/api/employee/activity/:sessionId', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.json({ success: true, session: null });
    const r = await pool.query(
      'SELECT * FROM training_sessions WHERE id=$1 AND user_id=$2',
      [req.params.sessionId, req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'الجلسة غير موجودة' });
    const session = r.rows[0];
    let messages = [];
    try { messages = JSON.parse(session.messages || '[]'); } catch(e) {}
    res.json({ success: true, session: { ...session, messages } });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// AUTO DELIVERY NOTIFICATION — تتبع تلقائي للعميل
// ============================================================
};
