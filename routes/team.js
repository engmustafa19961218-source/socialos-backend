module.exports = function(app, pool, helpers) {
const { sanitize, authenticateToken, rateLimit, notify, esc } = helpers;

const OPENROUTER_KEY = () => process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;

// دالة مساعدة للـ AI
async function askAI(system, user, max_tokens = 600) {
  const key = OPENROUTER_KEY();
  if (!key) throw new Error('AI غير متاح');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'anthropic/claude-haiku-4-5',
      max_tokens,
      messages: [{ role: 'user', content: `${system}\n\n${user}` }]
    })
  });
  const d = await res.json();
  return d.choices?.[0]?.message?.content || '';
}

async function askAIJSON(system, user, max_tokens = 800) {
  const raw = await askAI(system + '\nأجب بـ JSON فقط بدون أي نص إضافي أو backticks.', user, max_tokens);
  try { return JSON.parse(raw.replace(/```json|```/g, '').trim()); }
  catch(e) { return null; }
}

async function getBP(userId) {
  if (!pool) return {};
  const r = await pool.query('SELECT * FROM business_profile WHERE user_id=$1', [userId]);
  return r.rows[0] || {};
}

// ============================================================
// 🎨 قسم التصميم والنشر
// ============================================================

// تصميم مجموعة صور (batch design)
app.post('/api/team/design/batch', authenticateToken, rateLimit(10, 60000), async (req, res) => {
  const { product_name, product_images, background_style, count = 3, custom_instructions } = req.body;
  try {
    const bp = await getBP(req.user.id);
    const storeName = bp.store_name || 'متجرنا';
    const primaryColor = bp.primary_color || '#5b6af0';
    const phone = bp.whatsapp_number || '';
    const font = bp.font_name || 'Tajawal';

    // توليد prompts لـ DALL-E لكل صورة
    const result = await askAIJSON(
      `أنت مصمم جرافيك محترف. قم بإنشاء ${count} prompt مختلفة لـ DALL-E لتصميم صور منتج احترافية.
       المتجر: ${storeName}
       اللون الرئيسي: ${primaryColor}
       الخلفية المطلوبة: ${background_style || 'خلفية بيضاء نظيفة'}
       ${custom_instructions ? `تعليمات خاصة: ${custom_instructions}` : ''}`,
      `المنتج: ${product_name || 'منتج'}\nعدد الصور: ${count}`,
      800
    );

    const prompts = result?.prompts || Array(count).fill(null).map((_, i) => ({
      prompt: `Professional product photo of ${product_name}, ${background_style || 'white background'}, high quality, studio lighting, variation ${i+1}`,
      style: `نمط ${i+1}`,
      watermark_text: `${storeName} | ${phone}`
    }));

    // إنشاء مهمة workflow
    if (pool) {
      await pool.query(
        `INSERT INTO workflow_tasks (user_id, from_dept, to_dept, task_type, title, description, data, status)
         VALUES ($1, 'design_publish', 'design_publish', 'batch_design', $2, $3, $4, 'in_progress')`,
        [req.user.id, `تصميم ${count} صور لـ ${product_name}`, `مجموعة تصاميم لمنتج: ${product_name}`,
         JSON.stringify({ product_name, count, prompts, store_name: storeName })]
      ).catch(() => {});
    }

    // 🎨 تصميم → 📢 ترويج: إشعار بجاهزية التصاميم
    if (pool) {
      await pool.query(
        `INSERT INTO workflow_tasks (user_id, from_dept, to_dept, task_type, title, data, status)
         VALUES ($1,'design_publish','promotion','designs_ready',$2,$3,'pending')`,
        [req.user.id, `تصاميم ${product_name} جاهزة للترويج`,
         JSON.stringify({ product_name, count, prompts })]
      ).catch(() => {});
    }

    res.json({ success: true, prompts, watermark: { store_name: storeName, phone, color: primaryColor, font } });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// كتابة بوست + ربطه بصورة
app.post('/api/team/design/post', authenticateToken, rateLimit(20, 60000), async (req, res) => {
  const { product_name, price, image_url, platform, post_type } = req.body;
  try {
    const bp = await getBP(req.user.id);
    const result = await askAIJSON(
      `أنت كاتب محتوى عربي محترف لمنصات التواصل الاجتماعي.
       المتجر: ${bp.store_name} — ${bp.business_type}
       العملة: ${bp.currency || 'IQD'}
       أسلوب التواصل: ${bp.communication_style || 'ودي'}
       المنصة: ${platform || 'Instagram'}`,
      `نوع البوست: ${post_type || 'منتج'}
       المنتج: ${product_name}
       السعر: ${price || ''}`,
      600
    ) || {};

    res.json({
      success: true,
      post: {
        caption: result.caption || `✨ ${product_name}\n💰 السعر: ${price} ${bp.currency || 'IQD'}\n📱 للطلب: ${bp.whatsapp_number || ''}`,
        hashtags: result.hashtags || [],
        best_time: result.best_time || 'مساءً 7-9',
        cta: result.cta || 'تواصل معنا للطلب',
        image_url: image_url || null,
        platform: platform || 'Instagram'
      }
    });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// 📢 قسم الترويج
// ============================================================

// دراسة حملة ترويجية
app.post('/api/team/promotion/study', authenticateToken, rateLimit(10, 60000), async (req, res) => {
  const { campaign_goal, target_product, duration_days } = req.body;
  try {
    const bp = await getBP(req.user.id);

    const result = await askAIJSON(
      `أنت خبير تسويق رقمي متخصص في السوق العربي والعراقي.
       المتجر: ${bp.store_name} — ${bp.business_type}
       الموقع: ${bp.location || 'العراق'}`,
      `هدف الحملة: ${campaign_goal || 'زيادة المبيعات'}
       المنتج المستهدف: ${target_product || 'جميع المنتجات'}
       مدة الحملة: ${duration_days || 7} أيام
       
       قدم دراسة حملة شاملة بصيغة JSON:
       {
         "target_audience": "وصف الجمهور المستهدف",
         "platforms": ["المنصات المقترحة"],
         "ad_formats": ["أنواع الإعلانات"],
         "daily_schedule": "جدول النشر اليومي",
         "content_pillars": ["محاور المحتوى"],
         "kpis": ["مؤشرات النجاح"],
         "tips": ["نصائح"],
         "budget_note": "ملاحظة: الميزانية تحددها أنت كصاحب عمل",
         "estimated_reach": "التوقع المبدئي للوصول"
       }`,
      1000
    );

    if (pool) {
      await pool.query(
        `INSERT INTO workflow_tasks (user_id, from_dept, to_dept, task_type, title, description, data, requires_owner_approval, status)
         VALUES ($1, 'promotion', 'promotion', 'campaign_study', $2, $3, $4, true, 'pending')`,
        [req.user.id, `دراسة حملة: ${campaign_goal}`, `منتج: ${target_product} — ${duration_days} أيام`,
         JSON.stringify({ campaign_goal, target_product, duration_days, study: result })]
      ).catch(() => {});
      await notify(req.user.id, '📢 دراسة حملة جاهزة', `تحتاج موافقتك على الميزانية`, 'promotion');
    }

    res.json({ success: true, study: result });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// 💬 قسم خدمة العملاء
// ============================================================

// رد تلقائي على رسالة زبون
app.post('/api/team/customer/reply', authenticateToken, rateLimit(50, 60000), async (req, res) => {
  const { message, customer_name, customer_phone, is_voice, history } = req.body;
  if (!message) return res.status(400).json({ success: false, message: 'الرسالة مطلوبة' });
  try {
    const bp = await getBP(req.user.id);

    let products = [], orders = [], knowledge = [];
    if (pool) {
      const [pr, or, kr] = await Promise.all([
        pool.query('SELECT name, price, description, is_available FROM products WHERE user_id=$1 AND is_available=true LIMIT 15', [req.user.id]),
        customer_phone ? pool.query('SELECT * FROM orders WHERE user_id=$1 AND customer_phone=$2 ORDER BY created_at DESC LIMIT 3', [req.user.id, customer_phone]) : Promise.resolve({ rows: [] }),
        pool.query('SELECT title, content FROM knowledge_base WHERE user_id=$1 LIMIT 5', [req.user.id])
      ]);
      products = pr.rows;
      orders = or.rows;
      knowledge = kr.rows;
    }

    const statusMap = { new:'جديد', confirmed:'مؤكد', processing:'جاري', shipped:'شُحن', delivered:'تم', cancelled:'ملغي' };
    const system = `أنت موظف خدمة عملاء رقمي لمتجر "${bp.store_name || 'متجرنا'}".
أسلوبك: ${bp.communication_style || 'ودي وقريب'}
نوع النشاط: ${bp.business_type || ''}
العملة: ${bp.currency || 'IQD'}

المنتجات المتاحة:
${products.map(p => `- ${p.name}: ${Number(p.price).toLocaleString()} ${bp.currency || 'IQD'}`).join('\n') || 'لا منتجات'}

${knowledge.length ? `معلومات المتجر:\n${knowledge.map(k => `${k.title}: ${k.content}`).join('\n')}` : ''}
${orders.length ? `طلبيات الزبون:\n${orders.map(o => `#${o.id} - ${statusMap[o.status]||o.status} - ${Number(o.total||0).toLocaleString()}`).join('\n')}` : ''}

قواعد مهمة:
- رد بالعربية بأسلوب ودي ومختصر (2-3 جمل)
- إذا أراد الطلب: اطلب اسمه وعنوانه وأكد له
- إذا سأل عن سعر: أخبره فوراً
- أجب بـ JSON: {"reply": "نص الرد", "action": "none|confirm_order|transfer_to_orders", "order_data": null}`;

    const msgs = [...(Array.isArray(history) ? history.slice(-4) : []), { role: 'user', content: message }];
    const key = OPENROUTER_KEY();
    if (!key) return res.status(503).json({ success: false, message: 'AI غير متاح' });

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'anthropic/claude-haiku-4-5', max_tokens: 400, messages: [{ role: 'user', content: system }, ...msgs] })
    });
    const data = await aiRes.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    let result;
    try { result = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
    catch(e) { result = { reply: raw.substring(0, 200), action: 'none' }; }

    // حفظ المحادثة
    if (pool && customer_phone) {
      await pool.query(
        'INSERT INTO chatbot_conversations (user_id, customer_phone, customer_name, message, reply, action) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.user.id, sanitize(customer_phone||''), sanitize(customer_name||''), sanitize(message.substring(0,500)), sanitize(result.reply||''), result.action||'none']
      ).catch(() => {});
    }

    // إذا أراد تثبيت طلب — أرسل لقسم الطلبات
    if (result.action === 'transfer_to_orders' || result.action === 'confirm_order') {
      if (pool) {
        await pool.query(
          `INSERT INTO workflow_tasks (user_id, from_dept, to_dept, task_type, title, description, data, status)
           VALUES ($1, 'customer_service', 'orders', 'new_order_from_chat', $2, $3, $4, 'pending')`,
          [req.user.id, `طلب جديد من ${sanitize(customer_name||customer_phone||'زبون')}`,
           `تم استلام طلب من خدمة العملاء`,
           JSON.stringify({ customer_name, customer_phone, message, order_data: result.order_data })]
        ).catch(() => {});
        await notify(req.user.id, '📦 طلب جديد!', `من ${customer_name || customer_phone}`, 'order');
      }
    }

    res.json({ success: true, reply: result.reply, action: result.action, order_data: result.order_data });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// رد على تعليق
app.post('/api/team/customer/comment-reply', authenticateToken, rateLimit(30, 60000), async (req, res) => {
  const { comment, post_context } = req.body;
  if (!comment) return res.status(400).json({ success: false, message: 'التعليق مطلوب' });
  try {
    const bp = await getBP(req.user.id);
    const reply = await askAI(
      `أنت موظف خدمة عملاء لمتجر "${bp.store_name}". رد على التعليق بأسلوب ${bp.communication_style || 'ودي'} ومختصر (جملة أو جملتين فقط).`,
      `التعليق: "${comment}"\n${post_context ? `سياق المنشور: ${post_context}` : ''}`
    );
    res.json({ success: true, reply: reply.trim() });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// 📦 قسم الطلبات والفاتورة
// ============================================================

// إنشاء فاتورة من مهمة workflow
app.post('/api/team/orders/create-from-task', authenticateToken, async (req, res) => {
  const { task_id, customer_name, customer_phone, customer_address, items, total, delivery_cost, deposit } = req.body;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    // إنشاء الطلب
    const orderR = await pool.query(
      `INSERT INTO orders (user_id, customer_name, customer_phone, customer_address, items, total, delivery_cost, deposit, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'confirmed') RETURNING *`,
      [req.user.id, sanitize(customer_name||''), sanitize(customer_phone||''), sanitize(customer_address||''),
       JSON.stringify(items||[]), total||0, delivery_cost||0, deposit||0]
    );
    const order = orderR.rows[0];

    // إنشاء الفاتورة
    const countR = await pool.query('SELECT COUNT(*) FROM invoices WHERE user_id=$1', [req.user.id]);
    const invNum = `INV-${new Date().getFullYear()}-${String(parseInt(countR.rows[0].count)+1).padStart(4,'0')}`;
    const remaining = (total||0) - (deposit||0);

    const invR = await pool.query(
      `INSERT INTO invoices (user_id, invoice_number, order_id, customer_name, customer_phone, customer_address, items, total, deposit, delivery_cost, remaining_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.user.id, invNum, order.id, sanitize(customer_name||''), sanitize(customer_phone||''), sanitize(customer_address||''),
       JSON.stringify(items||[]), total||0, deposit||0, delivery_cost||0, remaining]
    );

    // تحديث مهمة workflow
    if (task_id) await pool.query('UPDATE workflow_tasks SET status=$1 WHERE id=$2', ['completed', task_id]).catch(() => {});

    // إشعار بالفاتورة
    const bp = await getBP(req.user.id);
    const phone = String(customer_phone||'').replace(/[^0-9]/g,'');
    const waPhone = phone.startsWith('0') ? '964'+phone.slice(1) : phone;
    const cur = bp.currency || 'IQD';

    let waMsg = `🧾 *فاتورة من ${bp.store_name || 'متجرنا'}*\n\n`;
    waMsg += `👤 ${sanitize(customer_name||'')}\n📍 ${sanitize(customer_address||'')}\n📱 ${customer_phone||''}\n\n`;
    waMsg += `━━━━━━━━━━━━━━\n`;
    waMsg += `💵 الإجمالي: *${Number(total||0).toLocaleString()} ${cur}*\n`;
    if (delivery_cost > 0) waMsg += `🚚 التوصيل: ${Number(delivery_cost).toLocaleString()} ${cur}\n`;
    if (deposit > 0) waMsg += `💳 العربون: *${Number(deposit).toLocaleString()} ${cur}*\n`;
    waMsg += `💰 المتبقي: *${Number(remaining).toLocaleString()} ${cur}*\n`;
    waMsg += `━━━━━━━━━━━━━━\n⚡ ${bp.store_name || 'متجرنا'}`;

    res.json({ success: true, order, invoice: invR.rows[0], wa_url: `https://wa.me/${waPhone}?text=${encodeURIComponent(waMsg)}` });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// 🏪 قسم المنتجات والمخزن
// ============================================================

// إضافة منتج من Mike أو صاحب العمل
app.post('/api/team/inventory/add-product', authenticateToken, async (req, res) => {
  const { name, price, description, stock, category, image_url } = req.body;
  if (!name || !price) return res.status(400).json({ success: false, message: 'الاسم والسعر مطلوبان' });
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query(
      `INSERT INTO products (user_id, name, price, description, stock, category, image_url, is_available)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true) RETURNING *`,
      [req.user.id, sanitize(name), parseFloat(price)||0, sanitize(description||''), parseInt(stock)||0, sanitize(category||''), image_url||null]
    );

    // مهمة workflow
    await pool.query(
      `INSERT INTO workflow_tasks (user_id, from_dept, to_dept, task_type, title, data, status)
       VALUES ($1,'inventory','analytics','product_added',$2,$3,'completed')`,
      [req.user.id, `تم إضافة منتج: ${name}`, JSON.stringify({ product_id: r.rows[0].id, name, price })]
    ).catch(() => {});

    res.json({ success: true, product: r.rows[0] });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// فحص المخزن وإرسال تنبيهات
app.get('/api/team/inventory/check', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.json({ success: true, alerts: [] });
    const r = await pool.query(
      `SELECT id, name, stock FROM products WHERE user_id=$1 AND stock <= 5 AND is_available=true ORDER BY stock ASC`,
      [req.user.id]
    );
    const alerts = r.rows;

    // إرسال تنبيه لـ Mike إذا هناك منتجات ناقصة
    if (alerts.length > 0) {
      await notify(req.user.id, '⚠️ تنبيه مخزون!', `${alerts.length} منتجات تحتاج تجديد`, 'inventory');
      await pool.query(
        `INSERT INTO workflow_tasks (user_id, from_dept, to_dept, task_type, title, description, data, status)
         VALUES ($1,'inventory','mike','low_stock_alert',$2,$3,$4,'pending')`,
        [req.user.id, `تنبيه: ${alerts.length} منتجات مخزونها منخفض`,
         alerts.map(a => `${a.name}: ${a.stock} قطع`).join('\n'),
         JSON.stringify({ products: alerts })]
      ).catch(() => {});
    }

    res.json({ success: true, alerts, count: alerts.length });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// 📊 قسم التحليل والتقارير
// ============================================================

// تقرير شامل
app.post('/api/team/analytics/report', authenticateToken, rateLimit(10, 60000), async (req, res) => {
  const { period = '7' } = req.body;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const bp = await getBP(req.user.id);

    const [ordersR, topProdsR, revsR] = await Promise.all([
      pool.query(`SELECT status, COUNT(*) as count, SUM(total) as revenue FROM orders WHERE user_id=$1 AND created_at > NOW() - INTERVAL '${parseInt(period)} days' GROUP BY status`, [req.user.id]),
      pool.query(`SELECT name, COUNT(*) as orders FROM orders o, jsonb_array_elements(COALESCE(o.items,'[]')::jsonb) item WHERE o.user_id=$1 AND o.created_at > NOW() - INTERVAL '${parseInt(period)} days' GROUP BY name ORDER BY orders DESC LIMIT 5`, [req.user.id]).catch(() => ({ rows: [] })),
      pool.query(`SELECT DATE_TRUNC('day', created_at) as day, SUM(total) as rev FROM orders WHERE user_id=$1 AND created_at > NOW() - INTERVAL '${parseInt(period)} days' GROUP BY day ORDER BY day`, [req.user.id])
    ]);

    const stats = ordersR.rows;
    const totalOrders = stats.reduce((s,r) => s + parseInt(r.count), 0);
    const totalRevenue = stats.reduce((s,r) => s + parseFloat(r.revenue||0), 0);
    const delivered = stats.find(s => s.status === 'delivered')?.count || 0;

    // تحليل AI
    const analysis = await askAIJSON(
      `أنت محلل أعمال. حلل هذه البيانات وقدم تقريراً مع نصائح عملية.
       المتجر: ${bp.store_name} — ${bp.business_type}
       العملة: ${bp.currency || 'IQD'}`,
      `إحصائيات ${period} يوم:
       إجمالي الطلبات: ${totalOrders}
       إجمالي الإيراد: ${totalRevenue.toLocaleString()} ${bp.currency || 'IQD'}
       معدل التسليم: ${totalOrders > 0 ? ((delivered/totalOrders)*100).toFixed(1) : 0}%
       أفضل المنتجات: ${topProdsR.rows.map(p => p.name).join(', ')}
       
       أجب بـ JSON: {
         "summary": "ملخص الأداء",
         "highlights": ["إنجاز 1", "إنجاز 2"],
         "issues": ["مشكلة 1"],
         "recommendations": ["توصية 1", "توصية 2", "توصية 3"],
         "score": 0-100
       }`,
      800
    );

    // 📊 تحليل → 🤖 Mike: إرسال التقرير
    if (pool) {
      await pool.query(
        `INSERT INTO workflow_tasks (user_id, from_dept, to_dept, task_type, title, description, data, status)
         VALUES ($1,'analytics','mike','report_ready',$2,$3,$4,'completed')`,
        [req.user.id, `تقرير ${period} يوم جاهز`,
         analysis?.summary || '',
         JSON.stringify({ period, total_orders: totalOrders, total_revenue: totalRevenue, score: analysis?.score })]
      ).catch(() => {});
    }

    res.json({
      success: true,
      report: {
        period: parseInt(period),
        total_orders: totalOrders,
        total_revenue: totalRevenue,
        delivery_rate: totalOrders > 0 ? ((delivered/totalOrders)*100).toFixed(1) : 0,
        top_products: topProdsR.rows,
        daily_revenue: revsR.rows,
        analysis: analysis || {},
        currency: bp.currency || 'IQD',
        generated_at: new Date().toISOString()
      }
    });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// 🤖 Mike — المدير العام
// ============================================================

// Mike ينفذ أمر
app.post('/api/mike/execute', authenticateToken, rateLimit(30, 60000), async (req, res) => {
  const { command, context } = req.body;
  if (!command) return res.status(400).json({ success: false, message: 'الأمر مطلوب' });
  try {
    const bp = await getBP(req.user.id);

    // Mike يفهم الأمر ويحدد القسم المناسب
    const plan = await askAIJSON(
      `أنت Mike، المدير العام الرقمي لشركة "${bp.store_name}".
       لديك 6 أقسام: تصميم_ونشر، ترويج، خدمة_عملاء، طلبات، منتجات، تحليل.
       صلاحياتك: تنفيذ كل شيء إلا (الميزانية الإعلانية، خصم >20%، حذف منتج، إلغاء طلب، استرداد) — هذه للمالك فقط.`,
      `الأمر: "${command}"
       ${context ? `السياق: ${context}` : ''}
       
       أجب بـ JSON:
       {
         "understood": "ماذا فهمت",
         "department": "اسم القسم",
         "action": "اسم الإجراء",
         "requires_owner": true/false,
         "reason": "السبب إن احتاج موافقة",
         "reply": "رد مباشر لصاحب العمل",
         "params": {}
       }`,
      600
    );

    if (!plan) throw new Error('فشل Mike في فهم الأمر');

    // إذا يحتاج موافقة المالك
    if (plan.requires_owner) {
      if (pool) {
        await pool.query(
          `INSERT INTO workflow_tasks (user_id, from_dept, to_dept, task_type, title, description, data, requires_owner_approval, status)
           VALUES ($1,'mike','owner','owner_approval_needed',$2,$3,$4,true,'pending')`,
          [req.user.id, `Mike: ${plan.understood}`, plan.reason || '', JSON.stringify({ command, plan })]
        ).catch(() => {});
        await notify(req.user.id, '⚠️ Mike يحتاج موافقتك', plan.reason || plan.understood, 'mike');
      }
      return res.json({ success: true, reply: plan.reply, requires_owner: true, reason: plan.reason });
    }

    // تنفيذ تلقائي حسب القسم
    if (pool) {
      await pool.query(
        `INSERT INTO workflow_tasks (user_id, from_dept, to_dept, task_type, title, data, status)
         VALUES ($1,'mike',$2,$3,$4,$5,'completed')`,
        [req.user.id, plan.department || 'mike', plan.action || 'execute',
         `Mike: ${plan.understood}`, JSON.stringify({ command, plan })]
      ).catch(() => {});
    }

    res.json({ success: true, reply: plan.reply, department: plan.department, action: plan.action, requires_owner: false, params: plan.params });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// Mike يعطي تقرير يومي
app.get('/api/mike/daily-brief', authenticateToken, rateLimit(5, 60000), async (req, res) => {
  try {
    const bp = await getBP(req.user.id);
    let stats = { orders: 0, revenue: 0, pending: 0, low_stock: 0 };

    if (pool) {
      const [o, p] = await Promise.all([
        pool.query(`SELECT COUNT(*) as cnt, SUM(total) as rev FROM orders WHERE user_id=$1 AND DATE(created_at)=CURRENT_DATE`, [req.user.id]),
        pool.query(`SELECT COUNT(*) as cnt FROM orders WHERE user_id=$1 AND status='new'`, [req.user.id])
      ]);
      stats.orders = parseInt(o.rows[0]?.cnt || 0);
      stats.revenue = parseFloat(o.rows[0]?.rev || 0);
      stats.pending = parseInt(p.rows[0]?.cnt || 0);
    }

    const brief = await askAI(
      `أنت Mike، مدير عام ذكي. قدم تقرير صباحي مختصر وودي لصاحب العمل باللغة العربية (3-4 جمل فقط).
       المتجر: ${bp.store_name}`,
      `اليوم:
       طلبات: ${stats.orders}
       إيراد: ${stats.revenue.toLocaleString()} ${bp.currency||'IQD'}
       طلبات معلقة: ${stats.pending}`
    );

    res.json({ success: true, brief: brief.trim(), stats });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});


// ============================================================
// 📱 النشر على المنصات — قسم التصميم والنشر
// ============================================================

// نشر بوست على منصة
app.post('/api/team/publish/post', authenticateToken, rateLimit(20, 60000), async (req, res) => {
  const { platform, content, media_url, scheduled_at, post_type } = req.body;
  if (!platform || !content) return res.status(400).json({ success: false, message: 'المنصة والمحتوى مطلوبان' });
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    // إنشاء البوست
    const r = await pool.query(
      `INSERT INTO posts (user_id, platform, content, media_url, media_type, scheduled_at, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.id, platform, sanitize(content.substring(0,2200)), media_url||null,
       media_url ? 'image' : 'text', scheduled_at||null, scheduled_at ? 'scheduled' : 'pending']
    );

    // مهمة workflow من التصميم والنشر
    await pool.query(
      `INSERT INTO workflow_tasks (user_id, from_dept, to_dept, task_type, title, data, status)
       VALUES ($1,'design_publish','analytics','post_published',$2,$3,'completed')`,
      [req.user.id, `${scheduled_at ? 'جُدول' : 'نُشر'} بوست على ${platform}`,
       JSON.stringify({ platform, post_type: post_type||'post', post_id: r.rows[0].id, scheduled_at })]
    ).catch(() => {});

    // نشر فوري إذا لم يكن مجدولاً
    if (!scheduled_at) {
      const acc = await pool.query(
        'SELECT access_token, page_id FROM social_accounts WHERE user_id=$1 AND platform=$2 AND is_connected=true',
        [req.user.id, platform]
      );

      if (acc.rows.length && acc.rows[0].access_token) {
        const { access_token, page_id } = acc.rows[0];
        try {
          if (platform === 'facebook' && page_id) {
            const fbRes = await fetch(`https://graph.facebook.com/v19.0/${page_id}/feed`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: content.substring(0,2200), access_token })
            });
            const fbData = await fbRes.json();
            if (fbData.id) {
              await pool.query('UPDATE posts SET status=$1, external_id=$2 WHERE id=$3', ['published', fbData.id, r.rows[0].id]);
            }
          } else if (platform === 'instagram' && page_id && media_url) {
            const containerRes = await fetch(`https://graph.facebook.com/v19.0/${page_id}/media`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ image_url: media_url, caption: content.substring(0,2200), access_token })
            });
            const container = await containerRes.json();
            if (container.id) {
              const publishRes = await fetch(`https://graph.facebook.com/v19.0/${page_id}/media_publish`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ creation_id: container.id, access_token })
              });
              const pub = await publishRes.json();
              if (pub.id) await pool.query('UPDATE posts SET status=$1, external_id=$2 WHERE id=$3', ['published', pub.id, r.rows[0].id]);
            }
          }
        } catch(e) { /* نكمل حتى لو فشل النشر */ }
      }
    }

    const bp = await getBP(req.user.id);
    await notify(req.user.id,
      scheduled_at ? `📅 جُدول بوست على ${platform}` : `✅ نُشر بوست على ${platform}`,
      content.substring(0,50) + '...', 'post'
    );

    res.json({ success: true, post: r.rows[0] });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// جلب آخر البوستات
app.get('/api/team/publish/posts', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.json({ success: true, posts: [] });
    const r = await pool.query(
      'SELECT * FROM posts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20',
      [req.user.id]
    );
    res.json({ success: true, posts: r.rows });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// توليد محتوى بوست بالذكاء الاصطناعي
app.post('/api/team/publish/generate', authenticateToken, rateLimit(20, 60000), async (req, res) => {
  const { post_type, product_name, price, platform, offer_details } = req.body;
  try {
    const bp = await getBP(req.user.id);
    const result = await askAIJSON(
      `أنت كاتب محتوى عربي محترف لـ ${bp.store_name} (${bp.business_type}).
       أسلوب التواصل: ${bp.communication_style || 'ودي'}
       العملة: ${bp.currency || 'IQD'}
       المنصة: ${platform || 'Instagram'}`,
      `نوع البوست: ${post_type || 'منتج'}
       ${product_name ? `المنتج: ${product_name}` : ''}
       ${price ? `السعر: ${price}` : ''}
       ${offer_details ? `تفاصيل العرض: ${offer_details}` : ''}
       
       أنشئ محتوى جذاب يناسب ${platform || 'Instagram'} بصيغة JSON:
       {
         "caption": "نص البوست الكامل مع إيموجي",
         "hashtags": ["#هاشتاغ1","#هاشتاغ2","#هاشتاغ3"],
         "story_text": "نص قصير للستوري",
         "cta": "نص الدعوة للتصرف",
         "best_time": "أفضل وقت للنشر"
       }`,
      600
    );

    res.json({ success: true, content: result || {} });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

};
