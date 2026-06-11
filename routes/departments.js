module.exports = function(app, pool, helpers) {
const { escapeHtml, sanitize, authenticateToken, notify, auditLog, esc } = helpers;

// ============================================================
// DEPARTMENTS — الأقسام الستة
// ============================================================

// Mike صلاحيات — مرجع ثابت
const MIKE_PERMISSIONS = {
  auto_approve: [
    'confirm_all_orders',           // تثبيت جميع الطلبات
    'add_product',                   // إضافة منتج جديد
    'reply_comments',                // الرد على تعليقات العملاء
    'publish_regular_posts',         // نشر بوستات عادية
    'issue_invoices',                // إصدار الفواتير
    'update_stock',                  // تحديث كميات المخزون
    'send_reports',                  // إرسال التقارير
    'schedule_posts',                // جدولة منشورات
    'activate_coupon_under_20',      // تفعيل كوبون خصم أقل من 20%
    'purchase_stock_any_amount',     // طلب شراء مخزون بأي مبلغ
  ],
  requires_owner_approval: [
    'set_advertising_budget',        // تحديد أي ميزانية ترويجية — دائماً يرجع للمالك
    'discount_over_20',              // خصم يتجاوز 20%
    'delete_product',                // حذف منتج
    'cancel_order',                  // إلغاء طلب
    'refund_customer',               // استرداد مبلغ لعميل
    'new_ad_campaign',               // حملة إعلانية جديدة
    'change_product_price',          // تغيير سعر منتج
    'publish_paid_content',          // نشر محتوى مدفوع
  ]
};

// الأقسام الستة
const DEPARTMENTS = [
  {
    id: 'customer_service',
    name: 'خدمة العملاء',
    emoji: '💬',
    description: 'الرد على الزبائن، تثبيت الطلبات، إرسال بطاقات الدفع، استقبال وصولات الحوالة',
    auto_tasks: ['reply_customer', 'confirm_order', 'send_payment_cards', 'receive_receipt', 'reply_comments'],
    sends_to: ['orders']
  },
  {
    id: 'orders',
    name: 'الطلبات والفواتير',
    emoji: '📦',
    description: 'تجهيز الفاتورة عند تثبيت الطلب، إضافة وصل الحوالة، متابعة حالة الطلب، إرسال الفاتورة للزبون',
    auto_tasks: ['prepare_invoice', 'attach_receipt', 'track_order', 'send_invoice_whatsapp'],
    sends_to: ['inventory', 'analytics']
  },
  {
    id: 'inventory',
    name: 'المنتجات والمخزن',
    emoji: '🏪',
    description: 'إضافة منتجات جديدة، تحديث الكميات عند البيع، تنبيه عند نفاد المخزون',
    auto_tasks: ['add_product', 'update_stock', 'low_stock_alert'],
    sends_to: ['analytics']
  },
  {
    id: 'design_publish',
    name: 'التصميم والنشر',
    emoji: '🎨',
    description: 'تصميم صور المنتجات بـ DALL-E، إضافة اللوغو ورقم الهاتف، كتابة البوستات ونشرها على وسائل التواصل',
    auto_tasks: ['design_image', 'add_logo_watermark', 'write_post', 'publish_post', 'schedule_post'],
    sends_to: ['promotion', 'analytics']
  },
  {
    id: 'promotion',
    name: 'الترويج والإعلانات',
    emoji: '📢',
    description: 'إنشاء حملات إعلانية، تحديد الاستهداف، تقديم نصائح ترويجية — الميزانية تحتاج موافقة المالك دائماً',
    auto_tasks: ['create_ad_draft', 'suggest_targeting', 'promotion_tips'],
    requires_approval: ['set_budget', 'launch_paid_campaign'],
    sends_to: ['analytics']
  },
  {
    id: 'analytics',
    name: 'التحليل والتقارير',
    emoji: '📊',
    description: 'تقارير يومية وأسبوعية وشهرية وسنوية، تحليل المبيعات والمنتجات، نصائح تطوير العمل',
    auto_tasks: ['daily_report', 'weekly_report', 'monthly_report', 'yearly_report', 'sales_analysis', 'business_tips'],
    sends_to: ['mike']
  }
];

// ============================================================
// API — جلب الأقسام
// ============================================================
app.get('/api/departments', authenticateToken, async (req, res) => {
  try {
    res.json({ success: true, departments: DEPARTMENTS, mike_permissions: MIKE_PERMISSIONS });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// API — جلب صلاحيات Mike
// ============================================================
app.get('/api/mike/permissions', authenticateToken, async (req, res) => {
  try {
    res.json({ success: true, permissions: MIKE_PERMISSIONS });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// WORKFLOW TASKS — تدفق المهام بين الأقسام
// ============================================================

// إنشاء مهمة جديدة
app.post('/api/workflow/tasks', authenticateToken, async (req, res) => {
  const { from_dept, to_dept, task_type, title, description, data, priority } = req.body;
  const userId = req.user.id;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    // التحقق من صلاحيات Mike
    let requires_mike_approval = false;
    let requires_owner_approval = false;

    if (MIKE_PERMISSIONS.requires_owner_approval.includes(task_type)) {
      requires_owner_approval = true;
    }

    const r = await pool.query(
      `INSERT INTO workflow_tasks (user_id, from_dept, to_dept, task_type, title, description, data, priority, requires_mike_approval, requires_owner_approval)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [userId, from_dept, to_dept, task_type, sanitize(title||''), sanitize(description||''),
       JSON.stringify(data||{}), priority||'normal', requires_mike_approval, requires_owner_approval]
    );

    const task = r.rows[0];

    // إشعار Mike إذا تحتاج موافقته
    if (requires_owner_approval) {
      await notify(userId, `⚠️ Mike — مطلوب موافقتك`, `${title} — من قسم ${from_dept}`, 'mike_approval');
    } else {
      // تنفيذ تلقائي
      await pool.query('UPDATE workflow_tasks SET status=$1, completed_at=NOW() WHERE id=$2', ['completed', task.id]);
      await notify(userId, `✅ ${title}`, `تم التنفيذ تلقائياً من قسم ${from_dept}`, 'workflow');
    }

    res.json({ success: true, task: r.rows[0], requires_owner_approval });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// جلب المهام المعلقة لـ Mike
app.get('/api/workflow/pending', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query(
      `SELECT * FROM workflow_tasks WHERE user_id=$1 AND (requires_owner_approval=true OR requires_mike_approval=true) AND status='pending' ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, tasks: r.rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// جلب كل المهام
app.get('/api/workflow/tasks', authenticateToken, async (req, res) => {
  const { dept, status } = req.query;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    let q = 'SELECT * FROM workflow_tasks WHERE user_id=$1';
    const params = [req.user.id];
    if (dept) { q += ` AND (from_dept=$${params.length+1} OR to_dept=$${params.length+1})`; params.push(dept); }
    if (status) { q += ` AND status=$${params.length+1}`; params.push(status); }
    q += ' ORDER BY created_at DESC LIMIT 100';
    const r = await pool.query(q, params);
    res.json({ success: true, tasks: r.rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// موافقة Mike على مهمة
app.post('/api/workflow/tasks/:id/approve', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT * FROM workflow_tasks WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'المهمة غير موجودة' });

    await pool.query(
      'UPDATE workflow_tasks SET status=$1, approved_by=$2, approved_at=NOW(), completed_at=NOW() WHERE id=$3',
      ['completed', 'owner', req.params.id]
    );
    await notify(req.user.id, '✅ تمت الموافقة', `تمت الموافقة على: ${r.rows[0].title}`, 'workflow');
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// رفض Mike لمهمة
app.post('/api/workflow/tasks/:id/reject', authenticateToken, async (req, res) => {
  const { reason } = req.body;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    await pool.query(
      'UPDATE workflow_tasks SET status=$1, rejection_reason=$2, completed_at=NOW() WHERE id=$3 AND user_id=$4',
      ['rejected', sanitize(reason||''), req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// PAYMENT CARDS — بطاقات الدفع
// ============================================================

// جلب بطاقات الدفع
app.get('/api/payment-cards', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query('SELECT * FROM payment_cards WHERE user_id=$1 AND is_active=true ORDER BY id', [req.user.id]);
    res.json({ success: true, cards: r.rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// إضافة بطاقة دفع
app.post('/api/payment-cards', authenticateToken, async (req, res) => {
  const { card_type, card_number, card_holder, notes } = req.body;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const r = await pool.query(
      `INSERT INTO payment_cards (user_id, card_type, card_number, card_holder, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.id, sanitize(card_type||''), sanitize(card_number||''), sanitize(card_holder||''), sanitize(notes||'')]
    );
    res.json({ success: true, card: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// تعديل بطاقة دفع
app.put('/api/payment-cards/:id', authenticateToken, async (req, res) => {
  const { card_type, card_number, card_holder, notes, is_active } = req.body;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    await pool.query(
      `UPDATE payment_cards SET card_type=$1, card_number=$2, card_holder=$3, notes=$4, is_active=$5 WHERE id=$6 AND user_id=$7`,
      [sanitize(card_type||''), sanitize(card_number||''), sanitize(card_holder||''), sanitize(notes||''), is_active!==false, req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// حذف بطاقة دفع
app.delete('/api/payment-cards/:id', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    await pool.query('DELETE FROM payment_cards WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// إرسال بطاقات الدفع للزبون عبر WhatsApp
// ============================================================
app.post('/api/payment-cards/send-to-customer', authenticateToken, async (req, res) => {
  const { customer_phone, customer_name, order_id, deposit_amount, total_amount } = req.body;
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    const [cardsR, bpR] = await Promise.all([
      pool.query('SELECT * FROM payment_cards WHERE user_id=$1 AND is_active=true ORDER BY id', [req.user.id]),
      pool.query('SELECT store_name, currency FROM business_profile WHERE user_id=$1', [req.user.id])
    ]);

    const cards = cardsR.rows;
    const bp = bpR.rows[0] || {};
    const storeName = bp.store_name || 'متجرنا';
    const currency = bp.currency || 'IQD';

    if (!cards.length) return res.status(400).json({ success: false, message: 'لا توجد بطاقات دفع مضافة' });

    // بناء رسالة WhatsApp
    let msg = `💳 *طرق الدفع — ${storeName}*\n\n`;
    msg += `👤 عزيزي ${sanitize(customer_name||'')}\n`;
    if (order_id) msg += `📦 طلب رقم: #${order_id}\n`;
    if (deposit_amount) msg += `💰 مبلغ العربون: *${Number(deposit_amount).toLocaleString()} ${currency}*\n`;
    if (total_amount) msg += `💵 المبلغ الكلي: *${Number(total_amount).toLocaleString()} ${currency}*\n`;
    msg += `\n📋 *أرقام الحوالة:*\n`;

    cards.forEach(card => {
      msg += `\n━━━━━━━━━━━━━━\n`;
      msg += `💳 ${card.card_type}\n`;
      msg += `🔢 ${card.card_number}\n`;
      msg += `👤 ${card.card_holder}\n`;
      if (card.notes) msg += `📝 ${card.notes}\n`;
    });

    msg += `\n━━━━━━━━━━━━━━\n`;
    msg += `📸 *بعد التحويل أرسل لنا صورة وصل الحوالة*\n`;
    msg += `\nشكراً لثقتك ⚡ ${storeName}`;

    const phone = String(customer_phone||'').replace(/[^0-9]/g, '');
    const waPhone = phone.startsWith('0') ? '964' + phone.slice(1) : phone;
    const waUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`;

    res.json({ success: true, wa_url: waUrl, message: msg });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

};
