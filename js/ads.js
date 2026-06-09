let currentAds=[];
async function ldAds(){
  const d=await api('/api/ads/campaigns');
  currentAds=d.campaigns||[];

  // إحصائيات
  const total=currentAds.length;
  const active=currentAds.filter(c=>c.status==='active').length;
  const impressions=currentAds.reduce((s,c)=>s+parseInt(c.impressions||0),0);
  const spend=currentAds.reduce((s,c)=>s+parseFloat(c.spend||0),0);
  document.getElementById('ads-total').textContent=total;
  document.getElementById('ads-active').textContent=active;
  document.getElementById('ads-impressions').textContent=impressions>=1000?(impressions/1000).toFixed(1)+'K':impressions;
  document.getElementById('ads-spend').textContent=spend.toFixed(1);

  // حالة ربط المنصات
  const social=await api('/api/social/accounts');
  const accounts=social.accounts||[];
  const fbConn=accounts.find(a=>a.platform==='facebook'&&a.is_connected);
  const ttConn=accounts.find(a=>a.platform==='tiktok'&&a.is_connected);
  const statusEl=document.getElementById('ads-connect-status');
  if(!fbConn&&!ttConn){
    statusEl.innerHTML=`<div style="background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.2);border-radius:10px;padding:11px 13px;font-size:.8rem;display:flex;align-items:center;gap:9px">
      <span style="font-size:1.2rem">⚠️</span>
      <div><b style="color:var(--accent3)">الحسابات غير مربوطة</b><br><span style="color:var(--text2)">اربط Meta أو TikTok من <button class="btn bo bsm" onclick="sp('social',null)" style="display:inline;padding:3px 8px;font-size:.72rem">ربط الحسابات</button> لإطلاق الحملات فعلياً</span></div>
    </div>`;
  } else {
    statusEl.innerHTML=`<div style="background:rgba(0,200,150,.06);border:1px solid rgba(0,200,150,.2);border-radius:10px;padding:10px 13px;font-size:.8rem;display:flex;gap:12px">
      ${fbConn?`<span class="badge bgr">✅ Meta مربوط</span>`:'<span class="badge brd">Meta غير مربوط</span>'}
      ${ttConn?`<span class="badge bgr">✅ TikTok مربوط</span>`:'<span class="badge brd">TikTok غير مربوط</span>'}
    </div>`;
  }

  renderAds(currentAds);

  // معاينة retargeting
  ldRetargetPreview();
}

