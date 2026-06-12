module.exports = function(app, pool, helpers) {
const { sanitize, authenticateToken, rateLimit, notify } = helpers;

const CREATOMATE_KEY = () => process.env.CREATOMATE_API_KEY || '0b330c957d7d46b5be1588af6c8cf097ccfe8059093ebdb58e3693dace5b8ffece54c47fcfcb9a1258cae47886a741ee';
const OPENROUTER_KEY = () => process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
const CREATOMATE_URL = 'https://api.creatomate.com/v1/renders';

// القوالب المتاحة
const TEMPLATES = {
  'product-hero-discount': {
    id: '40370d0f-420c-4298-8eed-563dd3748693',
    name_ar: 'منتج مع خصم',
    best_for: ['منتج', 'خصم', 'تخفيض', 'عرض', 'سعر']
  },
  'matrix-promotion': {
    id: '9d7526f4-2019-4918-a5de-201499f65d3b',
    name_ar: 'حملة ترويجية',
    best_for: ['ترويج', 'حملة', 'إطلاق', 'جديد', 'خدمة']
  },
  'animated-review': {
    id: '36075429-7516-4bac-b665-85afbc6c2aba',
    name_ar: 'تقييم متحرك',
    best_for: ['تقييم', 'رأي', 'زبون', 'مراجعة', 'تجربة']
  }
};

async function getBP(userId) {
  if (!pool) return {};
  const r = await pool.query('SELECT * FROM business_profile WHERE user_id=$1', [userId]);
  return r.rows[0] || {};
}

async function createRender(modifications, templateId) {
  const res = await fetch(CREATOMATE_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CREATOMATE_KEY()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ template_id: templateId, modifications })
  });
  return res.json();
}

// ============================================================
// Mike — يفهم الفكرة ويصنع الفيديو
// ============================================================
app.post('/api/video/mike-create', authenticateToken, rateLimit(10, 60000), async (req, res) => {
  const { idea, images } = req.body;
  if (!idea && !images?.length) return res.status(400).json({ success: false, message: 'اكتب فكرة أو أرسل صوراً' });

  try {
    const bp = await getBP(req.user.id);
    const storeName = bp.store_name || 'متجرنا';
    const color = bp.primary_color || '#5b6af0';
    const currency = bp.currency || 'IQD';
    const businessType = bp.business_type || '';
    const aiKey = OPENROUTER_KEY();

    // plan يُعرّف هنا — خارج أي block
    let plan = null;

    if (!aiKey) {
      // بدون AI — اختر بناءً على كلمات مفتاحية
      const ideaLower = (idea || '').toLowerCase();
      let templateKey = 'product-hero-discount';
      if (ideaLower.includes('تقييم') || ideaLower.includes('زبون') || ideaLower.includes('مراجعة')) templateKey = 'animated-review';
      else if (ideaLower.includes('حملة') || ideaLower.includes('ترويج') || ideaLower.includes('إطلاق')) templateKey = 'matrix-promotion';

      plan = {
        template: templateKey,
        reasoning: 'تم اختيار القالب تلقائياً',
        modifications: {
          'Product Name': idea || 'منتجنا',
          'Price': '', 'Discount': '',
          'Store Name': storeName,
          'Headline': idea || storeName,
          'Subtext': businessType,
          'CTA': 'اطلب الآن',
          'Customer Name': 'زبون راضٍ',
          'Review Text': idea || 'منتج رائع!',
          'Rating': '⭐⭐⭐⭐⭐'
        },
        platform: 'instagram',
        mike_note: 'تم الاختيار تلقائياً'
      };
    } else {
      // مع AI
      const prompt = `أنت Mike مخرج فيديو لمتجر "${storeName}".
القوالب: product-hero-discount (منتج+خصم) | matrix-promotion (ترويج) | animated-review (تقييم)
الفكرة: "${idea || 'فيديو من الصور'}"
أجب بـ JSON فقط: {"template":"...","reasoning":"...","modifications":{"Product Name":"","Price":"","Discount":"","Store Name":"${storeName}","Headline":"","Subtext":"","CTA":"اطلب الآن","Customer Name":"","Review Text":"","Rating":"⭐⭐⭐⭐⭐"},"platform":"instagram","mike_note":"..."}`;

      const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${aiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'anthropic/claude-haiku-4-5', max_tokens: 500, messages: [{ role: 'user', content: prompt }] })
      });
      const aiData = await aiRes.json();
      const raw = aiData.choices?.[0]?.message?.content || '{}';

      try { plan = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
      catch(e) { plan = null; }
    }

    // fallback إذا plan فارغ أو template غير صحيح
    if (!plan || !plan.template || !TEMPLATES[plan.template]) {
      plan = {
        template: 'product-hero-discount',
        reasoning: 'قالب افتراضي',
        modifications: { 'Product Name': idea || 'منتجنا', 'Store Name': storeName, 'Headline': idea || storeName, 'CTA': 'اطلب الآن' },
        platform: 'instagram',
        mike_note: ''
      };
    }

    const template = TEMPLATES[plan.template];
    let modifications = { ...plan.modifications };

    // إضافة صورة وألوان
    if (images?.length) modifications['Product Image'] = images[0];
    modifications['Primary Color'] = color;
    modifications['Background Color'] = color;
    modifications['Store Name'] = storeName;

    const result = await createRender(modifications, template.id);
    if (!result || result.error) {
      return res.status(400).json({ success: false, message: result?.error || result?.message || 'خطأ في Creatomate' });
    }

    const renderId = Array.isArray(result) ? result[0]?.id : result.id;
    if (!renderId) return res.status(400).json({ success: false, message: 'لم يتم إنشاء الفيديو' });

    if (pool) {
      await pool.query(
        `INSERT INTO video_renders (user_id, render_id, type, platform, product_name, status) VALUES ($1,$2,$3,$4,$5,'rendering')`,
        [req.user.id, renderId, plan.template, plan.platform||'instagram', sanitize(idea?.substring(0,100)||'')]
      ).catch(() => {});
    }

    res.json({ success: true, render_id: renderId, template_used: template.name_ar, reasoning: plan.reasoning, mike_note: plan.mike_note, platform: plan.platform||'instagram', status: 'rendering' });

  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// فحص حالة الفيديو
app.get('/api/video/status/:render_id', authenticateToken, async (req, res) => {
  try {
    const r = await fetch(`${CREATOMATE_URL}/${req.params.render_id}`, {
      headers: { 'Authorization': `Bearer ${CREATOMATE_KEY()}` }
    });
    const data = await r.json();

    if (pool && (data.status === 'succeeded' || data.status === 'failed')) {
      await pool.query(
        'UPDATE video_renders SET status=$1, video_url=$2, updated_at=NOW() WHERE render_id=$3 AND user_id=$4',
        [data.status === 'succeeded' ? 'completed' : 'failed', data.url || null, req.params.render_id, req.user.id]
      ).catch(() => {});

      if (data.status === 'succeeded') {
        await notify(req.user.id, '🎬 فيديوك جاهز!', 'Mike انتهى من إنشاء الفيديو', 'video');
      }
    }

    res.json({
      success: true,
      status: data.status,
      url: data.url || null,
      progress: data.progress || 0,
      ready: data.status === 'succeeded'
    });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// جلب آخر الفيديوهات
app.get('/api/video/list', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.json({ success: true, videos: [] });
    const r = await pool.query(
      'SELECT * FROM video_renders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20',
      [req.user.id]
    );
    res.json({ success: true, videos: r.rows });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

};
