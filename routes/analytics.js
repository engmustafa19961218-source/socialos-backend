module.exports = function(app, pool, helpers) {
const { escapeHtml, sanitize, authenticateToken, rateLimit, notify, auditLog, esc } = helpers;

// ============================================================
// DIGITAL TEAM MEETING — اجتماع الفريق الرقمي
// ============================================================
app.post('/api/team/digital/meeting', authenticateToken, rateLimit(10, 60*1000), async (req, res) => {
  const { question } = req.body;
  if (!question || String(question).length > 1000)
    return res.status(400).json({ success: false, message: 'السؤال مطلوب (حتى 1000 حرف)' });

  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(503).json({ success: false, message: 'AI غير متاح' });

  const userId = req.user.id;
  const TEAM_ROLES_DATA = {
    sales:            { name: 'موظف المبيعات',        icon: '💼', prompt: 'أنت خبير مبيعات محترف. ردّك يركز على: فرص البيع، إقناع العملاء، زيادة الإيراد، تقنيات الإغلاق.' },
    customer_service: { name: 'خدمة العملاء',         icon: '🎧', prompt: 'أنت متخصص خدمة عملاء. ردّك يركز على: رضا العملاء، حل المشاكل، تجربة الشراء، الاحتفاظ بالعملاء.' },
    marketing:        { name: 'موظف التسويق',         icon: '📢', prompt: 'أنت خبير تسويق رقمي. ردّك يركز على: الحملات، المحتوى، الجمهور المستهدف، الانتشار.' },
    designer:         { name: 'موظف التصميم',         icon: '🎨', prompt: 'أنت مصمم إبداعي. ردّك يركز على: الهوية البصرية، الصور، جاذبية العرض، التأثير البصري.' },
    orders:           { name: 'موظف الطلبات',         icon: '📦', prompt: 'أنت مسؤول الطلبات والعمليات. ردّك يركز على: كفاءة التنفيذ، التوصيل، المخزون، العمليات.' },
    advisor:          { name: 'المستشار التنفيذي',    icon: '🏛️', prompt: 'أنت مستشار أعمال استراتيجي. ردّك يركز على: الاستراتيجية الكبرى، المخاطر، فرص النمو، القرارات الحرجة.' }
  };

  try {
    // جلب بيانات السياق
    let biz = {}, members = {};
    if (pool) {
      const [bp, tm] = await Promise.all([
        pool.query('SELECT store_name, business_type, business_desc, policies FROM business_profile WHERE user_id=$1', [userId]),
        pool.query('SELECT role, name, personality, expertise, instructions FROM digital_team WHERE user_id=$1', [userId])
      ]);
      biz = bp.rows[0] || {};
      tm.rows.forEach(m => { members[m.role] = m; });
    }

    const bizContext = `المتجر: ${escapeHtml(biz.store_name||'')} — ${escapeHtml(biz.business_type||'')}
الوصف: ${escapeHtml(biz.business_desc||'')}
السياسات: ${escapeHtml(biz.policies||'')}`;

    // إرسال السؤال لكل موظف بالتوازي
    const roleEntries = Object.entries(TEAM_ROLES_DATA);
    const responses = await Promise.all(roleEntries.map(async ([role, roleData]) => {
      const member = members[role] || {};
      const systemPrompt = `${roleData.prompt}
المتجر: ${bizContext}
${member.personality ? 'شخصيتك: '+escapeHtml(member.personality) : ''}
${member.expertise ? 'خبرتك: '+escapeHtml(member.expertise) : ''}
${member.instructions ? 'تعليمات: '+escapeHtml(member.instructions) : ''}
أجب باختصار وعملية (3-5 جمل) بالعربية. ابدأ مباشرة بالرأي.`;

      try {
        const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'anthropic/claude-haiku-4-5',
            max_tokens: 300,
            system: systemPrompt,
            messages: [{ role: 'user', content: String(question).substring(0, 1000) }]
          })
        });
        const aiData = await aiRes.json();
        const reply = aiData.choices?.[0]?.message?.content || 'لا رد';
        // تحديث عداد التفاعلات
        if (pool) await pool.query(
          'UPDATE digital_team SET total_interactions=total_interactions+1 WHERE user_id=$1 AND role=$2',
          [userId, role]
        ).catch(() => {});
        return { role, name: member.name || roleData.name, icon: roleData.icon, reply: reply.substring(0, 600) };
      } catch(e) {
        return { role, name: member.name || roleData.name, icon: roleData.icon, reply: 'تعذر الحصول على رد' };
      }
    }));

    // تلخيص الاجتماع بالـ AI
    const summaryRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `بناءً على آراء الفريق التالية حول السؤال: "${question}"

${responses.map(r => `${r.icon} ${r.name}: ${r.reply}`).join('\n\n')}

لخّص أبرز نقاط الاتفاق والاختلاف، واذكر التوصية النهائية في جملتين. كن مختصراً وعملياً.`
        }]
      })
    });
    const summaryData = await summaryRes.json();
    const summary = summaryData.choices?.[0]?.message?.content || '';

    res.json({ success: true, question, responses, summary, timestamp: new Date().toISOString() });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// PDF REPORT EXPORT — تصدير تقرير PDF