function renderAds(ads){
  const list=document.getElementById('ads-list');
  if(!ads.length){list.innerHTML='<div class="empty"><div class="ei">📣</div><p>لا حملات بعد — أنشئ حملتك الأولى</p></div>';return;}
  const statusLabel={draft:'📝 مسودة',active:'🟢 نشطة',paused:'⏸ متوقفة',ended:'🏁 منتهية'};
  const statusColor={draft:'bor',active:'bgr',paused:'bbl',ended:'bpu'};
  const platIcon={facebook:'👥',instagram:'📸',tiktok:'🎵',google:'🔍'};
  list.innerHTML=ads.map(c=>`
    <div style="background:var(--surface2);border-radius:12px;padding:13px;margin-bottom:9px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:9px">
        <div style="display:flex;align-items:center;gap:7px">
          <span style="font-size:1.1rem">${platIcon[c.platform]||'📣'}</span>
          <div>
            <div style="font-weight:700;font-size:.88rem">${esc(c.name)}</div>
            ${c.external_id?`<div style="font-size:.66rem;color:var(--green);margin-top:1px">🔗 ID: ${esc(c.external_id.substring(0,16))}...</div>`:'<div style="font-size:.66rem;color:var(--text2)">محلي فقط</div>'}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:5px">
          <span class="badge ${statusColor[c.status]||'bor'}">${statusLabel[c.status]||c.status}</span>
          <button class="btn bd bsm" onclick="delAd(${c.id})">🗑</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:9px">
        <div style="background:var(--surface);border-radius:8px;padding:7px;text-align:center">
          <div style="font-size:.9rem;font-weight:700">$${Number(c.budget||0).toLocaleString()}</div>
          <div style="font-size:.63rem;color:var(--text2)">${c.budget_type==='daily'?'يوم':'إجمالي'}</div>
        </div>
        <div style="background:var(--surface);border-radius:8px;padding:7px;text-align:center">
          <div style="font-size:.9rem;font-weight:700">${Number(c.impressions||0)>=1000?(Number(c.impressions)/1000).toFixed(1)+'K':Number(c.impressions||0)}</div>
          <div style="font-size:.63rem;color:var(--text2)">مشاهدة</div>
        </div>
        <div style="background:var(--surface);border-radius:8px;padding:7px;text-align:center">
          <div style="font-size:.9rem;font-weight:700">${Number(c.clicks||0)}</div>
          <div style="font-size:.63rem;color:var(--text2)">نقرة</div>
        </div>
        <div style="background:var(--surface);border-radius:8px;padding:7px;text-align:center">
          <div style="font-size:.9rem;font-weight:700">$${Number(c.spend||0).toFixed(1)}</div>
          <div style="font-size:.63rem;color:var(--text2)">أُنفق</div>
        </div>
      </div>
      <div style="display:flex;gap:6px">
        ${c.external_id?`<button class="btn bo bsm" onclick="getInsights(${c.id})" style="flex:1;padding:8px">📊 نتائج</button>`:''}
        ${c.external_id&&c.status!=='active'?`<button class="btn ba bsm" onclick="toggleAd(${c.id},'activate')" style="flex:1;padding:8px;background:var(--green);border:none">▶️ تفعيل</button>`:''}
        ${c.external_id&&c.status==='active'?`<button class="btn bo bsm" onclick="toggleAd(${c.id},'pause')" style="flex:1;padding:8px">⏸ إيقاف</button>`:''}
      </div>
    </div>
  `).join('');
}

async function saveAd(){
  const name=document.getElementById('ad-name').value.trim();
  if(!name) return toast('⚠️ اسم الحملة مطلوب');
  const launchNow=document.getElementById('ad-launch-now').checked;
  const btn=document.querySelector('#mads .btn.ba');
  btn.disabled=true;btn.textContent=launchNow?'⏳ جاري الإطلاق...':'⏳ جاري الحفظ...';

  const interests=(document.getElementById('ad-interests').value||'').split(',').map(s=>s.trim()).filter(Boolean);
  const countries=(document.getElementById('ad-countries').value||'IQ,SA,AE').split(',').map(s=>s.trim()).filter(Boolean);

  const d=await api('/api/ads/campaigns',{method:'POST',body:JSON.stringify({
    name,
    platform:document.getElementById('ad-plat').value,
    objective:document.getElementById('ad-obj').value,
    budget:document.getElementById('ad-budget').value||0,
    budget_type:document.getElementById('ad-btype').value,
    start_date:document.getElementById('ad-start').value||null,
    end_date:document.getElementById('ad-end').value||null,
    target_audience:{
      age_min:parseInt(document.getElementById('ad-age-min').value)||18,
      age_max:parseInt(document.getElementById('ad-age-max').value)||45,
      countries,interests,
      gender:document.getElementById('ad-gender').value
    },
    ad_content:{copy:document.getElementById('ad-copy').value},
    launch_now:launchNow
  })});

  btn.disabled=false;btn.textContent='✅ حفظ الحملة';

  if(d.success){
    const resultEl=document.getElementById('ad-launch-result');
    if(launchNow&&d.launch_message){
      resultEl.style.display='block';
      resultEl.style.background=d.launch_error?'rgba(255,68,102,.1)':'rgba(0,200,150,.1)';
      resultEl.style.color=d.launch_error?'var(--danger)':'var(--green)';
      resultEl.style.border=`1px solid ${d.launch_error?'rgba(255,68,102,.3)':'rgba(0,200,150,.3)'}`;
      resultEl.textContent=d.launch_error?('⚠️ '+d.launch_error):d.launch_message;
      setTimeout(()=>{cm('mads');ldAds();resultEl.style.display='none';},3000);
    } else {
      toast(d.launched?'🚀 تم الإطلاق!':'✅ تم حفظ الحملة');
      cm('mads');ldAds();
    }
  } else toast('❌ '+(d.message||'خطأ'));
}

