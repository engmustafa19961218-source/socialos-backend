module.exports = function(app, pool, helpers) {
const { escapeHtml, sanitize, authenticateToken, rateLimit, notify, auditLog, esc } = helpers;

// ============================================================
// AD MANAGER — مدير الإعلانات (Meta + TikTok Ads API)
// ============================================================

// ─── Helper: جلب Ad Account من Meta ───
async function getMetaAdAccount(accessToken) {
  try {
    const r = await fetch(`https://graph.facebook.com/v19.0/me/adaccounts?fields=id,name,currency,account_status&access_token=${encodeURIComponent(accessToken)}`);
    const d = await r.json();
    return d.data?.[0] || null;
  } catch(e) { return null; }
}

// ─── Helper: جلب TikTok Advertiser ID ───
async function getTikTokAdvertiser(accessToken) {
  try {
    const r = await fetch('https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/', {
      headers: { 'Access-Token': accessToken }
    });
    const d = await r.json();
    return d.data?.list?.[0]?.advertiser_id || null;
  } catch(e) { return null; }
}

// جلب الحملات
app.get('/api/ads/campaigns', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.json({ success: true, campaigns: [] });
    const r = await pool.query(
      'SELECT * FROM ad_campaigns WHERE user_id=$1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json({ success: true, campaigns: r.rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// إنشاء وإطلاق حملة
app.post('/api/ads/campaigns', authenticateToken, async (req, res) => {
  const { name, platform, objective, budget, budget_type, start_date, end_date, target_audience, ad_content, launch_now } = req.body;
  const ALLOWED_PLATFORMS = ['facebook', 'instagram', 'tiktok', 'google'];
  if (!name || !platform) return res.status(400).json({ success: false, message: 'الاسم والمنصة مطلوبان' });
  if (!ALLOWED_PLATFORMS.includes(platform)) return res.status(400).json({ success: false, message: 'منصة غير مدعومة' });
  if (budget && parseFloat(budget) < 0) return res.status(400).json({ success: false, message: 'الميزانية غير صالحة' });

  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    let external_id = '';
    let launch_status = 'draft';
    let launch_message = '';
    let launch_error = null;

    // ─── إطلاق فعلي إذا طُلب ───
    if (launch_now) {
      if (platform === 'facebook' || platform === 'instagram') {
        const META_KEY = process.env.META_ADS_TOKEN; // توكن Ads خاص بالمستخدم
        // محاولة جلب توكن من قاعدة البيانات
        const accR = await pool.query(
          'SELECT access_token FROM social_accounts WHERE user_id=$1 AND platform=$2 AND is_connected=true',
          [req.user.id, 'facebook']
        );
        const token = META_KEY || accR.rows[0]?.access_token;

        if (token) {
          try {
            const adAccount = await getMetaAdAccount(token);
            if (adAccount) {
              const adAccountId = adAccount.id;

              // 1. إنشاء Campaign
              const campRes = await fetch(`https://graph.facebook.com/v19.0/${adAccountId}/campaigns`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name: escapeHtml(name),
                  objective: metaObjectiveMap(objective),
                  status: 'PAUSED', // نبدأ متوقفة حتى يراجعها المستخدم
                  special_ad_categories: [],
                  access_token: token
                })
              });
              const campData = await campRes.json();

              if (campData.id) {
                external_id = campData.id;
                launch_status = 'paused';
                launch_message = `✅ تم إنشاء الحملة على Meta (ID: ${campData.id}) — بحالة متوقفة لمراجعتك`;

                // 2. إنشاء Ad Set
                const adSetRes = await fetch(`https://graph.facebook.com/v19.0/${adAccountId}/adsets`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name: `${name} — Ad Set`,
                    campaign_id: campData.id,
                    daily_budget: Math.round((parseFloat(budget)||10) * 100), // بالسنت
                    billing_event: 'IMPRESSIONS',
                    optimization_goal: 'REACH',
                    targeting: buildMetaTargeting(target_audience),
                    status: 'PAUSED',
                    start_time: start_date || new Date().toISOString(),
                    access_token: token
                  })
                });
                const adSetData = await adSetRes.json();
                if (adSetData.error) launch_message += ` | تحذير Ad Set: ${adSetData.error.message}`;
              } else {
                launch_error = campData.error?.message || 'فشل إنشاء الحملة على Meta';
              }
            } else {
              launch_error = 'لم يتم العثور على Ad Account — تأكد من ربط حساب Meta Business';
            }
          } catch(e) {
            launch_error = 'خطأ في الاتصال بـ Meta API: ' + e.message;
          }
        } else {
          launch_error = 'لا يوجد Meta Access Token — اربط حسابك من صفحة ربط الحسابات';
        }
      }

      else if (platform === 'tiktok') {
        const accR = await pool.query(
          'SELECT access_token FROM social_accounts WHERE user_id=$1 AND platform=$2 AND is_connected=true',
          [req.user.id, 'tiktok']
        );
        const token = accR.rows[0]?.access_token;

        if (token) {
          try {
            const advertiserId = await getTikTokAdvertiser(token);
            if (advertiserId) {
              const campRes = await fetch('https://business-api.tiktok.com/open_api/v1.3/campaign/create/', {
                method: 'POST',
                headers: { 'Access-Token': token, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  advertiser_id: advertiserId,
                  campaign_name: escapeHtml(name),
                  objective_type: tiktokObjectiveMap(objective),
                  budget_mode: 'BUDGET_MODE_DAY',
                  budget: parseFloat(budget) || 10,
                  operation_status: 'DISABLE' // متوقفة للمراجعة
                })
              });
              const campData = await campRes.json();
              if (campData.data?.campaign_id) {
                external_id = campData.data.campaign_id;
                launch_status = 'paused';
                launch_message = `✅ تم إنشاء الحملة على TikTok (ID: ${campData.data.campaign_id}) — بحالة متوقفة لمراجعتك`;
              } else {
                launch_error = campData.message || 'فشل إنشاء الحملة على TikTok';
              }
            } else {
              launch_error = 'لم يتم العثور على Advertiser ID — تأكد من حساب TikTok for Business';
            }
          } catch(e) {
            launch_error = 'خطأ في الاتصال بـ TikTok API: ' + e.message;
          }
        } else {
          launch_error = 'لا يوجد TikTok Access Token — اربط حسابك من صفحة ربط الحسابات';
        }
      }
    }

    // حفظ في قاعدة البيانات
    const r = await pool.query(`
      INSERT INTO ad_campaigns (user_id,name,platform,objective,budget,budget_type,start_date,end_date,target_audience,ad_content,external_id,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *
    `, [req.user.id, escapeHtml(name), platform, objective||'awareness',
        parseFloat(budget)||0, budget_type||'daily',
        start_date||null, end_date||null,
        JSON.stringify(target_audience||{}), JSON.stringify(ad_content||{}),
        external_id, launch_status]);

    await auditLog(req.user.id, 'create_campaign', 'ad_campaigns', r.rows[0].id, `${name} [${platform}]`, req.ip);
    if (launch_status !== 'draft') await notify(req.user.id, '📣 حملة جديدة', launch_message || `تم إنشاء: ${name}`, 'success');

    res.json({
      success: true,
      campaign: r.rows[0],
      launched: launch_status !== 'draft',
      launch_message,
      launch_error
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ─── تفعيل/إيقاف حملة على المنصة ───
app.put('/api/ads/campaigns/:id/toggle', authenticateToken, async (req, res) => {
  const { action } = req.body; // 'activate' | 'pause'
  const id = parseInt(req.params.id);
  if (!id || !['activate','pause'].includes(action))
    return res.status(400).json({ success: false, message: 'بيانات غير صالحة' });
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT * FROM ad_campaigns WHERE id=$1 AND user_id=$2', [id, req.user.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'الحملة غير موجودة' });
    const camp = r.rows[0];
    const newStatus = action === 'activate' ? 'active' : 'paused';
    let apiResult = null;

    // تفعيل/إيقاف على المنصة إذا كان external_id موجوداً
    if (camp.external_id) {
      const accR = await pool.query(
        'SELECT access_token FROM social_accounts WHERE user_id=$1 AND platform=$2 AND is_connected=true',
        [req.user.id, camp.platform === 'instagram' ? 'facebook' : camp.platform]
      );
      const token = accR.rows[0]?.access_token;

      if (token && (camp.platform === 'facebook' || camp.platform === 'instagram')) {
        const status = action === 'activate' ? 'ACTIVE' : 'PAUSED';
        const toggleRes = await fetch(`https://graph.facebook.com/v19.0/${camp.external_id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, access_token: token })
        });
        apiResult = await toggleRes.json();
      } else if (token && camp.platform === 'tiktok') {
        const advertiserId = await getTikTokAdvertiser(token);
        if (advertiserId) {
          const status = action === 'activate' ? 'ENABLE' : 'DISABLE';
          await fetch('https://business-api.tiktok.com/open_api/v1.3/campaign/status/update/', {
            method: 'POST',
            headers: { 'Access-Token': token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ advertiser_id: advertiserId, campaign_ids: [camp.external_id], operation_status: status })
          });
        }
      }
    }

    await pool.query('UPDATE ad_campaigns SET status=$1,updated_at=NOW() WHERE id=$2', [newStatus, id]);
    res.json({ success: true, status: newStatus, api_result: apiResult });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ─── جلب نتائج حملة من Meta ───
app.get('/api/ads/campaigns/:id/insights', authenticateToken, async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT * FROM ad_campaigns WHERE id=$1 AND user_id=$2', [id, req.user.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'الحملة غير موجودة' });
    const camp = r.rows[0];
    if (!camp.external_id) return res.json({ success: false, message: 'الحملة لم تُطلق على المنصة بعد' });

    const accR = await pool.query(
      'SELECT access_token FROM social_accounts WHERE user_id=$1 AND platform=$2 AND is_connected=true',
      [req.user.id, camp.platform === 'instagram' ? 'facebook' : camp.platform]
    );
    const token = accR.rows[0]?.access_token;
    if (!token) return res.json({ success: false, message: 'لا يوجد Access Token' });

    if (camp.platform === 'facebook' || camp.platform === 'instagram') {
      const insightsRes = await fetch(
        `https://graph.facebook.com/v19.0/${camp.external_id}/insights?fields=impressions,clicks,spend,reach,cpc,cpm,actions&date_preset=last_30_days&access_token=${encodeURIComponent(token)}`
      );
      const insights = await insightsRes.json();
      const data = insights.data?.[0] || {};

      // تحديث قاعدة البيانات
      await pool.query(`UPDATE ad_campaigns SET
        impressions=$1, clicks=$2, spend=$3, results=$4, updated_at=NOW()
        WHERE id=$5`,
        [parseInt(data.impressions||0), parseInt(data.clicks||0),
         parseFloat(data.spend||0), JSON.stringify(data), id]);

      return res.json({ success: true, insights: data, platform: 'meta' });
    }

    if (camp.platform === 'tiktok') {
      const advertiserId = await getTikTokAdvertiser(token);
      if (advertiserId) {
        const insightsRes = await fetch(
          `https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/?advertiser_id=${advertiserId}&report_type=CAMPAIGN&dimensions=["campaign_id"]&metrics=["impressions","clicks","spend","reach"]&data_level=AUCTION_CAMPAIGN&campaign_ids=["${camp.external_id}"]&start_date=${new Date(Date.now()-30*86400000).toISOString().split('T')[0]}&end_date=${new Date().toISOString().split('T')[0]}`,
          { headers: { 'Access-Token': token } }
        );
        const data = await insightsRes.json();
        const metrics = data.data?.list?.[0]?.metrics || {};
        await pool.query(`UPDATE ad_campaigns SET impressions=$1,clicks=$2,spend=$3,updated_at=NOW() WHERE id=$4`,
          [parseInt(metrics.impressions||0), parseInt(metrics.clicks||0), parseFloat(metrics.spend||0), id]);
        return res.json({ success: true, insights: metrics, platform: 'tiktok' });
      }
    }

    res.json({ success: false, message: 'منصة غير مدعومة' });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// تحديث حملة
app.put('/api/ads/campaigns/:id', authenticateToken, async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'ID غير صالح' });
  const { name, status, budget, start_date, end_date, target_audience, ad_content, results, spend, impressions, clicks, conversions } = req.body;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT user_id FROM ad_campaigns WHERE id=$1', [id]);
    if (!r.rows.length || r.rows[0].user_id !== req.user.id) return res.status(403).json({ success: false, message: 'غير مصرح' });
    await pool.query(`UPDATE ad_campaigns SET
        name=COALESCE($2,name), status=COALESCE($3,status),
        budget=COALESCE($4,budget), start_date=COALESCE($5,start_date),
        end_date=COALESCE($6,end_date),
        target_audience=COALESCE($7,target_audience),
        ad_content=COALESCE($8,ad_content),
        results=COALESCE($9,results),
        spend=COALESCE($10,spend), impressions=COALESCE($11,impressions),
        clicks=COALESCE($12,clicks), conversions=COALESCE($13,conversions),
        updated_at=NOW() WHERE id=$1`,
      [id, name?escapeHtml(name):null, status||null,
       budget?parseFloat(budget):null, start_date||null, end_date||null,
       target_audience?JSON.stringify(target_audience):null,
       ad_content?JSON.stringify(ad_content):null,
       results?JSON.stringify(results):null,
       spend?parseFloat(spend):null, impressions?parseInt(impressions):null,
       clicks?parseInt(clicks):null, conversions?parseInt(conversions):null]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// حذف حملة
app.delete('/api/ads/campaigns/:id', authenticateToken, async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'ID غير صالح' });
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT user_id FROM ad_campaigns WHERE id=$1', [id]);
    if (!r.rows.length || r.rows[0].user_id !== req.user.id) return res.status(403).json({ success: false, message: 'غير مصرح' });
    await pool.query('DELETE FROM ad_campaigns WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// اقتراح حملة بالذكاء الاصطناعي
app.post('/api/ads/suggest', authenticateToken, async (req, res) => {
  const { goal, budget, platform, product_desc, target } = req.body;
  if (!goal) return res.status(400).json({ success: false, message: 'الهدف مطلوب' });
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(503).json({ success: false, message: 'AI غير متاح' });
  try {
    let biz = {};
    if (pool) {
      const bp = await pool.query('SELECT store_name, business_type, business_desc, target_audience FROM business_profile WHERE user_id=$1', [req.user.id]);
      biz = bp.rows[0] || {};
    }
    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 900,
        messages: [{
          role: 'user',
          content: `أنت خبير إعلانات رقمية عربي متخصص في Meta وTikTok. اقترح حملة إعلانية متكاملة جاهزة للإطلاق.
المتجر: ${escapeHtml(biz.store_name||'')} — ${escapeHtml(biz.business_type||'')}
الهدف: ${escapeHtml(goal)}
الميزانية: ${escapeHtml(String(budget||'غير محددة'))} دولار يومياً
المنصة: ${escapeHtml(platform||'غير محددة')}
المنتج: ${escapeHtml(product_desc||'')}
الجمهور: ${escapeHtml(target||biz.target_audience||'')}

أرجع JSON فقط:
{"campaign_name":"اسم الحملة","objective":"awareness|traffic|engagement|leads|sales","target_audience":{"age_min":18,"age_max":45,"interests":["اهتمام1","اهتمام2"],"location":"العراق","gender":"all"},"ad_copies":[{"title":"عنوان1","body":"نص1","cta":"تسوق الآن","image_desc":"وصف الصورة المثالية"}],"budget_suggestion":{"daily":10,"total":300},"schedule":{"duration_days":30,"best_times":["20:00","22:00"]},"retargeting":{"enabled":true,"audience":"زوار الموقع + عملاء سابقون"},"tips":["نصيحة1","نصيحة2","نصيحة3"]}`
        }]
      })
    });
    const aiData = await aiRes.json();
    let result = aiData.choices?.[0]?.message?.content || '';
    try { result = JSON.parse(result.replace(/```json|```/g, '').trim()); } catch (e) { result = { tips: [result] }; }
    res.json({ success: true, suggestion: result });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// RETARGETING — إعادة الاستهداف
// ============================================================

// جلب جماهير إعادة الاستهداف
app.get('/api/ads/retargeting/audiences', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (!pool) return res.json({ success: true, audiences: [] });

    // بناء جماهير من بيانات العملاء
    const [allCustomers, recentBuyers, highValue, abandoned, loyal] = await Promise.all([
      pool.query('SELECT COUNT(*) as cnt, ARRAY_AGG(DISTINCT customer_phone) as phones FROM orders WHERE user_id=$1', [userId]),
      pool.query(`SELECT COUNT(DISTINCT customer_phone) as cnt FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '30 days'`, [userId]),
      pool.query(`SELECT COUNT(DISTINCT customer_phone) as cnt FROM orders WHERE user_id=$1 AND total >= (SELECT AVG(total)*1.5 FROM orders WHERE user_id=$1)`, [userId]),
      pool.query(`SELECT COUNT(*) as cnt FROM orders WHERE user_id=$1 AND status='cancelled'`, [userId]),
      pool.query('SELECT COUNT(*) as cnt FROM loyalty_points WHERE user_id=$1 AND points>0', [userId])
    ]);

    const audiences = [
      {
        id: 'all_customers',
        name: 'كل العملاء',
        icon: '👥',
        size: parseInt(allCustomers.rows[0]?.cnt || 0),
        desc: 'جميع من أجروا طلباً',
        type: 'customer_list',
        use_case: 'استهدافهم بعروض ومنتجات جديدة'
      },
      {
        id: 'recent_buyers',
        name: 'المشترون مؤخراً',
        icon: '🔥',
        size: parseInt(recentBuyers.rows[0]?.cnt || 0),
        desc: 'اشتروا في آخر 30 يوم',
        type: 'recent',
        use_case: 'بيع منتجات تكميلية (Upsell)'
      },
      {
        id: 'high_value',
        name: 'العملاء ذوو القيمة العالية',
        icon: '💎',
        size: parseInt(highValue.rows[0]?.cnt || 0),
        desc: 'طلباتهم فوق المتوسط',
        type: 'high_value',
        use_case: 'استهدافهم بمنتجات premium'
      },
      {
        id: 'cancelled',
        name: 'الطلبات الملغاة',
        icon: '↩️',
        size: parseInt(abandoned.rows[0]?.cnt || 0),
        desc: 'ألغوا طلباتهم',
        type: 'cancelled',
        use_case: 'استرجاعهم بعرض خاص'
      },
      {
        id: 'loyal',
        name: 'العملاء المخلصون',
        icon: '⭐',
        size: parseInt(loyal.rows[0]?.cnt || 0),
        desc: 'لديهم نقاط ولاء',
        type: 'loyal',
        use_case: 'استهدافهم بعروض حصرية'
      }
    ];

    res.json({ success: true, audiences });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// إطلاق حملة إعادة استهداف
app.post('/api/ads/retargeting/launch', authenticateToken, async (req, res) => {
  const { audience_id, platform, ad_copy, budget, offer } = req.body;
  if (!audience_id || !platform) return res.status(400).json({ success: false, message: 'البيانات ناقصة' });
  const userId = req.user.id;

  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    // جلب قائمة الهواتف حسب الجمهور
    let phones = [];
    const audienceQueries = {
      all_customers:  `SELECT DISTINCT customer_phone FROM orders WHERE user_id=$1`,
      recent_buyers:  `SELECT DISTINCT customer_phone FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '30 days'`,
      high_value:     `SELECT DISTINCT customer_phone FROM orders WHERE user_id=$1 AND total>=(SELECT AVG(total)*1.5 FROM orders WHERE user_id=$1)`,
      cancelled:      `SELECT DISTINCT customer_phone FROM orders WHERE user_id=$1 AND status='cancelled'`,
      loyal:          `SELECT DISTINCT lp.customer_phone FROM loyalty_points lp WHERE lp.user_id=$1 AND lp.points>0`
    };
    const q = audienceQueries[audience_id];
    if (q) {
      const r = await pool.query(q, [userId]);
      phones = r.rows.map(row => row.customer_phone.replace(/[^0-9]/g,''));
    }

    let external_id = '';
    let launch_status = 'draft';
    let launch_message = '';

    // محاولة رفع Custom Audience على Meta
    if ((platform === 'facebook' || platform === 'instagram') && phones.length > 0) {
      const accR = await pool.query(
        'SELECT access_token FROM social_accounts WHERE user_id=$1 AND platform=$2 AND is_connected=true',
        [userId, 'facebook']
      );
      const token = accR.rows[0]?.access_token;

      if (token) {
        try {
          const adAccount = await getMetaAdAccount(token);
          if (adAccount) {
            // إنشاء Custom Audience
            const audRes = await fetch(`https://graph.facebook.com/v19.0/${adAccount.id}/customaudiences`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: `SocialOS Retargeting — ${audience_id} — ${new Date().toLocaleDateString('ar')}`,
                subtype: 'CUSTOM',
                description: `إعادة استهداف: ${audience_id}`,
                customer_file_source: 'USER_PROVIDED_ONLY',
                access_token: token
              })
            });
            const audData = await audRes.json();

            if (audData.id) {
              // رفع الأرقام المشفّرة
              const crypto = require('crypto');
              const hashedPhones = phones.slice(0,1000).map(p => {
                const normalized = p.startsWith('0') ? '964' + p.slice(1) : p;
                return crypto.createHash('sha256').update(normalized).digest('hex');
              });

              await fetch(`https://graph.facebook.com/v19.0/${audData.id}/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  payload: { schema: ['PHONE'], data: hashedPhones.map(h => [h]) },
                  access_token: token
                })
              });

              external_id = audData.id;
              launch_status = 'active';
              launch_message = `✅ تم رفع ${Math.min(phones.length,1000)} رقم هاتف كـ Custom Audience على Meta (ID: ${audData.id})`;
            }
          }
        } catch(e) {
          launch_message = `⚠️ تم حفظ الجمهور محلياً — ${e.message}`;
        }
      } else {
        launch_message = `⚠️ اربط حساب Meta لرفع الجمهور مباشرة`;
      }
    }

    // حفظ حملة retargeting
    const campName = `إعادة استهداف — ${audience_id} — ${platform}`;
    const r = await pool.query(`
      INSERT INTO ad_campaigns (user_id,name,platform,objective,budget,status,external_id,ad_content,target_audience)
      VALUES ($1,$2,$3,'retargeting',$4,$5,$6,$7,$8) RETURNING *
    `, [userId, campName, platform, parseFloat(budget)||5, launch_status, external_id,
        JSON.stringify({ copy: ad_copy, offer }),
        JSON.stringify({ type: audience_id, size: phones.length })]);

    // إنشاء رسائل واتساب للجمهور (fallback)
    const waLinks = phones.slice(0,50).map(phone => {
      const waPhone = phone.startsWith('0') ? '964' + phone.slice(1) : phone;
      const msg = offer || ad_copy || 'لدينا عرض خاص لك! 🎁';
      return { phone: waPhone, url: `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}` };
    });

    await notify(userId, '🎯 إعادة استهداف', launch_message || campName, 'success');
    res.json({
      success: true,
      campaign: r.rows[0],
      audience_size: phones.length,
      launch_message: launch_message || `تم إنشاء حملة إعادة الاستهداف (${phones.length} عميل)`,
      wa_links: waLinks,
      external_id
    });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ─── Helpers: تحويل أهداف الحملات ───
function metaObjectiveMap(obj) {
  const map = { awareness:'BRAND_AWARENESS', traffic:'LINK_CLICKS', engagement:'POST_ENGAGEMENT', leads:'LEAD_GENERATION', sales:'CONVERSIONS', retargeting:'CONVERSIONS' };
  return map[obj] || 'BRAND_AWARENESS';
}
function tiktokObjectiveMap(obj) {
  const map = { awareness:'REACH', traffic:'TRAFFIC', engagement:'VIDEO_VIEWS', leads:'LEAD_GENERATION', sales:'CONVERSIONS', retargeting:'CONVERSIONS' };
  return map[obj] || 'REACH';
}
function buildMetaTargeting(audience) {
  const ta = audience || {};
  return {
    age_min: ta.age_min || 18,
    age_max: ta.age_max || 55,
    geo_locations: { countries: ta.countries || ['IQ', 'SA', 'AE'] },
    interests: (ta.interests||[]).map(i => ({ name: i })).slice(0,10),
    genders: ta.gender === 'male' ? [1] : ta.gender === 'female' ? [2] : [1,2]
  };
}

// ============================================================
// SOCIAL POSTS — نشر المنشورات
// ============================================================

};