// ============================================================
app.get('/api/analytics/export-pdf', authenticateToken, async (req, res) => {
  const { period = '30' } = req.query;
  const days = Math.min(365, Math.max(1, parseInt(period) || 30));
  const userId = req.user.id;

  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    const [bp, orders, prev, topCusts, daily, products, statusBreak] = await Promise.all([
      pool.query('SELECT store_name, business_type, currency FROM business_profile WHERE user_id=$1', [userId]),
      pool.query(`SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) as rev, COALESCE(AVG(total),0) as avg FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '${days} days'`, [userId]),
      pool.query(`SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) as rev FROM orders WHERE user_id=$1 AND created_at BETWEEN NOW()-INTERVAL '${days*2} days' AND NOW()-INTERVAL '${days} days'`, [userId]),
      pool.query(`SELECT customer_name, COUNT(*) as orders, SUM(total) as spent FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '${days} days' GROUP BY customer_name ORDER BY spent DESC LIMIT 5`, [userId]),
      pool.query(`SELECT DATE(created_at) as date, SUM(total) as revenue FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '${days} days' GROUP BY DATE(created_at) ORDER BY date`, [userId]),
      pool.query(`SELECT COUNT(*) as cnt, SUM(CASE WHEN stock<=5 THEN 1 ELSE 0 END) as low FROM products WHERE user_id=$1`, [userId]),
      pool.query(`SELECT status, COUNT(*) as count, SUM(total) as revenue FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '${days} days' GROUP BY status`, [userId])
    ]);

    const store = bp.rows[0] || {};
    const cur = store.currency || 'IQD';
    const o = orders.rows[0];
    const pv = prev.rows[0];
    const totalRev = Number(o.rev||0);
    const prevRev = Number(pv.rev||0);
    const growth = prevRev > 0 ? ((totalRev - prevRev) / prevRev * 100).toFixed(1) : 0;
    const now = new Date().toLocaleDateString('ar-IQ', { year:'numeric', month:'long', day:'numeric' });

    // بناء HTML للـ PDF
    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>تقرير SocialOS</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; background: #f8fafc; color: #1e293b; direction: rtl; font-size: 13px; }
  .header { background: linear-gradient(135deg, #4f8ef7, #7c3aed); color: white; padding: 28px 32px; }
  .header h1 { font-size: 22px; font-weight: 900; margin-bottom: 4px; }
  .header p { opacity: .75; font-size: 12px; }
  .header-meta { display: flex; gap: 20px; margin-top: 12px; font-size: 11px; opacity: .8; }
  .content { padding: 24px 32px; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .kpi { background: white; border-radius: 10px; padding: 14px; border: 1px solid #e2e8f0; text-align: center; }
  .kpi-val { font-size: 22px; font-weight: 900; color: #4f8ef7; margin-bottom: 2px; }
  .kpi-lbl { font-size: 10px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: .3px; }
  .kpi-sub { font-size: 10px; color: #94a3b8; margin-top: 2px; }
  .section { background: white; border-radius: 10px; border: 1px solid #e2e8f0; margin-bottom: 16px; overflow: hidden; }
  .section-header { background: #f1f5f9; padding: 10px 16px; font-weight: 700; font-size: 12px; color: #475569; border-bottom: 1px solid #e2e8f0; }
  .section-body { padding: 14px 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #f8fafc; padding: 8px 10px; text-align: right; color: #475569; font-weight: 700; border-bottom: 1px solid #e2e8f0; font-size: 11px; }
  td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; }
  tr:last-child td { border-bottom: none; }
  .chart-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
  .chart-bar-label { width: 60px; font-size: 10px; color: #64748b; }
  .chart-bar-track { flex: 1; height: 8px; background: #f1f5f9; border-radius: 4px; overflow: hidden; }
  .chart-bar-fill { height: 100%; background: linear-gradient(90deg, #4f8ef7, #7c3aed); border-radius: 4px; }
  .chart-bar-val { width: 80px; font-size: 10px; font-weight: 700; text-align: left; color: #475569; }
  .growth-pos { color: #10b981; font-weight: 700; }
  .growth-neg { color: #ef4444; font-weight: 700; }
  .footer { text-align: center; padding: 16px; color: #94a3b8; font-size: 10px; border-top: 1px solid #e2e8f0; margin-top: 8px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 700; }
  .badge-blue { background: #eff6ff; color: #3b82f6; }
  .badge-green { background: #f0fdf4; color: #16a34a; }
  .badge-red { background: #fef2f2; color: #dc2626; }
  .badge-orange { background: #fff7ed; color: #ea580c; }
  @media print { body { background: white; } }
</style>
</head>
<body>
<div class="header">
  <h1>⚡ تقرير الأداء — ${escapeHtml(store.store_name || 'متجري')}</h1>
  <p>${escapeHtml(store.business_type || '')} | آخر ${days} يوم</p>
  <div class="header-meta">
    <span>📅 تاريخ التقرير: ${now}</span>
    <span>💱 العملة: ${cur}</span>
    <span>🔖 SocialOS v2.0</span>
  </div>
</div>
<div class="content">

  <!-- KPIs -->
  <div class="kpi-grid">
    <div class="kpi">
      <div class="kpi-val">${Number(totalRev).toLocaleString('ar-IQ')}</div>
      <div class="kpi-lbl">الإيرادات</div>
      <div class="kpi-sub ${Number(growth)>=0?'growth-pos':'growth-neg'}">${Number(growth)>=0?'↑':'↓'} ${Math.abs(growth)}% مقارنة بالفترة السابقة</div>
    </div>
    <div class="kpi">
      <div class="kpi-val">${parseInt(o.cnt||0).toLocaleString('ar')}</div>
      <div class="kpi-lbl">الطلبات</div>
      <div class="kpi-sub">${parseInt(o.cnt||0)>0?Number(o.avg||0).toFixed(0)+' '+cur+' متوسط':'-'}</div>
    </div>
    <div class="kpi">
      <div class="kpi-val">${topCusts.rows.length}</div>
      <div class="kpi-lbl">العملاء النشطون</div>
      <div class="kpi-sub">في آخر ${days} يوم</div>
    </div>
    <div class="kpi">
      <div class="kpi-val">${parseInt(products.rows[0]?.low||0)}</div>
      <div class="kpi-lbl">مخزون منخفض</div>
      <div class="kpi-sub">من أصل ${parseInt(products.rows[0]?.cnt||0)} منتج</div>
    </div>
  </div>

  <!-- الإيرادات اليومية -->
  <div class="section">
    <div class="section-header">📈 الإيرادات اليومية</div>
    <div class="section-body">
      ${(() => {
        const max = Math.max(...daily.rows.map(r => Number(r.revenue||0)), 1);
        return daily.rows.slice(-14).map(r => {
          const pct = Math.round((Number(r.revenue||0)/max)*100);
          const dt = new Date(r.date).toLocaleDateString('ar', {month:'short',day:'numeric'});
          return `<div class="chart-bar">
            <div class="chart-bar-label">${dt}</div>
            <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${pct}%"></div></div>
            <div class="chart-bar-val">${Number(r.revenue||0).toLocaleString()} ${cur}</div>
          </div>`;
        }).join('') || '<p style="color:#94a3b8;text-align:center;padding:16px">لا بيانات</p>';
      })()}
    </div>
  </div>

  <!-- أفضل العملاء + توزيع الطلبات -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
    <div class="section">
      <div class="section-header">🏆 أفضل 5 عملاء</div>
      <div class="section-body" style="padding:0">
        <table>
          <tr><th>العميل</th><th>الطلبات</th><th>الإنفاق</th></tr>
          ${topCusts.rows.map(c => `<tr>
            <td>${escapeHtml(c.customer_name||'-')}</td>
            <td style="text-align:center">${c.orders}</td>
            <td style="font-weight:700;color:#4f8ef7">${Number(c.spent||0).toLocaleString()} ${cur}</td>
          </tr>`).join('') || '<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:12px">لا بيانات</td></tr>'}
        </table>
      </div>
    </div>
    <div class="section">
      <div class="section-header">📊 توزيع الطلبات بالحالة</div>
      <div class="section-body" style="padding:0">
        <table>
          <tr><th>الحالة</th><th>العدد</th><th>الإيراد</th></tr>
          ${statusBreak.rows.map(s => {
            const labels = {new:'🆕 جديد',confirmed:'✅ مؤكد',processing:'⚙️ جاري',shipped:'🚚 شُحن',delivered:'🚀 تم',cancelled:'❌ ملغي'};
            return `<tr>
              <td>${labels[s.status]||s.status}</td>
              <td style="text-align:center;font-weight:700">${s.count}</td>
              <td>${Number(s.revenue||0).toLocaleString()} ${cur}</td>
            </tr>`;
          }).join('') || '<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:12px">لا بيانات</td></tr>'}
        </table>
      </div>
    </div>
  </div>

</div>
<div class="footer">
  تم إنشاء هذا التقرير تلقائياً بواسطة SocialOS ⚡ | ${now}
</div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="report-${days}days.html"`);
    res.setHeader('X-Report-Type', 'analytics');
    res.send(html);
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

const TEAM_ROLES = {
  sales: { name: 'موظف المبيعات', icon: '💼', desc: 'إغلاق الصفقات والإقناع' },
  customer_service: { name: 'خدمة العملاء', icon: '🎧', desc: 'الشكاوى والدعم' },
  marketing: { name: 'موظف التسويق', icon: '📢', desc: 'الإعلانات والحملات' },
  designer: { name: 'موظف التصميم', icon: '🎨', desc: 'الصور والإعلانات' },
  orders: { name: 'موظف الطلبات', icon: '📦', desc: 'الطلبات والعربون والشحن' },
  advisor: { name: 'المستشار التنفيذي', icon: '🏛️', desc: 'التحليلات والتوصيات' }
};

app.get('/api/team/digital', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.json({ success: true, members: [] });
    const r = await pool.query('SELECT * FROM digital_team WHERE user_id=$1 ORDER BY role', [req.user.id]);
    // أضف الأدوار الناقصة
    const existing = r.rows.map(m => m.role);
    const all = Object.entries(TEAM_ROLES).map(([role, info]) => {
      const found = r.rows.find(m => m.role === role);
      return found || { user_id: req.user.id, role, name: info.name, personality: '', expertise: '', instructions: '', is_active: false, total_interactions: 0 };
    });
    res.json({ success: true, members: all });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.put('/api/team/digital/:role', authenticateToken, async (req, res) => {
  const { role } = req.params;
  if (!TEAM_ROLES[role]) return res.status(400).json({ success: false, message: 'دور غير صالح' });
  const { name, personality, expertise, instructions, is_active } = req.body;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    await pool.query(`
      INSERT INTO digital_team (user_id, role, name, personality, expertise, instructions, is_active, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
      ON CONFLICT (user_id, role) DO UPDATE SET
        name=$3, personality=$4, expertise=$5, instructions=$6,
        is_active=$7, updated_at=NOW()
    `, [req.user.id, role, escapeHtml(name||TEAM_ROLES[role].name),
        escapeHtml(personality||''), escapeHtml(expertise||''),
        escapeHtml(instructions||''), is_active !== undefined ? is_active : true]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// محادثة مع موظف رقمي متخصص
app.post('/api/team/digital/:role/chat', authenticateToken, async (req, res) => {
  const { role } = req.params;
  if (!TEAM_ROLES[role]) return res.status(400).json({ success: false, message: 'دور غير صالح' });
  const { message, history } = req.body;
  if (!message || String(message).length > 2000) return res.status(400).json({ success: false, message: 'الرسالة غير صالحة' });

  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(503).json({ success: false, message: 'AI غير متاح' });

  try {
    let member = { name: TEAM_ROLES[role].name, personality: '', expertise: '', instructions: '' };
    let biz = {};
    if (pool) {
      const [tm, bp] = await Promise.all([
        pool.query('SELECT * FROM digital_team WHERE user_id=$1 AND role=$2', [req.user.id, role]),
        pool.query('SELECT store_name, business_type, business_desc, policies FROM business_profile WHERE user_id=$1', [req.user.id])
      ]);
      if (tm.rows.length) member = tm.rows[0];
      biz = bp.rows[0] || {};
      await pool.query('UPDATE digital_team SET total_interactions=total_interactions+1 WHERE user_id=$1 AND role=$2', [req.user.id, role]);
    }

    const rolePrompts = {
      sales: 'أنت موظف مبيعات محترف. هدفك إغلاق الصفقات وإقناع العملاء بالشراء.',
      customer_service: 'أنت موظف خدمة عملاء متميز. هدفك حل المشاكل وإرضاء العملاء.',
      marketing: 'أنت خبير تسويق رقمي. هدفك وضع استراتيجيات وحملات تسويقية فعالة.',
      designer: 'أنت مصمم إبداعي. هدفك اقتراح أفكار تصميمية جذابة للمحتوى.',
      orders: 'أنت مسؤول الطلبات والشحن. هدفك تنظيم الطلبات وضمان التوصيل.',
      advisor: 'أنت مستشار تنفيذي خبير. هدفك تقديم توصيات استراتيجية لتنمية العمل.'
    };

    const systemPrompt = `${rolePrompts[role]}
المتجر: ${escapeHtml(biz.store_name||'')} — ${escapeHtml(biz.business_type||'')}
${biz.business_desc ? 'الوصف: '+escapeHtml(biz.business_desc) : ''}
${biz.policies ? 'السياسات: '+escapeHtml(biz.policies) : ''}
${member.personality ? 'شخصيتك: '+escapeHtml(member.personality) : ''}
${member.expertise ? 'خبرتك: '+escapeHtml(member.expertise) : ''}
${member.instructions ? 'تعليمات خاصة: '+escapeHtml(member.instructions) : ''}
تحدث بالعربية دائماً. كن عملياً ومحدداً.`;

    const msgs = [
      ...(Array.isArray(history) ? history.slice(-8).map(m => ({ role: m.role, content: String(m.content).substring(0, 500) })) : []),
      { role: 'user', content: String(message).substring(0, 2000) }
    ];

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'anthropic/claude-haiku-4-5', max_tokens: 600, system: systemPrompt, messages: msgs })
    });
    const aiData = await aiRes.json();
    const reply = aiData.choices?.[0]?.message?.content || 'عذراً، لم أتمكن من الرد';
    res.json({ success: true, reply: reply.substring(0, 2000) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// ADVANCED ANALYTICS — التحليلات المتقدمة
// ============================================================

app.get('/api/analytics/advanced', authenticateToken, async (req, res) => {
  const { period = '30', compare = 'false' } = req.query;
  const days = Math.min(365, Math.max(1, parseInt(period) || 30));
  const userId = req.user.id;
  try {
    if (!pool) return res.json({ success: true, data: {} });

    const [current, previous, topProds, custBehavior, dailyTrend] = await Promise.all([
      // الفترة الحالية
      pool.query(`SELECT COUNT(*) as orders, COALESCE(SUM(total),0) as revenue, COALESCE(AVG(total),0) as avg_order
        FROM orders WHERE user_id=$1 AND created_at >= NOW()-INTERVAL '${days} days'`, [userId]),
      // الفترة السابقة للمقارنة
      pool.query(`SELECT COUNT(*) as orders, COALESCE(SUM(total),0) as revenue
        FROM orders WHERE user_id=$1 AND created_at BETWEEN NOW()-INTERVAL '${days*2} days' AND NOW()-INTERVAL '${days} days'`, [userId]),
      // أفضل المنتجات
      pool.query(`SELECT items, COUNT(*) as freq FROM orders WHERE user_id=$1 AND created_at >= NOW()-INTERVAL '${days} days' GROUP BY items LIMIT 10`, [userId]),
      // سلوك العملاء
      pool.query(`SELECT customer_phone, customer_name, COUNT(*) as orders, SUM(total) as spent,
        MAX(created_at) as last_order, MIN(created_at) as first_order
        FROM orders WHERE user_id=$1 AND created_at >= NOW()-INTERVAL '${days} days'
        GROUP BY customer_phone, customer_name ORDER BY spent DESC LIMIT 10`, [userId]),
      // الاتجاه اليومي
      pool.query(`SELECT DATE(created_at) as day, COUNT(*) as orders, SUM(total) as revenue
        FROM orders WHERE user_id=$1 AND created_at >= NOW()-INTERVAL '${days} days'
        GROUP BY DATE(created_at) ORDER BY day`, [userId])
    ]);

    const cur = current.rows[0];
    const prev = previous.rows[0];
    const revenueGrowth = prev.revenue > 0 ? ((cur.revenue - prev.revenue) / prev.revenue * 100).toFixed(1) : 0;
    const ordersGrowth = prev.orders > 0 ? ((cur.orders - prev.orders) / prev.orders * 100).toFixed(1) : 0;

    res.json({
      success: true,
      data: {
        current: { orders: parseInt(cur.orders), revenue: parseFloat(cur.revenue), avg_order: parseFloat(cur.avg_order) },
        previous: { orders: parseInt(prev.orders), revenue: parseFloat(prev.revenue) },
        growth: { revenue: parseFloat(revenueGrowth), orders: parseFloat(ordersGrowth) },
        top_customers: custBehavior.rows,
        daily_trend: dailyTrend.rows,
        period: days
      }
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// توقع المبيعات بالذكاء الاصطناعي
app.post('/api/analytics/forecast', authenticateToken, async (req, res) => {
  const { days = 30 } = req.body;
  const userId = req.user.id;
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_KEY) return res.status(503).json({ success: false, message: 'AI غير متاح' });
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    const [history, products, biz] = await Promise.all([
      pool.query(`SELECT DATE(created_at) as day, COUNT(*) as orders, SUM(total) as revenue
        FROM orders WHERE user_id=$1 AND created_at >= NOW()-INTERVAL '90 days'
        GROUP BY DATE(created_at) ORDER BY day`, [userId]),
      pool.query('SELECT COUNT(*) as total, SUM(CASE WHEN stock<=3 THEN 1 ELSE 0 END) as low_stock FROM products WHERE user_id=$1', [userId]),
      pool.query('SELECT store_name, business_type FROM business_profile WHERE user_id=$1', [userId])
    ]);

    const totalRevenue = history.rows.reduce((s, r) => s + parseFloat(r.revenue || 0), 0);
    const avgDaily = history.rows.length > 0 ? (totalRevenue / 90).toFixed(2) : 0;

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        max_tokens: 700,
        messages: [{
          role: 'user',
          content: `أنت خبير تحليل بيانات. بناءً على بيانات المتجر، قدم توقعاً للـ ${days} يوم القادمة.

المتجر: ${escapeHtml(biz.rows[0]?.store_name||'')} — ${escapeHtml(biz.rows[0]?.business_type||'')}
متوسط الإيراد اليومي (90 يوم): ${avgDaily}
عدد أيام البيانات: ${history.rows.length}
إجمالي المنتجات: ${products.rows[0]?.total||0}
منتجات مخزونها منخفض: ${products.rows[0]?.low_stock||0}
آخر 5 أيام: ${JSON.stringify(history.rows.slice(-5))}

أرجع JSON فقط:
{"predicted_revenue":0,"predicted_orders":0,"confidence":85,"trend":"صاعد/هابط/مستقر","insights":["ملاحظة1","ملاحظة2","ملاحظة3"],"recommendations":["توصية1","توصية2"],"risks":["خطر1"]}`
        }]
      })
    });
    const aiData = await aiRes.json();
    let forecast = aiData.choices?.[0]?.message?.content || '{}';
    try { forecast = JSON.parse(forecast.replace(/```json|```/g, '').trim()); } catch (e) { forecast = {}; }

    // حفظ التوقع
    await pool.query(
      'INSERT INTO sales_forecasts (user_id, forecast_date, predicted_revenue, predicted_orders, confidence, factors) VALUES ($1, NOW()::date, $2, $3, $4, $5)',
      [userId, forecast.predicted_revenue||0, forecast.predicted_orders||0, forecast.confidence||0, JSON.stringify(forecast)]
    ).catch(() => {});

    res.json({ success: true, forecast, avg_daily: avgDaily, data_points: history.rows.length });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// تصدير التقرير
app.get('/api/analytics/export', authenticateToken, async (req, res) => {
  const { period = '30', format = 'csv' } = req.query;
  const days = Math.min(365, Math.max(1, parseInt(period) || 30));
  const userId = req.user.id;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const orders = await pool.query(
      `SELECT id, customer_name, customer_phone, total, status, platform, created_at
       FROM orders WHERE user_id=$1 AND created_at >= NOW()-INTERVAL '${days} days' ORDER BY created_at DESC`,
      [userId]
    );
    if (format === 'csv') {
      const headers = 'رقم الطلب,اسم العميل,الهاتف,المبلغ,الحالة,المصدر,التاريخ';
      const rows = orders.rows.map(o =>
        `${o.id},"${escapeHtml(o.customer_name||'')}","${escapeHtml(o.customer_phone||'')}",${o.total},"${escapeHtml(o.status||'')}","${escapeHtml(o.platform||'')}","${new Date(o.created_at).toLocaleDateString('ar')}"`
      );
      const csv = '\uFEFF' + headers + '\n' + rows.join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="orders-${days}days.csv"`);
      return res.send(csv);
    }
    res.json({ success: true, orders: orders.rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// MIKE — المساعد التنفيذي الذكي
// ============================================================
};
