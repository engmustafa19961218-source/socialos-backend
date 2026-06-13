module.exports = function(app, pool, helpers) {
// ============================================================
// نظام الذاكرة الدائمة لـ Mike
// ============================================================

// جلب كل ذاكرة Mike
async function getMikeMemory(userId) {
  if (!pool) return '';
  try {
    const r = await pool.query(
      'SELECT content, memory_type, importance FROM mike_memory WHERE user_id=$1 ORDER BY importance DESC, created_at DESC LIMIT 50',
      [userId]
    );
    if (!r.rows.length) return '';
    const grouped = {};
    r.rows.forEach(m => {
      if (!grouped[m.memory_type]) grouped[m.memory_type] = [];
      grouped[m.memory_type].push(m.content);
    });
    let memText = '\n\n=== ذاكرتي الدائمة ===\n';
    const typeNames = {
      customer: '👥 معلومات الزبائن',
      product: '📦 معلومات المنتجات',
      decision: '⚡ قرارات مهمة',
      policy: '📋 سياسات العمل',
      preference: '⭐ تفضيلات المتجر',
      result: '📊 نتائج وإحصائيات',
      general: '💡 معلومات عامة'
    };
    Object.entries(grouped).forEach(([type, items]) => {
      memText += `\n${typeNames[type] || type}:\n`;
      items.forEach(item => { memText += `- ${item}\n`; });
    });
    return memText;
  } catch(e) { return ''; }
}

// حفظ ذاكرة جديدة
async function saveMikeMemory(userId, content, type = 'general', importance = 1) {
  if (!pool || !content) return;
  try {
    await pool.query(
      'INSERT INTO mike_memory (user_id, content, memory_type, importance) VALUES ($1,$2,$3,$4)',
      [userId, content.substring(0, 500), type, importance]
    );
  } catch(e) {}
}

// استخراج معلومات مهمة من المحادثة تلقائياً
async function extractAndSaveMemory(userId, userMessage, mikeReply, aiKey) {
  if (!aiKey) return;
  try {
    const extractRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${aiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `تحليل هذه المحادثة واستخرج المعلومات المهمة التي يجب على Mike تذكرها.
رسالة المستخدم: "${userMessage}"
رد Mike: "${mikeReply}"

أجب بـ JSON فقط:
{
  "should_save": true/false,
  "memories": [
    {"content": "معلومة مهمة", "type": "customer|product|decision|policy|preference|result|general", "importance": 1-3}
  ]
}
إذا لم تكن هناك معلومات مهمة: {"should_save": false, "memories": []}`
        }]
      })
    });
    const data = await extractRes.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    let parsed;
    try { parsed = JSON.parse(raw.replace(/\`\`\`json|\`\`\`/g, '').trim()); } catch(e) { return; }
    if (parsed.should_save && parsed.memories?.length) {
      for (const mem of parsed.memories) {
        await saveMikeMemory(userId, mem.content, mem.type, mem.importance);
      }
    }
  } catch(e) {}
}


const { escapeHtml, sanitize, authenticateToken, rateLimit, notify, auditLog, esc } = helpers;

// ============================================================
// MIKE — المساعد التنفيذي الذكي
// ============================================================

app.post('/api/mike', authenticateToken, async (req, res) => {
  const { message, history, image } = req.body;
  if (!message || String(message).length > 2000)
    return res.status(400).json({ success: false, message: 'الرسالة غير صالحة' });

  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(503).json({ success: false, message: 'AI غير متاح' });

  const userId = req.user.id;

  try {
    // جلب بيانات السياق
    let context = {};
    if (pool) {
      const [biz, stats, prods, custs, orders, gallery] = await Promise.all([
        pool.query('SELECT store_name, business_type, currency, whatsapp_number FROM business_profile WHERE user_id=$1', [userId]),
        pool.query('SELECT COUNT(*) as orders FROM orders WHERE user_id=$1', [userId]),
        pool.query('SELECT id, name, price, stock, category FROM products WHERE user_id=$1 AND is_available=true LIMIT 20', [userId]),
        pool.query('SELECT id, name, phone FROM customers WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10', [userId]),
        pool.query('SELECT id, customer_name, total, status FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5', [userId]),
        pool.query('SELECT label, ai_analysis, category FROM mike_gallery WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10', [userId]).catch(()=>({rows:[]}))
      ]);
      context = {
        store: biz.rows[0] || {},
        total_orders: stats.rows[0]?.orders || 0,
        products: prods.rows,
        recent_customers: custs.rows,
        recent_orders: orders.rows,
        gallery: gallery.rows
      };
    }

    const bizType = context.store?.business_type || '';
    const bizTypeContext = {
      restaurant: '⚠️ هذا متجر مطاعم/كافيه — ركز على: الطلبات والتوصيل، أوقات العمل، قائمة الطعام، الحجوزات، العروض اليومية.',
      retail: '⚠️ هذا متجر تجزئة — ركز على: المخزون، العروض، الشحن، استفسارات المنتجات.',
      fashion: '⚠️ هذا متجر أزياء — ركز على: الأصناف والمقاسات، العروض الموسمية، صور المنتجات.',
      electronics: '⚠️ هذا متجر إلكترونيات — ركز على: المواصفات التقنية، الضمان، التوافقية.',
      perfume: '⚠️ هذا متجر عطور — ركز على: وصف الرائحة، المناسبات، العروض المجمعة.',
      health: '⚠️ هذا مركز صحة وجمال — ركز على: المواعيد، الخدمات، الحزم.',
      education: '⚠️ هذا مركز تعليمي — ركز على: الدورات، المواعيد، التسجيل.',
      real_estate: '⚠️ هذا مكتب عقارات — ركز على: العقارات، المعاينات، الأسعار.',
      furniture: '⚠️ هذا متجر أثاث — ركز على: المقاسات، التوصيل والتركيب، التخصيص.',
      sports: '⚠️ هذا متجر رياضة — ركز على: المعدات، المقاسات، العروض.',
    }[bizType] || '';

    // جلب ذاكرة Mike
    const mikeMemory = await getMikeMemory(req.user.id);

    const systemPrompt = `تعليمات صارمة وإلزامية — يجب الالتزام بها تماماً:

أنت Mike، المدير التنفيذي الرقمي لمتجر "${escapeHtml(context.store?.store_name || 'المتجر')}".
أنت متصل مباشرة بقاعدة بيانات المتجر وتنفذ الأوامر فعلياً.
يحظر عليك تماماً قول "لا أستطيع" أو "مساعد ذكي فقط" أو "غير متصل".
يجب عليك دائماً الرد بـ JSON فقط — لا نص عادي إطلاقاً.

عند أي أمر مثل "أضف منتج" أو "سجل طلب" أو "أضف عميل":
- نفذ الأمر فوراً عبر action المناسب
- لا تعتذر ولا تشرح ولا تطلب تأكيداً (إلا للحذف)

أنت مرتبط بجميع أنظمة المتجر وتستطيع تنفيذ الأوامر مباشرة.
${mikeMemory}
${bizTypeContext}

قاعدة إلزامية: جميع ردودك واقتراحاتك وأمثلتك يجب أن تكون مرتبطة بنوع عمل المتجر فقط. لا تقترح أمثلة أو منتجات من قطاعات أخرى.

معلومات المتجر:
- الاسم: ${escapeHtml(context.store?.store_name || '')}
- النوع: ${escapeHtml(bizType)}
- العملة: ${context.store?.currency || 'IQD'}
- واتساب: ${context.store?.whatsapp_number || ''}
- إجمالي الطلبات: ${context.total_orders}

المنتجات المتاحة: ${JSON.stringify(context.products || [])}
آخر العملاء: ${JSON.stringify(context.recent_customers || [])}
آخر الطلبات: ${JSON.stringify(context.recent_orders || [])}

صلاحياتك:
- إنشاء طلبات، منتجات، عملاء
- نشر منشورات على المنصات
- إرسال رسائل واتساب
- جلب التقارير والإحصائيات
- إنشاء كوبونات
- أي عملية في النظام

عند تلقي أمر، قم بـ:
1. فهم الأمر بالكامل
2. تحديد الإجراء المطلوب
3. الرد بـ JSON بهذا الشكل:

{
  "reply": "ردك الطبيعي بالعربية للمستخدم",
  "action": "اسم الإجراء أو null إذا لا يوجد",
  "action_data": { بيانات الإجراء },
  "needs_confirm": false
}

الإجراءات المتاحة:
- create_order: إنشاء طلب { customer_name, customer_phone, items, total }
- create_product: إضافة منتج { name, price, stock, category, description }
- create_customer: إضافة عميل { name, phone, address }
- create_post: نشر منشور { platform, content, media_url }
- send_whatsapp: إرسال واتساب { phone, message }
- create_coupon: إنشاء كوبون { code, type, value }
- get_report: جلب تقرير { type: 'sales'|'orders'|'customers' }
- update_order_status: تحديث حالة طلب { order_id, status }
- none: فقط الرد بدون إجراء

الإجراءات المتاحة (action):

// ─── التنقل في التطبيق ───
- navigate_to: الانتقال لصفحة { page: 'orders'|'products'|'customers'|'analytics'|'designer'|'posts'|'ads'|'identity'|'knowledge'|'decisions'|'board'|'coupons'|'loyalty'|'bulk-wa'|'team'|'emergency'|'backup'|'security'|'settings'|'delivery'|'inventory'|'notifications'|'profile'|'employee'|'training'|'digital-team'|'analytics-adv'|'retargeting'|'social'|'home' }

// ─── الطلبات ───
- create_order: إنشاء طلب { customer_name, customer_phone, items:[{name,price,qty}], total, notes }
- update_order_status: تحديث حالة طلب { order_id, status: 'confirmed'|'processing'|'delivered'|'cancelled' }

// ─── المنتجات ───
- create_product: إضافة منتج { name, price, stock, category, description }

// ─── العملاء ───
- create_customer: إضافة عميل { name, phone, address, notes }
- schedule_followup: جدولة متابعة عميل { customer_phone, note, days_from_now }

// ─── النشر على المنصات ───
- create_post: نشر منشور { platform: 'instagram'|'facebook'|'tiktok', content, media_url }

// ─── واتساب ───
- send_whatsapp: إرسال واتساب { phone, message }
- send_bulk_whatsapp: إرسال جماعي { message, target: 'all'|'vip' }

// ─── الكوبونات والعروض ───
- create_coupon: إنشاء كوبون { code, type: 'percent'|'fixed', value, min_order }

// ─── التقارير ───
- get_report: تقرير { type: 'sales'|'orders'|'customers'|'products' }

// ─── الإعلانات ───
- suggest_ad: اقتراح حملة إعلانية { platform: 'facebook'|'instagram'|'tiktok'|'google', goal, budget, product_desc }

// ─── الطوارئ ───
- set_emergency: تفعيل/إيقاف وضع الطوارئ { active: true|false, mode_type, message }

// ─── لا إجراء ───
- none: الرد فقط بدون تنفيذ

قواعد مهمة:
- إذا طلب المستخدم فتح صفحة أو الانتقال لقسم → navigate_to
- إذا طلب نشر بوست أو ترويج → create_post
- إذا طلب إعلان أو حملة → suggest_ad أو navigate_to ads
- إذا طلب تصميم صورة → navigate_to designer
- إذا طلب إحصائيات أو تقرير → get_report أو navigate_to analytics
- أرجع JSON صالح فقط بدون أي نص خارجه.`;

    const msgs = [
      { role: 'system', content: systemPrompt },
      ...(Array.isArray(history) ? history.slice(-6).map(m => ({
        role: m.role,
        content: String(m.content).substring(0, 500)
      })) : []),
      { role: 'user', content: image ? [
        { type: 'image_url', image_url: { url: image } },
        { type: 'text', text: String(message || 'ماذا ترى في هذه الصورة؟ نفذ الأمر المناسب').substring(0, 2000) }
      ] : String(message).substring(0, 2000) }
    ];

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4-5',
        max_tokens: 1200,
        messages: msgs
      })
    });
    const aiData = await aiRes.json();
    let raw = aiData.choices?.[0]?.message?.content || '{}';

    // تأكد أن الرد JSON
    let parsed = {};
    try {
      // إزالة أي نص قبل { وبعد }
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        parsed = { reply: raw, action: null };
      }
    } catch (e) {
      parsed = { reply: raw, action: null };
    }

    const reply = String(parsed.reply || 'تم').substring(0, 2000);
    const action = parsed.action || null;
    const actionData = parsed.action_data || {};
    let actionResult = null;
    let actionError = null;

    // تنفيذ الإجراء
    if (action && action !== 'none' && pool) {
      try {
        if (action === 'create_order') {
          const r = await pool.query(
            'INSERT INTO orders (user_id,customer_name,customer_phone,items,total,status,platform) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
            [userId, escapeHtml(actionData.customer_name||''), actionData.customer_phone||'',
             JSON.stringify(actionData.items||[]), parseFloat(actionData.total)||0, 'new', 'mike']
          );
          actionResult = { type: 'order', id: r.rows[0].id, message: `تم إنشاء الطلب #${r.rows[0].id}` };
          await notify(userId, '🛒 طلب جديد من Mike', `${actionData.customer_name} — ${actionData.total}`, 'order');
        }

        else if (action === 'create_product') {
          const rawPrice = String(actionData.price || '').replace(/[^\d.]/g, '');
          const price = parseFloat(rawPrice);
          if (!price || price <= 0) throw new Error('السعر غير صالح — قل مثلاً: سعره 25000');
          const r = await pool.query(
            'INSERT INTO products (user_id,name,description,price,stock,category,is_available) VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING id',
            [userId, escapeHtml(actionData.name||'منتج جديد'), escapeHtml(actionData.description||''),
             price, parseInt(actionData.stock)||0, escapeHtml(actionData.category||'عام')]
          );
          actionResult = { type: 'product', id: r.rows[0].id, message: `تم إضافة المنتج #${r.rows[0].id}` };
        }

        else if (action === 'create_customer') {
          const r = await pool.query(
            'INSERT INTO customers (user_id,name,phone,address) VALUES ($1,$2,$3,$4) RETURNING id',
            [userId, escapeHtml(actionData.name||''), actionData.phone||'', escapeHtml(actionData.address||'')]
          );
          actionResult = { type: 'customer', id: r.rows[0].id, message: `تم إضافة العميل #${r.rows[0].id}` };
        }

        else if (action === 'create_post') {
          const ALLOWED_PLATFORMS = ['instagram', 'facebook', 'tiktok'];
          const platform = ALLOWED_PLATFORMS.includes(actionData.platform) ? actionData.platform : 'instagram';
          const content = String(actionData.content||'').substring(0, 2200);
          const r = await pool.query(
            'INSERT INTO social_posts (user_id,platform,content,media_url,status) VALUES ($1,$2,$3,$4,$5) RETURNING id',
            [userId, platform, escapeHtml(content), actionData.media_url||'', 'published']
          );
          actionResult = { type: 'post', id: r.rows[0].id, message: `تم نشر المنشور على ${platform}` };
        }

        else if (action === 'send_whatsapp') {
          const phone = String(actionData.phone||'').replace(/[^\d]/g,'');
          if (phone.length >= 7) {
            const acc = await pool.query(
              'SELECT access_token, whatsapp_phone_id FROM social_accounts WHERE user_id=$1 AND platform=$2 AND is_connected=true',
              [userId, 'whatsapp']
            );
            if (acc.rows.length && acc.rows[0].access_token && acc.rows[0].whatsapp_phone_id) {
              const waRes = await fetch(`https://graph.facebook.com/v19.0/${acc.rows[0].whatsapp_phone_id}/messages`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${acc.rows[0].access_token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ messaging_product:'whatsapp', to: phone, type:'text', text:{ body: String(actionData.message||'').substring(0,4096) } })
              });
              const waData = await waRes.json();
              actionResult = { type: 'whatsapp', message: waData.error ? 'تعذر الإرسال: '+waData.error.message : `تم إرسال الرسالة لـ ${phone}` };
            } else {
              actionResult = { type: 'whatsapp', message: 'واتساب غير مربوط — اذهب لصفحة ربط الحسابات' };
            }
          }
        }

        else if (action === 'create_coupon') {
          const r = await pool.query(
            'INSERT INTO coupons (user_id,code,type,value,is_active) VALUES ($1,$2,$3,$4,true) RETURNING id',
            [userId, escapeHtml(String(actionData.code||'MIKE'+Date.now()).toUpperCase()),
             actionData.type||'percent', parseFloat(actionData.value)||10]
          );
          actionResult = { type: 'coupon', id: r.rows[0].id, message: `تم إنشاء الكوبون: ${actionData.code}` };
        }

        else if (action === 'update_order_status') {
          const ALLOWED_STATUS = ['new','confirmed','processing','delivered','cancelled'];
          const status = ALLOWED_STATUS.includes(actionData.status) ? actionData.status : 'confirmed';
          await pool.query(
            'UPDATE orders SET status=$1 WHERE id=$2 AND user_id=$3',
            [status, parseInt(actionData.order_id)||0, userId]
          );
          actionResult = { type: 'order_update', message: `تم تحديث حالة الطلب #${actionData.order_id} إلى ${status}` };
        }

        else if (action === 'get_report') {
          const reportType = actionData.type || 'sales';

          if (reportType === 'customers') {
            const [c, topC] = await Promise.all([
              pool.query('SELECT COUNT(*) as cnt FROM customers WHERE user_id=$1', [userId]),
              pool.query(`SELECT c.name, c.phone, COUNT(o.id) as orders, COALESCE(SUM(o.total),0) as spent
                FROM customers c LEFT JOIN orders o ON o.customer_name=c.name AND o.user_id=$1
                WHERE c.user_id=$2 GROUP BY c.id, c.name, c.phone ORDER BY spent DESC LIMIT 5`, [userId, userId])
            ]);
            actionResult = {
              type: 'report', report_type: 'customers',
              data: { total: c.rows[0].cnt, top: topC.rows },
              message: `إجمالي العملاء: ${c.rows[0].cnt}`
            };
          } else if (reportType === 'products') {
            const p = await pool.query('SELECT name, price, stock, category FROM products WHERE user_id=$1 ORDER BY stock ASC', [userId]);
            actionResult = {
              type: 'report', report_type: 'products',
              data: { products: p.rows },
              message: `إجمالي المنتجات: ${p.rows.length}`
            };
          } else if (reportType === 'orders') {
            const [o, recent] = await Promise.all([
              pool.query('SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) as rev FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL \'30 days\'', [userId]),
              pool.query('SELECT customer_name, total, status FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5', [userId])
            ]);
            actionResult = {
              type: 'report', report_type: 'orders',
              data: { orders_30d: o.rows[0].cnt, revenue_30d: o.rows[0].rev, recent: recent.rows },
              message: `الطلبات (30 يوم): ${o.rows[0].cnt} — الإيراد: ${Number(o.rows[0].rev).toLocaleString()}`
            };
          } else {
            const [o, r, c] = await Promise.all([
              pool.query('SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) as rev FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL \'30 days\'', [userId]),
              pool.query('SELECT COUNT(*) as cnt FROM products WHERE user_id=$1', [userId]),
              pool.query('SELECT COUNT(*) as cnt FROM customers WHERE user_id=$1', [userId])
            ]);
            actionResult = {
              type: 'report', report_type: 'sales',
              data: { orders_30d: o.rows[0].cnt, revenue_30d: o.rows[0].rev, products: r.rows[0].cnt, customers: c.rows[0].cnt },
              message: `الطلبات (30 يوم): ${o.rows[0].cnt} — الإيراد: ${Number(o.rows[0].rev).toLocaleString()}`
            };
          }
        }

      } catch (e) {
        actionError = e.message;
      }
    }

    // حفظ الذاكرة تلقائياً في الخلفية
    extractAndSaveMemory(req.user.id, message, reply, OPENROUTER_KEY).catch(() => {});

    // حفظ صريح عند "احفظ" أو "تذكر"
    const memTriggers = ['احفظ', 'تذكر', 'لا تنسى', 'خذ بالحسبان', 'ضع في اعتبارك'];
    if (memTriggers.some(t => message.includes(t))) {
      const memContent = message.replace(/احفظ|تذكر|لا تنسى|خذ بالحسبان|ضع في اعتبارك/g, '').trim();
      if (memContent.length > 3) {
        await saveMikeMemory(req.user.id, memContent, 'general', 3);
      }
    }

    res.json({
      success: true,
      reply,
      action,
      action_result: actionResult,
      action_error: actionError
    });

  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// MIKE GALLERY — معرض صور مايك
