module.exports = function(app, pool, helpers) {
const { escapeHtml, sanitize, authenticateToken, rateLimit, notify, auditLog, formatCurrency, esc } = helpers;

// ============================================================
// BACKUP — النسخ الاحتياطية
// ============================================================
app.post('/api/backup/create', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    const [bp, emp, products, customers, orders, knowledge, decisions, coupons, corrections, sessions, identity, loyalty] = await Promise.all([
      pool.query('SELECT * FROM business_profile WHERE user_id=$1', [userId]),
      pool.query('SELECT * FROM digital_employee WHERE user_id=$1', [userId]),
      pool.query('SELECT * FROM products WHERE user_id=$1', [userId]),
      pool.query('SELECT * FROM customers WHERE user_id=$1', [userId]),
      pool.query('SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 500', [userId]),
      pool.query('SELECT * FROM knowledge_base WHERE user_id=$1', [userId]),
      pool.query('SELECT * FROM decision_memory WHERE user_id=$1', [userId]),
      pool.query('SELECT * FROM coupons WHERE user_id=$1', [userId]),
      pool.query('SELECT * FROM training_corrections WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [userId]),
      pool.query('SELECT * FROM training_sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [userId]),
      pool.query('SELECT * FROM store_identity WHERE user_id=$1', [userId]).catch(()=>({rows:[]})),
      pool.query('SELECT * FROM loyalty_points WHERE user_id=$1', [userId]).catch(()=>({rows:[]}))
    ]);

    const backupData = JSON.stringify({
      version: '2.0',
      timestamp: new Date().toISOString(),
      user_id: userId,
      sections: {
        business_profile: bp.rows[0] || {},
        digital_employee: emp.rows[0] || {},
        store_identity: identity.rows[0] || {},
        products: products.rows,
        customers: customers.rows,
        orders: orders.rows,
        knowledge_base: knowledge.rows,
        decision_memory: decisions.rows,
        coupons: coupons.rows,
        training_corrections: corrections.rows,
        training_sessions: sessions.rows,
        loyalty_points: loyalty.rows
      },
      stats: {
        products: products.rows.length,
        customers: customers.rows.length,
        orders: orders.rows.length,
        knowledge: knowledge.rows.length,
        decisions: decisions.rows.length,
        corrections: corrections.rows.length
      }
    });

    const r = await pool.query(
      'INSERT INTO backups (user_id, type, data, size) VALUES ($1,$2,$3,$4) RETURNING id, created_at',
      [userId, 'full', backupData, backupData.length]
    );
    await auditLog(userId, 'create_backup', 'backup', r.rows[0].id, `Full backup ${(backupData.length/1024).toFixed(1)}KB`, req.ip);
    await notify(userId, '💾 نسخة احتياطية', 'تم إنشاء نسخة احتياطية كاملة', 'success');

    return res.json({
      success: true,
      backup_id: r.rows[0].id,
      created_at: r.rows[0].created_at,
      size: backupData.length,
      stats: JSON.parse(backupData).stats
    });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/backup/list', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT id, type, size, created_at FROM backups WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [req.user.id]);
      return res.json({ success: true, backups: r.rows });
    }
  } catch (e) {}
  res.json({ success: true, backups: [] });
});

