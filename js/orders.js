let ordF='';
async function ldOrds(){
  const d=await api('/api/orders'+(ordF?`?status=${ordF}`:''));
  allOrds=d.orders||[];rnOrds(allOrds);
}
function rnOrds(ords){
  const list=document.getElementById('ordlist');
  if(!ords.length){list.innerHTML='<div class="empty"><div class="ei">🛒</div><p>لا طلبات</p></div>';return;}
  const sl={new:'🆕 جديد',confirmed:'✅ مؤكد',processing:'⚙️ جاري',shipped:'🚚 شُحن',delivered:'🚀 تم',cancelled:'❌ ملغي'};
  const bc={new:'bbl',confirmed:'bgr',processing:'bor',shipped:'bpu',delivered:'bgr',cancelled:'brd'};
  list.innerHTML=ords.map(o=>{
  const pm=PAYMENT_INFO[o.payment_method]||{label:o.payment_method||'',icon:'💰'};
  const st=o.status||'new';
  const sc={new:'rgba(201,168,76,.15)',confirmed:'rgba(34,197,94,.15)',processing:'rgba(201,168,76,.12)',shipped:'rgba(99,102,241,.15)',delivered:'rgba(34,197,94,.15)',cancelled:'rgba(239,68,68,.15)'};
  const stc={new:'#C9A84C',confirmed:'#22c55e',processing:'#C9A84C',shipped:'#818cf8',delivered:'#22c55e',cancelled:'#ef4444'};
  const sl2={new:'جديد',confirmed:'مؤكد',processing:'جاري',shipped:'شُحن',delivered:'تم التسليم',cancelled:'ملغي'};
  return`<div style="${G}">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:42px;height:42px;background:#1a1a1a;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.1rem">🛒</div>
        <div><div style="font-weight:700;font-size:.88rem">${esc(o.customer_name)}</div>
        <div style="font-size:.72rem;color:#9A9590" dir="ltr">${esc(o.customer_phone)}</div></div>
      </div>
      <div style="text-align:left">
        <div style="font-size:1rem;font-weight:900;color:#E8C96A">${Number(o.total||0).toLocaleString()}</div>
        <div style="font-size:.6rem;color:#5A5550">${new Date(o.created_at).toLocaleDateString('ar')}</div>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <span style="background:${sc[st]};color:${stc[st]};padding:3px 10px;border-radius:20px;font-size:.7rem;font-weight:700">${sl2[st]||st}</span>
      <span style="font-size:.72rem;color:#9A9590">${pm.icon} ${esc(pm.label)}</span>
      <span style="font-size:.7rem;color:#5A5550;margin-right:auto;font-family:monospace">#${o.id}</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
      <select style="background:#1a1a1a;border:1px solid rgba(201,168,76,.15);border-radius:10px;padding:8px;color:#F0EDE8;font-size:.75rem;font-family:'Tajawal',sans-serif" onchange="updOrdSt(${o.id},this.value)">
        <option value="">تغيير الحالة...</option>
        <option>new</option><option>confirmed</option><option>processing</option>
        <option>shipped</option><option>delivered</option><option>cancelled</option>
      </select>
      <button style="background:rgba(37,211,102,.08);border:1px solid rgba(37,211,102,.2);border-radius:10px;padding:8px;color:#25D366;font-size:.75rem;cursor:pointer;font-family:'Tajawal',sans-serif" onclick="waInv(${o.id})">📱 واتساب</button>
      <button style="background:#1a1a1a;border:1px solid rgba(201,168,76,.12);border-radius:10px;padding:8px;color:#9A9590;font-size:.72rem;cursor:pointer;font-family:'Tajawal',sans-serif" onclick="sendTrackLink(${o.id},'${o.customer_phone}','${o.customer_name}')">🔍 تتبع</button>
      <button style="background:#1a1a1a;border:1px solid rgba(201,168,76,.12);border-radius:10px;padding:8px;color:#9A9590;font-size:.72rem;cursor:pointer;font-family:'Tajawal',sans-serif" onclick="notifyCustomer(${o.id},'confirmed')">🔔 إشعار</button>
    </div>
  </div>`;}).join('');
}
function ford(s,btn){ordF=s;document.querySelectorAll('#page-orders .fb').forEach(b=>b.classList.remove('active'));btn.classList.add('active');ldOrds();}
function srchOrd(){const q=document.getElementById('osrch').value.toLowerCase();rnOrds(allOrds.filter(o=>o.customer_name?.toLowerCase().includes(q)||o.customer_phone?.includes(q)));}
async function saveOrd(){
  const name=document.getElementById('on').value.trim(),phone=document.getElementById('oph').value.trim(),total=parseFloat(document.getElementById('otot').value)||0;
  if(!name||!phone) return toast('⚠️ الاسم والهاتف مطلوبان');
  if(total<=0) return toast('⚠️ المبلغ يجب أن يكون أكبر من صفر');
  const payMethod=document.getElementById('opay').value;
  const cardInfo=document.getElementById('ocard')?.value.trim()||'';
  const d=await api('/api/orders',{method:'POST',body:JSON.stringify({
    customer_name:name,customer_phone:phone,
    customer_address:document.getElementById('oad').value,
    items:[{description:document.getElementById('oit').value}],
    total,deposit:parseFloat(document.getElementById('odep').value)||0,
    payment_method:payMethod,
    card_info:cardInfo,
    platform:document.getElementById('oplt').value,
    notes:document.getElementById('onto').value
  })});
  if(d.success){
    toast('✅ تم');cm('mo');ldOrds();
    ['on','oph','oad','oit','otot','onto','ocard'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    document.getElementById('odep').value='0';
    document.getElementById('card-info-wrap').style.display='none';
  } else toast('❌ '+(d.message||'خطأ'));
}
async function updOrdSt(id,s){if(!s) return;await api('/api/orders/'+id,{method:'PUT',body:JSON.stringify({status:s})});ldOrds();}
async function waInv(id) {
  const d = await api('/api/orders/' + id + '/whatsapp');
  if (d.success && d.url) {
    window.open(d.url, '_blank');
  } else {
    // fallback - افتح واتساب مباشرة برقم الزبون
    const order = allOrds?.find(o => o.id == id);
    if (order?.customer_phone) {
      const phone = String(order.customer_phone).replace(/[^0-9]/g,'');
      const waPhone = phone.startsWith('0') ? '964'+phone.slice(1) : phone;
      window.open('https://wa.me/' + waPhone, '_blank');
    } else toast('❌ ' + (d.message || 'لا يوجد رقم هاتف'));
  }
}

// طرق الدفع — تفاصيل العرض
const PAYMENT_INFO = {
  cash:           { label:'💵 كاش',            icon:'💵', hint:'',                          showCard:false },
  transfer:       { label:'🏦 تحويل بنكي',      icon:'🏦', hint:'أدخل رقم الحساب البنكي',   showCard:true  },
  zain_cash:      { label:'📱 زين كاش',         icon:'📱', hint:'أدخل رقم محفظة زين كاش',   showCard:true  },
  asia_hawala:    { label:'🏧 آسيا حوالة',      icon:'🏧', hint:'أدخل رقم حساب آسيا',       showCard:true  },
  master_rafidain:{ label:'💳 ماستر رافدين',    icon:'💳', hint:'أدخل رقم البطاقة',         showCard:true  },
  qi_card:        { label:'💳 Qi Card',         icon:'💳', hint:'أدخل رقم Qi Card',         showCard:true  },
  fast_pay:       { label:'⚡ FastPay',         icon:'⚡', hint:'أدخل رقم حساب FastPay',    showCard:true  },
  fib:            { label:'🏦 FIB',             icon:'🏦', hint:'أدخل رقم حساب FIB',        showCard:true  },
  credit_card:    { label:'💳 بطاقة ائتمان',    icon:'💳', hint:'أدخل آخر 4 أرقام',         showCard:true  },
  paypal:         { label:'🌐 PayPal',          icon:'🌐', hint:'أدخل البريد الإلكتروني',    showCard:true  },
  other:          { label:'🔄 أخرى',            icon:'🔄', hint:'أدخل تفاصيل الدفع',        showCard:true  }
};

function toggleCardInfo() {
  const method = document.getElementById('opay')?.value || 'cash';
  const info = PAYMENT_INFO[method] || PAYMENT_INFO.other;
  const wrap = document.getElementById('card-info-wrap');
  const label = document.getElementById('card-info-label');
  const icon = document.getElementById('card-info-icon');
  const hint = document.getElementById('card-info-hint');
  const input = document.getElementById('ocard');
  if (!wrap) return;
  if (info.showCard) {
    wrap.style.display = 'block';
    if (label) label.textContent = `رقم ${info.label.replace(/^[^ ]+ /,'')}`;
    if (icon) icon.textContent = info.icon;
    if (hint) hint.textContent = info.hint;
    if (input) input.placeholder = info.hint || 'أدخل رقم الحساب';
  } else {
    wrap.style.display = 'none';
    if (input) input.value = '';
  }
}

// ============================================================
// CUSTOMERS
// ============================================================
async function ldCusts(){const d=await api('/api/customers');allCusts=d.customers||[];rnCusts(allCusts);}
function rnCusts(list){
  const el=document.getElementById('custlist');
  if(!list.length){el.innerHTML='<div class="empty"><div class="ei">👥</div><p>لا عملاء</p></div>';return;}
  el.innerHTML=list.map(c=>`<div style="background:#111111;border:1px solid rgba(201,168,76,.1);border-radius:14px;padding:14px;margin-bottom:10px"><div style="display:flex;align-items:center;gap:12px"><div style="width:44px;height:44px;border-radius:13px;background:linear-gradient(135deg,#8B6914,#C9A84C);display:flex;align-items:center;justify-content:center;font-size:1.1rem;color:#080808;font-weight:900;flex-shrink:0">${esc(c.name?.[0]||'؟')}</div><div style="flex:1;min-width:0"><div style="font-weight:700;font-size:.88rem">${esc(c.name)}</div><div style="font-size:.72rem;color:#9A9590;margin-top:2px" dir="ltr">${esc(c.phone)}</div>${c.address?`<div style="font-size:.7rem;color:#5A5550;margin-top:2px">📍 ${esc(c.address)}</div>`:''}</div><div style="display:flex;flex-direction:column;gap:5px"><a href="https://wa.me/${c.phone?.replace(/[^0-9]/g,'')}" target="_blank" style="background:rgba(37,211,102,.08);border:1px solid rgba(37,211,102,.2);border-radius:10px;padding:6px 10px;color:#25D366;font-size:.7rem;text-decoration:none;text-align:center">📱</a><button style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:10px;padding:6px 10px;color:#ef4444;font-size:.7rem;cursor:pointer;font-family:'Tajawal',sans-serif" onclick="delCust(${c.id})">🗑️</button></div></div></div>`).join('');
}
function srchCust(){const q=document.getElementById('csrch').value.toLowerCase();rnCusts(allCusts.filter(c=>c.name?.toLowerCase().includes(q)||c.phone?.includes(q)));}
async function saveCust(){
  const n=document.getElementById('cn').value.trim(),p=document.getElementById('cph').value.trim();
  if(!n||!p) return toast('⚠️ الاسم والهاتف مطلوبان');
  const d=await api('/api/customers',{method:'POST',body:JSON.stringify({name:n,phone:p,address:document.getElementById('cad').value,notes:document.getElementById('cnt').value})});
  if(d.success){toast('✅ تم');cm('mc');ldCusts();}else toast('❌ '+(d.message||'خطأ'));
}
async function delCust(id){if(!confirm('حذف العميل؟')) return;await api('/api/customers/'+id,{method:'DELETE'});ldCusts();}

// ============================================================
// PRODUCTS
// ============================================================
async function ldProds(){const d=await api('/api/products');allProds=d.products||[];rnProds(allProds);}
function rnProds(list){
  const el=document.getElementById('prodlist');
  if(!list.length){el.innerHTML='<div class="empty"><div class="ei">📦</div><p>لا منتجات</p></div>';return;}
  el.innerHTML=`<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">${list.map(p=>`<div style="background:#111;border:1px solid rgba(201,168,76,.1);border-radius:16px;overflow:hidden"><div style="${p.image_url?'background:url('+p.image_url+') center/cover':'background:#1a1a1a'};height:110px;display:flex;align-items:center;justify-content:center;font-size:2.5rem">${p.image_url?'':' 📦'}</div><div style="padding:12px"><div style="font-weight:700;font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px">${esc(p.name)}</div><div style="font-size:.95rem;font-weight:900;color:#E8C96A;margin-bottom:6px">${Number(p.price||0).toLocaleString()}</div><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><span style="font-size:.65rem;background:rgba(201,168,76,.1);color:#C9A84C;padding:2px 8px;border-radius:10px">${esc(p.category||'عام')}</span><span style="font-size:.65rem;color:${p.stock>0?'#22c55e':'#ef4444'}">${p.stock>0?'✅ '+p.stock:'❌ نفذ'}</span></div><button style="width:100%;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:10px;padding:6px;color:#ef4444;font-size:.72rem;cursor:pointer;font-family:'Tajawal',sans-serif" onclick="delProd(${p.id})">🗑️ حذف</button></div></div>`).join('')}</div>`;
}
function srchProd(){const q=document.getElementById('psrch').value.toLowerCase();rnProds(allProds.filter(p=>p.name?.toLowerCase().includes(q)||p.category?.toLowerCase().includes(q)));}
function addAttr(){
  const k=document.getElementById('attrk').value.trim(),v=document.getElementById('attrv').value.trim();
  if(!k||!v) return;pAttrs[k]=v;document.getElementById('attrk').value='';document.getElementById('attrv').value='';rnAttrs();
}
function rnAttrs(){document.getElementById('attrarea').innerHTML=Object.entries(pAttrs).map(([k,v])=>`<span class="badge bpu" style="cursor:pointer" onclick="delete pAttrs['${k}'];rnAttrs()">✕ ${esc(k)}:${esc(v)}</span>`).join('');}
async function saveProd(){
  const n=document.getElementById('pn').value.trim(),pr=parseFloat(document.getElementById('pp').value)||0;
  if(!n) return toast('⚠️ الاسم مطلوب');if(pr<=0) return toast('⚠️ السعر يجب أن يكون أكبر من صفر');
  const d=await api('/api/products',{method:'POST',body:JSON.stringify({name:n,description:document.getElementById('pd2').value,price:pr,category:document.getElementById('pc').value||'عام',stock:parseInt(document.getElementById('pst').value)||0,image_url:document.getElementById('pi').value,dynamic_attrs:pAttrs})});
  if(d.success){toast('✅ تم');cm('mp');pAttrs={};rnAttrs();ldProds();}else toast('❌ '+(d.message||'خطأ'));
}
async function delProd(id){if(!confirm('حذف؟')) return;await api('/api/products/'+id,{method:'DELETE'});ldProds();}

// ============================================================
// INVENTORY
// ============================================================
async function ldInv(){
  const d=await api('/api/inventory/alerts');
  const list=document.getElementById('invlist');
  if(!d.alerts?.length){list.innerHTML='<div class="empty"><div class="ei">✅</div><p>المخزون طبيعي</p></div>';return;}
  list.innerHTML=d.alerts.map(p=>`<div class="card" style="padding:12px;margin-bottom:7px;border-right:3px solid ${p.stock===0?'var(--danger)':'var(--accent3)'}"><div style="display:flex;justify-content:space-between;align-items:center"><div><div style="font-weight:700">${esc(p.name)}</div><div class="badge ${p.stock===0?'brd':'bor'}" style="margin-top:3px">${p.stock===0?'🚨 نفذ':'⚠️ منخفض'} — ${p.stock}</div></div><div style="display:flex;gap:5px"><button class="btn ba bsm" onclick="adjStock(${p.id},'add')">+</button><button class="btn bo bsm" onclick="adjStock(${p.id},'subtract')">-</button></div></div></div>`).join('');
}
async function adjStock(id,op){const qty=prompt('الكمية:');if(!qty) return;await api('/api/products/'+id+'/stock',{method:'PUT',body:JSON.stringify({quantity:parseInt(qty),operation:op})});ldInv();}

// ============================================================
// ANALYTICS
// ============================================================
async function ldAna(){
  const p=document.getElementById('aper')?.value||'7';
  const per=p==='7'?'week':p==='30'?'month':'year';
  const d=await api('/api/analytics/report?period='+per);
  if(!d.success) return;
  // KPI حسب نوع العمل
  const kpi=d.business_kpi;
  const kpiEl=document.getElementById('ana-biz-kpi');
  if(kpiEl && kpi?.label && kpi.target>0){
    const actual=parseFloat(kpi.actual||0);
    const pct=Math.min(100,Math.round((actual/kpi.target)*100));
    const ok=actual>=kpi.target;
    kpiEl.innerHTML=`<div style="background:var(--surface2);border-radius:11px;padding:12px;margin-bottom:13px;border:1px solid ${ok?'rgba(0,200,150,.2)':'rgba(255,100,100,.15)'}"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div style="font-size:.8rem;font-weight:700">🎯 ${esc(kpi.label)}</div><span class="badge ${ok?'bgr':'brd'}">${ok?'✅ محقق':'⚠️ دون المستهدف'}</span></div><div style="display:flex;gap:12px;font-size:.78rem;color:var(--text2);margin-bottom:7px"><span>الفعلي: <strong>${Number(actual).toLocaleString()} ${esc(kpi.unit)}</strong></span><span>المستهدف: <strong>${Number(kpi.target).toLocaleString()} ${esc(kpi.unit)}</strong></span></div><div style="height:7px;background:var(--border);border-radius:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${ok?'var(--green)':'var(--accent3)'};border-radius:4px"></div></div>${kpi.tip?`<div style="font-size:.71rem;color:var(--text2);margin-top:5px">💡 ${esc(kpi.tip)}</div>`:''}</div>`;
  } else if(kpiEl) kpiEl.innerHTML='';
  const gr=n=>n===null?'':` <span style="color:${parseFloat(n)>=0?'var(--green)':'var(--danger)'}">${parseFloat(n)>=0?'↑':'↓'}${Math.abs(n)}%</span>`;
  document.getElementById('anast').innerHTML=`<div class="sc"><div class="si">💰</div><div class="sv">${Number(d.orders?.revenue||0).toLocaleString()}</div><div class="sl">الإيرادات${gr(d.comparison?.revenue_growth)}</div></div><div class="sc"><div class="si">🛒</div><div class="sv">${d.orders?.total||0}</div><div class="sl">الطلبات${gr(d.comparison?.orders_growth)}</div></div><div class="sc"><div class="si">📦</div><div class="sv">${Number(d.orders?.deposits||0).toLocaleString()}</div><div class="sl">العربونات</div></div><div class="sc"><div class="si">🧮</div><div class="sv">${Number(d.orders?.avg||0).toFixed(0)}</div><div class="sl">متوسط الطلب</div></div>`;
  // Chart
  const chart=document.getElementById('anachart');const daily=d.daily_revenue||[];
  if(daily.length){const mx=Math.max(...daily.map(x=>parseFloat(x.revenue||0)),1);chart.innerHTML=daily.map(x=>{const pct=Math.round((parseFloat(x.revenue||0)/mx)*100);const dt=new Date(x.date).toLocaleDateString('ar',{day:'numeric',month:'short'});return`<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><div style="width:50px;font-size:.7rem;color:var(--text2);text-align:right">${dt}</div><div style="flex:1;height:13px;background:var(--border);border-radius:3px;overflow:hidden"><div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:3px"></div></div><div style="width:75px;font-size:.7rem;font-weight:700">${Number(x.revenue||0).toLocaleString()}</div></div>`;}).join('');}
  else chart.innerHTML='<div class="empty"><div class="ei">📈</div><p>لا بيانات</p></div>';
  // Top customers
  const top=d.top_customers||[];
  document.getElementById('anacust').innerHTML=top.length?top.map((c,i)=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:.82rem"><span><span style="color:var(--text2)">${i+1}.</span> ${esc(c.customer_name)}</span><span style="font-weight:700;color:var(--accent)">${Number(c.total_spent||0).toLocaleString()}</span></div>`).join(''):'<div class="empty"><div class="ei">👥</div><p>لا بيانات</p></div>';
  // Status
  const sl={new:'جديد',confirmed:'مؤكد',processing:'جاري',delivered:'تم',cancelled:'ملغي'};
  const sb=d.status_breakdown||[];
  document.getElementById('anastatus').innerHTML=sb.length?sb.map(s=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:.82rem"><span>${sl[s.status]||s.status}</span><span>${s.count} — <b>${Number(s.revenue||0).toLocaleString()}</b></span></div>`).join(''):'<div class="empty"><div class="ei">📊</div><p>لا بيانات</p></div>';
}

// ============================================================
// COUPONS
// ============================================================
