// ============================================================
// DEPARTMENTS — الأقسام الستة + Mike كمدير عام
// ============================================================

let _deptTasks = [];
let _pendingTasks = [];
let _deptFilter = 'all';

// تحميل صفحة الأقسام
async function ldDepartments() {
  const d = await api('/api/departments');
  if (!d.success) return;
  rnDepartments(d.departments, d.mike_permissions);
  ldPendingTasks();
}

// رسم الأقسام
function rnDepartments(departments, permissions) {
  const grid = document.getElementById('dept-grid');
  if (!grid) return;

  const deptColors = {
    customer_service: '#5b6af0',
    orders: '#10b981',
    inventory: '#f59e0b',
    design_publish: '#8b5cf6',
    promotion: '#ef4444',
    analytics: '#06b6d4'
  };

  grid.innerHTML = departments.map(dept => `
    <div class="card dept-card" style="border-color:${deptColors[dept.id]}33;cursor:pointer" onclick="showDeptDetail('${dept.id}')">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <div style="width:44px;height:44px;border-radius:12px;background:${deptColors[dept.id]}22;display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0">${dept.emoji}</div>
        <div>
          <div style="font-weight:700;font-size:.92rem">${dept.name}</div>
          <div style="font-size:.72rem;color:var(--text2)">${dept.auto_tasks.length} مهمة تلقائية</div>
        </div>
      </div>
      <div style="font-size:.78rem;color:var(--text2);line-height:1.6;margin-bottom:10px">${dept.description}</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px">
        ${dept.auto_tasks.slice(0,3).map(t => `<span style="background:${deptColors[dept.id]}15;color:${deptColors[dept.id]};border-radius:20px;padding:2px 8px;font-size:.68rem;font-weight:600">${formatTaskName(t)}</span>`).join('')}
        ${dept.auto_tasks.length > 3 ? `<span style="background:var(--surface2);color:var(--text2);border-radius:20px;padding:2px 8px;font-size:.68rem">+${dept.auto_tasks.length-3}</span>` : ''}
      </div>
    </div>
  `).join('');
}

// تحميل المهام المعلقة
async function ldPendingTasks() {
  const d = await api('/api/workflow/pending');
  if (!d.success) return;
  _pendingTasks = d.tasks || [];
  rnPendingTasks();

  // تحديث badge
  const badge = document.getElementById('pending-tasks-badge');
  if (badge) {
    badge.textContent = _pendingTasks.length > 0 ? _pendingTasks.length : '';
    badge.style.display = _pendingTasks.length > 0 ? 'flex' : 'none';
  }
}

