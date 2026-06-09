module.exports = function(app, pool, helpers) {
const { escapeHtml, sanitize, authenticateToken, rateLimit, notify, auditLog, esc } = helpers;

// ============================================================
// IMAGE TOOLS — أدوات الصور
// ============================================================

// إزالة الخلفية عبر remove.bg
app.post('/api/images/remove-bg', authenticateToken, async (req, res) => {
  const { image_url, image_base64 } = req.body;
  if (!image_url && !image_base64)
    return res.status(400).json({ success: false, message: 'image_url أو image_base64 مطلوب' });

  const REMOVE_BG_KEY = process.env.REMOVE_BG_API_KEY;
  if (!REMOVE_BG_KEY)
    return res.status(503).json({ success: false, message: 'REMOVE_BG_API_KEY غير مضبوط في المتغيرات' });

  try {
    let formData, contentType;

    if (image_url) {
      try { new URL(image_url); } catch { return res.status(400).json({ success: false, message: 'رابط غير صالح' }); }
    }

    // بناء multipart form
    const boundary = '----FormBoundary' + Date.now();
    const parts = [];

    if (image_url) {
      parts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="image_url"\r\n\r\n${image_url}`
      );
    } else {
      // base64 — نحوله لبيانات ثنائية
      const base64Data = image_base64.replace(/^data:image\/\w+;base64,/, '');
      const imgBuffer = Buffer.from(base64Data, 'base64');
      parts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="image_file"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n`
      );
      formData = Buffer.concat([
        Buffer.from(parts.join('\r\n') + '\r\n'),
        imgBuffer,
        Buffer.from(`\r\n--${boundary}--`)
      ]);
      contentType = `multipart/form-data; boundary=${boundary}`;
    }

    if (!formData) {
      const body = parts.join('\r\n') + `\r\n--${boundary}--`;
      formData = Buffer.from(body);
      contentType = `multipart/form-data; boundary=${boundary}`;
    }

    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'X-Api-Key': REMOVE_BG_KEY,
        'Content-Type': contentType,
      },
      body: formData
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ success: false, message: err.errors?.[0]?.title || 'فشل إزالة الخلفية' });
    }

    const imgBuffer = await response.arrayBuffer();
    const base64Result = Buffer.from(imgBuffer).toString('base64');
    const dataUrl = `data:image/png;base64,${base64Result}`;

    // رفع النتيجة على Cloudinary إن كان مضبوطاً
    const CLOUD = process.env.CLOUDINARY_CLOUD_NAME;
    const KEY = process.env.CLOUDINARY_API_KEY;
    const SECRET = process.env.CLOUDINARY_API_SECRET;

    if (CLOUD && KEY && SECRET) {
      try {
        const crypto = require('crypto');
        const timestamp = Math.floor(Date.now() / 1000);
        const folder = `socialos/${req.user.id}/nobg`;
        const sigStr = `folder=${folder}&timestamp=${timestamp}${SECRET}`;
        const signature = crypto.createHash('sha1').update(sigStr).digest('hex');
        const boundary2 = '----CloudBoundary' + Date.now();
        const cloudBody = [
          `--${boundary2}`, `Content-Disposition: form-data; name="file"`, '', dataUrl,
          `--${boundary2}`, `Content-Disposition: form-data; name="api_key"`, '', KEY,
          `--${boundary2}`, `Content-Disposition: form-data; name="timestamp"`, '', String(timestamp),
          `--${boundary2}`, `Content-Disposition: form-data; name="signature"`, '', signature,
          `--${boundary2}`, `Content-Disposition: form-data; name="folder"`, '', folder,
          `--${boundary2}--`
        ].join('\r\n');
        const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, {
          method: 'POST',
          headers: { 'Content-Type': `multipart/form-data; boundary=${boundary2}` },
          body: cloudBody
        });
        const uploadData = await uploadRes.json();
        if (uploadData.secure_url) return res.json({ success: true, url: uploadData.secure_url, source: 'cloudinary' });
      } catch (e) {}
    }

    // إرجاع base64 مباشرة إذا لم يكن Cloudinary مضبوطاً
    res.json({ success: true, url: dataUrl, source: 'base64' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Product Placement — دمج المنتج في بيئة
app.post('/api/images/place-product', authenticateToken, async (req, res) => {
  const { product_base64, product_url, placement_prompt } = req.body;
  if (!placement_prompt) return res.status(400).json({ success: false, message: 'وصف البيئة مطلوب' });
  if (!product_base64 && !product_url) return res.status(400).json({ success: false, message: 'صورة المنتج مطلوبة' });

  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) return res.status(503).json({ success: false, message: 'OPENAI_API_KEY غير مضبوط' });

  try {
    // جلب معلومات المتجر للسياق
    let storeName = 'متجر';
    if (pool) {
      const bp = await pool.query('SELECT store_name FROM business_profile WHERE user_id=$1', [req.user.id]);
      storeName = bp.rows[0]?.store_name || 'متجر';
    }

    const fullPrompt = `A professional product photography image for "${storeName}". The product is placed in: ${placement_prompt}. The product should be prominently displayed, realistic lighting, high quality commercial photography, 4K resolution, clean and professional look. The scene should look natural and inviting for customers.`;

    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: fullPrompt,
        n: 1,
        size: '1024x1024',
        quality: 'hd',
        style: 'natural'
      })
    });

    const data = await r.json();
    if (data.error) return res.status(400).json({ success: false, message: data.error.message });

    const imageUrl = data.data?.[0]?.url;
    if (!imageUrl) return res.status(500).json({ success: false, message: 'فشل توليد الصورة' });

    res.json({ success: true, image_url: imageUrl, revised_prompt: data.data?.[0]?.revised_prompt });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// توليد ديكور ذكي بالذكاء الاصطناعي
