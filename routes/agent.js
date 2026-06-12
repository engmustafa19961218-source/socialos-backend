module.exports = function(app, pool, helpers) {
// ============================================================
// نظام الذاكرة الدائمة للموظف الرقمي
// ============================================================

async function getEmployeeMemory(userId) {
  if (!pool) return '';
  try {
    const r = await pool.query(
      'SELECT content, memory_type FROM employee_memory WHERE user_id=$1 ORDER BY importance DESC, created_at DESC LIMIT 40',
      [userId]
    );
    if (!r.rows.length) return '';
    let memText = '\n\n=== تعليماتي المحفوظة ===\n';
    r.rows.forEach(m => { memText += `- ${m.content}\n`; });
    return memText;
  } catch(e) { return ''; }
}

async function saveEmployeeMemory(userId, content, type = 'general', importance = 1) {
  if (!pool || !content) return;
  try {
    await pool.query(
      'INSERT INTO employee_memory (user_id, content, memory_type, importance) VALUES ($1,$2,$3,$4)',
      [userId, content.substring(0, 500), type, importance]
    );
  } catch(e) {}
}

async function extractEmployeeMemory(userId, userMsg, empReply, apiKey) {
  if (!apiKey) return;
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 200,
        messages: [{ role: 'user', content: `هل تحتوي هذه المحادثة على تعليمات أو معلومات يجب أن يتذكرها الموظف دائماً؟
رسالة: "${userMsg}"
الرد: "${empReply}"
JSON فقط: {"save": true/false, "content": "ما يجب حفظه", "type": "policy|customer|product|general", "importance": 1-3}` }]
      })
    });
    const data = await r.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw.replace(/\`\`\`json|\`\`\`/g, '').trim());
    if (parsed.save && parsed.content) {
      await saveEmployeeMemory(userId, parsed.content, parsed.type || 'general', parsed.importance || 1);
    }
  } catch(e) {}
}


const { escapeHtml, sanitize, authenticateToken, rateLimit, notify, auditLog, esc } = helpers;

// ============================================================
// SMART AGENT — الموظف الرقمي في وضع العمل
// ============================================================
const agentConversations = {};
setInterval(() => {
  const now = Date.now();
  Object.keys(agentConversations).forEach(uid => {
    if (agentConversations[uid]._lastActivity && now - agentConversations[uid]._lastActivity > 2*60*60*1000)
      delete agentConversations[uid];
  });
}, 60*60*1000);

app.post('/api/agent/chat', authenticateToken, rateLimit(25, 60*1000), async (req, res) => {
  const userId = req.user.id;
  const { message } = req.body;
  if (!message) return res.status(400).json({ success: false, message: 'الرسالة مطلوبة' });
  const safeMessage = message.substring(0, 2000);

  let bp = {}, emp = {}, knowledge = [], decisions = [], products = [], emergency = null;
  let employeeMemoryText = '';
  try {
    if (pool) {
      employeeMemoryText = await getEmployeeMemory(userId);
      const [bpR, empR, kbR, dmR, prodR, ordR, emR] = await Promise.all([
        pool.query('SELECT * FROM business_profile WHERE user_id=$1', [userId]),
        pool.query('SELECT * FROM digital_employee WHERE user_id=$1', [userId]),
        pool.query('SELECT title, content, type FROM knowledge_base WHERE user_id=$1 LIMIT 15', [userId]),
        pool.query('SELECT decision, reason, context FROM decision_memory WHERE user_id=$1 AND is_active=true LIMIT 15', [userId]),
        pool.query('SELECT name, price, category, stock FROM products WHERE user_id=$1 AND is_available=true', [userId]),
        pool.query('SELECT COUNT(*) as cnt, SUM(total) as rev FROM orders WHERE user_id=$1', [userId]),
        pool.query('SELECT * FROM emergency_mode WHERE user_id=$1', [userId])
      ]);
      bp = bpR.rows[0] || {};
      emp = empR.rows[0] || {};
      knowledge = kbR.rows;
      decisions = dmR.rows;
      products = prodR.rows;
      emergency = emR.rows[0];
    }
  } catch (e) {}

  // Check emergency mode
  if (emergency?.is_active && emergency?.stop_ai) {
    return res.json({ success: true, response: emergency.message || 'النظام في وضع الطوارئ حالياً. سنعود قريباً.' });
  }

  const trustLabels = { 1: 'مراقبة — يعمل تحت إشراف كامل', 2: 'مساعدة — يمكنه المساعدة باستقلالية محدودة', 3: 'استقلال — يمكنه العمل باستقلالية' };
  const systemPrompt = `أنت الموظف الرقمي الذكي لـ "${bp.store_name || 'المتجر'}".
مستوى الثقة: ${trustLabels[emp.trust_level] || trustLabels[1]}

━━━ معلومات العمل ━━━
النشاط: ${bp.business_type || 'غير محدد'}
الوصف: ${bp.business_desc || ''}
الجمهور: ${bp.target_audience || 'الجميع'}
المنطقة: ${bp.location || ''}
العملة: ${bp.currency || 'IQD'}
أسلوب التواصل: ${bp.communication_style || 'ودي وقريب'}
السياسات: ${bp.policies || 'لم تُحدد'}

━━━ فلسفتي وأسلوبي ━━━
الفلسفة: ${emp.philosophy || 'لم تُحدد بعد — التزم بما يطلبه صاحب العمل'}
أسلوب البيع: ${emp.sales_style || ''}
التعامل مع الاعتراضات: ${emp.objection_handling || ''}
حدودي: ${emp.boundaries || 'لا أغير الأسعار بدون موافقة، لا أحذف بيانات'}

━━━ المنتجات المتاحة ━━━
${products.map(p => `• ${p.name} | ${Number(p.price).toLocaleString('ar-IQ')} ${bp.currency||'د.ع'} | مخزون: ${p.stock}`).join('\n') || 'لا منتجات مضافة'}

━━━ مركز المعرفة ━━━
${knowledge.map(k => `[${k.type}] ${k.title}: ${k.content.substring(0,300)}`).join('\n') || 'فارغ'}

━━━ قرارات مهمة ━━━
${decisions.map(d => `• ${d.decision} ← ${d.reason}`).join('\n') || 'لا توجد'}

━━━ قواعد عملي ━━━
- نفّذ الطلب مباشرةً
- لا تغير الأسعار أو السياسات بدون موافقة
- إذا طُلب خصم غير مصرّح به، اعتذر بأدب
- احفظ أسلوب صاحب العمل في كل رد`;

  if (!agentConversations[userId]) agentConversations[userId] = [];
  agentConversations[userId]._lastActivity = Date.now();
  agentConversations[userId].push({ role: 'user', content: safeMessage });
  if (agentConversations[userId].length > 20) agentConversations[userId] = agentConversations[userId].slice(-20);

  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(500).json({ success: false, message: 'OpenRouter غير مفعّل' });

  // ─── تعزيز الـ system prompt بتحويل للبشر ───
  const enhancedPrompt = systemPrompt + `

━━━ التحويل للبشر ━━━
إذا وجدت أن الحالة تحتاج تدخل صاحب العمل (شكوى جدية، طلب استثنائي، خلاف في الأسعار، موقف حساس)، أضف في نهاية ردك:
[TRANSFER_TO_HUMAN: سبب التحويل]

━━━ صلاحياتك ━━━
- يمكنك: الإجابة عن الأسئلة، شرح المنتجات، أخذ معلومات الطلب
- لا يمكنك: تغيير الأسعار، منح خصومات خارج السياسة، الوعد بما لم يوافق عليه صاحب العمل`;

  try {
    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4-5',
        max_tokens: 2000,
        messages: [{ role: 'system', content: enhancedPrompt }, ...agentConversations[userId].filter(m => m.role)]
      })
    });
    const aiData = await aiRes.json();
    if (aiData.error) return res.json({ success: false, message: aiData.error.message });

    let response = aiData.choices?.[0]?.message?.content || '';
    let transferReason = null;
    let needsHuman = false;

    // استخراج تحويل للبشر
    const transferMatch = response.match(/\[TRANSFER_TO_HUMAN:\s*(.*?)\]/s);
    if (transferMatch) {
      transferReason = transferMatch[1].trim();
      needsHuman = true;
      response = response.replace(/\[TRANSFER_TO_HUMAN:.*?\]/s, '').trim();
      // إشعار صاحب العمل
      if (pool) await notify(userId, '🔔 تحويل للبشر', `عميل يحتاج تدخلك: ${escapeHtml(transferReason.substring(0,100))}`, 'warning');
    }

    agentConversations[userId].push({ role: 'assistant', content: response });
    if (pool) await pool.query('UPDATE digital_employee SET total_interactions=total_interactions+1 WHERE user_id=$1', [userId]);

    // كشف نوع الإجراء
    let action = null;
    const lm = safeMessage.toLowerCase();
    if (lm.includes('طلب') && (lm.includes('أضف')||lm.includes('جديد'))) action = { type: 'new_order' };
    else if (lm.includes('منشور')||lm.includes('اكتب')||lm.includes('محتوى')) action = { type: 'create_post', content: response };
    else if (lm.includes('تقرير')||lm.includes('إحصائيات')) action = { type: 'report' };

    // حفظ الذاكرة تلقائياً
    const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
    extractEmployeeMemory(userId, safeMessage, response, OPENROUTER_KEY).catch(() => {});

    // حفظ صريح عند "تذكر" أو "احفظ"
    const memTriggers = ['احفظ', 'تذكر', 'لا تنسى', 'دائماً', 'من الآن'];
    if (memTriggers.some(t => safeMessage.includes(t))) {
      await saveEmployeeMemory(userId, safeMessage, 'policy', 3);
    }

    return res.json({ success: true, response, action, needs_human: needsHuman, transfer_reason: transferReason });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/agent/clear', authenticateToken, (req, res) => {
  agentConversations[req.user.id] = [];
  res.json({ success: true });
});

// Ask why — لماذا أجبت هكذا
app.post('/api/agent/explain', authenticateToken, rateLimit(10, 60*1000), async (req, res) => {
  const { last_response, question } = req.body;
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(500).json({ success: false, message: 'OpenRouter غير مفعّل' });
  try {
    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `أنت موظف رقمي ذكي. أجبت بهذا الرد: "${last_response}"
صاحب العمل يسأل: "${question || 'لماذا أجبت هكذا؟'}"
اشرح منطقك بوضوح وإيجاز، وكيف يمكن تحسين الرد.`
        }]
      })
    });
    const data = await aiRes.json();
    res.json({ success: true, explanation: data.choices?.[0]?.message?.content || '' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

};