// ============================================================

// جلب الصور
app.get('/api/mike/gallery', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query(
      `SELECT id, image_url,
        CASE WHEN image_url='' OR image_url IS NULL THEN
          CONCAT('data:image/jpeg;base64,', image_base64)
        ELSE image_url END as display_url,
        label, description, ai_analysis, category, created_at
        FROM mike_gallery WHERE user_id=$1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, images: r.rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// رفع صورة جديدة
app.post('/api/mike/gallery', authenticateToken, async (req, res) => {
  const { image_base64, label, category } = req.body;
  if (!image_base64) return res.status(400).json({ success: false, message: 'الصورة مطلوبة' });
  const userId = req.user.id;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    let image_url = '';
    let ai_analysis = '';
    const base64Clean = image_base64.startsWith('data:') ? image_base64.split(',')[1] : image_base64;
    const dataUrl = image_base64.startsWith('data:') ? image_base64 : `data:image/jpeg;base64,${image_base64}`;

    // رفع على Cloudinary (إلزامي للحفظ الدائم)
    const CLOUD = process.env.CLOUDINARY_CLOUD_NAME;
    const KEY = process.env.CLOUDINARY_API_KEY;
    const SECRET = process.env.CLOUDINARY_API_SECRET;
    if (CLOUD && KEY && SECRET) {
      try {
        const crypto = require('crypto');
        const timestamp = Math.floor(Date.now() / 1000);
        const folder = `socialos/${userId}/mike-gallery`;
        const sigStr = `folder=${folder}&timestamp=${timestamp}${SECRET}`;
        const signature = crypto.createHash('sha1').update(sigStr).digest('hex');
        const boundary = '----CloudBoundary' + Date.now();
        const cloudBody = [
          `--${boundary}`, `Content-Disposition: form-data; name="file"`, '', dataUrl,
          `--${boundary}`, `Content-Disposition: form-data; name="api_key"`, '', KEY,
          `--${boundary}`, `Content-Disposition: form-data; name="timestamp"`, '', String(timestamp),
          `--${boundary}`, `Content-Disposition: form-data; name="signature"`, '', signature,
          `--${boundary}`, `Content-Disposition: form-data; name="folder"`, '', folder,
          `--${boundary}--`
        ].join('\r\n');
        const cloudRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, {
          method: 'POST',
          headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
          body: cloudBody
        });
        const cloudData = await cloudRes.json();
        if (cloudData.secure_url) image_url = cloudData.secure_url;
      } catch (e) { console.error('Cloudinary error:', e.message); }
    }

    // تحليل الصورة بالذكاء الاصطناعي
    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    if (OPENAI_KEY) {
      try {
        const base64Data = base64Clean;
        const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o',
            max_tokens: 300,
            messages: [{
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Data}`, detail: 'low' } },
                { type: 'text', text: 'حلل هذه الصورة باختصار باللغة العربية: ما المنتج؟ ما لونه؟ ما مميزاته؟ هل يمكن استخدامه كصورة للمتجر؟ أجب في 2-3 جمل.' }
              ]
            }]
          })
        });
        const aiData = await aiRes.json();
        ai_analysis = aiData.choices?.[0]?.message?.content || '';
      } catch (e) {}
    }

    const r = await pool.query(
      `INSERT INTO mike_gallery (user_id, image_url, image_base64, label, ai_analysis, category)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, image_url, label, ai_analysis, category, created_at`,
      [userId, image_url, image_url ? '' : base64Clean,
       sanitize(label || ''), ai_analysis, sanitize(category || 'general')]
    );

    res.json({ success: true, image: r.rows[0], ai_analysis });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// تحديث label الصورة
