module.exports = function(app, pool, helpers) {
const { escapeHtml, sanitize, authenticateToken, rateLimit, notify, auditLog, esc } = helpers;

// ============================================================
// BOARD OF DIRECTORS — مجلس الإدارة الذكي
// ============================================================
app.get('/api/board/recommendations', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM board_recommendations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [req.user.id]);
      return res.json({ success: true, recommendations: r.rows });
    }
  } catch (e) {}
  res.json({ success: true, recommendations: [] });
});

app.post('/api/board/generate', authenticateToken, rateLimit(5, 60*1000), async (req, res) => {
  const userId = req.user.id;
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(500).json({ success: false, message: 'OpenRouter غير مفعّل' });
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'قاعدة البيانات غير متاحة' });

    // بيانات أعمق للمجلس
    const [orders, ordersMonth, products, customers, bp, emp, topProds, campaigns, coupons, loyalty] = await Promise.all([
      pool.query(`SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) as rev, SUM(CASE WHEN status='new' THEN 1 ELSE 0 END) as new_cnt, SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) as cancelled FROM orders WHERE user_id=$1`, [userId]),
      pool.query(`SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) as rev FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '30 days'`, [userId]),
      pool.query(`SELECT COUNT(*) as cnt, SUM(CASE WHEN stock<=3 THEN 1 ELSE 0 END) as low, SUM(CASE WHEN stock=0 THEN 1 ELSE 0 END) as out FROM products WHERE user_id=$1`, [userId]),
      pool.query(`SELECT COUNT(DISTINCT customer_phone) as cnt, COUNT(DISTINCT CASE WHEN created_at>=NOW()-INTERVAL '30 days' THEN customer_phone END) as new_30d FROM orders WHERE user_id=$1`, [userId]),
      pool.query('SELECT * FROM business_profile WHERE user_id=$1', [userId]),
      pool.query('SELECT trust_level, total_interactions, correct_interactions FROM digital_employee WHERE user_id=$1', [userId]),
      pool.query(`SELECT items, COUNT(*) as freq FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '30 days' GROUP BY items ORDER BY freq DESC LIMIT 5`, [userId]),
      pool.query(`SELECT COUNT(*) as cnt, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active FROM ad_campaigns WHERE user_id=$1`, [userId]).catch(()=>({rows:[{cnt:0,active:0}]})),
      pool.query(`SELECT COUNT(*) as cnt FROM coupons WHERE user_id=$1 AND is_active=true`, [userId]).catch(()=>({rows:[{cnt:0}]})),
      pool.query(`SELECT COUNT(*) as cnt, COALESCE(SUM(points),0) as total_pts FROM loyalty_points WHERE user_id=$1`, [userId]).catch(()=>({rows:[{cnt:0,total_pts:0}]}))
    ]);

    const bpData = bp.rows[0] || {};
    const empData = emp.rows[0] || {};
    const o = orders.rows[0];
    const om = ordersMonth.rows[0];
    const p = products.rows[0];

    const statsStr = `
متجر: ${bpData.store_name||''} — ${bpData.business_type||''}
الطلبات الكلية: ${o.cnt} | الإيرادات: ${Number(o.rev||0).toLocaleString()} | ملغية: ${o.cancelled}
آخر 30 يوم: ${om.cnt} طلب — ${Number(om.rev||0).toLocaleString()} إيراد
المنتجات: ${p.cnt} | مخزون منخفض: ${p.low} | نفذ: ${p.out}
العملاء: ${customers.rows[0]?.cnt} | جدد (30 يوم): ${customers.rows[0]?.new_30d}
الموظف الرقمي: مستوى ${empData.trust_level||1} — دقة ${empData.total_interactions>0?Math.round((empData.correct_interactions/empData.total_interactions)*100):0}%
الحملات الإعلانية: ${campaigns.rows[0]?.cnt} | نشطة: ${campaigns.rows[0]?.active}
الكوبونات النشطة: ${coupons.rows[0]?.cnt}
عملاء الولاء: ${loyalty.rows[0]?.cnt} — إجمالي النقاط: ${loyalty.rows[0]?.total_pts}`;

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4-5',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `أنت مجلس إدارة ذكي وخبير استراتيجي لمتجر عربي. حلّل البيانات وقدّم توصيات قابلة للتنفيذ فوراً.

