module.exports = function(app, pool, helpers) {
const { escapeHtml, sanitize, authenticateToken, rateLimit, notify, auditLog, esc } = helpers;

// ============================================================
// STORE IDENTITY — هوية المتجر
// ============================================================

app.get('/api/identity', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.json({ success: true, identity: {} });
    const r = await pool.query('SELECT * FROM store_identity WHERE user_id=$1', [req.user.id]);
    res.json({ success: true, identity: r.rows[0] || {} });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.put('/api/identity', authenticateToken, async (req, res) => {
  const {
    logo_url, cover_url, primary_color, secondary_color, accent_color,
    font_name, communication_style, watermark_enabled, watermark_position,
    watermark_opacity, social_template, payment_cards
  } = req.body;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const cardsJson = Array.isArray(payment_cards) ? JSON.stringify(payment_cards) : '[]';
    await pool.query(`
      INSERT INTO store_identity
        (user_id, logo_url, cover_url, primary_color, secondary_color, accent_color,
         font_name, communication_style, watermark_enabled, watermark_position, watermark_opacity, social_template, payment_cards, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        logo_url=COALESCE(NULLIF($2,''), store_identity.logo_url),
        cover_url=COALESCE(NULLIF($3,''), store_identity.cover_url),
        primary_color=COALESCE(NULLIF($4,''), store_identity.primary_color),
        secondary_color=COALESCE(NULLIF($5,''), store_identity.secondary_color),
        accent_color=COALESCE(NULLIF($6,''), store_identity.accent_color),
        font_name=COALESCE(NULLIF($7,''), store_identity.font_name),
        communication_style=COALESCE(NULLIF($8,''), store_identity.communication_style),
        watermark_enabled=COALESCE($9, store_identity.watermark_enabled),
        watermark_position=COALESCE(NULLIF($10,''), store_identity.watermark_position),
        watermark_opacity=COALESCE($11, store_identity.watermark_opacity),
        social_template=COALESCE(NULLIF($12,'{}'), store_identity.social_template),
        payment_cards=$13,
        updated_at=NOW()
    `, [req.user.id, logo_url||'', cover_url||'', primary_color||'', secondary_color||'',
        accent_color||'', font_name||'', communication_style||'',
        watermark_enabled, watermark_position||'', watermark_opacity||null,
        social_template ? JSON.stringify(social_template) : '{}', cardsJson]);
    await auditLog(req.user.id, 'update_identity', 'store_identity', null, '', req.ip);
    const r = await pool.query('SELECT * FROM store_identity WHERE user_id=$1', [req.user.id]);
    res.json({ success: true, identity: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// IMAGE DESIGNER — مصمم الصور الذكي
// ============================================================

// جلب مشاريع الصور
app.get('/api/images/projects', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.json({ success: true, projects: [] });
    const r = await pool.query(
      'SELECT * FROM image_projects WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    res.json({ success: true, projects: r.rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// حفظ مشروع صورة
app.post('/api/images/projects', authenticateToken, async (req, res) => {
  const { title, type, original_url, result_url, prompt, status, provider, metadata } = req.body;
  if (!original_url) return res.status(400).json({ success: false, message: 'original_url مطلوب' });
  // التحقق من الروابط
  try { new URL(original_url); } catch { return res.status(400).json({ success: false, message: 'رابط غير صالح' }); }
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query(
      `INSERT INTO image_projects (user_id, title, type, original_url, result_url, prompt, status, provider, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user.id, escapeHtml(title||''), type||'product', original_url,
       result_url||'', escapeHtml(prompt||''), status||'done',
       provider||'cloudinary', JSON.stringify(metadata||{})]
    );
    res.json({ success: true, project: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// حذف مشروع صورة
app.delete('/api/images/projects/:id', authenticateToken, async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'ID غير صالح' });
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT user_id FROM image_projects WHERE id=$1', [id]);
    if (!r.rows.length || r.rows[0].user_id !== req.user.id)
      return res.status(403).json({ success: false, message: 'غير مصرح' });
    await pool.query('DELETE FROM image_projects WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// معالجة الصورة بالذكاء الاصطناعي
app.post('/api/images/process', authenticateToken, async (req, res) => {
  const { image_url, action, prompt, style } = req.body;
  if (!image_url || !action)
    return res.status(400).json({ success: false, message: 'image_url و action مطلوبان' });
  try { new URL(image_url); } catch { return res.status(400).json({ success: false, message: 'رابط غير صالح' }); }

  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY)
    return res.status(503).json({ success: false, message: 'OPENROUTER_API_KEY غير مضبوط' });

  const actions = {
    describe: 'صف هذه الصورة بالتفصيل بالعربية: المنتج، الألوان، التصميم، وكيف يمكن تحسينها للإعلانات',
    improve: 'اقترح 5 تحسينات محددة لهذه الصورة لجعلها أكثر جاذبية في التسويق العربي',
    caption: 'اكتب 3 تعليقات إعلانية جذابة بالعربية لهذه الصورة مناسبة لـ Instagram وTikTok',
    hashtags: 'اقترح 20 هاشتاق عربي وإنجليزي مناسبة لهذه الصورة للتسويق على منصات التواصل',
    ad_copy: 'اكتب نص إعلاني كامل بالعربية لهذه الصورة: عنوان جذاب، وصف مقنع، ودعوة للعمل',
    custom: escapeHtml(prompt || 'صف هذه الصورة')
  };

  const userPrompt = actions[action] || actions.describe;

  try {
    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: image_url } },
            { type: 'text', text: userPrompt }
          ]
        }]
      })
    });
    const aiData = await aiRes.json();
    const result = aiData.choices?.[0]?.message?.content || '';
    if (!result) return res.status(500).json({ success: false, message: 'لم يرد الذكاء الاصطناعي' });
    res.json({ success: true, result, action });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// توليد نص إعلاني للمنتج
app.post('/api/images/generate-text', authenticateToken, async (req, res) => {
  const { product_name, product_desc, platform, style, tone } = req.body;
  if (!product_name) return res.status(400).json({ success: false, message: 'اسم المنتج مطلوب' });

  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(503).json({ success: false, message: 'AI غير متاح' });

  const platformGuide = {
    instagram: 'Instagram: نص قصير جذاب مع إيموجي وهاشتاقات',
    tiktok: 'TikTok: نص سريع ومثير للشباب مع هاشتاقات ترند',
    facebook: 'Facebook: نص مفصل ومقنع مع دعوة واضحة للعمل',
    whatsapp: 'واتساب: رسالة ترويجية ودية وشخصية'
  };

  try {
    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `أنت خبير تسويق رقمي عربي. اكتب محتوى إعلاني لـ ${platformGuide[platform]||'منصات التواصل'}.
المنتج: ${escapeHtml(product_name)}
الوصف: ${escapeHtml(product_desc||'')}
الأسلوب: ${escapeHtml(tone||'جذاب ومقنع')}

أرجع JSON فقط بهذا الشكل:
{"title":"عنوان جذاب","body":"النص الرئيسي","cta":"دعوة للعمل","hashtags":["هاشتاق1","هاشتاق2"],"emojis":"إيموجي مناسبة"}`
        }]
      })
    });
    const aiData = await aiRes.json();
    let result = aiData.choices?.[0]?.message?.content || '';
    try {
      result = result.replace(/```json|```/g, '').trim();
      result = JSON.parse(result);
    } catch (e) { result = { title: '', body: result, cta: '', hashtags: [], emojis: '' }; }
    res.json({ success: true, content: result });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// AD MANAGER — مدير الإعلانات (Meta + TikTok Ads API)
// ============================================================

};
