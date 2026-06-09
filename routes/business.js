module.exports = function(app, pool, helpers) {
const { escapeHtml, sanitize, authenticateToken, rateLimit, notify, auditLog, esc } = helpers;

// ============================================================
// BUSINESS PROFILE — فهم طبيعة العمل
// ============================================================
app.get('/api/business/profile', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM business_profile WHERE user_id=$1', [req.user.id]);
      return res.json({ success: true, profile: r.rows[0] || {} });
    }
  } catch (e) {}
  res.json({ success: true, profile: {} });
});

app.put('/api/business/profile', authenticateToken, async (req, res) => {
  const {
    store_name, business_type, business_desc, target_audience,
    pricing_style, communication_style, policies, location,
    currency, whatsapp_number, logo_url, brand_colors, brand_fonts, onboarding_done
  } = req.body;
  const userId = req.user.id;
  try {
    if (pool) {
      // AI Analysis of business description
      let ai_analysis = '';
      const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
      if (OPENROUTER_KEY && business_desc) {
        try {
          const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'anthropic/claude-haiku-4-5',
              max_tokens: 500,
              messages: [{
                role: 'user',
                content: `حلل هذا الوصف التجاري وأرجع JSON فقط بهذا الشكل بدون أي كلام إضافي:
{"activity_type":"نوع النشاط","pricing_style":"طريقة التسعير","reply_style":"أسلوب الرد المناسب","key_features":["ميزة1","ميزة2"],"suggested_policies":["سياسة1","سياسة2"]}

الوصف: "${business_desc}"`
              }]
            })
          });
          const aiData = await aiRes.json();
          ai_analysis = aiData.choices?.[0]?.message?.content || '';
        } catch (e) {}
      }
      await pool.query(`
        INSERT INTO business_profile (user_id, store_name, business_type, business_desc, target_audience, pricing_style, communication_style, policies, location, currency, whatsapp_number, logo_url, brand_colors, brand_fonts, ai_analysis, onboarding_done)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        ON CONFLICT (user_id) DO UPDATE SET
          store_name=$2, business_type=$3, business_desc=$4, target_audience=$5,
          pricing_style=$6, communication_style=$7, policies=$8, location=$9,
          currency=$10, whatsapp_number=$11, logo_url=$12, brand_colors=$13,
          brand_fonts=$14, ai_analysis=CASE WHEN $15='' THEN business_profile.ai_analysis ELSE $15 END,
          onboarding_done=$16, updated_at=NOW()
      `, [userId, store_name||'', business_type||'', business_desc||'', target_audience||'',
          pricing_style||'', communication_style||'ودي وقريب', policies||'', location||'',
          currency||'IQD', whatsapp_number||'', logo_url||'',
          JSON.stringify(brand_colors||[]), JSON.stringify(brand_fonts||[]),
          ai_analysis, onboarding_done||false]);
      await auditLog(userId, 'update_business_profile', 'business_profile', null, '', req.ip);
      const r = await pool.query('SELECT * FROM business_profile WHERE user_id=$1', [userId]);
      return res.json({ success: true, profile: r.rows[0] });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// Business Types list
app.get('/api/business/types', (req, res) => {
  res.json({
    success: true,
    types: [
      { id: 'retail',    name: 'تجارة ومنتجات',  icon: '🛍️', attrs: ['اللون', 'المقاس', 'المادة'] },
      { id: 'restaurant',name: 'مطاعم وكافيه',   icon: '🍽️', attrs: ['الحجم', 'الإضافات', 'الحرارة'] },
      { id: 'real_estate',name: 'عقارات',         icon: '🏠', attrs: ['المساحة', 'الغرف', 'الطابق'] },
      { id: 'services',  name: 'خدمات',           icon: '🔧', attrs: ['المدة', 'النوع', 'المكان'] },
      { id: 'health',    name: 'صحة وجمال',       icon: '💆', attrs: ['النوع', 'المدة', 'الجنس'] },
      { id: 'education', name: 'تعليم',           icon: '📚', attrs: ['المستوى', 'المدة', 'الشهادة'] },
      { id: 'sports',    name: 'رياضة',           icon: '⚽', attrs: ['النوع', 'المقاس', 'اللون'] },
      { id: 'perfume',   name: 'عطور',            icon: '🌹', attrs: ['الحجم', 'التركيز', 'النوع'] },
      { id: 'furniture', name: 'أثاث',            icon: '🛋️', attrs: ['اللون', 'المادة', 'المقاس'] },
      { id: 'fashion',   name: 'أزياء وملابس',   icon: '👗', attrs: ['المقاس', 'اللون', 'الخامة'] },
      { id: 'electronics',name:'إلكترونيات',      icon: '📱', attrs: ['الموديل', 'اللون', 'السعة'] },
      { id: 'other',     name: 'أخرى',            icon: '🏪', attrs: [] }
    ]
  });
});