async function toggleAd(id,action){
  const d=await api(`/api/ads/campaigns/${id}/toggle`,{method:'PUT',body:JSON.stringify({action})});
  if(d.success){toast(action==='activate'?'▶️ تم التفعيل':'⏸ تم الإيقاف');ldAds();}
  else toast('❌ '+(d.message||'خطأ'));
}

async function getInsights(id){
  toast('⏳ جاري جلب النتائج...');
  const d=await api(`/api/ads/campaigns/${id}/insights`);
  if(d.success){
    const ins=d.insights||{};
    toast(`📊 مشاهدات: ${ins.impressions||0} | نقرات: ${ins.clicks||0} | أُنفق: $${ins.spend||0}`);
    ldAds();
  } else toast('⚠️ '+(d.message||'لا نتائج بعد'));
}

async function syncAdsInsights(){
  const hasExternal=currentAds.filter(c=>c.external_id);
  if(!hasExternal.length) return toast('⚠️ لا حملات مطلقة على المنصات بعد');
  toast(`⏳ جاري تحديث ${hasExternal.length} حملة...`);
  for(const c of hasExternal){
    await api(`/api/ads/campaigns/${c.id}/insights`).catch(()=>{});
  }
  ldAds();
  toast('✅ تم تحديث النتائج');
}

async function delAd(id){
  if(!confirm('حذف الحملة؟')) return;
  const d=await api('/api/ads/campaigns/'+id,{method:'DELETE'});
  if(d.success){toast('✅ تم الحذف');ldAds();}else toast('❌ '+(d.message||'خطأ'));
}

// ============================================================
// RETARGETING — إعادة الاستهداف
// ============================================================
async function ldRetargetPreview(){
  const d=await api('/api/ads/retargeting/audiences');
  const el=document.getElementById('ads-retarget-preview');
  if(!el) return;
  const auds=d.audiences||[];
  if(!auds.length){el.innerHTML='<div class="empty"><div class="ei">🎯</div><p>لا بيانات</p></div>';return;}
  el.innerHTML=auds.slice(0,3).map(a=>`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:7px">
        <span style="font-size:1.1rem">${a.icon}</span>
        <div><div style="font-weight:700;font-size:.82rem">${esc(a.name)}</div><div style="font-size:.72rem;color:var(--text2)">${a.use_case}</div></div>
      </div>
      <div style="text-align:left">
        <div style="font-weight:900;color:var(--accent)">${a.size}</div>
        <div style="font-size:.65rem;color:var(--text2)">عميل</div>
      </div>
    </div>
  `).join('');
}

async function ldRetargeting(){
  const d=await api('/api/ads/retargeting/audiences');
  const el=document.getElementById('retarget-audiences');
  const auds=d.audiences||[];
  if(!auds.length){el.innerHTML='<div class="empty"><div class="ei">🎯</div><p>أضف طلبات لبناء الجماهير</p></div>';return;}

  el.innerHTML=auds.map(a=>`
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:15px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:9px">
          <div style="width:42px;height:42px;border-radius:10px;background:rgba(79,142,247,.1);display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0">${a.icon}</div>
          <div>
            <div style="font-weight:900;font-size:.88rem">${esc(a.name)}</div>
            <div style="font-size:.72rem;color:var(--text2)">${esc(a.desc)}</div>
          </div>
        </div>
        <div style="text-align:left">
          <div style="font-size:1.5rem;font-weight:900;color:var(--accent);line-height:1">${a.size}</div>
          <div style="font-size:.65rem;color:var(--text2)">عميل</div>
        </div>
      </div>
      <div style="background:var(--surface2);border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:.76rem;color:var(--text2)">
        💡 ${esc(a.use_case)}
      </div>
      <button class="btn ba bsm" onclick="openRetargetLaunch('${a.id}','${esc(a.name)}',${a.size})"
        style="width:100%;padding:9px;font-weight:700"
        ${a.size===0?'disabled style="opacity:.4;width:100%;padding:9px"':''}>
        ${a.size>0?'🚀 إطلاق حملة':'لا يوجد عملاء بعد'}
      </button>
    </div>
  `).join('');
}

