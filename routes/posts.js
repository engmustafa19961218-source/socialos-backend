module.exports = function(app, pool, helpers, cron) {
const { escapeHtml, sanitize, authenticateToken, rateLimit, notify, auditLog, esc } = helpers;

// ============================================================
// SOCIAL POSTS — نشر المنشورات
// ============================================================

// جلب المنشورات
// توليد محتوى منشور بالذكاء حسب نوع العمل
app.post('/api/posts/generate-content', authenticateToken, rateLimit(20, 60*1000), async (req, res) => {
  const { content_type, platform } = req.body;
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.json({ success: false, message: 'AI غير متاح' });
  try {
    let bp = {}, identity = {};
    if (pool) {
      const [bpR, idR] = await Promise.all([
        pool.query('SELECT store_name, business_type, business_desc, target_audience, communication_style FROM business_profile WHERE user_id=$1', [req.user.id]),
        pool.query('SELECT brand_voice FROM store_identity WHERE user_id=$1', [req.user.id]).catch(()=>({rows:[]}))
      ]);
      bp = bpR.rows[0] || {};
      identity = idR.rows[0] || {};
    }
    const typeLabels = {
      offer: 'عرض خاص أو تخفيض', new_product: 'إطلاق منتج أو خدمة جديدة',
      tips: 'نصيحة مفيدة مرتبطة بالنشاط', story: 'قصة عن العمل أو خلف الكواليس',
      engagement: 'منشور يشجع على التفاعل والتعليقات'
    };
    const platRules = {
      instagram: 'قصير وجذاب مع هاشتاقات (5-10) في النهاية، أقل من 300 كلمة',
      facebook: 'متوسط الطول مع دعوة للتفاعل، أقل من 400 كلمة',
      tiktok: 'قصير جداً لوصف فيديو، أقل من 150 كلمة مع هاشتاقات'
    };
    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 500,
        messages: [{ role: 'user', content:
`اكتب منشور "${typeLabels[content_type]||content_type}" لـ${platform} لهذا العمل.

المتجر: ${escapeHtml(bp.store_name||'متجرنا')}
نوع النشاط: ${escapeHtml(bp.business_type||'تجارة')}
وصف العمل: ${escapeHtml(bp.business_desc||'')}
الجمهور: ${escapeHtml(bp.target_audience||'الجميع')}
أسلوب التواصل: ${escapeHtml(bp.communication_style||identity.brand_voice||'ودي')}
قواعد المنصة: ${platRules[platform]||''}

أرجع نص المنشور فقط بدون أي مقدمة أو شرح.`
        }]
      })
    });
    const data = await aiRes.json();
    const content = data.choices?.[0]?.message?.content?.trim() || '';
    res.json({ success: true, content });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/posts', authenticateToken, async (req, res) => {
  const platform = req.query.platform;
  try {
    if (!pool) return res.json({ success: true, posts: [] });
    let q = 'SELECT * FROM social_posts WHERE user_id=$1';
    const params = [req.user.id];
    if (platform) { q += ' AND platform=$2'; params.push(platform); }
    q += ' ORDER BY created_at DESC LIMIT 50';
    const r = await pool.query(q, params);
    res.json({ success: true, posts: r.rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// إنشاء منشور / جدولة
app.post('/api/posts', authenticateToken, async (req, res) => {
  const { platform, content, media_url, media_type, scheduled_at } = req.body;
  const ALLOWED_PLATFORMS = ['instagram', 'facebook', 'tiktok'];
  if (!platform || !content) return res.status(400).json({ success: false, message: 'المنصة والمحتوى مطلوبان' });
  if (!ALLOWED_PLATFORMS.includes(platform)) return res.status(400).json({ success: false, message: 'منصة غير مدعومة' });
  if (String(content).length > 2200) return res.status(400).json({ success: false, message: 'المحتوى طويل جداً (2200 حرف كحد أقصى)' });
  if (media_url) { try { new URL(media_url); } catch { return res.status(400).json({ success: false, message: 'رابط الوسائط غير صالح' }); } }
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    // إذا طلب نشر فوري — نشر عبر API المنصة
    if (!scheduled_at) {
      const acc = await pool.query(
        'SELECT access_token, page_id FROM social_accounts WHERE user_id=$1 AND platform=$2 AND is_connected=true',
        [req.user.id, platform]
      );

      let externalId = '';
      if (acc.rows.length && acc.rows[0].access_token) {
        const { access_token, page_id } = acc.rows[0];
        try {
          if (platform === 'facebook' && page_id) {
            const fbRes = await fetch(`https://graph.facebook.com/v19.0/${page_id}/feed`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: String(content).substring(0, 2200), access_token })
            });
            const fbData = await fbRes.json();
            externalId = fbData.id || '';
          } else if (platform === 'instagram' && page_id) {
            // Instagram Graph API — نشر صورة
            if (media_url) {
              const containerRes = await fetch(`https://graph.facebook.com/v19.0/${page_id}/media`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_url: media_url, caption: String(content).substring(0, 2200), access_token })
              });
              const container = await containerRes.json();
              if (container.id) {
                const publishRes = await fetch(`https://graph.facebook.com/v19.0/${page_id}/media_publish`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ creation_id: container.id, access_token })
                });
                const pub = await publishRes.json();
                externalId = pub.id || '';
              }
            }
          }
        } catch (e) { console.error('Publish error:', e.message); }
      }

      const r = await pool.query(`
        INSERT INTO social_posts (user_id,platform,content,media_url,media_type,status,published_at,external_id)
        VALUES ($1,$2,$3,$4,$5,'published',NOW(),$6) RETURNING *
      `, [req.user.id, platform, escapeHtml(String(content)), media_url||'', media_type||'image', externalId]);
      await notify(req.user.id, '📱 تم النشر', `تم نشر منشور على ${platform}`, 'success');
      return res.json({ success: true, post: r.rows[0], published: !!externalId });
    }

    // جدولة المنشور
    const r = await pool.query(`
      INSERT INTO social_posts (user_id,platform,content,media_url,media_type,status,scheduled_at)
      VALUES ($1,$2,$3,$4,$5,'scheduled',$6) RETURNING *
    `, [req.user.id, platform, escapeHtml(String(content)), media_url||'', media_type||'image', scheduled_at]);
    res.json({ success: true, post: r.rows[0], scheduled: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// حذف منشور
app.delete('/api/posts/:id', authenticateToken, async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'ID غير صالح' });
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT user_id FROM social_posts WHERE id=$1', [id]);
    if (!r.rows.length || r.rows[0].user_id !== req.user.id) return res.status(403).json({ success: false, message: 'غير مصرح' });
    await pool.query('DELETE FROM social_posts WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
// ============================================================
// COMMENTS — تعليقات الصفحة
// ============================================================

app.get('/api/comments/posts', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const accR = await pool.query(
      "SELECT access_token, page_id FROM social_accounts WHERE user_id=$1 AND platform='facebook' AND is_connected=true",
      [req.user.id]
    );
    if (!accR.rows.length || !accR.rows[0].access_token)
      return res.status(400).json({ success: false, message: 'لم يتم ربط Facebook' });
    const { access_token, page_id } = accR.rows[0];
    if (!page_id) return res.status(400).json({ success: false, message: 'لم يتم ربط صفحة Facebook' });
    const fbRes = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(page_id)}/feed?fields=id,message,created_time,comments.summary(true)&limit=10&access_token=${encodeURIComponent(access_token)}`);
    const data = await fbRes.json();
    if (data.error) return res.status(400).json({ success: false, message: data.error.message });
    res.json({ success: true, posts: data.data || [] });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/comments/post/:postId', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const accR = await pool.query(
      "SELECT access_token FROM social_accounts WHERE user_id=$1 AND platform='facebook' AND is_connected=true",
      [req.user.id]
    );
    if (!accR.rows.length || !accR.rows[0].access_token)
      return res.status(400).json({ success: false, message: 'لم يتم ربط Facebook' });
    const { access_token } = accR.rows[0];
    const fbRes = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(req.params.postId)}/comments?fields=id,message,from,created_time,like_count&access_token=${encodeURIComponent(access_token)}`);
    const data = await fbRes.json();
    if (data.error) return res.status(400).json({ success: false, message: data.error.message });
    res.json({ success: true, comments: data.data || [] });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/comments/reply', authenticateToken, async (req, res) => {
  const { comment_id, message } = req.body;
  if (!comment_id || !message?.trim())
    return res.status(400).json({ success: false, message: 'comment_id والرسالة مطلوبان' });
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const accR = await pool.query(
      "SELECT access_token FROM social_accounts WHERE user_id=$1 AND platform='facebook' AND is_connected=true",
      [req.user.id]
    );
    if (!accR.rows.length || !accR.rows[0].access_token)
      return res.status(400).json({ success: false, message: 'لم يتم ربط Facebook' });
    const { access_token } = accR.rows[0];
    const fbRes = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(comment_id)}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message.trim(), access_token })
    });
    const data = await fbRes.json();
    if (data.error) return res.status(400).json({ success: false, message: data.error.message });
    res.json({ success: true, reply_id: data.id, message: 'تم الرد بنجاح' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/comments/:commentId', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const accR = await pool.query(
      "SELECT access_token FROM social_accounts WHERE user_id=$1 AND platform='facebook' AND is_connected=true",
      [req.user.id]
    );
    if (!accR.rows.length || !accR.rows[0].access_token)
      return res.status(400).json({ success: false, message: 'لم يتم ربط Facebook' });
    const { access_token } = accR.rows[0];
    const fbRes = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(req.params.commentId)}?access_token=${encodeURIComponent(access_token)}`, { method: 'DELETE' });
    const data = await fbRes.json();
    if (data.error) return res.status(400).json({ success: false, message: data.error.message });
    res.json({ success: true, message: 'تم حذف التعليق' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
// Cron — نشر المنشورات المجدولة
cron.schedule('*/5 * * * *', async () => {
  try {
    if (!pool) return;
    const posts = await pool.query(
      "SELECT sp.*, sa.access_token, sa.page_id FROM social_posts sp LEFT JOIN social_accounts sa ON sa.user_id=sp.user_id AND sa.platform=sp.platform AND sa.is_connected=true WHERE sp.status='scheduled' AND sp.scheduled_at<=NOW() LIMIT 10"
    );
    for (const post of posts.rows) {
      try {
        let externalId = '';
        if (post.access_token && post.page_id) {
          if (post.platform === 'facebook') {
            const res = await fetch(`https://graph.facebook.com/v19.0/${post.page_id}/feed`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: post.content, access_token: post.access_token })
            });
            const d = await res.json();
            externalId = d.id || '';
          }
        }
        await pool.query(
          "UPDATE social_posts SET status='published', published_at=NOW(), external_id=$2 WHERE id=$1",
          [post.id, externalId]
        );
        await notify(post.user_id, '📱 نُشر تلقائياً', `منشور ${post.platform} نُشر بنجاح`, 'success');
      } catch (e) {
        await pool.query("UPDATE social_posts SET status='failed' WHERE id=$1", [post.id]);
      }
    }
  } catch (e) { console.error('Post scheduler error:', e.message); }
});

// ============================================================
};