// ============================================================
// ONBOARDING AUTO-SETUP — الإعداد الذكي التلقائي
// ============================================================
app.post('/api/onboarding/auto-setup', authenticateToken, async (req, res) => {
  const { business_type, business_desc, store_name, employee_name, user_philosophy, user_objection } = req.body;
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.json({ success: false, message: 'AI غير متاح' });

  const typeNames = {
    retail:'تجارة ومنتجات', restaurant:'مطاعم وكافيه', real_estate:'عقارات',
    services:'خدمات', health:'صحة وجمال', education:'تعليم',
    sports:'رياضة', perfume:'عطور', furniture:'أثاث',
    fashion:'أزياء وملابس', electronics:'إلكترونيات', other:'أخرى'
  };
  const typeName = typeNames[business_type] || business_type;

  try {
    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: `أنت مساعد إعداد أنظمة تجارية ذكية. بناءً على معلومات هذا المتجر، أنشئ إعدادات مناسبة.

المتجر: ${escapeHtml(store_name||'')}
نوع النشاط: ${typeName}
وصف العمل: ${escapeHtml(business_desc||'')}
اسم الموظف الرقمي: ${escapeHtml(employee_name||'مساعدي الذكي')}
فلسفة صاحب العمل: ${escapeHtml(user_philosophy||'')}
أسلوبه مع طلبات الخصم: ${escapeHtml(user_objection||'')}

أرجع JSON فقط بهذا الشكل بدون أي نص خارجه:
{
  "employee_name": "اسم مناسب للموظف إذا لم يُحدد",
  "personality": "وصف شخصية الموظف الرقمي المناسبة لهذا النشاط (جملتان)",
  "sales_style": "أسلوب البيع المناسب لهذا النشاط (جملتان)",
  "philosophy": "فلسفة التعامل مع العملاء إذا لم يحددها صاحب العمل (جملتان)",
  "objection_handling": "كيفية التعامل مع اعتراضات العملاء إذا لم تُحدد (جملتان)",
  "boundaries": "ما لا يجب على الموظف فعله (جملة واحدة)",
  "communication_style": "ودي وقريب",
  "policies": "سياسات مناسبة لهذا النشاط (3-4 سياسات مفصولة بفاصلة)"
}`
        }]
      })
    });
    const aiData = await aiRes.json();
    let raw = aiData.choices?.[0]?.message?.content || '{}';
    let settings = {};
    try { settings = JSON.parse(raw.replace(/\`\`\`json|\`\`\`/g,'').trim()); } catch(e) {}
    // إذا أدخل المستخدم بيانات خاصة، لا نتجاوزها
    if (user_philosophy) settings.philosophy = user_philosophy;
    if (user_objection) settings.objection_handling = user_objection;
    if (employee_name) settings.employee_name = employee_name;
    res.json({ success: true, settings });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});


app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ message: 'DB غير متاحة' });
    const r = await pool.query('SELECT id,name,email,avatar_url,plan,plan_expires_at,role FROM users WHERE id=$1', [req.user.id]);
    if (!r.rows.length) return res.status(404).json({ message: 'المستخدم غير موجود' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/profile', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ message: 'DB غير متاحة' });
    const { name, avatar_url } = req.body;
    await pool.query('UPDATE users SET name=$1, avatar_url=$2 WHERE id=$3', [name||'', avatar_url||'', req.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

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

};
