module.exports = function(app, pool, helpers) {
const { escapeHtml, sanitize, authenticateToken, rateLimit, notify, auditLog, esc } = helpers;

// ============================================================
// SOCIAL ACCOUNTS — ربط حسابات التواصل الاجتماعي
// ============================================================

// جلب جميع الحسابات المربوطة
app.get('/api/social/accounts', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.json({ success: true, accounts: [] });
    const r = await pool.query(
      `SELECT id, platform, account_name, account_username, avatar_url,
              page_id, page_name, whatsapp_phone_id, whatsapp_business_id,
              is_connected, scopes, connected_at, updated_at
       FROM social_accounts WHERE user_id=$1 ORDER BY connected_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, accounts: r.rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ربط حساب يدوياً (Meta/TikTok/WhatsApp)
app.post('/api/social/connect', authenticateToken, async (req, res) => {
  const {
    platform, access_token, account_id, account_name, account_username,
    avatar_url, page_id, page_name, whatsapp_phone_id, whatsapp_business_id,
    scopes, extra_data
  } = req.body;

  const ALLOWED_PLATFORMS = ['instagram', 'facebook', 'tiktok', 'whatsapp'];
  if (!platform || !ALLOWED_PLATFORMS.includes(platform))
    return res.status(400).json({ success: false, message: 'المنصة غير مدعومة' });
  if (!access_token)
    return res.status(400).json({ success: false, message: 'access_token مطلوب' });

  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    // التحقق من صحة التوكن حسب المنصة
    let verifiedData = {};
    if (platform === 'facebook' || platform === 'instagram') {
      try {
        const verifyRes = await fetch(
          `https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${encodeURIComponent(access_token)}`
        );
        const vd = await verifyRes.json();
        if (vd.error) return res.status(401).json({ success: false, message: `التوكن غير صالح: ${vd.error.message}` });
        verifiedData = { account_id: vd.id || account_id, account_name: vd.name || account_name };
      } catch (e) { /* نكمل حتى لو التحقق فشل */ }
    }

    if (platform === 'tiktok') {
      try {
        const verifyRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url', {
          headers: { 'Authorization': `Bearer ${access_token}` }
        });
        const vd = await verifyRes.json();
        if (vd.data?.user) {
          verifiedData = {
            account_id: vd.data.user.open_id || account_id,
            account_name: vd.data.user.display_name || account_name,
            avatar_url: vd.data.user.avatar_url || avatar_url
          };
        }
      } catch (e) {}
    }

    const finalData = { ...{ account_id, account_name, account_username, avatar_url }, ...verifiedData };

    await pool.query(`
      INSERT INTO social_accounts
        (user_id, platform, account_id, account_name, account_username, avatar_url,
         access_token, page_id, page_name, whatsapp_phone_id, whatsapp_business_id,
         is_connected, scopes, extra_data, connected_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12,$13,NOW(),NOW())
      ON CONFLICT (user_id, platform) DO UPDATE SET
        account_id=$3, account_name=$4, account_username=$5, avatar_url=$6,
        access_token=$7, page_id=$8, page_name=$9,
        whatsapp_phone_id=$10, whatsapp_business_id=$11,
        is_connected=true, scopes=$12, extra_data=$13, updated_at=NOW()
    `, [
      req.user.id, platform,
      finalData.account_id || '', finalData.account_name || '', account_username || '', finalData.avatar_url || '',
      access_token,
      page_id || '', page_name || '', whatsapp_phone_id || '', whatsapp_business_id || '',
      JSON.stringify(scopes || []), JSON.stringify(extra_data || {})
    ]);

    await auditLog(req.user.id, 'connect_social', 'social_accounts', null, `ربط ${platform}`, req.ip);
    await notify(req.user.id, '🔗 ربط حساب', `تم ربط حساب ${platform} بنجاح`, 'success');
    res.json({ success: true, message: `تم ربط ${platform} بنجاح` });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// فك ربط حساب
app.delete('/api/social/disconnect/:platform', authenticateToken, async (req, res) => {
  const { platform } = req.params;
  const ALLOWED_PLATFORMS = ['instagram', 'facebook', 'tiktok', 'whatsapp'];
  if (!ALLOWED_PLATFORMS.includes(platform))
    return res.status(400).json({ success: false, message: 'المنصة غير مدعومة' });
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    await pool.query(
      'UPDATE social_accounts SET is_connected=false, access_token=\'\', updated_at=NOW() WHERE user_id=$1 AND platform=$2',
      [req.user.id, platform]
    );
    await auditLog(req.user.id, 'disconnect_social', 'social_accounts', null, `فك ربط ${platform}`, req.ip);
    res.json({ success: true, message: `تم فك ربط ${platform}` });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// تحديث إعدادات حساب موجود
app.put('/api/social/accounts/:platform', authenticateToken, async (req, res) => {
  const { platform } = req.params;
  const ALLOWED_PLATFORMS = ['instagram', 'facebook', 'tiktok', 'whatsapp'];
  if (!ALLOWED_PLATFORMS.includes(platform))
    return res.status(400).json({ success: false, message: 'المنصة غير مدعومة' });
  const { page_id, page_name, whatsapp_phone_id, whatsapp_business_id, extra_data } = req.body;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    await pool.query(`
      UPDATE social_accounts SET
        page_id=COALESCE($3, page_id),
        page_name=COALESCE($4, page_name),
        whatsapp_phone_id=COALESCE($5, whatsapp_phone_id),
        whatsapp_business_id=COALESCE($6, whatsapp_business_id),
        extra_data=COALESCE($7, extra_data),
        updated_at=NOW()
      WHERE user_id=$1 AND platform=$2
    `, [req.user.id, platform, page_id, page_name, whatsapp_phone_id, whatsapp_business_id,
        extra_data ? JSON.stringify(extra_data) : null]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// META OAuth — Facebook & Instagram
// ============================================================

// الخطوة 1: توليد رابط OAuth
app.get('/api/social/meta/auth-url', authenticateToken, (req, res) => {
  const clientId = process.env.META_APP_ID;
  if (!clientId) return res.status(503).json({ success: false, message: 'META_APP_ID غير مضبوط' });
  const redirectUri = `${process.env.APP_URL || 'https://socialos-production-4aa6.up.railway.app'}/api/social/meta/callback`;
  const scopes = [
    'pages_show_list', 'pages_read_engagement', 'pages_manage_posts',
    'instagram_basic', 'instagram_content_publish', 'business_management'
  ].join(',');
  const state = Buffer.from(JSON.stringify({ userId: req.user.id, ts: Date.now() })).toString('base64');
  const url = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&state=${encodeURIComponent(state)}&response_type=code`;
  res.json({ success: true, url });
});

// الخطوة 2: OAuth Callback من Meta
app.get('/api/social/meta/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect(`/?social_error=${encodeURIComponent(error)}`);
  if (!code) return res.redirect('/?social_error=no_code');

  let userId;
  try {
    const s = JSON.parse(Buffer.from(state, 'base64').toString());
    userId = s.userId;
    if (!userId) throw new Error('userId missing');
  } catch (e) { return res.redirect('/?social_error=invalid_state'); }

  const clientId = process.env.META_APP_ID;
  const clientSecret = process.env.META_APP_SECRET;
  const redirectUri = `${process.env.APP_URL || 'https://socialos-production-4aa6.up.railway.app'}/api/social/meta/callback`;

  try {
    // استبدال الكود بتوكن
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${clientSecret}&code=${code}`
    );
    const tokenData = await tokenRes.json();
    if (tokenData.error) return res.redirect(`/?social_error=${encodeURIComponent(tokenData.error.message)}`);

    const accessToken = tokenData.access_token;

    // جلب بيانات المستخدم
    const meRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name,picture&access_token=${accessToken}`);
    const me = await meRes.json();

    // جلب الصفحات
    const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${accessToken}`);
    const pages = await pagesRes.json();
    const firstPage = pages.data?.[0];

    if (pool) {
      // حفظ Facebook
      await pool.query(`
        INSERT INTO social_accounts (user_id,platform,account_id,account_name,avatar_url,access_token,page_id,page_name,is_connected,connected_at,updated_at)
        VALUES ($1,'facebook',$2,$3,$4,$5,$6,$7,true,NOW(),NOW())
        ON CONFLICT(user_id,platform) DO UPDATE SET
          account_id=$2,account_name=$3,avatar_url=$4,access_token=$5,
          page_id=$6,page_name=$7,is_connected=true,updated_at=NOW()
      `, [userId, me.id||'', me.name||'', me.picture?.data?.url||'', accessToken,
          firstPage?.id||'', firstPage?.name||'']);

      // محاولة جلب حساب Instagram المرتبط
      if (firstPage) {
        try {
          const igRes = await fetch(
            `https://graph.facebook.com/v19.0/${firstPage.id}?fields=instagram_business_account&access_token=${firstPage.access_token || accessToken}`
          );
          const igData = await igRes.json();
          const igId = igData.instagram_business_account?.id;
          if (igId) {
            const igProfile = await fetch(
              `https://graph.facebook.com/v19.0/${igId}?fields=name,username,profile_picture_url&access_token=${accessToken}`
            ).then(r => r.json());
            await pool.query(`
              INSERT INTO social_accounts (user_id,platform,account_id,account_name,account_username,avatar_url,access_token,is_connected,connected_at,updated_at)
              VALUES ($1,'instagram',$2,$3,$4,$5,$6,true,NOW(),NOW())
              ON CONFLICT(user_id,platform) DO UPDATE SET
                account_id=$2,account_name=$3,account_username=$4,avatar_url=$5,
                access_token=$6,is_connected=true,updated_at=NOW()
            `, [userId, igId, igProfile.name||'', igProfile.username||'', igProfile.profile_picture_url||'', accessToken]);
          }
        } catch (e) {}
      }

      await notify(userId, '🔗 ربط Meta', 'تم ربط Facebook وInstagram بنجاح', 'success');
    }

    res.redirect('/?social_connected=facebook');
  } catch (e) {
    res.redirect(`/?social_error=${encodeURIComponent(e.message)}`);
  }
});

