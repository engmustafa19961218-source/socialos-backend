module.exports = function(app, pool, helpers) {
const { sanitize, authenticateToken, rateLimit, escapeHtml } = helpers;

const CREATOMATE_KEY = () => process.env.CREATOMATE_API_KEY;
const CREATOMATE_URL = 'https://api.creatomate.com/v1/renders';

// القوالب
const TEMPLATES = {
  'product-hero-discount': {
    id: '40370d0f-420c-4298-8eed-563dd3748693',
    name_ar: 'منتج مع خصم'
  },
  'matrix-promotion': {
    id: '9d7526f4-2019-4918-a5de-201499f65d3b',
    name_ar: 'حملة ترويجية'
  },
  'animated-review': {
    id: '36075429-7516-4bac-b665-85afbc6c2aba',
    name_ar: 'تقييم متحرك'
  }
};

async function getBP(userId) {
  if (!pool) return {};
  const r = await pool.query('SELECT * FROM business_profile WHERE user_id=$1', [userId]);
  return r.rows[0] || {};
}

// ============================================================
// إنشاء فيديو بالصور
// ============================================================
app.post('/api/video/create', authenticateToken, rateLimit(10, 60000), async (req, res) => {
  try {
    const KEY = CREATOMATE_KEY();
    if (!KEY) return res.status(503).json({ success: false, message: 'Creatomate غير مفعّل' });

    const { product_name, price, discount, headline, images = [], template = 'product-hero-discount' } = req.body;
    const bp = await getBP(req.user.id);
    const storeName = bp.store_name || 'متجرنا';

    const tmpl = TEMPLATES[template] || TEMPLATES['product-hero-discount'];

    // بناء modifications
    const modifications = {
      'Store Name': storeName,
      'Product Name': sanitize(product_name || 'منتج مميز'),
      'Price': sanitize(price || ''),
      'Discount': sanitize(discount || ''),
      'Headline': sanitize(headline || 'عرض خاص!'),
      'CTA': 'اطلب الآن',
    };

    // إضافة الصور إذا وُجدت
    if (images.length > 0) modifications['Image'] = images[0];
    if (images.length > 1) modifications['Image 2'] = images[1];
    if (images.length > 2) modifications['Image 3'] = images[2];

    const result = await fetch(CREATOMATE_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ template_id: tmpl.id, modifications })
    });

    const data = await result.json();
    console.log('Creatomate response:', JSON.stringify(data).substring(0, 300));

    if (!result.ok) {
      return res.status(400).json({ success: false, message: data?.message || data?.error || 'خطأ في Creatomate', raw: data });
    }

    const renderId = Array.isArray(data) ? data[0]?.id : data.id;
    if (!renderId) {
      return res.status(400).json({ success: false, message: 'لم يتم إنشاء الفيديو', raw: data });
    }

    if (pool) {
      await pool.query(
        `INSERT INTO video_renders (user_id, render_id, type, platform, product_name, status) VALUES ($1,$2,$3,$4,$5,'rendering')`,
        [req.user.id, renderId, template, 'instagram', sanitize(product_name?.substring(0,100)||'')]
      ).catch(() => {});
    }

    res.json({ success: true, render_id: renderId, template_used: tmpl.name_ar, status: 'rendering' });

  } catch(e) {
    console.error('Video create error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// Mike create — يفهم الفكرة ويصنع الفيديو
app.post('/api/video/mike-create', authenticateToken, rateLimit(10, 60000), async (req, res) => {
  try {
    const KEY = CREATOMATE_KEY();
    if (!KEY) return res.status(503).json({ success: false, message: 'Creatomate غير مفعّل' });

    const { idea, images = [], platform = 'instagram' } = req.body;
    const bp = await getBP(req.user.id);
    const storeName = bp.store_name || 'متجرنا';

    // اختيار القالب بناء على الفكرة
    const ideaLower = (idea || '').toLowerCase();
    let templateKey = 'product-hero-discount';
    if (ideaLower.includes('تقييم') || ideaLower.includes('مراجعة') || ideaLower.includes('زبون')) templateKey = 'animated-review';
    else if (ideaLower.includes('حملة') || ideaLower.includes('ترويج') || ideaLower.includes('إطلاق')) templateKey = 'matrix-promotion';

    const tmpl = TEMPLATES[templateKey];

    // modifications حسب القالب المختار
    let modifications = {};

    if (templateKey === 'product-hero-discount') {
      modifications = {
        'Product-Name': sanitize(idea?.substring(0, 50) || 'منتج مميز'),
        'Product-Description': sanitize(idea?.substring(0, 80) || ''),
        'Caption': 'خصم خاص!',
        'Discounted-Price': '',
        'Normal-Price': '',
      };
      if (images.length > 0) modifications['Product-Image'] = images[0];
    } else if (templateKey === 'matrix-promotion') {
      modifications = {
        'Text': storeName,
        'Date': new Date().toLocaleDateString('ar'),
        'Product Offer 1': sanitize(idea?.substring(0, 50) || 'عرض مميز'),
      };
      if (images.length > 0) modifications['Product Image 1'] = images[0];
      if (images.length > 1) modifications['Product Image 2'] = images[1];
    } else if (templateKey === 'animated-review') {
      modifications = {
        'Review-Text': sanitize(idea?.substring(0, 100) || 'منتج رائع وجودة عالية'),
        'Name': storeName,
        'Date': new Date().toLocaleDateString('ar'),
        'Stars': '5',
      };
      if (images.length > 0) modifications['Photo'] = images[0];
    }

    const result = await fetch(CREATOMATE_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: tmpl.id, modifications })
    });

    const data = await result.json();
    console.log('Creatomate mike-create:', JSON.stringify(data).substring(0, 300));

    if (!result.ok) {
      return res.status(400).json({ success: false, message: data?.message || data?.error || 'خطأ في Creatomate', raw: data });
    }

    const renderId = Array.isArray(data) ? data[0]?.id : data.id;
    if (!renderId) return res.status(400).json({ success: false, message: 'لم يتم إنشاء الفيديو', raw: data });

    if (pool) {
      await pool.query(
        `INSERT INTO video_renders (user_id, render_id, type, platform, product_name, status) VALUES ($1,$2,$3,$4,$5,'rendering')`,
        [req.user.id, renderId, templateKey, platform, sanitize(idea?.substring(0,100)||'')]
      ).catch(() => {});
    }

    res.json({ 
      success: true, render_id: renderId, 
      template_used: tmpl.name_ar, 
      reasoning: `اخترت قالب "${tmpl.name_ar}" بناء على فكرتك`,
      mike_note: 'جاري تصنيع الفيديو، سيكون جاهزاً خلال دقيقة!',
      platform, status: 'rendering' 
    });

  } catch(e) {
    console.error('Mike video error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ============================================================
// متابعة حالة الفيديو
// ============================================================
app.get('/api/video/status/:render_id', authenticateToken, async (req, res) => {
  try {
    const KEY = CREATOMATE_KEY();
    if (!KEY) return res.status(503).json({ success: false, message: 'Creatomate غير مفعّل' });

    const r = await fetch(`${CREATOMATE_URL}/${req.params.render_id}`, {
      headers: { 'Authorization': `Bearer ${KEY}` }
    });
    const data = await r.json();

    if (data.status === 'succeeded') {
      if (pool) {
        await pool.query(
          `UPDATE video_renders SET status='done', video_url=$1 WHERE render_id=$2 AND user_id=$3`,
          [data.url, req.params.render_id, req.user.id]
        ).catch(() => {});
      }
      res.json({ success: true, status: 'done', url: data.url });
    } else if (data.status === 'failed') {
      res.json({ success: false, status: 'failed', message: data.error || 'فشل التوليد' });
    } else {
      res.json({ success: true, status: 'rendering', progress: data.progress || 0 });
    }
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ============================================================
// قائمة الفيديوهات
// ============================================================
app.get('/api/video/list', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.json({ success: true, videos: [] });
    const r = await pool.query(
      `SELECT * FROM video_renders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20`,
      [req.user.id]
    );
    res.json({ success: true, videos: r.rows });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

};