app.get('/api/backup/:id/download', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM backups WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
      if (!r.rows.length) return res.status(404).json({ message: 'النسخة غير موجودة' });
      const date = new Date(r.rows[0].created_at).toISOString().split('T')[0];
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="socialos-backup-${date}.json"`);
      return res.send(r.rows[0].data);
    }
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// استيراد نسخة احتياطية
app.post('/api/backup/restore', authenticateToken, async (req, res) => {
  const { backup_data, sections } = req.body;
  if (!backup_data) return res.status(400).json({ success: false, message: 'بيانات النسخة مطلوبة' });
  const userId = req.user.id;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    let data;
    try { data = typeof backup_data === 'string' ? JSON.parse(backup_data) : backup_data; } catch { return res.status(400).json({ success: false, message: 'تنسيق النسخة غير صالح' }); }

    // التحقق من أن النسخة تخص نفس المستخدم أو نسخة عامة
    const src = data.sections || data; // دعم النسختين القديمة والجديدة
    const restored = [];

    // استيراد الأقسام المطلوبة فقط
    const toRestore = sections || ['business_profile','digital_employee','knowledge_base','decision_memory','training_corrections'];

    if (toRestore.includes('business_profile') && src.business_profile) {
      const bp = src.business_profile;
      await pool.query(`INSERT INTO business_profile (user_id,store_name,business_type,business_desc,target_audience,communication_style,policies,whatsapp_number,onboarding_done)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) ON CONFLICT(user_id) DO UPDATE SET
        store_name=$2,business_type=$3,business_desc=$4,target_audience=$5,communication_style=$6,policies=$7,whatsapp_number=$8`,
        [userId,bp.store_name||'',bp.business_type||'',bp.business_desc||'',bp.target_audience||'',bp.communication_style||'',bp.policies||'',bp.whatsapp_number||'']);
      restored.push('بيانات المتجر');
    }

    if (toRestore.includes('digital_employee') && src.digital_employee) {
      const emp = src.digital_employee;
      await pool.query(`INSERT INTO digital_employee (user_id,name,personality,sales_style,philosophy,objection_handling,boundaries)
        VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id) DO UPDATE SET
        name=$2,personality=$3,sales_style=$4,philosophy=$5,objection_handling=$6,boundaries=$7`,
        [userId,emp.name||'',emp.personality||'',emp.sales_style||'',emp.philosophy||'',emp.objection_handling||'',emp.boundaries||'']);
      restored.push('الموظف الرقمي');
    }

    if (toRestore.includes('knowledge_base') && src.knowledge_base?.length) {
      for (const k of src.knowledge_base.slice(0,100)) {
        await pool.query('INSERT INTO knowledge_base (user_id,title,content,type) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
          [userId, escapeHtml(k.title||''), k.content||'', k.type||'other']).catch(()=>{});
      }
      restored.push(`مركز المعرفة (${src.knowledge_base.length})`);
    }

    if (toRestore.includes('decision_memory') && src.decision_memory?.length) {
      for (const d of src.decision_memory.slice(0,100)) {
        await pool.query('INSERT INTO decision_memory (user_id,decision,reason,context,is_active) VALUES ($1,$2,$3,$4,true) ON CONFLICT DO NOTHING',
          [userId, d.decision||'', d.reason||'', d.context||'general']).catch(()=>{});
      }
      restored.push(`القرارات (${src.decision_memory.length})`);
    }

    if (toRestore.includes('training_corrections') && src.training_corrections?.length) {
      for (const c of src.training_corrections.slice(0,50)) {
        await pool.query('INSERT INTO training_corrections (user_id,original_response,corrected_response,lesson) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
          [userId, c.original_response||'', c.corrected_response||'', c.lesson||'']).catch(()=>{});
      }
      restored.push(`التصحيحات (${src.training_corrections.length})`);
    }

    if (toRestore.includes('products') && src.products?.length) {
      for (const p of src.products.slice(0,200)) {
        await pool.query('INSERT INTO products (user_id,name,description,price,stock,category,is_available) VALUES ($1,$2,$3,$4,$5,$6,true) ON CONFLICT DO NOTHING',
          [userId, escapeHtml(p.name||''), escapeHtml(p.description||''), parseFloat(p.price)||0, parseInt(p.stock)||0, escapeHtml(p.category||'عام')]).catch(()=>{});
      }
      restored.push(`المنتجات (${src.products.length})`);
    }

    await auditLog(userId, 'restore_backup', 'backup', null, `Restored: ${restored.join(', ')}`, req.ip);
    await notify(userId, '💾 استيراد نسخة', `تم استيراد: ${restored.join('، ')}`, 'success');
    res.json({ success: true, restored, message: `تم استيراد: ${restored.join('، ')}` });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// WHATSAPP BULK CAMPAIGNS
// ============================================================
app.post('/api/whatsapp/bulk', authenticateToken, async (req, res) => {
  const { message, target, phones: customPhones } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ success: false, message: 'الرسالة مطلوبة' });
  if (message.length > 1000) return res.status(400).json({ success: false, message: 'الرسالة طويلة جداً' });
  const userId = req.user.id;
  try {
    if (pool) {
      let phones = [];
      if (target === 'all') phones = (await pool.query('SELECT DISTINCT customer_phone as phone, customer_name as name FROM orders WHERE user_id=$1', [userId])).rows;
      else if (target === 'recent') phones = (await pool.query(`SELECT DISTINCT customer_phone as phone, customer_name as name FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '30 days'`, [userId])).rows;
      else if (target === 'loyalty') phones = (await pool.query('SELECT customer_phone as phone, customer_name as name FROM loyalty_points WHERE user_id=$1 AND points>0', [userId])).rows;
      else if (target === 'custom' && customPhones) phones = customPhones.map(p => ({ phone: p, name: '' }));
      if (!phones.length) return res.json({ success: false, message: 'لا يوجد عملاء في هذه الفئة' });
      const links = phones.slice(0, 50).map(c => {
        const clean = (c.phone||'').replace(/[^0-9]/g, '');
        const waPhone = clean.startsWith('0') ? '964' + clean.slice(1) : clean;
        return { phone: waPhone, name: c.name, url: `https://wa.me/${waPhone}?text=${encodeURIComponent(message.replace('{اسم}', c.name||'عزيزي العميل'))}` };
      });
      return res.json({ success: true, links, total: phones.length, shown: links.length });
    }
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/whatsapp/bulk/counts', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const [all, recent, loyalty] = await Promise.all([
        pool.query('SELECT COUNT(DISTINCT customer_phone) as count FROM orders WHERE user_id=$1', [req.user.id]),
        pool.query(`SELECT COUNT(DISTINCT customer_phone) as count FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '30 days'`, [req.user.id]),
        pool.query('SELECT COUNT(*) as count FROM loyalty_points WHERE user_id=$1 AND points>0', [req.user.id])
      ]);
      return res.json({ success: true, counts: { all: parseInt(all.rows[0]?.count||0), recent: parseInt(recent.rows[0]?.count||0), loyalty: parseInt(loyalty.rows[0]?.count||0) } });
    }
  } catch (e) {}
  res.json({ success: true, counts: { all: 0, recent: 0, loyalty: 0 } });
});