${statsStr}

أرجع JSON فقط — 7 توصيات متنوعة:
[
  {"type":"opportunity","title":"عنوان قصير جذاب","content":"تحليل مفصل مع خطوات تنفيذية واضحة","priority":"high","action":"action_type","action_label":"نص الزر","kpi":"مؤشر النجاح"},
  {"type":"warning","title":"تحذير عاجل","content":"المشكلة وتأثيرها وكيفية الحل","priority":"high","action":null,"action_label":null,"kpi":""},
  {"type":"strategy","title":"استراتيجية نمو","content":"خطة متكاملة للنمو","priority":"medium","action":null,"action_label":null,"kpi":""},
  {"type":"insight","title":"ملاحظة مهمة","content":"استنتاج من البيانات","priority":"medium","action":null,"action_label":null,"kpi":""},
  {"type":"action","title":"إجراء فوري","content":"ما يجب فعله اليوم","priority":"high","action":"create_campaign","action_label":"إنشاء حملة","kpi":""},
  {"type":"opportunity","title":"فرصة إيراد","content":"كيف تزيد الإيراد","priority":"medium","action":null,"action_label":null,"kpi":""},
  {"type":"risk","title":"خطر محتمل","content":"ما قد يضر العمل وكيف تتفادى","priority":"low","action":null,"action_label":null,"kpi":""}
]

الأنواع المتاحة للـ action: create_campaign, add_coupon, go_training, go_retargeting, go_inventory`
        }]
      })
    });
    const data = await aiRes.json();
    let recs = [];
    try {
      const text = data.choices?.[0]?.message?.content || '[]';
      const match = text.match(/\[[\s\S]*\]/);
      recs = match ? JSON.parse(match[0]) : [];
    } catch (e) {}

    // حذف التوصيات القديمة وإضافة الجديدة
    await pool.query('DELETE FROM board_recommendations WHERE user_id=$1 AND created_at < NOW() - INTERVAL \'7 days\'', [userId]);
    for (const rec of recs) {
      await pool.query(
        'INSERT INTO board_recommendations (user_id, type, title, content, priority) VALUES ($1,$2,$3,$4,$5)',
        [userId, rec.type||'insight', escapeHtml(rec.title||''), rec.content||'', rec.priority||'medium']
      );
    }

    const r = await pool.query('SELECT * FROM board_recommendations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [userId]);

    // إرفاق action_data من الـ AI مع النتائج
    const enriched = r.rows.map((row, i) => ({
      ...row,
      action: recs[i]?.action || null,
      action_label: recs[i]?.action_label || null,
      kpi: recs[i]?.kpi || ''
    }));

    // إحصائيات الأداء للمجلس
    const performance = {
      revenue_30d: Number(om.rev||0),
      orders_30d: parseInt(om.cnt||0),
      avg_order: parseInt(om.cnt||0) > 0 ? Number(om.rev||0)/parseInt(om.cnt||0) : 0,
      new_customers: parseInt(customers.rows[0]?.new_30d||0),
      low_stock: parseInt(p.low||0),
      cancelled_rate: parseInt(o.cnt||0) > 0 ? Math.round((parseInt(o.cancelled||0)/parseInt(o.cnt||0))*100) : 0,
      employee_accuracy: empData.total_interactions>0 ? Math.round((empData.correct_interactions/empData.total_interactions)*100) : 0
    };

    return res.json({ success: true, recommendations: enriched, performance });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.put('/api/board/:id/read', authenticateToken, async (req, res) => {
  try {
    if (pool) await pool.query('UPDATE board_recommendations SET is_read=true WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// EMERGENCY MODE — وضع الطوارئ والعطلات
// ============================================================
app.get('/api/emergency', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM emergency_mode WHERE user_id=$1', [req.user.id]);
      return res.json({ success: true, emergency: r.rows[0] || { is_active: false } });
    }
  } catch (e) {}
  res.json({ success: true, emergency: { is_active: false } });
});

app.put('/api/emergency', authenticateToken, async (req, res) => {
  const { is_active, mode_type, message, stop_orders, stop_ai, end_at } = req.body;
  const userId = req.user.id;
  try {
    if (pool) {
      await pool.query(`
        INSERT INTO emergency_mode (user_id, is_active, mode_type, message, stop_orders, stop_ai, start_at, end_at)
        VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7)
        ON CONFLICT (user_id) DO UPDATE SET
          is_active=$2, mode_type=$3, message=$4, stop_orders=$5, stop_ai=$6,
          start_at=CASE WHEN $2=true THEN NOW() ELSE emergency_mode.start_at END,
          end_at=$7, updated_at=NOW()
      `, [userId, is_active||false, mode_type||'emergency', message||'', stop_orders||false, stop_ai||false, end_at||null]);
      await auditLog(userId, is_active?'enable_emergency':'disable_emergency', 'emergency', null, mode_type, req.ip);
      return res.json({ success: true });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// اقتراح رسائل طوارئ ذكية حسب نوع العمل
app.post('/api/emergency/suggest', authenticateToken, rateLimit(10, 60*1000), async (req, res) => {
  const { mode_type, end_at } = req.body;
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.json({ success: false, message: 'AI غير متاح' });
  try {
    let bp = {};
    if (pool) {
      const r = await pool.query('SELECT store_name, business_type, whatsapp_number, communication_style FROM business_profile WHERE user_id=$1', [req.user.id]);
      bp = r.rows[0] || {};
    }

    const modeLabels = { emergency:'طارئ', vacation:'إجازة', maintenance:'صيانة', holiday:'عطلة رسمية', closed:'مغلق مؤقتاً' };
    const endStr = end_at ? `موعد العودة: ${new Date(end_at).toLocaleDateString('ar-IQ')}` : 'موعد العودة: غير محدد';

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 600,
        messages: [{ role: 'user', content:
`أنت خبير تواصل تجاري. اكتب 3 رسائل مختلفة لوضع "${modeLabels[mode_type]||mode_type}" لهذا العمل.