// ============================================================
// TikTok OAuth
// ============================================================

app.get('/api/social/tiktok/auth-url', authenticateToken, (req, res) => {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  if (!clientKey) return res.status(503).json({ success: false, message: 'TIKTOK_CLIENT_KEY غير مضبوط' });
  const redirectUri = `${process.env.APP_URL || 'https://socialos-production-4aa6.up.railway.app'}/api/social/tiktok/callback`;
  const scopes = 'user.info.basic,video.list,video.upload';
  const state = Buffer.from(JSON.stringify({ userId: req.user.id, ts: Date.now() })).toString('base64');
  const url = `https://www.tiktok.com/v2/auth/authorize?client_key=${clientKey}&scope=${scopes}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
  res.json({ success: true, url });
});

app.get('/api/social/tiktok/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error || !code) return res.redirect(`/?social_error=${encodeURIComponent(error || 'no_code')}`);

  let userId;
  try {
    const s = JSON.parse(Buffer.from(state, 'base64').toString());
    userId = s.userId;
  } catch (e) { return res.redirect('/?social_error=invalid_state'); }

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  const redirectUri = `${process.env.APP_URL || 'https://socialos-production-4aa6.up.railway.app'}/api/social/tiktok/callback`;

  try {
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri })
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) return res.redirect(`/?social_error=${encodeURIComponent(tokenData.error_description || tokenData.error)}`);

    const accessToken = tokenData.access_token;
    const openId = tokenData.open_id;

    const profileRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url,follower_count', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const profileData = await profileRes.json();
    const profile = profileData.data?.user || {};

    if (pool) {
      await pool.query(`
        INSERT INTO social_accounts (user_id,platform,account_id,account_name,avatar_url,access_token,is_connected,connected_at,updated_at)
        VALUES ($1,'tiktok',$2,$3,$4,$5,true,NOW(),NOW())
        ON CONFLICT(user_id,platform) DO UPDATE SET
          account_id=$2,account_name=$3,avatar_url=$4,access_token=$5,is_connected=true,updated_at=NOW()
      `, [userId, openId||profile.open_id||'', profile.display_name||'', profile.avatar_url||'', accessToken]);
      await notify(userId, '🎵 ربط TikTok', 'تم ربط حساب TikTok بنجاح', 'success');
    }

    res.redirect('/?social_connected=tiktok');
  } catch (e) { res.redirect(`/?social_error=${encodeURIComponent(e.message)}`); }
});

// ============================================================
// WhatsApp Business API
// ============================================================

// إرسال رسالة واتساب
app.post('/api/social/whatsapp/send', authenticateToken, async (req, res) => {
  const { to, message, type = 'text', template_name, template_params } = req.body;
  if (!to || (!message && type === 'text'))
    return res.status(400).json({ success: false, message: 'to ومحتوى الرسالة مطلوبان' });

  // تنظيف رقم الهاتف
  const phone = String(to).replace(/[^\d]/g, '');
  if (phone.length < 7) return res.status(400).json({ success: false, message: 'رقم هاتف غير صالح' });

  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query(
      'SELECT access_token, whatsapp_phone_id FROM social_accounts WHERE user_id=$1 AND platform=$2 AND is_connected=true',
      [req.user.id, 'whatsapp']
    );
    if (!r.rows.length || !r.rows[0].access_token)
      return res.status(400).json({ success: false, message: 'حساب واتساب غير مربوط' });

    const { access_token, whatsapp_phone_id } = r.rows[0];
    if (!whatsapp_phone_id)
      return res.status(400).json({ success: false, message: 'Phone Number ID غير مضبوط' });

    let bodyPayload;
    if (type === 'template' && template_name) {
      bodyPayload = {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: template_name,
          language: { code: 'ar' },
          components: template_params ? [{ type: 'body', parameters: template_params.map(p => ({ type: 'text', text: p })) }] : []
        }
      };
    } else {
      bodyPayload = {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body: String(message).substring(0, 4096) }
      };
    }

    const waRes = await fetch(`https://graph.facebook.com/v19.0/${whatsapp_phone_id}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload)
    });
    const waData = await waRes.json();
    if (waData.error) return res.status(400).json({ success: false, message: waData.error.message });
    res.json({ success: true, message_id: waData.messages?.[0]?.id });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Webhook استقبال رسائل واتساب (التحقق)