app.post('/api/images/suggest-decor', authenticateToken, async (req, res) => {
  const { product_type, store_style, color_scheme } = req.body;
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(503).json({ success: false, message: 'AI غير متاح' });

  try {
    let biz = {};
    if (pool) {
      const bp = await pool.query('SELECT store_name, business_type, business_desc FROM business_profile WHERE user_id=$1', [req.user.id]);
      biz = bp.rows[0] || {};
      // جلب هوية المتجر
      const id = await pool.query('SELECT primary_color, secondary_color, communication_style, font_name FROM store_identity WHERE user_id=$1', [req.user.id]);
      if (id.rows[0]) Object.assign(biz, id.rows[0]);
    }

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `أنت مصمم جرافيك عربي محترف. اقترح ديكوراً لصورة منتج بعد إزالة الخلفية.

المتجر: ${escapeHtml(biz.store_name||'')} — ${escapeHtml(biz.business_type||'')}
نوع المنتج: ${escapeHtml(product_type||'منتج عام')}
الألوان المفضلة: ${escapeHtml(biz.primary_color||color_scheme||'أزرق وبنفسجي')}
أسلوب المتجر: ${escapeHtml(biz.communication_style||store_style||'عصري')}

أرجع JSON فقط:
{
  "bg_type": "gradient|solid|pattern|blur",
  "bg_colors": ["#لون1", "#لون2"],
  "gradient_direction": "135deg",
  "overlay_opacity": 0.15,
  "shadow": { "color": "#000000", "blur": 20, "offsetX": 5, "offsetY": 10 },
  "border": { "enabled": false, "color": "#ffffff", "width": 3, "radius": 20 },
  "texts": [
    { "text": "نص مقترح", "pos": "bottom", "size": 32, "color": "#ffffff", "bg": "gradient" }
  ],
  "description": "وصف قصير للديكور",
  "style_name": "اسم الأسلوب"
}`
        }]
      })
    });
    const aiData = await aiRes.json();
    let decor = aiData.choices?.[0]?.message?.content || '{}';
    try { decor = JSON.parse(decor.replace(/```json|```/g, '').trim()); } catch (e) {
      decor = {
        bg_type: 'gradient',
        bg_colors: [biz.primary_color||'#4f8ef7', biz.secondary_color||'#7c3aed'],
        gradient_direction: '135deg',
        overlay_opacity: 0.1,
        shadow: { color: '#000000', blur: 20, offsetX: 5, offsetY: 10 },
        border: { enabled: false, color: '#ffffff', width: 3, radius: 16 },
        texts: [],
        description: 'ديكور متدرج بألوان المتجر',
        style_name: 'Classic Gradient'
      };
    }
    res.json({ success: true, decor });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// DEPOSIT POLICY — سياسات العربون
// ============================================================
};