المتجر: ${escapeHtml(bp.store_name||'متجرنا')}
نوع النشاط: ${escapeHtml(bp.business_type||'تجارة')}
أسلوب التواصل: ${escapeHtml(bp.communication_style||'ودي')}
${bp.whatsapp_number ? `واتساب: ${escapeHtml(bp.whatsapp_number)}` : ''}
${endStr}

المطلوب: رسائل قصيرة مناسبة لطبيعة هذا النشاط تحديداً (ليست عامة). الرسالة الأولى رسمية، الثانية ودية، الثالثة مختصرة.

أرجع JSON فقط:
{"messages":[{"label":"رسمية","text":"..."},{"label":"ودية","text":"..."},{"label":"مختصرة","text":"..."}]}`
        }]
      })
    });
    const data = await aiRes.json();
    let result = {};
    try {
      const raw = data.choices?.[0]?.message?.content || '{}';
      result = JSON.parse(raw.replace(/```json|```/g,'').trim());
    } catch(e) {}
    res.json({ success: true, messages: result.messages || [] });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ============================================================
// APPROVAL REQUESTS — مركز الموافقات
// ============================================================
app.get('/api/approvals', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query('SELECT * FROM approval_requests WHERE user_id=$1 AND status=$2 ORDER BY created_at DESC', [req.user.id, 'pending']);
      return res.json({ success: true, requests: r.rows });
    }
  } catch (e) {}
  res.json({ success: true, requests: [] });
});

app.put('/api/approvals/:id', authenticateToken, async (req, res) => {
  const { status } = req.body; // approved | rejected
  if (!['approved','rejected'].includes(status)) return res.status(400).json({ success: false, message: 'حالة غير صحيحة' });
  try {
    if (pool) {
      await pool.query('UPDATE approval_requests SET status=$1, decided_at=NOW() WHERE id=$2 AND user_id=$3', [status, req.params.id, req.user.id]);
      await auditLog(req.user.id, status === 'approved' ? 'approve_request' : 'reject_request', 'approval', parseInt(req.params.id), '', req.ip);
      return res.json({ success: true });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
};