// ============================================================
// REPLY TEMPLATES
// ============================================================
// اقتراح قوالب واتساب ذكية حسب نوع العمل
app.post('/api/whatsapp/templates/suggest', authenticateToken, rateLimit(15, 60*1000), async (req, res) => {
  const { template_type } = req.body;
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.json({ success: false, message: 'AI غير متاح' });
  try {
    let bp = {};
    if (pool) {
      const r = await pool.query('SELECT store_name, business_type, communication_style, currency FROM business_profile WHERE user_id=$1', [req.user.id]);
      bp = r.rows[0] || {};
    }
    const typeLabels = {
      offer: 'عرض خاص أو تخفيض',
      new_product: 'منتج أو خدمة جديدة',
      loyalty: 'مكافأة عملاء مميزين',
      followup: 'متابعة عملاء غير نشطين',
      seasonal: 'مناسبة موسمية أو عطلة'
    };
    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 700,
        messages: [{ role: 'user', content:
`أنت خبير تسويق واتساب للسوق العربي. اكتب 3 قوالب رسائل واتساب لـ "${typeLabels[template_type]||template_type}".

المتجر: ${escapeHtml(bp.store_name||'متجرنا')}
نوع النشاط: ${escapeHtml(bp.business_type||'تجارة')}
أسلوب التواصل: ${escapeHtml(bp.communication_style||'ودي')}
العملة: ${bp.currency||'IQD'}

المطلوب: رسائل قصيرة مناسبة لطبيعة هذا النشاط تحديداً. استخدم {اسم} لاسم العميل. بدون مبالغة.

أرجع JSON فقط:
{"templates":[{"label":"نسخة 1","text":"..."},{"label":"نسخة 2","text":"..."},{"label":"نسخة 3","text":"..."}]}`
        }]
      })
    });
    const data = await aiRes.json();
    let result = {};
    try { result = JSON.parse((data.choices?.[0]?.message?.content||'{}').replace(/```json|```/g,'').trim()); } catch(e){}
    res.json({ success: true, templates: result.templates || [] });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/templates', authenticateToken, async (req, res) => {
  const { title, content, category } = req.body;
  if (!title || !content) return res.status(400).json({ success: false, message: 'العنوان والمحتوى مطلوبان' });
  try {
    if (pool) {
      const r = await pool.query('INSERT INTO reply_templates (user_id,title,content,category) VALUES ($1,$2,$3,$4) RETURNING *', [req.user.id, title, content, category||'عام']);
      return res.json({ success: true, template: r.rows[0] });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/templates', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM reply_templates WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
      return res.json({ templates: r.rows });
    }
  } catch (e) {}
  res.json({ templates: [] });
});