function openRetargetLaunch(audienceId,audienceName,size){
  document.getElementById('rt-audience-id').value=audienceId;
  document.getElementById('retarget-launch-title').textContent=`🚀 استهداف: ${audienceName} (${size} عميل)`;
  document.getElementById('retarget-launch-form').style.display='block';
  document.getElementById('retarget-result').style.display='none';
  document.getElementById('retarget-launch-form').scrollIntoView({behavior:'smooth'});
}

async function launchRetargeting(){
  const audienceId=document.getElementById('rt-audience-id').value;
  const copy=document.getElementById('rt-copy').value.trim();
  if(!copy) return toast('⚠️ أدخل نص الإعلان');
  const btn=document.getElementById('rt-launch-btn');
  btn.disabled=true;btn.textContent='⏳ جاري الإطلاق...';

  const d=await api('/api/ads/retargeting/launch',{method:'POST',body:JSON.stringify({
    audience_id:audienceId,
    platform:document.getElementById('rt-platform').value,
    budget:document.getElementById('rt-budget').value||5,
    ad_copy:copy,
    offer:document.getElementById('rt-offer').value.trim()
  })});

  btn.disabled=false;btn.textContent='🚀 إطلاق';

  const resultEl=document.getElementById('retarget-result');
  resultEl.style.display='block';

  if(d.success){
    const waCount=d.wa_links?.length||0;
    resultEl.innerHTML=`
      <div style="background:rgba(0,200,150,.08);border:1px solid rgba(0,200,150,.25);border-radius:12px;padding:14px">
        <div style="font-weight:900;color:var(--green);margin-bottom:8px">✅ ${esc(d.launch_message)}</div>
        <div style="font-size:.8rem;color:var(--text2);margin-bottom:10px">حجم الجمهور: <b style="color:var(--text)">${d.audience_size||0} عميل</b></div>
        ${d.external_id?`<div style="font-size:.76rem;color:var(--green);margin-bottom:10px">🔗 Custom Audience ID: ${esc(d.external_id)}</div>`:''}
        ${waCount>0?`
          <div style="font-size:.78rem;font-weight:700;margin-bottom:7px">📱 إرسال عبر واتساب (${waCount} رابط جاهز)</div>
          <div style="max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:5px">
            ${d.wa_links.slice(0,10).map(l=>`<a href="${esc(l.url)}" target="_blank" class="btn bo bsm" style="text-decoration:none;padding:7px;font-size:.75rem">📤 ${esc(l.phone)}</a>`).join('')}
            ${waCount>10?`<div style="font-size:.72rem;color:var(--text2);text-align:center;padding:5px">...و ${waCount-10} آخرين</div>`:''}
          </div>
        `:''}
      </div>`;
    ldRetargeting();
  } else {
    resultEl.innerHTML=`<div style="background:rgba(255,68,102,.08);border:1px solid rgba(255,68,102,.25);border-radius:12px;padding:12px;color:var(--danger)">❌ ${esc(d.message||'خطأ')}</div>`;
  }
}
async function suggestAd(){
  const goal=document.getElementById('ads-goal').value;
  const budget=document.getElementById('ads-budget').value;
  const platform=document.getElementById('ads-plat').value;
  const pdesc=document.getElementById('ads-pdesc').value.trim();
  const btn=document.getElementById('ads-sug-btn');
  const res=document.getElementById('ads-sug-result');
  btn.disabled=true;btn.textContent='⏳ جاري الاقتراح...';
  res.style.display='none';
  const d=await api('/api/ads/suggest',{method:'POST',body:JSON.stringify({goal,budget,platform,product_desc:pdesc})});
  btn.disabled=false;btn.textContent='✨ اقترح حملة';
  if(d.success&&d.suggestion){
    const s=d.suggestion;
    res.style.display='block';
    res.innerHTML=`
      <div style="background:var(--surface2);border-radius:10px;padding:13px">
        ${s.campaign_name?`<div style="font-weight:900;margin-bottom:7px;font-size:.95rem">📣 ${esc(s.campaign_name)}</div>`:''}
        ${s.objective?`<div style="font-size:.82rem;color:var(--text2);margin-bottom:8px">🎯 ${esc(s.objective)}</div>`:''}
        ${s.budget_suggestion?`<div style="font-size:.82rem;margin-bottom:8px">💰 يومي: $${s.budget_suggestion.daily||0} — إجمالي: $${s.budget_suggestion.total||0} لـ ${s.schedule?.duration_days||30} يوم</div>`:''}
        ${s.ad_copies&&s.ad_copies.length?`<div style="margin-bottom:8px"><div style="font-size:.78rem;color:var(--text2);margin-bottom:4px">✍️ نماذج إعلانية:</div>${s.ad_copies.map(a=>`<div style="background:var(--surface);border-radius:8px;padding:9px;margin-bottom:5px;font-size:.8rem"><b>${esc(a.title||'')}</b><br>${esc(a.body||'')}<br><span style="color:var(--accent)">${esc(a.cta||'')}</span></div>`).join('')}</div>`:''}
        ${s.tips&&s.tips.length?`<div><div style="font-size:.78rem;color:var(--text2);margin-bottom:4px">💡 نصائح:</div>${s.tips.map(t=>`<div style="font-size:.78rem;padding:4px 0;border-bottom:1px solid var(--border)">• ${esc(t)}</div>`).join('')}</div>`:''}
        <button class="btn ba bsm" style="margin-top:9px;width:100%" onclick="document.getElementById('ad-name').value=${JSON.stringify(s.campaign_name||'')};document.getElementById('ad-plat').value=${JSON.stringify(platform)};om('mads')">➕ إنشاء هذه الحملة</button>
      </div>
    `;
  } else toast('❌ '+(d.message||'فشل الاقتراح'));
}

