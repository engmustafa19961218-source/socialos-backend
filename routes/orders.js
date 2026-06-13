module.exports = function(app, pool, helpers) {
const { escapeHtml, sanitize, authenticateToken, rateLimit, notify, auditLog, formatCurrency, esc } = helpers;

// ============================================================
app.post('/api/orders/:id/notify-customer', authenticateToken, async (req, res) => {
  const { type } = req.body; // 'confirmed' | 'shipped' | 'delivered'
  const VALID = ['confirmed','shipped','delivered','cancelled'];
  if (!VALID.includes(type)) return res.status(400).json({ success: false, message: 'نوع غير صالح' });

  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });
    const [ordR, bpR] = await Promise.all([
      pool.query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]),
      pool.query('SELECT store_name, currency, whatsapp_number FROM business_profile WHERE user_id=$1', [req.user.id])
    ]);
    if (!ordR.rows.length) return res.status(404).json({ success: false, message: 'الطلب غير موجود' });

    const o = ordR.rows[0];
    const bp = bpR.rows[0] || {};
    const cur = bp.currency || 'IQD';
    const storeName = bp.store_name || 'متجرنا';

    const phone = String(o.customer_phone || '').replace(/[^0-9]/g, '');
    const waPhone = phone.startsWith('0') ? '964' + phone.slice(1) : phone;

    const msgs = {
      confirmed: `✅ *تم تأكيد طلبك!*\n\nأهلاً ${escapeHtml(o.customer_name||'')} 😊\nطلبك رقم *#${o.id}* تم تأكيده بنجاح.\n💰 المبلغ: ${Number(o.total||0).toLocaleString()} ${cur}\n\nسنتواصل معك قريباً للتوصيل 🚚\n\n⚡ ${storeName}`,
      shipped: `🚚 *تم شحن طلبك!*\n\nأهلاً ${escapeHtml(o.customer_name||'')} 📦\nطلبك رقم *#${o.id}* في الطريق إليك.\n${o.delivery_company ? `🏢 شركة التوصيل: ${escapeHtml(o.delivery_company)}` : ''}\n${o.delivery_link ? `🔍 رقم التتبع: *${escapeHtml(o.delivery_link)}*` : ''}\n\nنتمنى وصوله سريعاً! ⚡ ${storeName}`,
      delivered: `🎉 *تم توصيل طلبك!*\n\nأهلاً ${escapeHtml(o.customer_name||'')} 🌟\nوصل طلبك رقم *#${o.id}* بنجاح.\n\nنرجو أن تكون راضياً 😊\nشاركنا رأيك ليستفيد الجميع!\n\nشكراً لثقتك ⚡ ${storeName}`,
      cancelled: `❌ *تم إلغاء طلبك*\n\nأهلاً ${escapeHtml(o.customer_name||'')} 😔\nتم إلغاء طلبك رقم *#${o.id}*.\n${o.notes ? `السبب: ${escapeHtml(o.notes)}` : ''}\n\nللاستفسار تواصل معنا 📞\n⚡ ${storeName}`
    };

    const msg = msgs[type];
    const waUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`;

    // محاولة إرسال تلقائي عبر WhatsApp API إذا كان مربوطاً
    let autoSent = false;
    const wa = await pool.query(
      'SELECT access_token, whatsapp_phone_id FROM social_accounts WHERE user_id=$1 AND platform=$2 AND is_connected=true',
      [req.user.id, 'whatsapp']
    );
    if (wa.rows[0]?.access_token && wa.rows[0]?.whatsapp_phone_id) {
      try {
        const waRes = await fetch(`https://graph.facebook.com/v19.0/${wa.rows[0].whatsapp_phone_id}/messages`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${wa.rows[0].access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to: waPhone, type: 'text', text: { body: msg } })
        });
        const waData = await waRes.json();
        if (!waData.error) autoSent = true;
      } catch(e) {}
    }

    await auditLog(req.user.id, `notify_${type}`, 'orders', parseInt(req.params.id), waPhone, req.ip);
    res.json({ success: true, wa_url: waUrl, auto_sent: autoSent, message: autoSent ? 'تم الإرسال تلقائياً' : 'رابط واتساب جاهز' });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// تتبع تلقائي عند تغيير حالة الطلب