app.get('/api/social/whatsapp/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'socialos_wa_verify';
  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WhatsApp Webhook verified');
    return res.status(200).send(challenge);
  }
  res.status(403).send('Forbidden');
});

// Webhook استقبال رسائل واتساب (الرسائل الواردة)
app.post('/api/social/whatsapp/webhook', async (req, res) => {
  res.status(200).send('OK'); // يجب الرد فوراً
  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    if (!value?.messages?.length) return;

    const msg = value.messages[0];
    const from = msg.from;
    const text = msg.text?.body || '';
    const phoneNumberId = value.metadata?.phone_number_id;

    if (!pool || !phoneNumberId) return;
    // إيجاد صاحب الحساب
    const r = await pool.query(
      'SELECT user_id FROM social_accounts WHERE whatsapp_phone_id=$1 AND platform=$2 AND is_connected=true',
      [phoneNumberId, 'whatsapp']
    );
    if (!r.rows.length) return;
    const userId = r.rows[0].user_id;
    await notify(userId, '💬 رسالة واتساب جديدة', `من ${from}: ${String(text).substring(0,100)}`, 'whatsapp');
  } catch (e) { console.error('WA webhook error:', e.message); }
});

// ============================================================
// STORE IDENTITY — هوية المتجر
// ============================================================
};