// ============================================================
// SOCIAL POSTS — المنشورات
// ============================================================
let postsFilter='';
async function ldPosts(){
  const d=await api('/api/posts'+(postsFilter?'?platform='+postsFilter:''));
  const posts=d.posts||[];
  // إحصائيات
  const total=posts.length;
  const pub=posts.filter(p=>p.status==='published').length;
  const sched=posts.filter(p=>p.status==='scheduled').length;
  document.getElementById('ps-total').textContent=total;
  document.getElementById('ps-pub').textContent=pub;
  document.getElementById('ps-sched').textContent=sched;
  renderPosts(posts);
  // عداد المحتوى
  const qpContent=document.getElementById('qp-content');
  if(qpContent) qpContent.oninput=()=>document.getElementById('qp-count').textContent=qpContent.value.length+'/2200';
}
function filterPosts(platform,btn){
  postsFilter=platform;
  document.querySelectorAll('#page-posts .fb').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  ldPosts();
}
function renderPosts(posts){
  const list=document.getElementById('posts-list');
  if(!posts.length){list.innerHTML='<div class="empty"><div class="ei">📱</div><p>لا منشورات بعد</p></div>';return;}
  const platIcon={facebook:'👥',instagram:'📸',tiktok:'🎵'};
  const statusLabel={published:'✅ منشور',scheduled:'⏰ مجدول',draft:'📝 مسودة',failed:'❌ فشل'};
  list.innerHTML=posts.map(p=>`
    <div style="background:var(--surface2);border-radius:10px;padding:11px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="display:flex;gap:7px;align-items:flex-start;flex:1">
          <span style="font-size:1.1rem;flex-shrink:0">${platIcon[p.platform]||'📱'}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:.82rem;line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${esc(p.content||'')}</div>
            <div style="font-size:.72rem;color:var(--text2);margin-top:3px">${statusLabel[p.status]||p.status} — ${new Date(p.created_at).toLocaleDateString('ar')}</div>
            ${p.status==='scheduled'&&p.scheduled_at?`<div style="font-size:.72rem;color:var(--accent3)">⏰ ${new Date(p.scheduled_at).toLocaleString('ar')}</div>`:''}
          </div>
        </div>
        <button class="btn bd bsm" onclick="delPost(${p.id})" style="flex-shrink:0">🗑</button>
      </div>
      ${p.media_url?`<div style="margin-top:7px"><img src="${esc(p.media_url)}" style="height:60px;border-radius:7px;object-fit:cover" onerror="this.style.display='none'"></div>`:''}
    </div>
  `).join('');
}
async function genPostContent(type){
  const loadingEl=document.getElementById('post-gen-loading');
  const platform=document.getElementById('qp-plat')?.value||'instagram';
  loadingEl.style.display='block';
  const d=await api('/api/posts/generate-content',{method:'POST',body:JSON.stringify({content_type:type,platform})});
  loadingEl.style.display='none';
  if(!d.success||!d.content) return toast('❌ تعذر التوليد');
  document.getElementById('qp-content').value=d.content;
  document.getElementById('qp-count').textContent=d.content.length+'/2200';
  toast('✅ تم توليد المحتوى');
}