// نضيف هذا الـ middleware بعد تحديث حالة الطلب في PUT /api/orders/:id


// ============================================================
// ORDERS
// ============================================================
app.post('/api/orders', authenticateToken, async (req, res) => {
  const { customer_name, customer_phone, customer_address, items, total, deposit, deposit_type, payment_method, delivery_company, delivery_link, notes, platform, coupon_code, discount, loyalty_points_used, card_info } = req.body;
  const userId = req.user.id;
  if (total !== undefined && (parseFloat(total) < 0 || isNaN(parseFloat(total)))) return res.status(400).json({ success: false, message: 'المبلغ غير صحيح' });
  try {
    if (pool) {
      // Check emergency
      const em = await pool.query('SELECT * FROM emergency_mode WHERE user_id=$1', [userId]);
      if (em.rows[0]?.is_active && em.rows[0]?.stop_orders)
        return res.status(503).json({ success: false, message: em.rows[0].message || 'الطلبات متوقفة مؤقتاً' });

      const r = await pool.query(
        `INSERT INTO orders (user_id,customer_name,customer_phone,customer_address,items,total,deposit,deposit_type,payment_method,delivery_company,delivery_link,notes,platform,coupon_code,discount,loyalty_points_used,card_info)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [userId, customer_name, customer_phone, customer_address||'', JSON.stringify(items||[]), total||0, deposit||0, deposit_type||'full', payment_method||'cash', delivery_company||'', delivery_link||'', notes||'', platform||'', coupon_code||'', discount||0, loyalty_points_used||0, escapeHtml(card_info||'')]
      );
      const order = r.rows[0];
      await notify(userId, '🛒 طلب جديد!', `${customer_name} — ${formatCurrency(total)}`, 'order');
      await auditLog(userId, 'create_order', 'orders', order.id, `${customer_name} - ${total}`, req.ip);

      // WhatsApp notification
      const bpR = await pool.query('SELECT whatsapp_number, currency FROM business_profile WHERE user_id=$1', [userId]);
      let waUrl = null;
      if (bpR.rows[0]?.whatsapp_number) {
        const cleanWa = bpR.rows[0].whatsapp_number.replace(/[^0-9]/g, '');
        const waPhone = cleanWa.startsWith('0') ? '964' + cleanWa.slice(1) : cleanWa;
        const cur = bpR.rows[0]?.currency || 'IQD';
        const waMsg = `🛒 *طلب جديد #${order.id}*\n👤 ${customer_name}\n📱 ${customer_phone}\n💰 ${formatCurrency(total, cur)}\n${notes ? '📝 ' + notes : ''}\n⚡ SocialOS`;
        waUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(waMsg)}`;
      }
      return res.json({ success: true, order, wa_notify_url: waUrl });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/orders', authenticateToken, async (req, res) => {
  const { status, q } = req.query;
  try {
    if (pool) {
      let query = 'SELECT * FROM orders WHERE user_id=$1';
      const params = [req.user.id];
      if (status) { query += ' AND status=$2'; params.push(status); }
      if (q) { query += ` AND (customer_name ILIKE $${params.length+1} OR customer_phone ILIKE $${params.length+1})`; params.push(`%${q}%`); }
      query += ' ORDER BY created_at DESC';
      const r = await pool.query(query, params);
      return res.json({ orders: r.rows });
    }
  } catch (e) {}
  res.json({ orders: [] });
});

app.put('/api/orders/:id', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const allowed = ['status','customer_name','customer_phone','customer_address','items','total','deposit','deposit_type','payment_method','delivery_company','delivery_link','notes','platform','card_info'];
      const updates = {};
      for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
      if (!Object.keys(updates).length) return res.status(400).json({ success: false, message: 'لا توجد حقول للتحديث' });
      const fields = Object.keys(updates).map((k, i) => `${k}=$${i+3}`).join(', ');
      await pool.query(`UPDATE orders SET ${fields} WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id, ...Object.values(updates)]);
      await auditLog(req.user.id, 'update_order', 'orders', parseInt(req.params.id), JSON.stringify(updates), req.ip);

      // إشعار تلقائي للعميل عند تغيير الحالة
      const autoNotifyStatuses = ['confirmed', 'shipped', 'delivered', 'cancelled'];
      if (updates.status && autoNotifyStatuses.includes(updates.status)) {
        try {
          const [ordR, bpR, waR] = await Promise.all([
            pool.query('SELECT customer_name, customer_phone, total, delivery_company, delivery_link, notes FROM orders WHERE id=$1', [req.params.id]),
            pool.query('SELECT store_name, currency FROM business_profile WHERE user_id=$1', [req.user.id]),
            pool.query('SELECT access_token, whatsapp_phone_id FROM social_accounts WHERE user_id=$1 AND platform=$2 AND is_connected=true', [req.user.id, 'whatsapp'])
          ]);
          const o = ordR.rows[0];
          const bp = bpR.rows[0] || {};
          if (o?.customer_phone) {
            const phone = o.customer_phone.replace(/[^0-9]/g, '');
            const waPhone = phone.startsWith('0') ? '964' + phone.slice(1) : phone;
            const cur = bp.currency || 'IQD';
            const store = bp.store_name || 'متجرنا';

            // ===================================================
            // عند تثبيت الطلب — موظف خدمة العملاء يرسل بطاقات الدفع تلقائياً
            // ===================================================
            if (updates.status === 'confirmed') {
              try {
                const cardsR = await pool.query(
                  'SELECT * FROM payment_cards WHERE user_id=$1 AND is_active=true ORDER BY id',
                  [req.user.id]
                );
                const cards = cardsR.rows;
                if (cards.length > 0) {
                  const fullOrderR = await pool.query('SELECT * FROM orders WHERE id=$1', [req.params.id]);
                  const fo = fullOrderR.rows[0] || o;
                  const dep = parseFloat(fo.deposit) || 0;
                  const tot = parseFloat(fo.total) || 0;

                  let payMsg = `💳 *أرقام الدفع — ${store}*\n\n`;
                  payMsg += `أهلاً ${escapeHtml(o.customer_name||'')} 😊\n`;
                  payMsg += `📦 طلب رقم: *#${req.params.id}*\n`;
                  payMsg += `💵 المبلغ الكلي: *${Number(tot).toLocaleString()} ${cur}*\n`;
                  if (dep > 0) payMsg += `💰 العربون المطلوب: *${Number(dep).toLocaleString()} ${cur}*\n`;
                  payMsg += `\n📋 *أرقام الحوالة:*\n`;
                  cards.forEach(card => {
                    payMsg += `\n━━━━━━━━━━━━━━\n`;
                    payMsg += `💳 ${card.card_type}\n`;
                    payMsg += `🔢 ${card.card_number}\n`;
                    payMsg += `👤 ${card.card_holder}\n`;
                    if (card.notes) payMsg += `📝 ${card.notes}\n`;
                  });
                  payMsg += `\n━━━━━━━━━━━━━━\n`;
                  payMsg += `📸 *بعد التحويل أرسل لنا صورة وصل الحوالة لإكمال الطلب*\n`;
                  payMsg += `\nشكراً لثقتك ⚡ ${store}`;

                  // إرسال تلقائي عبر WhatsApp API
                  if (waR.rows[0]?.access_token && waR.rows[0]?.whatsapp_phone_id) {
                    await fetch(`https://graph.facebook.com/v19.0/${waR.rows[0].whatsapp_phone_id}/messages`, {
                      method: 'POST',
                      headers: { 'Authorization': `Bearer ${waR.rows[0].access_token}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ messaging_product: 'whatsapp', to: waPhone, type: 'text', text: { body: payMsg } })
                    }).catch(() => {});
                  }

                  // حفظ رابط الإرسال اليدوي
                  const payWaUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(payMsg)}`;
                  await pool.query('UPDATE orders SET payment_wa_link=$1 WHERE id=$2', [payWaUrl, req.params.id]).catch(() => {});

                  // 💬 خدمة عملاء → 🏪 مخزن: خصم الكمية بعد تثبيت الطلب
                  await pool.query(
                    `INSERT INTO workflow_tasks (user_id, from_dept, to_dept, task_type, title, data, status)
                     VALUES ($1,'customer_service','inventory','deduct_stock',$2,$3,'pending')`,
                    [req.user.id, `خصم مخزون للطلب #${req.params.id}`,
                     JSON.stringify({ order_id: req.params.id })]
                  ).catch(() => {});

                  // 💬 خدمة عملاء → 📊 تحليل: تسجيل الطلب المؤكد
                  await pool.query(
                    `INSERT INTO workflow_tasks (user_id, from_dept, to_dept, task_type, title, data, status)
                     VALUES ($1,'customer_service','analytics','order_confirmed',$2,$3,'completed')`,
                    [req.user.id, `طلب مؤكد #${req.params.id}`,
                     JSON.stringify({ order_id: req.params.id, total: o.total })]
                  ).catch(() => {});

                  // إنشاء مهمة workflow لقسم الطلبات — انتظار وصل الحوالة
                  await pool.query(
                    `INSERT INTO workflow_tasks (user_id, from_dept, to_dept, task_type, title, description, data, status)
                     VALUES ($1, 'customer_service', 'orders', 'awaiting_receipt', $2, $3, $4, 'pending')`,
                    [req.user.id,
                     `انتظار وصل الحوالة — طلب #${req.params.id}`,
                     `تم إرسال بطاقات الدفع لـ ${escapeHtml(o.customer_name||'')} — في انتظار صورة الوصل`,
                     JSON.stringify({ order_id: req.params.id, customer_name: o.customer_name, customer_phone: o.customer_phone })]
                  ).catch(() => {});
                }
              } catch(e) { /* لا نوقف العملية */ }
            }

            const statusMsgs = {
              confirmed: `✅ *تم تأكيد طلبك!*\n\nأهلاً ${escapeHtml(o.customer_name||'')} 😊\nطلبك رقم *#${req.params.id}* مؤكد.\n💰 ${Number(o.total||0).toLocaleString()} ${cur}\n⚡ ${store}`,
              shipped:   `🚚 *تم شحن طلبك!*\n\nأهلاً ${escapeHtml(o.customer_name||'')} 📦\nطلبك في الطريق${o.delivery_company?'\n🏢 '+escapeHtml(o.delivery_company):''}${o.delivery_link?'\n🔍 تتبع: *'+escapeHtml(o.delivery_link)+'*':''}\n⚡ ${store}`,
              delivered: `🎉 *وصل طلبك!*\n\nأهلاً ${escapeHtml(o.customer_name||'')} 🌟\nطلبك رقم *#${req.params.id}* وصل.\nنرجو رضاك 😊 ⚡ ${store}`,
              cancelled: `❌ *إلغاء الطلب*\n\nأهلاً ${escapeHtml(o.customer_name||'')}\nتم إلغاء طلبك #${req.params.id}${o.notes?'\nالسبب: '+escapeHtml(o.notes):''}\n⚡ ${store}`
            };
            const msg = statusMsgs[updates.status];
            // إرسال تلقائي عبر WhatsApp API إن كان مربوطاً
            if (waR.rows[0]?.access_token && waR.rows[0]?.whatsapp_phone_id) {
              await fetch(`https://graph.facebook.com/v19.0/${waR.rows[0].whatsapp_phone_id}/messages`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${waR.rows[0].access_token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ messaging_product: 'whatsapp', to: waPhone, type: 'text', text: { body: msg } })
              }).catch(() => {});
            }
            // حفظ الرابط في الطلب للاستخدام اليدوي
            const waUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`;
            await pool.query('UPDATE orders SET delivery_wa_link=$1 WHERE id=$2', [waUrl, req.params.id]).catch(() => {});
          }
        } catch(e) { /* لا نوقف العملية إذا فشل الإشعار */ }
      }

      return res.json({ success: true });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// استقبال وصل الحوالة — يرسله لقسم الطلبات لإضافته للفاتورة
// ============================================================
app.post('/api/orders/:id/receipt', authenticateToken, async (req, res) => {
  const { receipt_image } = req.body;
  if (!receipt_image) return res.status(400).json({ success: false, message: 'صورة الوصل مطلوبة' });
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'DB غير متاحة' });

    // حفظ صورة الوصل في الطلب
    await pool.query('UPDATE orders SET receipt_image=$1 WHERE id=$2 AND user_id=$3', [receipt_image, req.params.id, req.user.id]);

    // إضافة الوصل للفاتورة المرتبطة إن وجدت
    await pool.query('UPDATE invoices SET receipt_image=$1 WHERE order_id=$2 AND user_id=$3', [receipt_image, req.params.id, req.user.id]);

    // تحديث مهمة workflow — تم استلام الوصل
    await pool.query(
      `UPDATE workflow_tasks SET status='completed', completed_at=NOW(), data=data||$1
       WHERE user_id=$2 AND task_type='awaiting_receipt' AND (data->>'order_id')=$3 AND status='pending'`,
      [JSON.stringify({ receipt_received: true }), req.user.id, String(req.params.id)]
    ).catch(() => {});

    // إنشاء مهمة جديدة لقسم الطلبات — أضف الوصل للفاتورة
    await pool.query(
      `INSERT INTO workflow_tasks (user_id, from_dept, to_dept, task_type, title, description, data, status)
       VALUES ($1, 'customer_service', 'orders', 'receipt_received', $2, $3, $4, 'pending')`,
      [req.user.id,
       `📸 وصل حوالة جديد — طلب #${req.params.id}`,
       'تم استلام صورة وصل الحوالة من الزبون — يرجى إضافته للفاتورة',
       JSON.stringify({ order_id: req.params.id, receipt_image: receipt_image.substring(0, 100) + '...' })]
    ).catch(() => {});

    // إشعار للتاجر
    await notify(req.user.id, '📸 وصل حوالة جديد!', `تم استلام وصل الحوالة للطلب #${req.params.id}`, 'receipt');

    res.json({ success: true, message: 'تم استلام الوصل وإرساله لقسم الطلبات' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/orders/:id', authenticateToken, async (req, res) => {
  try {
    if (pool) { await pool.query('DELETE FROM orders WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]); }
    return res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/orders/:id/whatsapp', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const [r, bpR] = await Promise.all([
        pool.query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]),
        pool.query('SELECT currency FROM business_profile WHERE user_id=$1', [req.user.id])
      ]);
      if (!r.rows.length) return res.status(404).json({ message: 'الطلب غير موجود' });
      const o = r.rows[0];
      const cur = bpR.rows[0]?.currency || 'IQD';
      let items = [];
      try { items = JSON.parse(o.items || '[]'); } catch(e) {}
      const itemsText = items.map(i => i.description||'').filter(Boolean).join(', ') || 'طلب';
      const msg = `🧾 *فاتورة طلب #${o.id}*\n👤 ${o.customer_name}\n📱 ${o.customer_phone}\n📦 ${itemsText}\n💰 ${formatCurrency(o.total, cur)}${o.deposit>0?`\n💵 عربون: ${formatCurrency(o.deposit, cur)}\n💳 متبقي: ${formatCurrency(o.total-o.deposit, cur)}`:''}\n${o.notes?`📝 ${o.notes}\n`:''}\nشكراً! ⚡ SocialOS`;
      const phone = o.customer_phone.replace(/[^0-9]/g, '');
      const waPhone = phone.startsWith('0') ? '964' + phone.slice(1) : phone;
      return res.json({ success: true, url: `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}` });
    }
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ============================================================
// CUSTOMERS
// ============================================================
app.post('/api/customers', authenticateToken, async (req, res) => {
  const { name, phone, address, notes, tags } = req.body;
  if (!name || !phone) return res.status(400).json({ success: false, message: 'الاسم والهاتف مطلوبان' });
  try {
    if (pool) {
      const r = await pool.query(
        'INSERT INTO customers (user_id, name, phone, address, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [req.user.id, name, phone, address||'', notes||'']
      );
      return res.json({ success: true, customer: r.rows[0] });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/customers', authenticateToken, async (req, res) => {
  const { q } = req.query;
  try {
    if (pool) {
      let query = 'SELECT * FROM customers WHERE user_id=$1';
      const params = [req.user.id];
      if (q) { query += ' AND (name ILIKE $2 OR phone ILIKE $2)'; params.push(`%${q}%`); }
      query += ' ORDER BY created_at DESC';
      const r = await pool.query(query, params);
      return res.json({ customers: r.rows });
    }
  } catch (e) {}
  res.json({ customers: [] });
});

app.put('/api/customers/:id', authenticateToken, async (req, res) => {
  const { name, phone, address, notes, tags } = req.body;
  try {
    if (pool) {
      await pool.query('UPDATE customers SET name=$1,phone=$2,address=$3,notes=$4 WHERE id=$5 AND user_id=$6',
        [name, phone, address||'', notes||'', JSON.stringify(tags||[]), req.params.id, req.user.id]);
      return res.json({ success: true });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/customers/:id', authenticateToken, async (req, res) => {
  try {
    if (pool) { await pool.query('DELETE FROM customers WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]); }
    return res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/crm/:phone', authenticateToken, async (req, res) => {
  try {
    if (pool) {
      const [cust, ords, totals, loyalty] = await Promise.all([
        pool.query('SELECT * FROM customers WHERE user_id=$1 AND phone=$2', [req.user.id, req.params.phone]),
        pool.query('SELECT * FROM orders WHERE user_id=$1 AND customer_phone=$2 ORDER BY created_at DESC', [req.user.id, req.params.phone]),
        pool.query('SELECT SUM(total) as total, COUNT(*) as cnt FROM orders WHERE user_id=$1 AND customer_phone=$2', [req.user.id, req.params.phone]),
        pool.query('SELECT * FROM loyalty_points WHERE user_id=$1 AND customer_phone=$2', [req.user.id, req.params.phone])
      ]);
      return res.json({ success: true, customer: cust.rows[0]||null, orders: ords.rows, stats: { total_orders: parseInt(totals.rows[0]?.cnt||0), total_spent: parseFloat(totals.rows[0]?.total||0), last_order: ords.rows[0]?.created_at||null }, loyalty: loyalty.rows[0]||{ points: 0 } });
    }
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ============================================================
// ANALYTICS
// ============================================================
app.get('/api/analytics/dashboard', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    if (pool) {
      const [ordersData, revenueChart, topCustomers, products, lowStock] = await Promise.all([
        pool.query('SELECT SUM(total) as revenue, COUNT(*) as count, status FROM orders WHERE user_id=$1 GROUP BY status', [userId]),
        pool.query(`SELECT DATE(created_at) as date, SUM(total) as revenue, COUNT(*) as orders FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '14 days' GROUP BY DATE(created_at) ORDER BY date`, [userId]),
        pool.query(`SELECT customer_name, customer_phone, COUNT(*) as orders_count, SUM(total) as total_spent FROM orders WHERE user_id=$1 GROUP BY customer_name,customer_phone ORDER BY total_spent DESC LIMIT 5`, [userId]),
        pool.query('SELECT COUNT(*) as count FROM products WHERE user_id=$1', [userId]),
        pool.query('SELECT COUNT(*) as count FROM products WHERE user_id=$1 AND stock<=5', [userId])
      ]);
      const revenue = ordersData.rows.reduce((a, r) => a + parseFloat(r.revenue||0), 0);
      const ordersCount = ordersData.rows.reduce((a, r) => a + parseInt(r.count||0), 0);
      return res.json({ success: true, totals: { revenue, orders: ordersCount }, orders_by_status: ordersData.rows, revenue_chart: revenueChart.rows, top_customers: topCustomers.rows, products_count: parseInt(products.rows[0]?.count||0), low_stock: parseInt(lowStock.rows[0]?.count||0) });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
  res.json({ success: true, totals: { revenue: 0, orders: 0 }, revenue_chart: [], top_customers: [] });
});

app.get('/api/analytics/report', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { period } = req.query;
  const days = period === 'month' ? 30 : period === 'year' ? 365 : 7;
  try {
    if (pool) {
      const [orders, prevOrders, topCustomers, daily, statusBreak, bp] = await Promise.all([
        pool.query(`SELECT COUNT(*) as cnt, SUM(total) as rev, SUM(deposit) as dep FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '${days} days'`, [userId]),
        pool.query(`SELECT COUNT(*) as cnt, SUM(total) as rev FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '${days*2} days' AND created_at<NOW()-INTERVAL '${days} days'`, [userId]),
        pool.query(`SELECT customer_name, customer_phone, COUNT(*) as orders, SUM(total) as spent FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '${days} days' GROUP BY customer_name,customer_phone ORDER BY spent DESC LIMIT 10`, [userId]),
        pool.query(`SELECT DATE(created_at) as date, SUM(total) as revenue, COUNT(*) as orders FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '${days} days' GROUP BY DATE(created_at) ORDER BY date`, [userId]),
        pool.query(`SELECT status, COUNT(*) as count, SUM(total) as revenue FROM orders WHERE user_id=$1 AND created_at>=NOW()-INTERVAL '${days} days' GROUP BY status`, [userId]),
        pool.query('SELECT business_type FROM business_profile WHERE user_id=$1', [userId])
      ]);
      const totalRev = parseFloat(orders.rows[0]?.rev||0);
      const totalCnt = parseInt(orders.rows[0]?.cnt||0);
      const prevRev = parseFloat(prevOrders.rows[0]?.rev||0);
      const prevCnt = parseInt(prevOrders.rows[0]?.cnt||0);

      // مؤشرات KPI حسب نوع العمل
      const bizType = bp.rows[0]?.business_type || 'other';
      const kpiByType = {
        restaurant:  { label: 'متوسط قيمة الطلب المستهدف', target: 8000,  unit: 'د.ع', tip: 'المطاعم تستهدف متوسط طلب 8,000–15,000 دينار' },
        retail:      { label: 'معدل تكرار الشراء المستهدف', target: 2,    unit: 'مرة/شهر', tip: 'التجزئة الناجحة تحقق 2+ عمليات شراء شهرياً لكل عميل' },
        fashion:     { label: 'متوسط قيمة الطلب المستهدف', target: 25000, unit: 'د.ع', tip: 'الأزياء تستهدف متوسط طلب 25,000+ دينار' },
        electronics: { label: 'متوسط قيمة الطلب المستهدف', target: 80000, unit: 'د.ع', tip: 'الإلكترونيات تستهدف متوسط طلب 80,000+ دينار' },
        perfume:     { label: 'متوسط قيمة الطلب المستهدف', target: 20000, unit: 'د.ع', tip: 'العطور تستهدف متوسط طلب 20,000+ دينار' },
        health:      { label: 'معدل العودة المستهدف', target: 60, unit: '%', tip: 'الصحة والجمال تستهدف 60%+ من العملاء يعودون' },
        services:    { label: 'معدل العودة المستهدف', target: 70, unit: '%', tip: 'الخدمات تستهدف 70%+ من العملاء يعودون' },
        other:       { label: 'متوسط قيمة الطلب', target: 0, unit: 'د.ع', tip: '' }
      };
      const kpi = kpiByType[bizType] || kpiByType.other;

      return res.json({
        success: true, days,
        orders: { total: totalCnt, revenue: totalRev, deposits: parseFloat(orders.rows[0]?.dep||0), avg: totalCnt>0?totalRev/totalCnt:0 },
        comparison: { prev_revenue: prevRev, prev_orders: prevCnt, revenue_growth: prevRev>0?((totalRev-prevRev)/prevRev*100).toFixed(1):null, orders_growth: prevCnt>0?((totalCnt-prevCnt)/prevCnt*100).toFixed(1):null },
        top_customers: topCustomers.rows, daily_revenue: daily.rows, status_breakdown: statusBreak.rows,
        business_kpi: { type: bizType, ...kpi, actual: totalCnt>0?(totalRev/totalCnt).toFixed(0):0 }
      });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// COUPONS
// ============================================================

// رابط تتبع الطلب
app.post('/api/orders/:id/track-link', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false });
    const r = await pool.query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
    const baseUrl = process.env.BASE_URL || 'https://socialos.store';
    const trackUrl = `${baseUrl}/track/${req.params.id}`;
    res.json({ success: true, track_url: trackUrl });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

};