app.put('/api/mike/gallery/:id', authenticateToken, async (req, res) => {
  const { label, category } = req.body;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT user_id FROM mike_gallery WHERE id=$1', [req.params.id]);
    if (!r.rows.length || r.rows[0].user_id !== req.user.id)
      return res.status(403).json({ success: false, message: 'غير مصرح' });
    await pool.query('UPDATE mike_gallery SET label=$1, category=$2 WHERE id=$3',
      [sanitize(label || ''), sanitize(category || 'general'), req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// حذف صورة
app.delete('/api/mike/gallery/:id', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT user_id FROM mike_gallery WHERE id=$1', [req.params.id]);
    if (!r.rows.length || r.rows[0].user_id !== req.user.id)
      return res.status(403).json({ success: false, message: 'غير مصرح' });
    await pool.query('DELETE FROM mike_gallery WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});



// ============================================================
// API الذاكرة الدائمة
// ============================================================

// جلب ذاكرة Mike
app.get('/api/mike/memory', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.json({ success: true, memories: [] });
    const r = await pool.query(
      'SELECT * FROM mike_memory WHERE user_id=$1 ORDER BY importance DESC, created_at DESC',
      [req.user.id]
    );
    res.json({ success: true, memories: r.rows });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// إضافة ذاكرة يدوياً
app.post('/api/mike/memory', authenticateToken, async (req, res) => {
  const { content, memory_type, importance } = req.body;
  if (!content) return res.status(400).json({ success: false, message: 'المحتوى مطلوب' });
  try {
    if (!pool) return res.status(503).json({ success: false });
    const r = await pool.query(
      'INSERT INTO mike_memory (user_id, content, memory_type, importance) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.user.id, content.substring(0,500), memory_type||'general', importance||2]
    );
    res.json({ success: true, memory: r.rows[0] });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// حذف ذاكرة
app.delete('/api/mike/memory/:id', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false });
    await pool.query('DELETE FROM mike_memory WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// مسح كل الذاكرة
app.delete('/api/mike/memory', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false });
    await pool.query('DELETE FROM mike_memory WHERE user_id=$1', [req.user.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});
};