async function publishPost(schedule){
  const content=document.getElementById('qp-content').value.trim();
  const platform=document.getElementById('qp-plat').value;
  const media=document.getElementById('qp-media').value.trim();
  const sched=document.getElementById('qp-sched').value;
  if(!content) return toast('⚠️ المحتوى مطلوب');
  if(schedule&&!sched) return toast('⚠️ حدد وقت الجدولة');
  const btn=document.getElementById(schedule?'qp-sch-btn':'qp-pub-btn');
  btn.disabled=true;
  const d=await api('/api/posts',{method:'POST',body:JSON.stringify({
    platform,content,media_url:media||'',
    scheduled_at:schedule?sched:null
  })});
  btn.disabled=false;
  if(d.success){
    toast(schedule?'⏰ تم جدولة المنشور':'✅ تم النشر'+(d.published?' على المنصة':' (محفوظ محلياً)'));
    document.getElementById('qp-content').value='';
    document.getElementById('qp-media').value='';
    document.getElementById('qp-sched').value='';
    document.getElementById('qp-count').textContent='0/2200';
    ldPosts();
  } else toast('❌ '+(d.message||'خطأ'));
}
async function savePost(schedule){
  const content=document.getElementById('mp-content').value.trim();
  const platform=document.getElementById('mp-plat').value;
  const media=document.getElementById('mp-media').value.trim();
  const sched=document.getElementById('mp-sched').value;
  if(!content) return toast('⚠️ المحتوى مطلوب');
  if(schedule&&!sched) return toast('⚠️ حدد وقت الجدولة');
  const d=await api('/api/posts',{method:'POST',body:JSON.stringify({
    platform,content,media_url:media||'',
    scheduled_at:schedule?sched:null
  })});
  if(d.success){
    toast(schedule?'⏰ تم جدولة المنشور':'✅ تم النشر');
    cm('mposts');ldPosts();
  } else toast('❌ '+(d.message||'خطأ'));
}
async function delPost(id){
  if(!confirm('حذف المنشور؟')) return;
  const d=await api('/api/posts/'+id,{method:'DELETE'});
  if(d.success){toast('✅ تم الحذف');ldPosts();}else toast('❌ '+(d.message||'خطأ'));
}

// STORE IDENTITY — هوية المتجر
// ============================================================
