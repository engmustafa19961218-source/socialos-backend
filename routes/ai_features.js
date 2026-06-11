module.exports = function(app, pool, helpers) {
const { escapeHtml, sanitize, authenticateToken, rateLimit, notify, auditLog, esc } = helpers;

// ============================================================
// AI FEATURES — ميزات الذكاء الاصطناعي المتقدمة
// ============================================================

const OPENROUTER_KEY = () => process.env.OPENROUTER_API_KEY;

// ============================================================
// 1. تحليل مشاعر العملاء
// ============================================================
app.post('/api/ai/sentiment', authenticateToken, rateLimit(30, 60000), async (req, res) => {
  const { text, source, customer_phone, order_id } = req.body;
  if (!text) return res.status(400).json({ success: false, message: 'النص مطلوب' });

  const KEY = OPENROUTER_KEY();
  if (!KEY) return res.status(503).json({ success: false, message: 'AI غير متاح' });

  try {
    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `حلل مشاعر هذا النص من زبون وأجب بـ JSON فقط بدون أي نص إضافي:
النص: "${text}"

أجب بهذا الشكل:
{
  "sentiment": "positive|negative|neutral",
  "score": 0.0-1.0,
  "emotion": "سعيد|غاضب|محبط|راضٍ|قلق|محايد",
  "summary": "ملخص قصير جداً بالعربية",
  "action": "reply|escalate|ignore",
  "suggested_reply": "رد مقترح بالعربية"
}`
        }]
      })
    });

    const data = await aiRes.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    let result;
    try {
      result = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch(e) {
      result = { sentiment: 'neutral', score: 0.5, emotion: 'محايد', summary: raw.substring(0, 100), action: 'reply', suggested_reply: '' };
    }

    // حفظ في قاعدة البيانات
    if (pool) {
      await pool.query(
        `INSERT INTO sentiment_analysis (user_id, text, source, customer_phone, order_id, sentiment, score, emotion, summary, action, suggested_reply)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [req.user.id, sanitize(text.substring(0,1000)), source||'manual', sanitize(customer_phone||''),
         order_id||null, result.sentiment, result.score||0.5, result.emotion||'',
         result.summary||'', result.action||'reply', result.suggested_reply||'']
      ).catch(() => {});

      // إشعار تلقائي عند مشاعر سلبية
      if (result.sentiment === 'negative' && result.score > 0.7) {
        await notify(req.user.id, '⚠️ زبون غير راضٍ!', `${result.emotion} — ${result.summary}`, 'sentiment');
      }
    }

    res.json({ success: true, result });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// جلب سجل المشاعر
app.get('/api/ai/sentiment', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.json({ success: true, records: [] });
    const r = await pool.query(
      'SELECT * FROM sentiment_analysis WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    res.json({ success: true, records: r.rows });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// تحليل جميع التعليقات دفعة واحدة
app.post('/api/ai/sentiment/batch', authenticateToken, rateLimit(5, 60000), async (req, res) => {
  const { texts } = req.body;
  if (!Array.isArray(texts) || !texts.length) return res.status(400).json({ success: false, message: 'النصوص مطلوبة' });

  const KEY = OPENROUTER_KEY();
  if (!KEY) return res.status(503).json({ success: false, message: 'AI غير متاح' });

  try {
    const results = await Promise.all(
      texts.slice(0, 10).map(async (text) => {
        const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'anthropic/claude-haiku-4-5',
            max_tokens: 200,
            messages: [{ role: 'user', content: `حلل مشاعر: "${text.substring(0,200)}" - أجب بـ JSON: {"sentiment":"positive|negative|neutral","score":0.0-1.0,"emotion":"نص","suggested_reply":"نص"}` }]
          })
        });
        const d = await aiRes.json();
        try { return { text, ...JSON.parse(d.choices?.[0]?.message?.content?.replace(/```json|```/g,'').trim()||'{}') }; }
        catch(e) { return { text, sentiment: 'neutral', score: 0.5 }; }
      })
    );
    res.json({ success: true, results });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// 2. توقع المبيعات
// ============================================================
app.post('/api/ai/forecast', authenticateToken, rateLimit(10, 60000), async (req, res) => {
  const KEY = OPENROUTER_KEY();
  if (!KEY) return res.status(503).json({ success: false, message: 'AI غير متاح' });

  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    // جلب بيانات المبيعات التاريخية
    const [salesData, topProducts, bpData] = await Promise.all([
      pool.query(`
        SELECT DATE_TRUNC('day', created_at) as day,
               COUNT(*) as orders, SUM(total) as revenue
        FROM orders WHERE user_id=$1
        AND created_at > NOW() - INTERVAL '30 days'
        GROUP BY day ORDER BY day
      `, [req.user.id]),
      pool.query(`
        SELECT name, COUNT(*) as sales, SUM(total) as revenue
        FROM orders o, jsonb_array_elements(items::jsonb) item
        WHERE o.user_id=$1
        GROUP BY name ORDER BY sales DESC LIMIT 5
      `, [req.user.id]).catch(() => ({ rows: [] })),
      pool.query('SELECT store_name, business_type, currency FROM business_profile WHERE user_id=$1', [req.user.id])
    ]);

    const bp = bpData.rows[0] || {};
    const salesHistory = salesData.rows;
    const avgDaily = salesHistory.length > 0
      ? salesHistory.reduce((s, r) => s + Number(r.revenue || 0), 0) / salesHistory.length
      : 0;

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `أنت محلل مبيعات. بناءً على هذه البيانات التاريخية لـ 30 يوم الماضية، توقع المبيعات للأسبوع القادم.

المتجر: ${bp.store_name} — ${bp.business_type}
العملة: ${bp.currency || 'IQD'}
متوسط الإيراد اليومي: ${avgDaily.toFixed(0)}
بيانات المبيعات: ${JSON.stringify(salesHistory.slice(-7))}

أجب بـ JSON فقط:
{
  "next_7_days": [
    {"day": "الأحد", "predicted_orders": 0, "predicted_revenue": 0, "confidence": 0.0},
    {"day": "الاثنين", "predicted_orders": 0, "predicted_revenue": 0, "confidence": 0.0},
    {"day": "الثلاثاء", "predicted_orders": 0, "predicted_revenue": 0, "confidence": 0.0},
    {"day": "الأربعاء", "predicted_orders": 0, "predicted_revenue": 0, "confidence": 0.0},
    {"day": "الخميس", "predicted_orders": 0, "predicted_revenue": 0, "confidence": 0.0},
    {"day": "الجمعة", "predicted_orders": 0, "predicted_revenue": 0, "confidence": 0.0},
    {"day": "السبت", "predicted_orders": 0, "predicted_revenue": 0, "confidence": 0.0}
  ],
  "total_predicted_revenue": 0,
  "total_predicted_orders": 0,
  "trend": "صاعد|هابط|ثابت",
  "tips": ["نصيحة 1", "نصيحة 2", "نصيحة 3"],
  "best_day": "اسم اليوم",
  "risk_factors": ["عامل خطر 1"]
}`
        }]
      })
    });

    const data = await aiRes.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    let forecast;
    try { forecast = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
    catch(e) { forecast = { error: 'فشل التحليل', raw: raw.substring(0, 200) }; }

    // حفظ التوقع
    if (pool && forecast.total_predicted_revenue) {
      await pool.query(
        `INSERT INTO sales_forecasts (user_id, forecast_date, predicted_revenue, predicted_orders, confidence, factors)
         VALUES ($1, NOW(), $2, $3, $4, $5)`,
        [req.user.id, forecast.total_predicted_revenue || 0, forecast.total_predicted_orders || 0,
         0.75, JSON.stringify(forecast)]
      ).catch(() => {});
    }

    res.json({ success: true, forecast, historical: salesHistory });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// 3. تسعير ذكي
// ============================================================
app.post('/api/ai/pricing', authenticateToken, rateLimit(10, 60000), async (req, res) => {
  const { product_id } = req.body;
  const KEY = OPENROUTER_KEY();
  if (!KEY) return res.status(503).json({ success: false, message: 'AI غير متاح' });

  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    const [prodData, salesData, bpData] = await Promise.all([
      product_id
        ? pool.query('SELECT * FROM products WHERE id=$1 AND user_id=$2', [product_id, req.user.id])
        : pool.query('SELECT * FROM products WHERE user_id=$1 AND is_available=true ORDER BY created_at DESC LIMIT 10', [req.user.id]),
      pool.query(`
        SELECT p.name, p.price, COUNT(o.id) as sales_count
        FROM products p
        LEFT JOIN orders o ON o.user_id=p.user_id AND o.items::text LIKE '%'||p.name||'%'
        WHERE p.user_id=$1
        GROUP BY p.id, p.name, p.price
        ORDER BY sales_count DESC LIMIT 10
      `, [req.user.id]).catch(() => ({ rows: [] })),
      pool.query('SELECT store_name, business_type, currency FROM business_profile WHERE user_id=$1', [req.user.id])
    ]);

    const bp = bpData.rows[0] || {};
    const products = prodData.rows;

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `أنت خبير تسعير. حلل أسعار هذه المنتجات واقترح تحسينات.

المتجر: ${bp.store_name} — ${bp.business_type}
العملة: ${bp.currency || 'IQD'}
المنتجات: ${JSON.stringify(products.map(p => ({ name: p.name, price: p.price, stock: p.stock })))}
مبيعات المنتجات: ${JSON.stringify(salesData.rows)}

أجب بـ JSON فقط:
{
  "recommendations": [
    {
      "product_name": "اسم المنتج",
      "current_price": 0,
      "suggested_price": 0,
      "change_percent": 0,
      "reason": "السبب",
      "priority": "high|medium|low"
    }
  ],
  "general_tips": ["نصيحة 1", "نصيحة 2"],
  "pricing_strategy": "اسم الاستراتيجية",
  "expected_revenue_increase": "نسبة مئوية متوقعة"
}`
        }]
      })
    });

    const data = await aiRes.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    let pricing;
    try { pricing = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
    catch(e) { pricing = { error: 'فشل التحليل' }; }

    res.json({ success: true, pricing, products });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// 4. ChatBot WhatsApp — الرد التلقائي
// ============================================================
app.post('/api/ai/chatbot', authenticateToken, rateLimit(50, 60000), async (req, res) => {
  const { message, customer_phone, customer_name, history } = req.body;
  if (!message) return res.status(400).json({ success: false, message: 'الرسالة مطلوبة' });

  const KEY = OPENROUTER_KEY();
  if (!KEY) return res.status(503).json({ success: false, message: 'AI غير متاح' });

  try {
    let context = {};
    if (pool) {
      const [bpData, productsData, ordersData, knowledgeData] = await Promise.all([
        pool.query('SELECT * FROM business_profile WHERE user_id=$1', [req.user.id]),
        pool.query('SELECT name, price, description, is_available FROM products WHERE user_id=$1 AND is_available=true LIMIT 20', [req.user.id]),
        customer_phone
          ? pool.query('SELECT * FROM orders WHERE user_id=$1 AND customer_phone=$2 ORDER BY created_at DESC LIMIT 3', [req.user.id, customer_phone])
          : Promise.resolve({ rows: [] }),
        pool.query('SELECT title, content FROM knowledge_base WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5', [req.user.id])
      ]);
      context = {
        store: bpData.rows[0] || {},
        products: productsData.rows,
        customer_orders: ordersData.rows,
        knowledge: knowledgeData.rows
      };
    }

    const bp = context.store;
    const statusMap = { new:'جديد', confirmed:'مؤكد', processing:'جاري التجهيز', shipped:'شُحن', delivered:'تم التوصيل', cancelled:'ملغي' };

    const systemPrompt = `أنت موظف خدمة عملاء ذكي لمتجر "${bp?.store_name || 'متجرنا'}".
أسلوب التواصل: ${bp?.communication_style || 'ودي وقريب'}
نوع النشاط: ${bp?.business_type || ''}

المنتجات المتاحة:
${context.products?.map(p => `- ${p.name}: ${Number(p.price).toLocaleString()} ${bp?.currency||'IQD'}`).join('\n') || 'لا منتجات'}

${context.knowledge?.length ? `معلومات المتجر:\n${context.knowledge.map(k => `${k.title}: ${k.content}`).join('\n')}` : ''}

${context.customer_orders?.length ? `طلبيات الزبون السابقة:\n${context.customer_orders.map(o => `#${o.id} - ${statusMap[o.status]||o.status} - ${Number(o.total).toLocaleString()} ${bp?.currency||'IQD'}`).join('\n')}` : ''}

تعليمات:
- رد بالعربية بأسلوب ودي ومهني
- إذا سأل عن منتج، اذكر السعر والتفاصيل
- إذا أراد الطلب، اطلب منه الاسم والعنوان وأكد الطلب
- إذا سأل عن طلب سابق، أجبه بالمعلومات المتاحة
- الردود مختصرة وواضحة (2-4 جمل)
- أجب بـ JSON: {"reply": "نص الرد", "action": "none|confirm_order|send_catalog|transfer_human", "order_data": null}`;

    const messages = [
      ...(Array.isArray(history) ? history.slice(-6) : []),
      { role: 'user', content: message }
    ];

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 400,
        system: systemPrompt,
        messages
      })
    });

    const data = await aiRes.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    let result;
    try { result = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
    catch(e) { result = { reply: raw.substring(0, 300), action: 'none' }; }

    // تحليل المشاعر تلقائياً
    if (pool && customer_phone) {
      await pool.query(
        `INSERT INTO chatbot_conversations (user_id, customer_phone, customer_name, message, reply, action)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [req.user.id, sanitize(customer_phone||''), sanitize(customer_name||''), sanitize(message.substring(0,500)), sanitize(result.reply||''), result.action||'none']
      ).catch(() => {});
    }

    res.json({ success: true, reply: result.reply, action: result.action, order_data: result.order_data });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// جلب محادثات ChatBot
app.get('/api/ai/chatbot/conversations', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.json({ success: true, conversations: [] });
    const r = await pool.query(
      `SELECT customer_phone, customer_name, MAX(created_at) as last_msg,
       COUNT(*) as msg_count, array_agg(message ORDER BY created_at DESC) as messages
       FROM chatbot_conversations WHERE user_id=$1
       GROUP BY customer_phone, customer_name ORDER BY last_msg DESC LIMIT 20`,
      [req.user.id]
    );
    res.json({ success: true, conversations: r.rows });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// 5. تتبع الطلب للزبون — رابط خاص
// ============================================================
app.get('/track/:token', async (req, res) => {
  try {
    if (!pool) return res.status(503).send('الخدمة غير متاحة');
    const r = await pool.query('SELECT * FROM orders WHERE track_token=$1', [req.params.token]);
    if (!r.rows.length) return res.status(404).send('الطلب غير موجود');
    const o = r.rows[0];
    const bp = await pool.query('SELECT store_name, currency FROM business_profile WHERE user_id=$1', [o.user_id]);
    const store = bp.rows[0] || {};

    const statusSteps = [
      { key: 'new', label: 'تم استلام الطلب', icon: '📝' },
      { key: 'confirmed', label: 'تم تأكيد الطلب', icon: '✅' },
      { key: 'processing', label: 'جاري التجهيز', icon: '⚙️' },
      { key: 'shipped', label: 'تم الشحن', icon: '🚚' },
      { key: 'delivered', label: 'تم التوصيل', icon: '🎉' }
    ];
    const currentIdx = statusSteps.findIndex(s => s.key === o.status);

    res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>تتبع طلبك — ${store.store_name || 'متجرنا'}</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Segoe UI',Tahoma,Arial,sans-serif; background:#f5f5ff; color:#1a1a2e; padding:20px; }
  .card { background:white; border-radius:16px; padding:20px; margin-bottom:16px; box-shadow:0 4px 20px rgba(0,0,0,.08); }
  h1 { color:#6C63FF; font-size:1.4em; margin-bottom:6px; }
  .status-bar { display:flex; flex-direction:column; gap:12px; margin-top:16px; }
  .step { display:flex; align-items:center; gap:12px; }
  .step-icon { width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:1.1em; flex-shrink:0; }
  .step.done .step-icon { background:#6C63FF22; }
  .step.active .step-icon { background:#6C63FF; }
  .step.pending .step-icon { background:#f5f5f5; }
  .step-label { font-size:.88em; font-weight:600; }
  .step.pending .step-label { color:#aaa; }
  .info-row { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #f0f0ff; font-size:.88em; }
  .badge { background:#6C63FF22; color:#6C63FF; border-radius:20px; padding:4px 12px; font-size:.8em; font-weight:700; }
</style>
</head>
<body>
  <div class="card">
    <h1>⚡ ${store.store_name || 'متجرنا'}</h1>
    <p style="color:#888;font-size:.82em">تتبع طلبك في الوقت الفعلي</p>
  </div>
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div style="font-weight:700">طلب رقم #${o.id}</div>
      <span class="badge">${statusSteps[currentIdx]?.label || o.status}</span>
    </div>
    <div class="info-row"><span>👤 الاسم</span><span>${o.customer_name || ''}</span></div>
    <div class="info-row"><span>💰 المبلغ</span><span>${Number(o.total||0).toLocaleString()} ${store.currency||'IQD'}</span></div>
    ${o.delivery_company ? `<div class="info-row"><span>🚚 التوصيل</span><span>${o.delivery_company}</span></div>` : ''}
    ${o.delivery_link ? `<div class="info-row"><span>🔍 رقم التتبع</span><span style="direction:ltr">${o.delivery_link}</span></div>` : ''}
  </div>
  <div class="card">
    <div style="font-weight:700;margin-bottom:14px">مراحل الطلب</div>
    <div class="status-bar">
      ${statusSteps.map((step, i) => `
        <div class="step ${i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'pending'}">
          <div class="step-icon">${i <= currentIdx ? step.icon : '⭕'}</div>
          <div class="step-label">${step.label}</div>
          ${i === currentIdx ? '<div style="margin-right:auto;font-size:.72em;color:#6C63FF;font-weight:700">الحالة الحالية</div>' : ''}
        </div>
      `).join('')}
    </div>
  </div>
  <div style="text-align:center;font-size:.75em;color:#aaa;margin-top:20px">⚡ مدعوم بـ SocialOS</div>
</body>
</html>`);
  } catch(e) { res.status(500).send('خطأ: ' + e.message); }
});

// إنشاء رابط تتبع للطلب
app.post('/api/orders/:id/track-link', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'الطلب غير موجود' });

    let token = r.rows[0].track_token;
    if (!token) {
      token = require('crypto').randomBytes(16).toString('hex');
      await pool.query('UPDATE orders SET track_token=$1 WHERE id=$2', [token, req.params.id]);
    }

    const baseUrl = process.env.BASE_URL || 'https://socialos-production-4aa6.up.railway.app';
    const trackUrl = `${baseUrl}/track/${token}`;
    res.json({ success: true, track_url: trackUrl, token });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// 6. تقييم الخدمة بعد التوصيل
// ============================================================
app.get('/review/:token', async (req, res) => {
  try {
    if (!pool) return res.status(503).send('الخدمة غير متاحة');
    const r = await pool.query('SELECT * FROM orders WHERE track_token=$1', [req.params.token]);
    if (!r.rows.length) return res.status(404).send('الطلب غير موجود');
    const o = r.rows[0];
    const bp = await pool.query('SELECT store_name FROM business_profile WHERE user_id=$1', [o.user_id]);
    const store = bp.rows[0] || {};

    res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>تقييم تجربتك — ${store.store_name||'متجرنا'}</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Segoe UI',Tahoma,Arial,sans-serif; background:#f5f5ff; color:#1a1a2e; padding:20px; }
  .card { background:white; border-radius:16px; padding:24px; box-shadow:0 4px 20px rgba(0,0,0,.08); }
  h1 { color:#6C63FF; font-size:1.3em; margin-bottom:6px; }
  .stars { display:flex; gap:10px; justify-content:center; margin:20px 0; }
  .star { font-size:2.5em; cursor:pointer; transition:transform .1s; }
  .star:hover, .star.active { transform:scale(1.2); }
  textarea { width:100%; border:1px solid #e0e0ff; border-radius:10px; padding:12px; font-size:.88em; font-family:inherit; resize:none; margin-bottom:14px; direction:rtl; }
  button { background:#6C63FF; color:white; border:none; border-radius:10px; padding:12px; width:100%; font-size:.95em; font-weight:700; cursor:pointer; }
  #thanks { display:none; text-align:center; padding:30px; }
</style>
</head>
<body>
<div class="card">
  <div id="form-section">
    <h1>⭐ قيّم تجربتك</h1>
    <p style="color:#888;font-size:.82em;margin-bottom:16px">${store.store_name||'متجرنا'} — طلب #${o.id}</p>
    <div style="text-align:center;font-size:.88em;color:#888;margin-bottom:6px">كيف كانت تجربتك؟</div>
    <div class="stars" id="stars">
      ${[1,2,3,4,5].map(i => `<span class="star" onclick="setRating(${i})" id="star-${i}">☆</span>`).join('')}
    </div>
    <div style="font-size:.88em;color:#888;margin-bottom:10px">ملاحظاتك (اختياري)</div>
    <textarea id="comment" rows="3" placeholder="اكتب ملاحظاتك هنا..."></textarea>
    <button onclick="submitReview('${token}')">إرسال التقييم</button>
  </div>
  <div id="thanks">
    <div style="font-size:3em;margin-bottom:12px">🎉</div>
    <div style="font-size:1.1em;font-weight:700;color:#6C63FF;margin-bottom:8px">شكراً لتقييمك!</div>
    <div style="font-size:.85em;color:#888">رأيك يساعدنا على التحسين</div>
  </div>
</div>
<script>
  let rating = 0;
  function setRating(r) {
    rating = r;
    for(let i=1;i<=5;i++) {
      const s = document.getElementById('star-'+i);
      s.textContent = i <= r ? '⭐' : '☆';
      s.classList.toggle('active', i <= r);
    }
  }
  async function submitReview(token) {
    if (!rating) return alert('اختر عدد النجوم');
    const comment = document.getElementById('comment').value;
    const res = await fetch('/api/ai/review', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ token, rating, comment })
    });
    if (res.ok) {
      document.getElementById('form-section').style.display='none';
      document.getElementById('thanks').style.display='block';
    }
  }
</script>
</body>
</html>`);
  } catch(e) { res.status(500).send('خطأ'); }
});

// حفظ التقييم
app.post('/api/ai/review', async (req, res) => {
  const { token, rating, comment } = req.body;
  if (!token || !rating) return res.status(400).json({ success: false });
  try {
    if (!pool) return res.status(503).json({ success: false });
    const r = await pool.query('SELECT * FROM orders WHERE track_token=$1', [token]);
    if (!r.rows.length) return res.status(404).json({ success: false });
    const o = r.rows[0];

    await pool.query(
      `INSERT INTO service_reviews (user_id, order_id, customer_phone, customer_name, rating, comment)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [o.user_id, o.id, o.customer_phone, o.customer_name, parseInt(rating), sanitize(comment||'')]
    );

    await notify(o.user_id, `⭐ تقييم جديد ${rating}/5`, `${o.customer_name} — ${comment?.substring(0,50)||''}`, 'review');
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false }); }
});

// جلب التقييمات
app.get('/api/ai/reviews', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.json({ success: true, reviews: [], avg: 0 });
    const [reviews, avg] = await Promise.all([
      pool.query('SELECT * FROM service_reviews WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [req.user.id]),
      pool.query('SELECT AVG(rating) as avg, COUNT(*) as total FROM service_reviews WHERE user_id=$1', [req.user.id])
    ]);
    res.json({ success: true, reviews: reviews.rows, avg: parseFloat(avg.rows[0]?.avg||0).toFixed(1), total: avg.rows[0]?.total||0 });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// إرسال رابط تقييم للزبون بعد التوصيل
app.post('/api/orders/:id/send-review-link', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const [orderR, bpR] = await Promise.all([
      pool.query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]),
      pool.query('SELECT store_name FROM business_profile WHERE user_id=$1', [req.user.id])
    ]);
    if (!orderR.rows.length) return res.status(404).json({ success: false });
    const o = orderR.rows[0];
    const bp = bpR.rows[0] || {};

    let token = o.track_token;
    if (!token) {
      token = require('crypto').randomBytes(16).toString('hex');
      await pool.query('UPDATE orders SET track_token=$1 WHERE id=$2', [token, req.params.id]);
    }

    const baseUrl = process.env.BASE_URL || 'https://socialos-production-4aa6.up.railway.app';
    const reviewUrl = `${baseUrl}/review/${token}`;
    const phone = String(o.customer_phone||'').replace(/[^0-9]/g,'');
    const waPhone = phone.startsWith('0') ? '964'+phone.slice(1) : phone;

    const msg = `⭐ *قيّم تجربتك — ${bp.store_name||'متجرنا'}*\n\nأهلاً ${o.customer_name||''} 😊\nوصل طلبك رقم #${o.id} بنجاح!\n\nنرجو منك تقييم تجربتك:\n${reviewUrl}\n\nرأيك يساعدنا على التحسين 🙏\n⚡ ${bp.store_name||''}`;
    const waUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`;

    res.json({ success: true, wa_url: waUrl, review_url: reviewUrl });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// 7. مقارنة بالمنافسين
// ============================================================
app.post('/api/ai/competitor-analysis', authenticateToken, rateLimit(5, 60000), async (req, res) => {
  const { competitors } = req.body;
  const KEY = OPENROUTER_KEY();
  if (!KEY) return res.status(503).json({ success: false, message: 'AI غير متاح' });

  try {
    let bp = {};
    if (pool) {
      const r = await pool.query('SELECT * FROM business_profile WHERE user_id=$1', [req.user.id]);
      bp = r.rows[0] || {};
    }

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `أنت محلل أعمال. قدم تحليلاً للمنافسة لهذا المتجر.

المتجر: ${bp.store_name} — ${bp.business_type}
المنطقة: العراق
المنافسون المذكورون: ${competitors || 'غير محددين'}

أجب بـ JSON:
{
  "strengths": ["ميزة 1", "ميزة 2", "ميزة 3"],
  "weaknesses": ["نقطة ضعف 1", "نقطة ضعف 2"],
  "opportunities": ["فرصة 1", "فرصة 2", "فرصة 3"],
  "threats": ["تهديد 1", "تهديد 2"],
  "recommendations": ["توصية 1", "توصية 2", "توصية 3"],
  "differentiation_tips": ["تميز بـ 1", "تميز بـ 2"],
  "pricing_position": "أرخص|متوسط|أغلى من المنافسين"
}`
        }]
      })
    });

    const data = await aiRes.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    let analysis;
    try { analysis = JSON.parse(raw.replace(/```json|```/g,'').trim()); }
    catch(e) { analysis = { error: 'فشل التحليل' }; }

    res.json({ success: true, analysis });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// 8. نقاط ضعف العمل
// ============================================================
app.get('/api/ai/business-weaknesses', authenticateToken, rateLimit(5, 60000), async (req, res) => {
  const KEY = OPENROUTER_KEY();
  if (!KEY) return res.status(503).json({ success: false, message: 'AI غير متاح' });

  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    const [bpData, ordersData, productsData, reviewsData] = await Promise.all([
      pool.query('SELECT * FROM business_profile WHERE user_id=$1', [req.user.id]),
      pool.query(`
        SELECT status, COUNT(*) as count, AVG(total) as avg_total
        FROM orders WHERE user_id=$1
        AND created_at > NOW() - INTERVAL '30 days'
        GROUP BY status
      `, [req.user.id]),
      pool.query('SELECT COUNT(*) as total, COUNT(*) FILTER(WHERE stock=0) as out_of_stock FROM products WHERE user_id=$1', [req.user.id]),
      pool.query('SELECT AVG(rating) as avg_rating, COUNT(*) as total FROM service_reviews WHERE user_id=$1', [req.user.id]).catch(() => ({ rows: [{}] }))
    ]);

    const bp = bpData.rows[0] || {};
    const orderStats = ordersData.rows;
    const productStats = productsData.rows[0] || {};
    const reviewStats = reviewsData.rows[0] || {};

    const cancelled = orderStats.find(s => s.status === 'cancelled')?.count || 0;
    const total = orderStats.reduce((s, r) => s + parseInt(r.count), 0);
    const cancellationRate = total > 0 ? (cancelled / total * 100).toFixed(1) : 0;

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `حلل هذه البيانات وحدد نقاط ضعف العمل مع حلول عملية.

المتجر: ${bp.store_name} — ${bp.business_type}
إحصائيات الطلبات (30 يوم): ${JSON.stringify(orderStats)}
نسبة الإلغاء: ${cancellationRate}%
المنتجات: ${productStats.total} (نفد منها: ${productStats.out_of_stock})
متوسط التقييم: ${reviewStats.avg_rating ? Number(reviewStats.avg_rating).toFixed(1) : 'لا تقييمات'}/5

أجب بـ JSON:
{
  "critical_issues": [{"issue": "مشكلة", "impact": "التأثير", "solution": "الحل", "priority": "high|medium|low"}],
  "quick_wins": ["إجراء سريع 1", "إجراء سريع 2"],
  "score": 0-100,
  "summary": "ملخص الوضع"
}`
        }]
      })
    });

    const data = await aiRes.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    let analysis;
    try { analysis = JSON.parse(raw.replace(/```json|```/g,'').trim()); }
    catch(e) { analysis = { error: 'فشل التحليل' }; }

    res.json({ success: true, analysis, stats: { cancellationRate, productStats, reviewStats } });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// 9. قوالب تصميم ذكية
// ============================================================
app.post('/api/ai/design-template', authenticateToken, rateLimit(20, 60000), async (req, res) => {
  const { post_type, product_name, price, occasion } = req.body;
  const KEY = OPENROUTER_KEY();
  if (!KEY) return res.status(503).json({ success: false, message: 'AI غير متاح' });

  try {
    let bp = {};
    if (pool) {
      const r = await pool.query('SELECT store_name, business_type, communication_style FROM business_profile WHERE user_id=$1', [req.user.id]);
      bp = r.rows[0] || {};
    }

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `أنت مصمم محتوى خبير. اقترح قالب تصميم ونص لبوست.

المتجر: ${bp.store_name} — ${bp.business_type}
أسلوب التواصل: ${bp.communication_style || 'ودي'}
نوع البوست: ${post_type || 'منتج جديد'}
${product_name ? `المنتج: ${product_name}` : ''}
${price ? `السعر: ${price}` : ''}
${occasion ? `المناسبة: ${occasion}` : ''}

أجب بـ JSON:
{
  "caption": "نص البوست الكامل مع إيموجي",
  "hashtags": ["#هاشتاغ1", "#هاشتاغ2"],
  "design_prompt": "وصف للصورة المقترحة بالإنجليزي لـ DALL-E",
  "colors": ["#لون1", "#لون2"],
  "cta": "نص الدعوة للتصرف",
  "best_time": "أفضل وقت للنشر",
  "template_type": "اسم القالب"
}`
        }]
      })
    });

    const data = await aiRes.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    let template;
    try { template = JSON.parse(raw.replace(/```json|```/g,'').trim()); }
    catch(e) { template = { caption: raw.substring(0,300), hashtags: [] }; }

    res.json({ success: true, template });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

};