app.delete('/api/templates/:id', authenticateToken, async (req, res) => {
  try {
    if (pool) await pool.query('DELETE FROM reply_templates WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// IMAGE UPLOAD (Cloudinary)
// ============================================================
app.post('/api/upload/image', authenticateToken, async (req, res) => {
  const { image, folder } = req.body;
  if (!image) return res.status(400).json({ success: false, message: 'الصورة مطلوبة' });
  if (!image.startsWith('data:image/')) return res.status(400).json({ success: false, message: 'صيغة صورة غير صحيحة' });
  if (image.length > 10 * 1024 * 1024) return res.status(400).json({ success: false, message: 'الصورة أكبر من 7MB' });

  const CLOUD = process.env.CLOUDINARY_CLOUD_NAME;
  const KEY   = process.env.CLOUDINARY_API_KEY;
  const SECRET= process.env.CLOUDINARY_API_SECRET;

  if (!CLOUD || !KEY || !SECRET) {
    return res.json({ success: true, url: image, source: 'base64', message: 'Cloudinary غير مفعّل' });
  }
  try {
    const crypto = require('crypto');
    const timestamp = Math.floor(Date.now() / 1000);
    const uploadFolder = folder || 'socialos';
    const signature = crypto.createHmac('sha256', SECRET).update(`folder=${uploadFolder}&timestamp=${timestamp}`).digest('hex');
    const boundary = '----SocialOSBoundary' + Date.now();
    const formBody = [`--${boundary}`, 'Content-Disposition: form-data; name="file"', '', image, `--${boundary}`, 'Content-Disposition: form-data; name="api_key"', '', KEY, `--${boundary}`, 'Content-Disposition: form-data; name="timestamp"', '', String(timestamp), `--${boundary}`, 'Content-Disposition: form-data; name="signature"', '', signature, `--${boundary}`, 'Content-Disposition: form-data; name="folder"', '', uploadFolder, `--${boundary}--`].join('\r\n');
    const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body: formBody });
    const uploadData = await uploadRes.json();
    if (uploadData.secure_url) return res.json({ success: true, url: uploadData.secure_url, source: 'cloudinary' });
    return res.json({ success: true, url: image, source: 'base64' });
  } catch (e) { return res.json({ success: true, url: image, source: 'base64' }); }
});

// ============================================================
// PUBLIC STORE
// ============================================================
app.get('/store/:userId', async (req, res) => {
  const { userId } = req.params;
  if (!/^\d+$/.test(userId)) return res.status(400).send('<h1>رابط غير صحيح</h1>');
  try {
    if (!pool) return res.status(503).send('<h1>الخدمة غير متاحة</h1>');
    const [user, products, bp, identity] = await Promise.all([
      pool.query('SELECT name, avatar_url FROM users WHERE id=$1', [userId]),
      pool.query('SELECT * FROM products WHERE user_id=$1 AND is_available=true ORDER BY category, created_at DESC', [userId]),
      pool.query('SELECT * FROM business_profile WHERE user_id=$1', [userId]),
      pool.query('SELECT * FROM store_identity WHERE user_id=$1', [userId]).catch(()=>({rows:[]}))
    ]);
    if (!user.rows.length) return res.status(404).send('<h1>المتجر غير موجود</h1>');
    const owner = user.rows[0];
    const profile = bp.rows[0] || {};
    const id = identity.rows[0] || {};
    const storeName = escapeHtml(profile.store_name || owner.name || 'متجر');
    const cur = escapeHtml(profile.currency || 'IQD');
    const prods = products.rows;
    const categories = [...new Set(prods.map(p => p.category).filter(Boolean))];
    const prodsJson = JSON.stringify(prods.map(p => ({
      id: p.id,
      name: escapeHtml(p.name||''),
      description: escapeHtml(p.description||''),
      price: parseFloat(p.price)||0,
      stock: parseInt(p.stock)||0,
      category: escapeHtml(p.category||''),
      image_url: (p.image_url||'').startsWith('https://') ? p.image_url : ''
    })));

    // ألوان المتجر من الهوية
    const c1 = id.primary_color || '#4f8ef7';
    const c2 = id.secondary_color || '#7c3aed';
    const c3 = id.accent_color || '#00d4aa';
    const logoUrl = id.logo_url || owner.avatar_url || '';
    const coverUrl = id.cover_url || '';
    const fontName = id.font_name || 'Tajawal';
    const watermark = escapeHtml(id.watermark_text || storeName);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="${c1}">
<title>${storeName}</title>
<link href="https://fonts.googleapis.com/css2?family=${fontName.replace(' ','+')}:wght@400;700;900&family=Tajawal:wght@400;700;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--c1:${c1};--c2:${c2};--c3:${c3};}
body{font-family:'${fontName}',Tajawal,sans-serif;background:#06080f;color:#e2e8f5;direction:rtl;min-height:100vh}
/* HEADER */
.header{position:relative;background:linear-gradient(135deg,#0a0e18,#111827);border-bottom:1px solid rgba(255,255,255,.07);overflow:hidden}
.cover{width:100%;height:160px;object-fit:cover;display:block;opacity:.5}
.cover-placeholder{height:100px;background:linear-gradient(135deg,var(--c1),var(--c2));opacity:.15}
.header-inner{padding:20px 18px 22px;text-align:center;position:relative}
.store-logo{width:70px;height:70px;border-radius:18px;object-fit:cover;border:3px solid var(--c1);box-shadow:0 4px 20px rgba(0,0,0,.4);margin:-35px auto 12px;display:block;background:var(--c1)}
.store-logo-placeholder{width:70px;height:70px;border-radius:18px;background:linear-gradient(135deg,var(--c1),var(--c2));display:flex;align-items:center;justify-content:center;font-size:1.6rem;border:3px solid rgba(255,255,255,.1);margin:12px auto;font-weight:900;color:#fff}
.store-name{font-size:1.5rem;font-weight:900;margin-bottom:5px;background:linear-gradient(135deg,#fff,var(--c1));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.store-desc{color:rgba(255,255,255,.45);font-size:.82rem;line-height:1.5}
.store-badge{display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:4px 11px;font-size:.74rem;margin-top:8px;color:rgba(255,255,255,.5)}
/* NAV */
.nav-bar{position:sticky;top:0;background:rgba(6,8,15,.95);backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,.06);z-index:100;padding:10px 14px}
.search-row{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:8px 14px;margin-bottom:9px}
.search-row input{flex:1;background:transparent;border:none;color:#e2e8f5;font-family:inherit;font-size:.88rem;outline:none}
.search-row input::placeholder{color:rgba(255,255,255,.3)}
.cats{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}
.cats::-webkit-scrollbar{display:none}
.cat-btn{padding:5px 14px;border-radius:20px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:rgba(255,255,255,.45);cursor:pointer;font-family:inherit;font-size:.77rem;font-weight:700;white-space:nowrap;transition:all .18s}
.cat-btn.active{background:var(--c1);border-color:var(--c1);color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.3)}
/* GRID */
.container{max-width:960px;margin:0 auto;padding:16px 12px 110px}
.section-title{font-size:.72rem;font-weight:700;color:rgba(255,255,255,.3);text-transform:uppercase;letter-spacing:.8px;margin-bottom:11px;padding-right:2px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:11px}
.card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:14px;overflow:hidden;cursor:pointer;transition:all .22s;position:relative}
.card:hover{border-color:var(--c1);transform:translateY(-3px);box-shadow:0 8px 24px rgba(0,0,0,.3)}
.card:active{transform:scale(.97)}
.pimg{height:145px;background:rgba(255,255,255,.04);display:flex;align-items:center;justify-content:center;font-size:2.2rem;overflow:hidden;position:relative}
.pimg img{width:100%;height:100%;object-fit:cover;transition:transform .3s}
.card:hover .pimg img{transform:scale(1.05)}
.pinfo{padding:10px 11px 11px}
.pname{font-weight:700;font-size:.84rem;margin-bottom:4px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pprice{color:var(--c1);font-weight:900;font-size:.9rem}
.pstock{font-size:.68rem;color:rgba(255,255,255,.3);margin-top:3px}
.out-badge{position:absolute;top:8px;right:8px;background:rgba(240,64,96,.85);color:#fff;border-radius:6px;padding:2px 7px;font-size:.68rem;font-weight:700}
/* CART FLOAT */
.cart-float{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(30px);background:linear-gradient(135deg,var(--c1),var(--c2));border-radius:20px;padding:12px 22px;display:flex;align-items:center;gap:10px;cursor:pointer;z-index:200;opacity:0;pointer-events:none;transition:all .3s cubic-bezier(.16,1,.3,1);box-shadow:0 8px 32px rgba(0,0,0,.4);font-weight:700}
.cart-float.show{opacity:1;pointer-events:all;transform:translateX(-50%) translateY(0)}
/* OVERLAYS */
.overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:300;align-items:flex-end;justify-content:center;backdrop-filter:blur(6px)}
.overlay.show{display:flex}
.sheet{background:#0a0e18;border-radius:22px 22px 0 0;width:100%;max-width:500px;max-height:92vh;overflow-y:auto;padding:20px 18px 30px;border-top:1px solid rgba(255,255,255,.08)}
.handle{width:40px;height:4px;background:rgba(255,255,255,.15);border-radius:2px;margin:0 auto 18px}
.inp{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:11px;padding:11px 14px;color:#e2e8f5;font-size:.9rem;font-family:inherit;margin-bottom:9px;outline:none;transition:border-color .2s}
.inp:focus{border-color:var(--c1)}
.btn-main{width:100%;padding:13px;background:linear-gradient(135deg,var(--c1),var(--c2));color:#fff;border:none;border-radius:13px;font-size:.95rem;font-weight:700;cursor:pointer;font-family:inherit;margin-top:6px;transition:all .2s}
.btn-main:hover{opacity:.9;transform:translateY(-1px)}
.btn-main:disabled{opacity:.5;cursor:not-allowed;transform:none}
.btn-sec{width:100%;padding:11px;background:transparent;border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.5);border-radius:12px;font-size:.9rem;font-weight:700;cursor:pointer;font-family:inherit;margin-top:6px}
/* EMPTY */
.empty{text-align:center;padding:50px 20px;color:rgba(255,255,255,.25);grid-column:1/-1}
/* WATERMARK */
.watermark{text-align:center;color:rgba(255,255,255,.15);font-size:.7rem;padding:12px;margin-top:8px}
</style>
</head>
<body>
<div class="header">
  ${coverUrl ? `<img class="cover" src="${escapeHtml(coverUrl)}" alt="غلاف">` : '<div class="cover-placeholder"></div>'}
  <div class="header-inner">
    ${logoUrl ? `<img class="store-logo" src="${escapeHtml(logoUrl)}" alt="شعار">` : `<div class="store-logo-placeholder">${storeName.charAt(0)}</div>`}
    <div class="store-name">${storeName}</div>
    ${profile.business_desc ? `<div class="store-desc">${escapeHtml(profile.business_desc)}</div>` : ''}
    <div class="store-badge">🛍️ ${prods.length} منتج متاح</div>
  </div>
</div>

<div class="nav-bar">
  <div class="search-row"><span style="color:rgba(255,255,255,.3)">🔍</span><input id="si" placeholder="ابحث في المنتجات..." oninput="filt()"></div>
  <div class="cats">
    <button class="cat-btn active" onclick="fCat('',this)">الكل</button>
    ${categories.map(c=>`<button class="cat-btn" onclick="fCat(${JSON.stringify(escapeHtml(c))},this)">${escapeHtml(c)}</button>`).join('')}
  </div>
</div>

<div class="container">
  <div class="section-title" id="grid-label">جميع المنتجات (${prods.length})</div>
  <div class="grid" id="grid"></div>
  <div class="watermark">${watermark}</div>
</div>

<div class="cart-float" id="cf" onclick="openCart()">
  <span>🛒</span><span id="cc">0</span><span style="font-size:.75rem;opacity:.8">منتج</span>
  <span id="ct" style="font-weight:900">0</span><span style="font-size:.75rem">${cur}</span>
  <span style="font-size:.8rem;opacity:.75">اطلب الآن ←</span>
</div>

<!-- السلة -->
<div class="overlay" id="co" onclick="if(event.target===this)closeCo()">
  <div class="sheet">
    <div class="handle"></div>
    <h2 style="margin-bottom:14px;font-size:1.1rem">🛒 السلة</h2>
    <div id="ci"></div>
    <button class="btn-main" onclick="openOrder()">متابعة الطلب ←</button>
    <button class="btn-sec" onclick="closeCo()">متابعة التسوق</button>
  </div>
</div>

<!-- الطلب -->
<div class="overlay" id="oo" onclick="if(event.target===this)closeOo()">
  <div class="sheet">
    <div class="handle"></div>
    <div id="oc">
      <h2 style="margin-bottom:14px;font-size:1.1rem">📝 تفاصيل الطلب</h2>
      <input class="inp" id="cn" placeholder="اسمك الكريم *">
      <input class="inp" id="cp" placeholder="رقم هاتفك *" dir="ltr" type="tel">
      <input class="inp" id="ca" placeholder="عنوان التوصيل (اختياري)">
      <textarea class="inp" id="cno" placeholder="ملاحظات للبائع..." style="min-height:65px;resize:none"></textarea>
      <div id="os" style="margin:10px 0"></div>
      <button class="btn-main" id="sb" onclick="submitO()">✅ تأكيد الطلب</button>
      <button class="btn-sec" onclick="closeOo()">رجوع</button>
    </div>
  </div>
</div>

<script>
const UID=${parseInt(userId)},CUR=${JSON.stringify(cur)},PRODS=${prodsJson};
let cart=[],cat='',sq='';
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function sub(){return cart.reduce((s,c)=>s+c.price*c.qty,0);}
function render(){
  let p=PRODS;
  if(cat) p=p.filter(x=>x.category===cat);
  if(sq){const q=sq.toLowerCase();p=p.filter(x=>x.name.toLowerCase().includes(q)||x.description.toLowerCase().includes(q));}
  document.getElementById('grid-label').textContent=(cat?cat+' ':'جميع المنتجات ')+'('+p.length+')';
  if(!p.length){document.getElementById('grid').innerHTML='<div class="empty"><div style="font-size:2rem;margin-bottom:8px">🔍</div><div>لا توجد منتجات</div></div>';return;}
  document.getElementById('grid').innerHTML=p.map(function(x){
    var imgHtml=x.image_url?'<img src="'+esc(x.image_url)+'" loading="lazy" alt="'+esc(x.name)+'">'+'📦';
    var outBadge=x.stock===0?'<div class="out-badge">نفذ</div>':'';
    var stockWarn=x.stock>0&&x.stock<=5?'<div class="pstock">⚠️ آخر '+x.stock+' قطع</div>':'';
    return '<div class="card" onclick="addC('+x.id+')" title="'+esc(x.name)+'">'
      +'<div class="pimg">'+(x.image_url?'<img src="'+esc(x.image_url)+'" loading="lazy">'+'📦')+outBadge+'</div>'
      +'<div class="pinfo">'
      +'<div class="pname">'+esc(x.name)+'</div>'
      +'<div class="pprice">'+x.price.toFixed(0)+' '+esc(CUR)+'</div>'
      +stockWarn
      +'</div></div>';
  }).join('');
}
function fCat(c,btn){cat=c;document.querySelectorAll('.cat-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');render();}
function filt(){sq=document.getElementById('si').value.trim();render();}
function addC(id){
  const x=PRODS.find(p=>p.id===id);
  if(!x)return;
  if(x.stock===0){alert('عذراً، هذا المنتج نفذ من المخزون');return;}
  const e=cart.find(c=>c.id===id);
  if(e){if(e.qty>=x.stock){alert('وصلت للحد الأقصى المتاح');return;}e.qty++;}
  else cart.push({id:x.id,name:x.name,price:x.price,qty:1,stock:x.stock});
  updateF();
  // تأثير بصري
  const cards=document.querySelectorAll('.card');
  cards.forEach(c=>{if(c.onclick&&c.onclick.toString().includes(id)){c.style.borderColor='var(--c3)';setTimeout(()=>c.style.borderColor='',600);}});
}
function updateF(){
  const n=cart.reduce((s,c)=>s+c.qty,0);
  document.getElementById('cc').textContent=n;
  document.getElementById('ct').textContent=sub().toFixed(0);
  document.getElementById('cf').classList.toggle('show',n>0);
}
function openCart(){
  const el=document.getElementById('ci');
  if(!cart.length){el.innerHTML='<div style="text-align:center;padding:24px;color:rgba(255,255,255,.3)">السلة فارغة</div>';}
  else{
    el.innerHTML=cart.map(function(c){
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.07)">'
        +'<span style="font-size:.85rem;flex:1">'+esc(c.name)+'</span>'
        +'<div style="display:flex;align-items:center;gap:8px;flex-shrink:0">'
        +'<button onclick="chQ('+c.id+',-1)" style="width:28px;height:28px;border-radius:50%;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:#e2e8f5;cursor:pointer;font-size:.9rem">&#x2212;</button>'
        +'<span style="min-width:20px;text-align:center;font-weight:700">'+c.qty+'</span>'
        +'<button onclick="chQ('+c.id+',1)" style="width:28px;height:28px;border-radius:50%;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:#e2e8f5;cursor:pointer;font-size:.9rem">+</button>'
        +'<span style="color:var(--c1);font-weight:900;min-width:60px;text-align:left">'+(c.price*c.qty).toFixed(0)+'</span>'
        +'</div></div>';
    }).join('')
    +'<div style="display:flex;justify-content:space-between;font-weight:900;padding:12px 0;font-size:1rem"><span>المجموع</span><span style="color:var(--c1)">'+sub().toFixed(0)+' '+esc(CUR)+'</span></div>';
  }
  document.getElementById('co').classList.add('show');
  document.body.style.overflow='hidden';
}
function closeCo(){document.getElementById('co').classList.remove('show');document.body.style.overflow='';}
function chQ(id,d){
  const e=cart.find(c=>c.id===id);
  if(!e)return;
  e.qty=Math.max(0,e.qty+d);
  if(e.qty===0)cart=cart.filter(c=>c.id!==id);
  updateF();openCart();
}
function openOrder(){
  if(!cart.length)return;
  closeCo();
  const s=sub();
  const itemsHtml=cart.map(function(c){
    return '<div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:5px"><span>'+esc(c.name)+' \xD7'+c.qty+'</span><span style="color:var(--c1)">'+(c.price*c.qty).toFixed(0)+' '+esc(CUR)+'</span></div>';
  }).join('');
  document.getElementById('os').innerHTML='<div style="background:rgba(255,255,255,.04);border-radius:11px;padding:12px">'
    +itemsHtml
    +'<div style="display:flex;justify-content:space-between;font-weight:900;padding-top:9px;margin-top:6px;border-top:1px solid rgba(255,255,255,.08);font-size:.95rem"><span>الإجمالي</span><span style="color:var(--c1)">'+s.toFixed(0)+' '+esc(CUR)+'</span></div>'
    +'</div>';
  document.getElementById('oo').classList.add('show');
  document.body.style.overflow='hidden';
}
function closeOo(){document.getElementById('oo').classList.remove('show');document.body.style.overflow='';}
async function submitO(){
  const name=document.getElementById('cn').value.trim();
  const phone=document.getElementById('cp').value.trim();
  if(!name||!phone){alert('الاسم والهاتف مطلوبان');return;}
  if(!cart.length)return;
  const btn=document.getElementById('sb');
  btn.disabled=true;btn.textContent='⏳ جاري إرسال الطلب...';
  try{
    const r=await fetch('/api/marketplace/order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      store_user_id:UID,customer_name:name,customer_phone:phone,
      customer_address:document.getElementById('ca').value.trim(),
      notes:document.getElementById('cno').value.trim(),
      items:cart.map(c=>({description:c.name+' x'+c.qty,quantity:c.qty,price:c.price})),
      total:sub()
    })});
    const d=await r.json();
    if(d.success){
      document.getElementById('oc').innerHTML='<div style="text-align:center;padding:32px 16px">'
        +'<div style="font-size:3.5rem;margin-bottom:14px">&#x1F389;</div>'
        +'<div style="font-size:1.2rem;font-weight:900;margin-bottom:8px">تم استلام طلبك!</div>'
        +'<div style="color:rgba(255,255,255,.5);margin-bottom:6px">رقم الطلب</div>'
        +'<div style="font-size:1.8rem;font-weight:900;color:var(--c1);margin-bottom:20px">#'+(d.order&&d.order.id?d.order.id:'')+'</div>'
        +'<div style="color:rgba(255,255,255,.4);font-size:.82rem;margin-bottom:24px">سيتواصل معك البائع قريباً لتأكيد الطلب</div>'
        +'<button class="btn-main" onclick="closeOo();cart=[];updateF();render()">&#x1F6CD;&#xFE0F; متابعة التسوق</button>'
        +'</div>';
      cart=[];updateF();
    }else{alert(d.message||'حدث خطأ');btn.disabled=false;btn.textContent='✅ تأكيد الطلب';}
  }catch(e){alert('حدث خطأ في الاتصال');btn.disabled=false;btn.textContent='✅ تأكيد الطلب';}
}
render();
</script>
</body></html>`);
  } catch (e) { res.status(500).send('<h1>خطأ في الخادم</h1>'); }
});

app.post('/api/marketplace/order', async (req, res) => {
  const { store_user_id, customer_name, customer_phone, customer_address, items, total, notes } = req.body;
  if (!store_user_id || !customer_name || !customer_phone) return res.status(400).json({ success: false, message: 'البيانات ناقصة' });
  try {
    if (pool) {
      const r = await pool.query(
        'INSERT INTO orders (user_id,customer_name,customer_phone,customer_address,items,total,notes,platform) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [store_user_id, customer_name, customer_phone, customer_address||'', JSON.stringify(items||[]), total||0, notes||'', 'store']
      );
      await notify(store_user_id, '🛒 طلب جديد من المتجر!', `${customer_name} — ${total}`, 'order');
      return res.json({ success: true, order: r.rows[0] });
    }
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
};