// رسم المهام المعلقة
function rnPendingTasks() {
  const el = document.getElementById('pending-tasks-list');
  if (!el) return;

  if (!_pendingTasks.length) {
    el.innerHTML = `<div class="empty"><div class="ei">✅</div><p>لا توجد مهام معلقة</p></div>`;
    return;
  }

  const priorityColors = { high: '#ef4444', normal: '#f59e0b', low: '#10b981' };
  const deptEmoji = { customer_service:'💬', orders:'📦', inventory:'🏪', design_publish:'🎨', promotion:'📢', analytics:'📊' };

  el.innerHTML = _pendingTasks.map(task => `
    <div class="card" style="border-color:rgba(245,158,11,.3);margin-bottom:10px">
      <div style="display:flex;align-items:flex-start;gap:10px">
        <div style="font-size:1.5rem;flex-shrink:0">${deptEmoji[task.from_dept] || '📋'}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:.88rem;margin-bottom:3px">${esc(task.title)}</div>
          <div style="font-size:.76rem;color:var(--text2);margin-bottom:8px">${esc(task.description || '')}</div>
          <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px">
            <span style="background:rgba(245,158,11,.12);color:#f59e0b;border-radius:20px;padding:2px 8px;font-size:.68rem">من: ${task.from_dept}</span>
            <span style="background:rgba(79,142,247,.12);color:#5b6af0;border-radius:20px;padding:2px 8px;font-size:.68rem">إلى: ${task.to_dept}</span>
            ${task.requires_owner_approval ? '<span style="background:rgba(239,68,68,.12);color:#ef4444;border-radius:20px;padding:2px 8px;font-size:.68rem">⚠️ يحتاج موافقتك</span>' : ''}
          </div>
          <div style="display:flex;gap:7px">
            <button class="btn ba bsm" onclick="approveTask(${task.id})" style="flex:1;padding:8px">✅ موافقة</button>
            <button class="btn bd bsm" onclick="rejectTaskPrompt(${task.id})" style="flex:1;padding:8px">❌ رفض</button>
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

// الموافقة على مهمة
async function approveTask(id) {
  const d = await api(`/api/workflow/tasks/${id}/approve`, { method: 'POST' });
  if (d.success) { toast('✅ تمت الموافقة'); ldPendingTasks(); }
  else toast('❌ ' + (d.message || 'خطأ'));
}

// رفض مهمة
async function rejectTaskPrompt(id) {
  const reason = prompt('سبب الرفض (اختياري):') || '';
  const d = await api(`/api/workflow/tasks/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  });
  if (d.success) { toast('🚫 تم الرفض'); ldPendingTasks(); }
  else toast('❌ ' + (d.message || 'خطأ'));
}

// تحميل سجل المهام
async function ldWorkflowHistory() {
  const dept = _deptFilter === 'all' ? '' : _deptFilter;
  const d = await api(`/api/workflow/tasks${dept ? `?dept=${dept}` : ''}`);
  if (!d.success) return;
  _deptTasks = d.tasks || [];
  rnWorkflowHistory();
}

// رسم سجل المهام
function rnWorkflowHistory() {
  const el = document.getElementById('workflow-history');
  if (!el) return;

  if (!_deptTasks.length) {
    el.innerHTML = `<div class="empty"><div class="ei">📋</div><p>لا سجل بعد</p></div>`;
    return;
  }

  const statusColors = { pending: '#f59e0b', completed: '#10b981', rejected: '#ef4444' };
  const statusLabels = { pending: '⏳ معلق', completed: '✅ مكتمل', rejected: '❌ مرفوض' };
  const deptEmoji = { customer_service:'💬', orders:'📦', inventory:'🏪', design_publish:'🎨', promotion:'📢', analytics:'📊' };

  el.innerHTML = `<div class="tw"><table>
    <tr><th>المهمة</th><th>من</th><th>إلى</th><th>الحالة</th><th>التاريخ</th></tr>
    ${_deptTasks.map(t => `<tr>
      <td style="font-size:.82rem">${esc(t.title)}</td>
      <td>${deptEmoji[t.from_dept]||''} <span style="font-size:.75rem">${t.from_dept}</span></td>
      <td>${deptEmoji[t.to_dept]||''} <span style="font-size:.75rem">${t.to_dept}</span></td>
      <td><span class="badge" style="background:${statusColors[t.status]}22;color:${statusColors[t.status]}">${statusLabels[t.status]||t.status}</span></td>
      <td style="font-size:.72rem;color:var(--text2)">${new Date(t.created_at).toLocaleDateString('ar')}</td>
    </tr>`).join('')}
  </table></div>`;
}

