module.exports = function(app, pool, helpers) {
const { escapeHtml, sanitize, authenticateToken, rateLimit, notify, auditLog, esc } = helpers;

// ============================================================
// TRAINING — التدريب
// ============================================================

// Start training session
app.post('/api/training/session', authenticateToken, async (req, res) => {
  const { type, topic } = req.body;
  try {
    if (pool) {
      const r = await pool.query(
        'INSERT INTO training_sessions (user_id, type, topic, messages) VALUES ($1,$2,$3,$4) RETURNING *',
        [req.user.id, type || 'open', topic || '', '[]']
      );
      return res.json({ success: true, session: r.rows[0] });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// Training chat — محادثة تدريب
app.post('/api/training/chat', authenticateToken, rateLimit(30, 60*1000), async (req, res) => {
  const { session_id, message, mode } = req.body;
  const userId = req.user.id;
  if (!message) return res.status(400).json({ success: false, message: 'الرسالة مطلوبة' });

  let businessProfile = {}, employee = {}, knowledge = [], decisions = [], corrections = [], products = [], identity = {}, trainingMemories = [];
  try {
    if (pool) {
      const [bp, emp, kb, dm, cor, prods, sid, mem] = await Promise.all([
        pool.query('SELECT * FROM business_profile WHERE user_id=$1', [userId]),
        pool.query('SELECT * FROM digital_employee WHERE user_id=$1', [userId]),
        pool.query('SELECT title, content, type FROM knowledge_base WHERE user_id=$1 ORDER BY created_at DESC LIMIT 15', [userId]),
        pool.query('SELECT decision, reason, context FROM decision_memory WHERE user_id=$1 AND is_active=true LIMIT 15', [userId]),
        pool.query('SELECT corrected_response, lesson FROM training_corrections WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [userId]),
        pool.query('SELECT name, price, description, stock FROM products WHERE user_id=$1 AND is_available=true LIMIT 20', [userId]),
        pool.query('SELECT payment_cards FROM store_identity WHERE user_id=$1', [userId]).catch(()=>({rows:[]})),
        pool.query('SELECT summary, session_date FROM training_memory WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10', [userId]).catch(()=>({rows:[]}))
      ]);
      businessProfile = bp.rows[0] || {};
      employee = emp.rows[0] || {};
      knowledge = kb.rows;
      decisions = dm.rows;
      corrections = cor.rows;
      products = prods.rows;
      identity = sid.rows[0] || {};
      trainingMemories = mem.rows;
    }
  } catch (e) {}

  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(500).json({ success: false, message: 'OpenRouter غير مفعّل' });

  // ═══════════════════════════════════════════════════
  // بناء الـ system prompt حسب الوضع
  // ═══════════════════════════════════════════════════
  let systemPrompt = '';

  // ─── وضع خدمة العملاء الحقيقي ───
  if (mode === 'customer') {
    const stage = employee.trust_level >= 3 ? 'autonomous' : employee.trust_level >= 2 ? 'assisted' : 'supervised';
    systemPrompt = `أنت الموظف الرقمي الذكي لمتجر "${escapeHtml(businessProfile.store_name||'المتجر')}".
اسمك: ${escapeHtml(employee.name||'المساعد')}
مهمتك: الرد على العملاء وإغلاق الصفقات بأسلوب صاحب العمل.

═══ هوية العمل ═══
نوع النشاط: ${escapeHtml(businessProfile.business_type||'')}
وصف العمل: ${escapeHtml(businessProfile.business_desc||'')}
أسلوب التواصل: ${escapeHtml(businessProfile.communication_style||'ودي وقريب')}
السياسات: ${escapeHtml(businessProfile.policies||'')}

═══ فلسفتك وأسلوبك ═══
${escapeHtml(employee.philosophy||'كن ودياً ومحترفاً')}
أسلوب البيع: ${escapeHtml(employee.sales_style||'استمع أولاً ثم اقترح')}
كيفية التعامل مع الاعتراضات: ${escapeHtml(employee.objection_handling||'افهم السبب وقدم بديلاً')}

═══ المنتجات المتاحة ═══
${products.length ? products.map(p=>`- ${escapeHtml(p.name)}: ${p.price} (${escapeHtml(p.description||'')})`).join('\n') : 'لا منتجات مضافة بعد'}

═══ مركز المعرفة ═══
${knowledge.length ? knowledge.map(k=>`[${k.type}] ${escapeHtml(k.title)}: ${escapeHtml(k.content.substring(0,300))}`).join('\n') : 'فارغ'}

═══ قرارات مهمة يجب تطبيقها ═══
${decisions.length ? decisions.map(d=>`⚠️ ${escapeHtml(d.decision)} — السبب: ${escapeHtml(d.reason)}`).join('\n') : 'لا قرارات خاصة'}

═══ دروس من التدريب ═══
${corrections.length ? corrections.map(c=>`✓ ${escapeHtml(c.lesson||c.corrected_response.substring(0,150))}`).join('\n') : 'لا دروس بعد'}

═══ ذاكرة الجلسات السابقة ═══
${trainingMemories.length ? trainingMemories.map(m=>`📌 [${m.session_date}]: ${escapeHtml(m.summary)}`).join('\n\n') : 'لا ذاكرة محفوظة بعد — قل "احفظ ما تعلمته" لحفظ جلستك'}

═══ بطاقات الدفع والتحويل ═══
${(() => {
  try {
    const cards = JSON.parse(identity.payment_cards || '[]');
    if (!cards.length) return 'لم تُضَف بطاقات دفع بعد';
    return cards.map(c => `💳 ${c.type} — ${c.name}\nالرقم: ${c.number}${c.owner ? '\nالاسم: '+c.owner : ''}`).join('\n---\n');
  } catch(e) { return 'لا بطاقات'; }
})()}

عند طلب الزبون دفع العربون أو السداد، أرسل له بطاقات الدفع أعلاه مع تنسيق واضح.

═══ قواعد صارمة ═══
1. تحدث بأسلوب صاحب العمل وفلسفته دائماً
2. طبّق القرارات المهمة بدقة ولا تتجاوزها
3. لا تعطِ خصومات خارج السياسات المحددة
4. لا تحذف بيانات أو تغير سياسات
5. إذا كان الطلب خارج صلاحياتك أو معقداً، قل: "سأحول طلبك لصاحب العمل مباشرة"
6. مرحلتك الحالية: ${stage === 'supervised' ? 'مراقبة (احرص على الدقة)' : stage === 'assisted' ? 'مساعدة (يمكن تصرف محدود)' : 'استقلالية (ثق بحكمك ضمن الحدود)'}
7. أجب بالعربية دائماً بأسلوب طبيعي وودي`;

  // ─── وضع محاكاة العميل ───
  } else if (mode === 'simulate_customer') {
    const scenarios = [
      'عميل يسأل عن الأسعار ويريد خصماً',
      'عميل يتردد في الشراء ويقارن بمنافسين',
      'عميل يشكو من منتج سابق',
      'عميل جديد يسأل عن التوصيل',
      'عميل يريد كميات كبيرة ويتفاوض على السعر'
    ];
    const scenario = message.includes('سيناريو:') ? message : scenarios[Math.floor(Math.random() * scenarios.length)];
    systemPrompt = `أنت تلعب دور عميل حقيقي يتواصل مع متجر "${escapeHtml(businessProfile.store_name||'المتجر')}".
نوع المتجر: ${escapeHtml(businessProfile.business_type||'')}
المنتجات: ${products.slice(0,5).map(p=>escapeHtml(p.name)).join('، ')||'منتجات متنوعة'}

سيناريو محادثتك: ${typeof scenario === 'string' ? escapeHtml(scenario) : ''}

قواعد:
- كن عميلاً حقيقياً طبيعياً، لا تكشف أنك AI
- اسأل عن الأسعار والتوصيل والضمان
- اعترض وتفاوض بشكل طبيعي
- أبدِ اهتماماً حقيقياً أو تردداً حسب السيناريو
- استخدم لغة عامية عراقية أو خليجية طبيعية`;

  // ─── وضع التقييم ───
  } else if (mode === 'evaluate') {
    systemPrompt = `أنت مدرب أعمال خبير متخصص في المبيعات العربية.
فلسفة المتجر: ${escapeHtml(businessProfile.business_desc||'')}
أسلوب صاحب العمل: ${escapeHtml(employee.sales_style||'')}
فلسفة الموظف: ${escapeHtml(employee.philosophy||'')}

مهمتك: تقييم رد الموظف الرقمي وإعطاء:
1. ✅ ما أجاد فيه
2. ⚠️ ما يحتاج تحسيناً
3. 💡 رد أفضل مقترح
4. 📊 درجة من 10
5. 🎯 درس يجب أن يتعلمه

كن صريحاً وعملياً ومحدداً.`;

  // ─── وضع "لماذا أجبت هكذا؟" ───
  } else if (mode === 'explain') {
    systemPrompt = `أنت الموظف الرقمي لمتجر "${escapeHtml(businessProfile.store_name||'المتجر')}".
فلسفتك: ${escapeHtml(employee.philosophy||'')}
أسلوبك: ${escapeHtml(employee.sales_style||'')}
القرارات التي تطبقها: ${decisions.map(d=>escapeHtml(d.decision)).join('، ')||'لا قرارات خاصة'}

صاحب العمل يسألك لماذا أجبت بطريقة معينة.
اشرح تفكيرك بصراحة: ما الذي جعلك تختار هذا الرد؟ ما الذي طبّقته من فلسفة العمل؟ هل كنت متأكداً؟`;

  // ─── وضع التدريب المفتوح ───
  } else {
    systemPrompt = `أنت الموظف الرقمي الذكي لمتجر "${escapeHtml(businessProfile.store_name||'المتجر')}".
أنت في جلسة تدريب مع صاحب العمل — تعلم منه وطرح أسئلة وطبّق توجيهاته.

معلومات العمل:
- النشاط: ${escapeHtml(businessProfile.business_type||'')}
- الوصف: ${escapeHtml(businessProfile.business_desc||'')}
- أسلوب التواصل: ${escapeHtml(businessProfile.communication_style||'ودي وقريب')}
- السياسات: ${escapeHtml(businessProfile.policies||'')}

ما تعلمته حتى الآن:
الفلسفة: ${escapeHtml(employee.philosophy||'لم تُحدد بعد')}
أسلوب البيع: ${escapeHtml(employee.sales_style||'لم يُحدد بعد')}
التعامل مع الاعتراضات: ${escapeHtml(employee.objection_handling||'لم يُحدد بعد')}

مركز المعرفة:
${knowledge.map(k=>`[${k.type}] ${escapeHtml(k.title)}: ${escapeHtml(k.content.substring(0,200))}`).join('\n')||'فارغ'}

القرارات المهمة:
${decisions.map(d=>`- ${escapeHtml(d.decision)}`).join('\n')||'لا توجد'}

دروس من التصحيحات السابقة:
${corrections.map(c=>`✓ ${escapeHtml(c.lesson||c.corrected_response.substring(0,100))}`).join('\n')||'لا دروس بعد'}

قواعد:
- عندما يصحح صاحب العمل ردك، اشكره واطلب منه توضيح السبب
- اسأل أسئلة لتتعلم أكثر عن فلسفة العمل
- بعد كل تصحيح قل: "فهمت، هل تريد مني تطبيق هذا في حالة [مثال مشابه]؟"`;
  }

  try {
    // Get session messages
    let sessionMessages = [];
    if (pool && session_id) {
      const r = await pool.query('SELECT messages FROM training_sessions WHERE id=$1 AND user_id=$2', [session_id, userId]);
      if (r.rows.length > 0) {
        try { sessionMessages = JSON.parse(r.rows[0].messages || '[]'); } catch (e) {}
      }
    }
    sessionMessages.push({ role: 'user', content: message.substring(0, 2000) });
    if (sessionMessages.length > 30) sessionMessages = sessionMessages.slice(-30);

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4-5',
        max_tokens: 1500,
        messages: [{ role: 'system', content: systemPrompt }, ...sessionMessages]
      })
    });
    const aiData = await aiRes.json();
    if (aiData.error) return res.json({ success: false, message: aiData.error.message });

    const response = aiData.choices?.[0]?.message?.content || '';
    sessionMessages.push({ role: 'assistant', content: response });

    // Save updated messages
    if (pool && session_id) {
      await pool.query('UPDATE training_sessions SET messages=$1 WHERE id=$2 AND user_id=$3',
        [JSON.stringify(sessionMessages), session_id, userId]);
      // Update employee interaction count
      await pool.query('UPDATE digital_employee SET total_interactions=total_interactions+1, updated_at=NOW() WHERE user_id=$1', [userId]);
    }

    // كشف "احفظ ما تعلمته" وحفظ تلقائي
    let memorySaved = false;
    if (message && /احفظ|save|حفظ|تذكر|remember/i.test(message)) {
      try {
        const OPENAI_KEY = process.env.OPENAI_API_KEY;
        if (OPENAI_KEY && sessionMessages.length > 2) {
          const summaryRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'gpt-4o-mini', max_tokens: 400,
              messages: [
                { role: 'system', content: 'لخص أهم ما تعلمه الموظف الرقمي في هذه الجلسة بنقاط واضحة باللغة العربية.' },
                { role: 'user', content: sessionMessages.map(m=>`${m.role}: ${m.content}`).join('\n') }
              ]
            })
          });
          const sd = await summaryRes.json();
          const summary = sd.choices?.[0]?.message?.content || '';
          if (summary && pool) {
            await pool.query('INSERT INTO training_memory (user_id, summary) VALUES ($1,$2)', [userId, summary]);
            await pool.query(
              `UPDATE digital_employee SET philosophy = COALESCE(philosophy,'') || $1, updated_at=NOW() WHERE user_id=$2`,
              ['\n[ذاكرة ' + new Date().toLocaleDateString('ar-IQ') + ']: ' + summary, userId]
            );
            memorySaved = true;
          }
        }
      } catch(e) {}
    }

    return res.json({ success: true, response, mode, memorySaved });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// TRAINING MEMORY — حفظ ذاكرة التدريب
// ============================================================

// حفظ ملخص الجلسة يدوياً عند قول "احفظ"
app.post('/api/training/save-memory', authenticateToken, async (req, res) => {
  const { session_id, manual_summary } = req.body;
  const userId = req.user.id;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    let summary = manual_summary || '';

    // إذا لم يُعطَ ملخص يدوي، نولّد ملخصاً تلقائياً من الجلسة
    if (!summary && session_id) {
      const sess = await pool.query('SELECT messages FROM training_sessions WHERE id=$1 AND user_id=$2', [session_id, userId]);
      if (sess.rows.length) {
        const messages = JSON.parse(sess.rows[0].messages || '[]');
        if (messages.length > 0) {
          const OPENAI_KEY = process.env.OPENAI_API_KEY;
          if (OPENAI_KEY) {
            const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: 'gpt-4o-mini',
                max_tokens: 500,
                messages: [
                  { role: 'system', content: 'أنت مساعد يلخص جلسات التدريب. لخص أهم ما تعلمه الموظف الرقمي في هذه الجلسة بنقاط واضحة ومختصرة باللغة العربية. ركز على: السياسات المحددة، أسلوب التعامل مع العملاء، القواعد الجديدة، المعلومات المهمة.' },
                  { role: 'user', content: `لخص هذه الجلسة:\n${messages.map(m=>`${m.role==='user'?'المدرب':'الموظف'}: ${m.content}`).join('\n')}` }
                ]
              })
            });
            const aiData = await aiRes.json();
            summary = aiData.choices?.[0]?.message?.content || '';
          }
        }
      }
    }

    if (!summary) return res.json({ success: false, message: 'لا يوجد محتوى لحفظه' });

    await pool.query(
      'INSERT INTO training_memory (user_id, summary) VALUES ($1, $2)',
      [userId, summary]
    );

    // تحديث philosophy في digital_employee
    await pool.query(
      `UPDATE digital_employee SET philosophy = COALESCE(philosophy,'') || $1, updated_at=NOW() WHERE user_id=$2`,
      ['\n\n[ذاكرة محفوظة ' + new Date().toLocaleDateString('ar-IQ') + ']: ' + summary, userId]
    );

    res.json({ success: true, summary, message: '✅ تم حفظ ما تعلمته في ذاكرتي الدائمة!' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// جلب الذاكرة المحفوظة
app.get('/api/training/memory', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT * FROM training_memory WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [req.user.id]);
    res.json({ success: true, memories: r.rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// VOICE — الصوت (Whisper + TTS)
// ============================================================

// تحويل صوت → نص (Whisper)
app.post('/api/voice/transcribe', authenticateToken, async (req, res) => {
  const { audio_base64, mime_type } = req.body;
  if (!audio_base64) return res.status(400).json({ success: false, message: 'الصوت مطلوب' });
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) return res.status(503).json({ success: false, message: 'OPENAI_API_KEY غير مضبوط' });
  try {
    const audioBuffer = Buffer.from(audio_base64, 'base64');
    const boundary = '----WhisperBoundary' + Date.now();
    const ext = (mime_type || 'audio/webm').includes('mp4') ? 'mp4' : 'webm';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${ext}"\r\nContent-Type: ${mime_type||'audio/webm'}\r\n\r\n`),
      audioBuffer,
      Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nar\r\n`),
      Buffer.from(`--${boundary}--`)
    ]);
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body
    });
    const d = await r.json();
    if (d.error) return res.status(400).json({ success: false, message: d.error.message });
    res.json({ success: true, text: d.text || '' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// تحويل نص → صوت (TTS)
app.post('/api/voice/speak', authenticateToken, async (req, res) => {
  const { text, voice, speed } = req.body;
  if (!text) return res.status(400).json({ success: false, message: 'النص مطلوب' });
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) return res.status(503).json({ success: false, message: 'OPENAI_API_KEY غير مضبوط' });
  try {
    // جلب إعدادات الصوت المحفوظة
    let voiceTone = voice || 'alloy', voiceSpeed = speed || 1.0;
    if (pool) {
      const vp = await pool.query('SELECT voice_tone, voice_speed FROM voice_profile WHERE user_id=$1', [req.user.id]);
      if (vp.rows.length) { voiceTone = voice || vp.rows[0].voice_tone; voiceSpeed = speed || vp.rows[0].voice_speed; }
    }
    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1-hd', input: text.substring(0, 4096), voice: voiceTone, speed: voiceSpeed, response_format: 'mp3' })
    });
    if (!r.ok) { const e = await r.json(); return res.status(400).json({ success: false, message: e.error?.message || 'فشل TTS' }); }
    const audioBuffer = await r.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString('base64');
    res.json({ success: true, audio_base64: base64Audio, mime_type: 'audio/mp3' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// حفظ ملف الصوت
app.post('/api/voice/profile', authenticateToken, async (req, res) => {
  const { voice_tone, voice_speed, voice_style } = req.body;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    await pool.query(
      `INSERT INTO voice_profile (user_id, voice_tone, voice_speed, voice_style, updated_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (user_id) DO UPDATE SET voice_tone=$2, voice_speed=$3, voice_style=$4, updated_at=NOW()`,
      [req.user.id, voice_tone||'alloy', voice_speed||1.0, voice_style||'']
    );
    res.json({ success: true, message: 'تم حفظ إعدادات الصوت' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// INVOICES — الفواتير
// ============================================================

// جلب الفواتير
app.get('/api/invoices', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT * FROM invoices WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [req.user.id]);
    res.json({ success: true, invoices: r.rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// إنشاء فاتورة
app.post('/api/invoices', authenticateToken, async (req, res) => {
  const { order_id, customer_name, customer_phone, customer_address, items, tax_rate, discount, notes, due_date, currency } = req.body;
  const userId = req.user.id;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    // توليد رقم الفاتورة
    const countR = await pool.query('SELECT COUNT(*) FROM invoices WHERE user_id=$1', [userId]);
    const count = parseInt(countR.rows[0].count) + 1;
    const invoice_number = `INV-${new Date().getFullYear()}-${String(count).padStart(4,'0')}`;

    // حساب المبالغ
    const parsedItems = Array.isArray(items) ? items : [];
    const subtotal = parsedItems.reduce((s, i) => s + (parseFloat(i.price)||0) * (parseInt(i.qty)||1), 0);
    const taxRate = parseFloat(tax_rate) || 0;
    const tax_amount = subtotal * taxRate / 100;
    const disc = parseFloat(discount) || 0;
    const total = subtotal + tax_amount - disc;

    const r = await pool.query(
      `INSERT INTO invoices (user_id, invoice_number, order_id, customer_name, customer_phone, customer_address, items, subtotal, tax_rate, tax_amount, discount, total, currency, notes, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [userId, invoice_number, order_id||null, sanitize(customer_name||''), sanitize(customer_phone||''), sanitize(customer_address||''),
       JSON.stringify(parsedItems), subtotal, taxRate, tax_amount, disc, total, currency||'IQD', sanitize(notes||''), due_date||null]
    );
    res.json({ success: true, invoice: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// تحديث حالة الفاتورة
app.put('/api/invoices/:id', authenticateToken, async (req, res) => {
  const { status, notes } = req.body;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT user_id FROM invoices WHERE id=$1', [req.params.id]);
    if (!r.rows.length || r.rows[0].user_id !== req.user.id) return res.status(403).json({ success: false, message: 'غير مصرح' });
    await pool.query('UPDATE invoices SET status=$1, notes=$2 WHERE id=$3', [status||'draft', sanitize(notes||''), req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// حذف فاتورة
app.delete('/api/invoices/:id', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT user_id FROM invoices WHERE id=$1', [req.params.id]);
    if (!r.rows.length || r.rows[0].user_id !== req.user.id) return res.status(403).json({ success: false, message: 'غير مصرح' });
    await pool.query('DELETE FROM invoices WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// إنشاء فاتورة من طلب موجود
app.post('/api/invoices/from-order/:orderId', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const orderR = await pool.query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [req.params.orderId, userId]);
    if (!orderR.rows.length) return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
    const o = orderR.rows[0];

    // جلب منتجات الطلب
    const itemsR = await pool.query(
      'SELECT oi.*, p.name FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id WHERE oi.order_id=$1',
      [o.id]
    );
    const items = itemsR.rows.map(i => ({ name: i.name||i.product_name||'منتج', qty: i.quantity, price: i.unit_price }));

    const countR = await pool.query('SELECT COUNT(*) FROM invoices WHERE user_id=$1', [userId]);
    const count = parseInt(countR.rows[0].count) + 1;
    const invoice_number = `INV-${new Date().getFullYear()}-${String(count).padStart(4,'0')}`;
    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    const total = subtotal - (o.discount||0);

    const r = await pool.query(
      `INSERT INTO invoices (user_id, invoice_number, order_id, customer_name, customer_phone, customer_address, items, subtotal, discount, total, currency, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [userId, invoice_number, o.id, o.customer_name||'', o.customer_phone||'', o.address||'',
       JSON.stringify(items), subtotal, o.discount||0, total, o.currency||'IQD', '']
    );
    res.json({ success: true, invoice: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Submit correction — تصحيح الموظف
app.post('/api/training/correct', authenticateToken, async (req, res) => {
  const { original_response, corrected_response, context, lesson } = req.body;
  const userId = req.user.id;
  if (!original_response || !corrected_response) return res.status(400).json({ success: false, message: 'البيانات مطلوبة' });
  try {
    if (pool) {
      await pool.query(
        'INSERT INTO training_corrections (user_id, original_response, corrected_response, context, lesson) VALUES ($1,$2,$3,$4,$5)',
        [userId, original_response.substring(0,2000), corrected_response.substring(0,2000), context||'', lesson||'']
      );
      // Update employee: increment corrections, update philosophy if lesson provided
      if (lesson) {
        await pool.query(`UPDATE digital_employee SET
          philosophy = CASE WHEN philosophy='' THEN $1 ELSE philosophy || E'\n' || $1 END,
          correct_interactions = correct_interactions + 1,
          updated_at = NOW()
          WHERE user_id=$2`, [lesson, userId]);
      } else {
        await pool.query('UPDATE digital_employee SET correct_interactions=correct_interactions+1, updated_at=NOW() WHERE user_id=$1', [userId]);
      }
      return res.json({ success: true, message: 'تم حفظ التصحيح وتحديث الموظف' });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// Get training history
app.get('/api/training/sessions', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT id, type, topic, corrections, score, created_at FROM training_sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [req.user.id]);
      return res.json({ success: true, sessions: r.rows });
    }
  } catch (e) {}
  res.json({ success: true, sessions: [] });
});

// Get all corrections
app.get('/api/training/corrections', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM training_corrections WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
      return res.json({ success: true, corrections: r.rows });
    }
  } catch (e) {}
  res.json({ success: true, corrections: [] });
});

};