// تفاصيل قسم معين
function showDeptDetail(deptId) {
  _deptFilter = deptId;
  document.querySelectorAll('.dept-filter-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`[data-dept="${deptId}"]`);
  if (btn) btn.classList.add('active');
  ldWorkflowHistory();
  // Scroll to history
  document.getElementById('workflow-history-section')?.scrollIntoView({ behavior: 'smooth' });
}

// فلتر المهام
function filterWorkflow(dept, btn) {
  _deptFilter = dept;
  document.querySelectorAll('.dept-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  ldWorkflowHistory();
}

// تنسيق اسم المهمة
function formatTaskName(task) {
  const names = {
    reply_customer: 'رد على زبون',
    confirm_order: 'تثبيت طلب',
    send_payment_cards: 'إرسال بطاقات دفع',
    receive_receipt: 'استلام وصل',
    reply_comments: 'رد تعليقات',
    prepare_invoice: 'إعداد فاتورة',
    attach_receipt: 'إرفاق وصل',
    track_order: 'متابعة طلب',
    send_invoice_whatsapp: 'إرسال فاتورة',
    add_product: 'إضافة منتج',
    update_stock: 'تحديث مخزون',
    low_stock_alert: 'تنبيه نفاد',
    design_image: 'تصميم صورة',
    add_logo_watermark: 'إضافة لوغو',
    write_post: 'كتابة بوست',
    publish_post: 'نشر',
    schedule_post: 'جدولة',
    create_ad_draft: 'مسودة إعلان',
    suggest_targeting: 'اقتراح استهداف',
    promotion_tips: 'نصائح ترويج',
    daily_report: 'تقرير يومي',
    weekly_report: 'تقرير أسبوعي',
    monthly_report: 'تقرير شهري',
    yearly_report: 'تقرير سنوي',
    sales_analysis: 'تحليل مبيعات',
    business_tips: 'نصائح تطوير',
  };
  return names[task] || task;
}

// ============================================================
// صلاحيات Mike — عرض في صفحة Mike
// ============================================================
function renderMikePermissions(permissions) {
  const el = document.getElementById('mike-permissions-section');
  if (!el) return;

  el.innerHTML = `
    <div class="card" style="border-color:rgba(16,185,129,.3);margin-bottom:14px">
      <h3 style="color:#10b981;margin-bottom:12px">✅ يوافق تلقائياً</h3>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${permissions.auto_approve.map(p => `
          <span style="background:rgba(16,185,129,.1);color:#10b981;border-radius:20px;padding:4px 10px;font-size:.76rem;font-weight:600">${formatPermName(p)}</span>
        `).join('')}
      </div>
    </div>
    <div class="card" style="border-color:rgba(239,68,68,.3)">
      <h3 style="color:#ef4444;margin-bottom:12px">⚠️ يرجع لك دائماً</h3>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${permissions.requires_owner_approval.map(p => `
          <span style="background:rgba(239,68,68,.1);color:#ef4444;border-radius:20px;padding:4px 10px;font-size:.76rem;font-weight:600">${formatPermName(p)}</span>
        `).join('')}
      </div>
    </div>
  `;
}

function formatPermName(perm) {
  const names = {
    confirm_all_orders: 'تثبيت جميع الطلبات',
    add_product: 'إضافة منتج',
    reply_comments: 'الرد على التعليقات',
    publish_regular_posts: 'نشر بوستات عادية',
    issue_invoices: 'إصدار الفواتير',
    update_stock: 'تحديث المخزون',
    send_reports: 'إرسال التقارير',
    schedule_posts: 'جدولة المنشورات',
    activate_coupon_under_20: 'كوبون خصم أقل 20%',
    purchase_stock_any_amount: 'شراء مخزون بأي مبلغ',
    set_advertising_budget: 'تحديد ميزانية الترويج 💰',
    discount_over_20: 'خصم يتجاوز 20%',
    delete_product: 'حذف منتج',
    cancel_order: 'إلغاء طلب',
    refund_customer: 'استرداد مبلغ',
    new_ad_campaign: 'حملة إعلانية جديدة',
    change_product_price: 'تغيير سعر منتج',
    publish_paid_content: 'نشر محتوى مدفوع',
  };
  return names[perm] || perm;
}

// ============================================================
// رفع صورة وصل الحوالة
// ============================================================
async function uploadReceipt(orderId, file) {
  if (!file) return toast('⚠️ اختر صورة الوصل');
  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64 = e.target.result;
    const d = await api(`/api/orders/${orderId}/receipt`, {
      method: 'POST',
      body: JSON.stringify({ receipt_image: base64 })
    });
    if (d.success) {
      toast('✅ تم إرسال الوصل لقسم الطلبات');
      ldOrds();
    } else toast('❌ ' + (d.message || 'خطأ'));
  };
  reader.readAsDataURL(file);
}

// ============================================================
// إرسال فاتورة للزبون على WhatsApp
// ============================================================
async function sendInvoiceWhatsApp(invoiceId) {
  const d = await api(`/api/invoices/${invoiceId}/send-whatsapp`, { method: 'POST' });
  if (d.success && d.wa_url) window.open(d.wa_url, '_blank');
  else toast('❌ ' + (d.message || 'خطأ'));
}

// ============================================================
// تحميل المهام المعلقة لصفحة Mike
// ============================================================
async function ldPendingTasksMike() {
  const d = await api('/api/workflow/pending');
  if (!d.success) return;
  _pendingTasks = d.tasks || [];

  // تحديث badges
  const badge = document.getElementById('mike-tab-badge');
  if (badge) { badge.textContent = _pendingTasks.length || ''; badge.style.display = _pendingTasks.length > 0 ? 'flex' : 'none'; }
  const navBadge = document.getElementById('nav-pending-badge');
  if (navBadge) { navBadge.textContent = _pendingTasks.length || ''; navBadge.style.display = _pendingTasks.length > 0 ? 'flex' : 'none'; }
  const pendBadge = document.getElementById('pending-tasks-badge');
  if (pendBadge) { pendBadge.textContent = _pendingTasks.length || ''; pendBadge.style.display = _pendingTasks.length > 0 ? 'flex' : 'none'; }
  // تحديث bottom nav badge
  const bnMikeBadge = document.getElementById('bn-mike-badge');
  if (bnMikeBadge) { bnMikeBadge.textContent = _pendingTasks.length || ''; bnMikeBadge.classList.toggle('show', _pendingTasks.length > 0); }

  const deptEmoji = { customer_service:'💬', orders:'📦', inventory:'🏪', design_publish:'🎨', promotion:'📢', analytics:'📊' };
  const html = !_pendingTasks.length
    ? `<div class="empty"><div class="ei">✅</div><p>لا توجد مهام معلقة</p></div>`
    : _pendingTasks.map(task => `
      <div class="card" style="border-color:rgba(245,158,11,.3);margin-bottom:10px">
        <div style="display:flex;align-items:flex-start;gap:10px">
          <div style="font-size:1.4rem;flex-shrink:0">${deptEmoji[task.from_dept]||'📋'}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:.86rem;margin-bottom:3px">${esc(task.title)}</div>
            <div style="font-size:.74rem;color:var(--text2);margin-bottom:8px">${esc(task.description||'')}</div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px">
              <span style="background:rgba(245,158,11,.12);color:#f59e0b;border-radius:20px;padding:2px 8px;font-size:.67rem">من: ${task.from_dept}</span>
              ${task.requires_owner_approval?'<span style="background:rgba(239,68,68,.12);color:#ef4444;border-radius:20px;padding:2px 8px;font-size:.67rem">⚠️ يحتاج موافقتك</span>':''}
            </div>
            <div style="display:flex;gap:7px">
              <button class="btn ba bsm" onclick="approveTask(${task.id})" style="flex:1;padding:7px;font-size:.76rem">✅ موافقة</button>
              <button class="btn bd bsm" onclick="rejectTaskPrompt(${task.id})" style="flex:1;padding:7px;font-size:.76rem">❌ رفض</button>
            </div>
          </div>
        </div>
      </div>`).join('');

  // تحديث كل أماكن عرض المهام
  ['pending-tasks-list','pending-tasks-list-mike'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  });
}

// ============================================================
// تحميل صفحة الأقسام
// ============================================================
async function loadDepartmentsPage() {
  await ldDepartments();
  await ldWorkflowHistory();
  await ldPendingTasksMike();
}
