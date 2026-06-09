// ============================================================
// EMPLOYEE
// ============================================================
async function ldEmp(){
  const d=await api('/api/employee');
  const e=d.employee||{};
  document.getElementById('en').value=e.name||'';
  document.getElementById('ep').value=e.personality||'';
  document.getElementById('es').value=e.sales_style||'';
  document.getElementById('eo').value=e.objection_handling||'';
  document.getElementById('ef').value=e.philosophy||'';
  document.getElementById('eb').value=e.boundaries||'';
  renderTrustDashboard(e);
}

function renderTrustDashboard(e) {
  const tl = e.trust_level || 1;
  const correct = e.correct_interactions || 0;
  const total = e.total_interactions || 0;
  const requiredForNext = tl * 20;
  const pct = tl >= 3 ? 100 : Math.min(100, Math.round((correct / requiredForNext) * 100));
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
  const needed = tl < 3 ? Math.max(0, requiredForNext - correct) : 0;

  const stages = [
    { level:1, icon:'👁️', name:'مراقبة',   desc:'يعمل تحت إشراف كامل',          color:'rgba(245,158,11,.15)',  border:'rgba(245,158,11,.4)',  badge:'bor' },
    { level:2, icon:'🤝', name:'مساعدة',   desc:'استقلالية محدودة',              color:'rgba(79,142,247,.15)',  border:'rgba(79,142,247,.4)',  badge:'bbl' },
    { level:3, icon:'🚀', name:'استقلال',  desc:'يعمل باستقلالية تامة',          color:'rgba(0,200,150,.15)',   border:'rgba(0,200,150,.4)',   badge:'bgr' }
  ];

  const permissions = {
    1: { can: ['الإجابة على أسئلة العملاء','شرح المنتجات','أخذ معلومات الطلب'], cannot: ['تغيير الأسعار','منح خصومات','اتخاذ قرارات حرجة'] },
    2: { can: ['كل صلاحيات المرحلة 1','إقتراح بدائل للعميل','التفاوض المحدود','إغلاق صفقات بسيطة'], cannot: ['تغيير السياسات','خصومات خارج الحدود','حذف بيانات'] },
    3: { can: ['كل الصلاحيات السابقة','إغلاق الصفقات باستقلالية','التعامل مع الاعتراضات','إدارة كاملة للمحادثات'], cannot: ['تغيير السياسات الأساسية','حذف بيانات حساسة'] }
  };

  // الاسم
  document.getElementById('trust-emp-name').textContent = e.name || 'الموظف الرقمي';

  // badge المرحلة
  const stage = stages[tl-1];
  document.getElementById('trust-stage-badge').innerHTML =
    `<span class="badge ${stage.badge}" style="font-size:.72rem">${stage.icon} المرحلة ${tl}: ${stage.name}</span>`;

  // النسبة الكبيرة
  document.getElementById('trust-pct-big').textContent = pct + '%';
  document.getElementById('trust-pct-big').style.color = tl>=3 ? 'var(--green)' : tl>=2 ? 'var(--accent)' : 'var(--accent3)';

  // شريط التقدم
  document.getElementById('trust-bar-fill').style.width = pct + '%';
  document.getElementById('trust-bar-fill').style.background =
    tl>=3 ? 'linear-gradient(90deg,var(--green),#00a87a)' :
    tl>=2 ? 'linear-gradient(90deg,var(--accent),var(--accent2))' :
    'linear-gradient(90deg,var(--accent3),#e08000)';
  document.getElementById('trust-bar-label').textContent =
    tl>=3 ? '✅ وصل للمستوى الأعلى' : `التقدم نحو المرحلة ${tl+1}: ${stage.name === 'مراقبة' ? 'مساعدة' : 'استقلال'}`;
  document.getElementById('trust-bar-count').textContent = tl<3 ? `${correct} / ${requiredForNext}` : '';

  // المراحل الثلاث
  document.getElementById('trust-stages').innerHTML = stages.map(s => {
    const done = tl > s.level;
    const current = tl === s.level;
    return `
      <div style="background:${current?s.color:'var(--surface2)'};border:1px solid ${current?s.border:'var(--border)'};border-radius:10px;padding:10px;text-align:center;position:relative;transition:all .3s">
        ${done ? '<div style="position:absolute;top:6px;left:6px;width:16px;height:16px;background:var(--green);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.55rem;color:#fff">✓</div>' : ''}
        <div style="font-size:1.3rem;margin-bottom:4px">${s.icon}</div>
        <div style="font-weight:900;font-size:.78rem;margin-bottom:2px">${s.name}</div>
        <div style="font-size:.66rem;color:var(--text2);line-height:1.4">${s.desc}</div>
        ${current ? `<div style="margin-top:5px"><span class="badge ${s.badge}" style="font-size:.6rem">الحالي</span></div>` : ''}
      </div>`;
  }).join('');

  // الإحصائيات
  document.getElementById('trust-total-int').textContent = total.toLocaleString('ar');
  document.getElementById('trust-correct-int').textContent = correct.toLocaleString('ar');
  document.getElementById('trust-accuracy').textContent = accuracy + '%';
  document.getElementById('trust-accuracy').style.color = accuracy>=80?'var(--green)':accuracy>=60?'var(--accent3)':'var(--danger)';
  document.getElementById('trust-needed').textContent = tl<3 ? needed + ' تفاعل' : '✅';
  document.getElementById('trust-needed').style.color = needed===0&&tl<3 ? 'var(--green)' : 'var(--text)';

  // الصلاحيات
  const perms = permissions[tl] || permissions[1];
  document.getElementById('trust-permissions').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div>
        <div style="font-size:.7rem;color:var(--green);font-weight:700;margin-bottom:5px">✅ يستطيع</div>
        ${perms.can.map(p=>`<div style="font-size:.74rem;color:var(--text2);padding:3px 0;border-bottom:1px solid rgba(255,255,255,.04)">• ${p}</div>`).join('')}
      </div>
      <div>
        <div style="font-size:.7rem;color:var(--danger);font-weight:700;margin-bottom:5px">🚫 لا يستطيع</div>
        ${perms.cannot.map(p=>`<div style="font-size:.74rem;color:var(--text2);padding:3px 0;border-bottom:1px solid rgba(255,255,255,.04)">• ${p}</div>`).join('')}
      </div>
    </div>`;

  // زر الترقية
  const upgradeBtn = document.getElementById('trust-upgrade-btn');
  const upgradeHint = document.getElementById('trust-upgrade-hint');
  if (tl >= 3) {
    upgradeBtn.style.display = 'none';
    upgradeHint.textContent = '🏆 الموظف وصل للمستوى الأعلى — مرحباً بالاستقلالية الكاملة!';
    upgradeHint.style.color = 'var(--green)';
  } else if (needed === 0) {
    upgradeBtn.style.display = 'block';
    upgradeBtn.textContent = `🌟 ترقية للمرحلة ${tl+1} — جاهز!`;
    upgradeBtn.style.background = 'linear-gradient(135deg,var(--green),#00a87a)';
    upgradeHint.textContent = 'استوفيت شروط الترقية ✅';
  } else {
    upgradeBtn.style.display = 'block';
    upgradeBtn.textContent = `⬆️ طلب الترقية للمرحلة ${tl+1}`;
    upgradeBtn.style.background = '';
    upgradeHint.textContent = `يحتاج ${needed} تفاعل صحيح إضافي للترقية`;
  }
}
async function saveEmp(){
  const d=await api('/api/employee',{method:'PUT',body:JSON.stringify({name:document.getElementById('en').value,personality:document.getElementById('ep').value,sales_style:document.getElementById('es').value,objection_handling:document.getElementById('eo').value,philosophy:document.getElementById('ef').value,boundaries:document.getElementById('eb').value})});
  if(d.success) toast('✅ تم حفظ الموظف'); else toast('❌ '+(d.message||'خطأ'));
}
async function upLevel(){
  const d=await api('/api/employee/trust/upgrade',{method:'POST'});
  if(d.success){toast(`🌟 ترقية للمستوى ${d.new_level}!`);ldEmp();}else toast('⚠️ '+(d.message||'لا ترقية'));
}

// ============================================================
// TRAINING
// ============================================================
let simScenario = '';

function openSimScenario(){ om('msimscenario'); }

function startSimWithScenario(scenario){
  simScenario = scenario;
  cm('msimscenario');
  startTrain('simulate_customer');
}

async function startTrain(mode){
  trainMode = mode;
  const d = await api('/api/training/session',{method:'POST',body:JSON.stringify({type:mode,topic:simScenario||''})});
  if (!d.success) return toast('❌ تعذر بدء الجلسة');
  trainSess = d.session;

  const icons = {open:'💬',simulate_customer:'🎭',evaluate:'📊',explain:'🔍'};
  const titles = {open:'تدريب مفتوح',simulate_customer:'محاكاة عميل',evaluate:'تقييم الأداء',explain:'لماذا أجبت هكذا؟'};
  document.getElementById('train-mode-icon').textContent = icons[mode]||'🎓';
  document.getElementById('train-title').textContent = titles[mode]||'جلسة تدريب';
  document.getElementById('train-area').style.display = 'block';
  document.getElementById('tchat').innerHTML = '';
  document.getElementById('transfer-alert').style.display = 'none';

  const intros = {
    open: 'مرحباً! 👋 علّمني ما تريد — أسلوب البيع، التعامل مع العملاء، السياسات، أي شيء.',
    simulate_customer: simScenario ? `سأكون عميلاً بهذا السيناريو: "${simScenario}"\n\nابدأ الرد عليّ وأنا سأتصرف كعميل حقيقي.` : 'أنا عميل مهتم بمنتجاتكم 👋 هلا ممكن أشوف شو عندكم؟',
    evaluate: 'أرسل لي رداً على عميل وسأقيّمه بموضوعية وأعطيك درجة وتوصيات.',
    explain: 'أخبرني بالرد الذي تريد أن أشرح منطقه وسأوضح لك تفكيري.'
  };
  addCm('tchat','ai', intros[mode]||'مرحباً!');
}

function endTrain(){
  trainSess = null;
  simScenario = '';
  document.getElementById('train-area').style.display = 'none';
  ldCorrs();
}


// إرفاق صورة في التدريب
function attachTrainImage(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onloadend = () => {
    window._trainAttachedImage = reader.result;
    // إزالة preview قديم
    document.getElementById('train-img-preview')?.remove();
    // إضافة preview
    const cin = document.querySelector('#train-area .cin');
    if (cin) {
      const prev = document.createElement('div');
      prev.id = 'train-img-preview';
      prev.style.cssText = 'padding:6px;display:flex;align-items:center;gap:8px;background:var(--surface2);border-radius:8px;margin-bottom:4px';
      prev.innerHTML = `<img src="${reader.result}" style="width:40px;height:40px;object-fit:cover;border-radius:6px"><span style="font-size:.78rem;flex:1">صورة مرفقة</span><button onclick="window._trainAttachedImage=null;this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:var(--danger)">✕</button>`;
      cin.parentElement.insertBefore(prev, cin);
    }
    toast('✅ تم إرفاق الصورة — اكتب رسالتك وأرسل');
  };
  reader.readAsDataURL(file);
  input.value = '';
}

async function sendTrain(){
  const inp = document.getElementById('tinput');
  const msg = inp.value.trim();
  const attachedImg = window._trainAttachedImage;
  if (!msg && !attachedImg || !trainSess) return;
  inp.value = '';
  const displayMsg = msg + (attachedImg ? ' 🖼️' : '');
  addCm('tchat','user', displayMsg);
  const btn = document.getElementById('tbtn');
  btn.disabled = true; btn.textContent = '⏳';
  const body = {session_id:trainSess.id, message: msg || 'انظر لهذه الصورة', mode:trainMode};
  if (simScenario) body.scenario = simScenario;
  if (attachedImg) { body.image_base64 = attachedImg; window._trainAttachedImage = null; document.getElementById('train-img-preview')?.remove(); }
  const d = await api('/api/training/chat',{method:'POST',body:JSON.stringify(body)});
  btn.disabled = false; btn.textContent = 'إرسال';
  if (d.success) {
    lastTrainR = d.response;
    addCm('tchat','ai',d.response);
    // تشغيل الصوت إذا كان وضع الصوت مفعلاً
    if (voiceMode) speakResponse(d.response);
    // إشعار حفظ الذاكرة
    if (d.memorySaved) {
      addCm('tchat','ai','✅ تم حفظ ما تعلمته في ذاكرتي الدائمة! سأتذكره في كل الجلسات القادمة 🧠');
    }
    // كشف تحويل للبشر
    if (d.needs_human) {
      const alert = document.getElementById('transfer-alert');
      document.getElementById('transfer-reason').textContent = d.transfer_reason||'';
      alert.style.display = 'block';
    }
  } else {
    addCm('tchat','ai','❌ '+(d.message||'خطأ'));
  }
}

async function askWhyLast(){
  if (!lastTrainR) return toast('⚠️ لا يوجد رد سابق');
  addCm('tchat','user','لماذا أجبت هكذا؟');
  const btn = document.getElementById('tbtn');
  btn.disabled = true; btn.textContent = '⏳';
  const d = await api('/api/agent/explain',{method:'POST',body:JSON.stringify({last_response:lastTrainR,question:'لماذا أجبت هكذا؟ وضّح منطقك'})});
  btn.disabled = false; btn.textContent = 'إرسال';
  if (d.explanation) addCm('tchat','ai',d.explanation);
  else toast('❌ تعذر الحصول على شرح');
}

function addCm(chatId,role,text){
  const c = document.getElementById(chatId);
  if (!c) return;
  const d = document.createElement('div');
  d.className = 'cm' + (role==='user'?' u':'');
  d.innerHTML = `<div class="cav" style="background:${role==='user'?'var(--accent)':'linear-gradient(135deg,var(--accent2),#a855f7)'}">${role==='user'?'👤':'🧠'}</div><div class="cbub"></div>`;
  d.querySelector('.cbub').textContent = text;
  c.appendChild(d); c.scrollTop = c.scrollHeight;
}

function openCorr(){
  document.getElementById('corig').value = lastTrainR;
  document.getElementById('cfix').value = '';
  document.getElementById('cles').value = '';
  om('mcorr');
}

async function subCorr(){
  const orig = document.getElementById('corig').value;
  const fix = document.getElementById('cfix').value;
  const les = document.getElementById('cles').value;
  if (!orig||!fix) return toast('⚠️ الحقلان الأول والثاني مطلوبان');
  const d = await api('/api/training/correct',{method:'POST',body:JSON.stringify({original_response:orig,corrected_response:fix,lesson:les})});
  if (d.success){
    toast('✅ تم حفظ التصحيح — سيتعلم الموظف منه');
    cm('mcorr');
    ldCorrs();
    // إضافة رسالة توضيحية في المحادثة
    if (trainSess) addCm('tchat','ai',`✅ شكراً على التصحيح! فهمت: "${les||fix.substring(0,80)}" — سأطبق هذا في المستقبل.`);
  } else toast('❌ '+(d.message||'خطأ'));
}

async function ldCorrs(){
  const d = await api('/api/training/corrections');
  const list = document.getElementById('corrlist');
  if (!d.corrections?.length){list.innerHTML='<div class="empty"><div class="ei">✏️</div><p>لا تصحيحات بعد — صحّح الموظف ليتعلم</p></div>';return;}
  list.innerHTML = d.corrections.map(c=>`
    <div style="background:var(--surface2);border-radius:11px;padding:12px;margin-bottom:8px">
      <div style="color:var(--danger);font-size:.72rem;font-weight:700;margin-bottom:3px;text-transform:uppercase;letter-spacing:.5px">❌ الرد الأصلي</div>
      <div style="font-size:.8rem;margin-bottom:8px;color:var(--text2);line-height:1.5">${esc((c.original_response||'').substring(0,120))}...</div>
      <div style="color:var(--green);font-size:.72rem;font-weight:700;margin-bottom:3px;text-transform:uppercase;letter-spacing:.5px">✅ الرد الصحيح</div>
      <div style="font-size:.8rem;margin-bottom:6px;line-height:1.5">${esc((c.corrected_response||'').substring(0,120))}...</div>
      ${c.lesson?`<div style="background:rgba(79,142,247,.1);border-radius:8px;padding:5px 9px;font-size:.75rem;color:var(--accent)">💡 ${esc(c.lesson)}</div>`:''}
    </div>
  `).join('');
}

async function askExp(){
  const q = document.getElementById('exq').value.trim()||'لماذا أجبت هكذا؟';
  const r = document.getElementById('expr');
  r.textContent = '⏳ جاري الشرح...'; r.style.display = 'block';
  const d = await api('/api/agent/explain',{method:'POST',body:JSON.stringify({last_response:lastTrainR||lastAiResp,question:q})});
  r.textContent = d.explanation||'تعذر الحصول على شرح';
}

// ============================================================
// AGENT
// ============================================================
async function sndAgent(msg){
  const inp = document.getElementById('ainput');
  const m = msg||inp.value.trim();
  if (!m) return;
  if (!msg) inp.value = '';
  addCm('achat','user',m);
  const btn = document.getElementById('abtn');
  btn.disabled = true; btn.textContent = '⏳';
  const d = await api('/api/agent/chat',{method:'POST',body:JSON.stringify({message:m})});
  btn.disabled = false; btn.textContent = 'إرسال ↵';
  if (d.success) {
    lastAiResp = d.response;
    addCm('achat','ai',d.response);
    // عرض تحويل للبشر
    if (d.needs_human) {
      const alertDiv = document.createElement('div');
      alertDiv.style.cssText = 'background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);border-radius:11px;padding:11px 13px;margin-top:7px';
      alertDiv.innerHTML = `<div style="font-weight:700;font-size:.82rem;color:var(--accent3);margin-bottom:3px">⚠️ طلب تحويل لصاحب العمل</div><div style="font-size:.78rem;color:var(--text2)">${esc(d.transfer_reason||'')}</div>`;
      document.getElementById('achat').appendChild(alertDiv);
      document.getElementById('achat').scrollTop = 99999;
    }
  } else addCm('achat','ai','❌ '+(d.message||'خطأ'));
}
async function clrAgent(){
  await api('/api/agent/clear',{method:'DELETE'});
  document.getElementById('achat').innerHTML='<div class="cm"><div class="cav" style="background:linear-gradient(135deg,var(--accent2),#a855f7)">🧠</div><div class="cbub">تم المسح. ماذا تريد؟</div></div>';
}

// ============================================================
// KNOWLEDGE BASE
// ============================================================
let kbF='';
async function ldKb(search){
  const s = search || document.getElementById('kb-search-inp')?.value || '';
  let url = '/api/knowledge';
  const params = [];
  if (kbF) params.push('type='+kbF);
  if (s) params.push('search='+encodeURIComponent(s));
  if (params.length) url += '?' + params.join('&');
  const d = await api(url);
  const list = document.getElementById('kblist');
  if (!d.items?.length) { list.innerHTML='<div class="empty"><div class="ei">📚</div><p>فارغ — أضف سياساتك وضماناتك</p></div>'; return; }
  const ico = {policy:'📋',faq:'❓',catalog:'📦',warranty:'🛡️',return:'↩️',price_list:'💰',shipping:'🚚',product_info:'🏷️',other:'📄'};
  const labels = {policy:'سياسة',faq:'سؤال',catalog:'كتالوج',warranty:'ضمان',return:'استرجاع',price_list:'أسعار',shipping:'شحن',product_info:'منتج',other:'أخرى'};
  list.innerHTML = d.items.map(k=>`
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:13px;padding:13px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:flex-start;gap:9px">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
          <span class="badge bbl">${ico[k.type]||'📄'} ${labels[k.type]||k.type}</span>
          ${k.file_url?'<span class="badge bpu">📎 PDF</span>':''}
        </div>
        <div style="font-weight:700;font-size:.88rem;margin-bottom:4px">${esc(k.title)}</div>
        <div style="color:var(--text2);font-size:.78rem;line-height:1.5">${esc((k.content||'').substring(0,130))}${k.content?.length>130?'...':''}</div>
      </div>
      <div style="display:flex;gap:5px;flex-shrink:0">
        <button class="btn bo bsm" onclick="editKb(${k.id},'${esc(k.title).replace(/'/g,"\\'")}','${esc((k.content||'').replace(/'/g,"\\'")).replace(/\n/g,'\\n')}','${k.type}')">✏️</button>
        <button class="btn bd bsm" onclick="delKb(${k.id})">🗑</button>
      </div>
    </div>
  `).join('');
}

function fkb(type,btn){
  kbF=type;
  document.querySelectorAll('#page-knowledge .fb').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  ldKb();
}

async function saveKb(){
  const title = document.getElementById('kbtit').value.trim();
  const content = document.getElementById('kbcon').value.trim();
  const type = document.getElementById('kbtype').value;
  if (!title||!content) return toast('⚠️ العنوان والمحتوى مطلوبان');
  const d = await api('/api/knowledge',{method:'POST',body:JSON.stringify({title,content,type})});
  if (d.success) { toast('✅ تم الحفظ — الموظف سيقرأ هذا الآن'); cm('mkb'); ldKb(); }
  else toast('❌ '+(d.message||'خطأ'));
}

function editKb(id,title,content,type){
  document.getElementById('kbtit').value = title;
  document.getElementById('kbcon').value = content.replace(/\\n/g,'\n');
  document.getElementById('kbtype').value = type;
  // تحويل زر الحفظ لتحديث
  const btn = document.querySelector('#mkb .btn.ba');
  if (btn) {
    btn.textContent = '✅ تحديث';
    btn.onclick = async () => {
      const d = await api('/api/knowledge/'+id,{method:'PUT',body:JSON.stringify({
        title:document.getElementById('kbtit').value,
        content:document.getElementById('kbcon').value,
        type:document.getElementById('kbtype').value
      })});
      if (d.success) { toast('✅ تم التحديث'); cm('mkb'); ldKb(); btn.textContent='✅ حفظ في مركز المعرفة'; btn.onclick=saveKb; }
      else toast('❌ '+(d.message||'خطأ'));
    };
  }
  om('mkb');
}

async function delKb(id){
  if (!confirm('حذف؟')) return;
  await api('/api/knowledge/'+id,{method:'DELETE'});
  ldKb();
}

// بحث ذكي
async function searchKb(){
  const q = document.getElementById('kbs-q')?.value.trim();
  if (!q) return toast('⚠️ أدخل سؤالك');
  const btn = document.getElementById('kbs-btn');
  btn.disabled = true; btn.textContent = '⏳';
  const d = await api('/api/knowledge/search',{method:'POST',body:JSON.stringify({query:q})});
  btn.disabled = false; btn.textContent = 'بحث';
  const res = document.getElementById('kbs-result');
  const items = document.getElementById('kbs-items');
  if (d.success) {
    res.style.display = 'block';
    res.innerHTML = `<div style="font-size:.72rem;color:var(--text2);margin-bottom:6px;font-weight:700">🤖 إجابة الذكاء الاصطناعي:</div>${esc(d.answer||'لم أجد إجابة')}`;
    if (d.results?.length) {
      items.innerHTML = `<div style="font-size:.72rem;color:var(--text2);margin-top:10px;margin-bottom:6px;font-weight:700">📋 المصادر ذات الصلة:</div>` +
        d.results.map(k=>`<div style="background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:9px 11px;margin-bottom:5px;font-size:.8rem"><b>${esc(k.title)}</b><br><span style="color:var(--text2)">${esc(k.content.substring(0,100))}...</span></div>`).join('');
    }
  } else toast('❌ '+(d.message||'فشل البحث'));
}

// رفع PDF
let pdfFileData = null;
function setPdfFile(input){
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5*1024*1024) return toast('⚠️ الملف أكبر من 5MB');
  document.getElementById('pdf-file-name').textContent = file.name;
  const reader = new FileReader();
  reader.onload = e => { pdfFileData = e.target.result; };
  reader.readAsDataURL(file);
}
async function uploadPdf(){
  if (!pdfFileData) return toast('⚠️ اختر ملف PDF أولاً');
  const title = document.getElementById('pdf-title')?.value.trim();
  if (!title) return toast('⚠️ أدخل عنوان المستند');
  const btn = document.getElementById('pdf-upload-btn');
  btn.disabled = true; btn.textContent = '⏳ جاري الاستخراج بالـ AI...';
  const d = await api('/api/knowledge/upload-pdf',{method:'POST',body:JSON.stringify({
    pdf_base64: pdfFileData,
    title,
    type: document.getElementById('pdf-type')?.value || 'catalog'
  })});
  btn.disabled = false; btn.textContent = '📤 رفع واستخراج المحتوى';
  if (d.success) {
    const res = document.getElementById('pdf-result');
    res.style.display = 'block';
    res.innerHTML = `✅ تم استخراج المحتوى وحفظه!<br><span style="color:var(--text2)">${esc(d.extracted_text||'')}</span>`;
    pdfFileData = null;
    document.getElementById('pdf-file-name').textContent = 'اضغط لاختيار ملف PDF';
    document.getElementById('pdf-title').value = '';
    ldKb();
    toast('✅ تم حفظ محتوى الـ PDF في مركز المعرفة');
  } else toast('❌ '+(d.message||'فشل الاستخراج'));
}

// ============================================================
// DECISIONS
// ============================================================
let decFilter = '';
async function ldDec(){
  let url = '/api/decisions';
  if (decFilter) url += '?context=' + decFilter;
  const d = await api(url);
  const list = document.getElementById('declist');
  if (!d.decisions?.length) {
    list.innerHTML = `<div class="empty"><div class="ei">🗂️</div><p>لا قرارات — أضف قراراتك ليطبقها الموظف</p>
      <div style="margin-top:12px;text-align:right">
        <div style="font-size:.78rem;color:var(--text2);margin-bottom:8px">أمثلة على قرارات مفيدة:</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;justify-content:center">
          <button class="cs" onclick="quickDec('لا تعطِ خصماً لأي عميل يطلبه أكثر من مرة في أسبوع','للحفاظ على هامش الربح','pricing')">لا تعطِ خصماً متكرراً</button>
          <button class="cs" onclick="quickDec('لا توعد بموعد توصيل محدد بدون التأكد من المخزون','تجنب الإحراج مع العملاء','delivery')">لا توعد بتوصيل غير مؤكد</button>
          <button class="cs" onclick="quickDec('حوّل كل شكوى جدية لصاحب العمل فوراً','الشكاوى الجدية تحتاج قرار بشري','general')">حوّل الشكاوى الجدية</button>
        </div>
      </div>
    </div>`;
    return;
  }
  const ctxIcon = {general:'⚡',customer:'👤',pricing:'💰',delivery:'🚚',returns:'↩️'};
  const ctxLabel = {general:'عام',customer:'عميل',pricing:'تسعير',delivery:'توصيل',returns:'استرجاع'};
  list.innerHTML = d.decisions.map(dec=>`
    <div style="background:var(--surface);border:1px solid var(--border);border-right:3px solid var(--accent2);border-radius:13px;padding:14px;margin-bottom:9px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:9px">
        <div style="flex:1">
          <div style="font-weight:700;font-size:.88rem;margin-bottom:5px">⚡ ${esc(dec.decision)}</div>
          <div style="color:var(--text2);font-size:.78rem;margin-bottom:7px">📌 ${esc(dec.reason)}</div>
          <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">
            <span class="badge bpu">${ctxIcon[dec.context]||'⚡'} ${ctxLabel[dec.context]||dec.context}</span>
            ${dec.customer_phone?`<span class="badge bbl">📱 ${esc(dec.customer_phone)}</span>`:''}
            <span class="badge bgr" style="font-size:.62rem">✅ مُطبَّق تلقائياً</span>
          </div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          <button class="btn bo bsm" onclick="toggleDec(${dec.id},${!dec.is_active})" title="${dec.is_active?'إيقاف':'تفعيل'}">${dec.is_active?'⏸':'▶️'}</button>
          <button class="btn bd bsm" onclick="delDec(${dec.id})">🗑</button>
        </div>
      </div>
    </div>
  `).join('');
}

function filterDec(ctx, btn){
  decFilter = ctx;
  document.querySelectorAll('#page-decisions .fb').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  ldDec();
}

async function quickDec(decision, reason, context){
  const d = await api('/api/decisions',{method:'POST',body:JSON.stringify({decision,reason,context:context||'general'})});
  if (d.success) { toast('✅ تم إضافة القرار'); ldDec(); }
  else toast('❌ '+(d.message||'خطأ'));
}

async function saveDec(){
  const ctx = document.getElementById('dctx').value;
  const d = await api('/api/decisions',{method:'POST',body:JSON.stringify({
    decision: document.getElementById('ddc').value,
    reason: document.getElementById('drs').value,
    context: ctx,
    customer_phone: ctx==='customer' ? document.getElementById('dph').value : ''
  })});
  if (d.success) { toast('✅ تم — الموظف سيطبق هذا القرار الآن'); cm('mdec'); ldDec(); }
  else toast('❌ '+(d.message||'خطأ'));
}

async function toggleDec(id, active){
  await api('/api/decisions/'+id,{method:'PUT',body:JSON.stringify({is_active:active})});
  ldDec();
}

async function delDec(id){
  if (!confirm('حذف القرار؟')) return;
  await api('/api/decisions/'+id,{method:'DELETE'});
  ldDec();
}

// ============================================================
// EMERGENCY
// ============================================================
const emMsgs = {
  إجازة: 'نعتذر عن أي تأخير 🌴 نحن في إجازة حالياً. سنعود قريباً ونرد على جميع طلباتكم. للاستفسارات العاجلة يمكنكم التواصل معنا على واتساب.',
  صيانة: 'نعتذر 🔧 النظام في وضع الصيانة مؤقتاً لتحسين خدمتكم. سنعود خلال وقت قصير. شكراً لصبركم.',
  عطلة: 'بمناسبة العطلة الرسمية 🎉 سنكون غائبين اليوم. سنعود غداً ونتابع جميع طلباتكم. كل عام وأنتم بخير!',
  طوارئ: 'نعتذر 🚨 لدينا ظرف طارئ يمنعنا من الرد الآن. سنتواصل معكم في أقرب وقت ممكن. نشكر تفهمكم.'
};

function setEmMsg(type){ document.getElementById('emmsg').value = emMsgs[type] || ''; }

async function suggestEmMsg(){
  const btn = document.getElementById('em-ai-btn');
  const resultsEl = document.getElementById('em-ai-results');
  btn.disabled = true; btn.textContent = '⏳ جاري التوليد...';
  resultsEl.style.display = 'none'; resultsEl.innerHTML = '';
  const mode_type = document.getElementById('emtype')?.value || 'emergency';
  const end_at = document.getElementById('emend')?.value || null;
  const d = await api('/api/emergency/suggest', {method:'POST', body:JSON.stringify({mode_type, end_at})});
  btn.disabled = false; btn.textContent = '✨ اقتراح ذكي حسب نشاطي';
  if (!d.success || !d.messages?.length) return toast('❌ تعذر توليد الاقتراحات');
  resultsEl.innerHTML = d.messages.map(m=>`
    <div style="background:var(--surface2);border-radius:9px;padding:10px;cursor:pointer;border:1px solid var(--border)" onclick="document.getElementById('emmsg').value=\`${m.text.replace(/`/g,"'")}\`;toast('✅ تم نسخ الرسالة')">
      <div style="font-size:.72rem;color:var(--accent);font-weight:700;margin-bottom:4px">${esc(m.label)}</div>
      <div style="font-size:.8rem;color:var(--text1);line-height:1.5">${esc(m.text)}</div>
    </div>`).join('');
  resultsEl.style.display = 'flex';
}

async function ldBoard(){
  const d = await api('/api/board/recommendations');
  if (d.recommendations?.length) {
    rnBoard(d.recommendations, 'boardlist');
    rnBoard(d.recommendations.slice(0,3), 'h-board');
  } else { genBoard(); }
}
async function genBoard(){
  const btn=document.getElementById('bbtn');
  btn.disabled=true;btn.textContent='⏳ المجلس يحلل بياناتك...';
  const d=await api('/api/board/generate',{method:'POST'});
  btn.disabled=false;btn.textContent='🔄 توليد توصيات';
  if(d.success){
    rnBoard(d.recommendations||[],'boardlist');
    rnBoard((d.recommendations||[]).slice(0,3),'h-board');
    const perf=d.performance||{};
    const perfEl=document.getElementById('board-perf');
    if(perfEl&&perf.revenue_30d!==undefined){
      perfEl.innerHTML=`
        <div class="sc"><div class="si">💰</div><div class="sv">${Number(perf.revenue_30d||0).toLocaleString()}</div><div class="sl">إيراد 30 يوم</div></div>
        <div class="sc"><div class="si">🛒</div><div class="sv">${perf.orders_30d||0}</div><div class="sl">طلبات 30 يوم</div></div>
        <div class="sc"><div class="si">👤</div><div class="sv">${perf.new_customers||0}</div><div class="sl">عملاء جدد</div></div>
        <div class="sc"><div class="si">🧠</div><div class="sv" style="color:${perf.employee_accuracy>=80?'var(--green)':perf.employee_accuracy>=60?'var(--accent3)':'var(--danger)'}">${perf.employee_accuracy||0}%</div><div class="sl">دقة الموظف</div></div>`;
    }
  } else toast('❌ '+(d.message||'خطأ'));
}
function rnBoard(recs,elId){
  const el=document.getElementById(elId);
  if(!el) return;
  if(!recs.length){el.innerHTML='<div class="empty"><div class="ei">🏛️</div><p>لا توصيات — اضغط توليد</p></div>';return;}
  const ico={opportunity:'🚀',warning:'⚠️',strategy:'🎯',insight:'💡',action:'⚡',risk:'🔴'};
  const typeLabel={opportunity:'فرصة',warning:'تحذير',strategy:'استراتيجية',insight:'ملاحظة',action:'إجراء',risk:'خطر'};
  const actionHandlers={create_campaign:'om(\'mads\')',add_coupon:'om(\'mcoup\')',go_training:'sp(\'training\',null)',go_retargeting:'sp(\'retargeting\',null)',go_inventory:'sp(\'inventory\',null)'};
  el.innerHTML=recs.map(r=>`
    <div class="bc ${r.priority||'medium'}" style="margin-bottom:10px;padding:14px;border-radius:12px;border:1px solid var(--border);background:var(--surface)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:7px">
        <div style="display:flex;align-items:center;gap:7px">
          <span style="font-size:1.1rem">${ico[r.type]||'💡'}</span>
          <span class="badge ${r.priority==='high'?'brd':r.priority==='low'?'bgr':'bor'}" style="font-size:.65rem">${typeLabel[r.type]||r.type}</span>
        </div>
        ${!r.is_read?'<div style="width:7px;height:7px;border-radius:50%;background:var(--accent);flex-shrink:0;margin-top:4px"></div>':''}
      </div>
      <div style="font-weight:700;font-size:.9rem;margin-bottom:5px">${esc(r.title)}</div>
      <div style="color:var(--text2);font-size:.81rem;line-height:1.7;margin-bottom:${r.action_label?'9px':'0'}">${esc(r.content)}</div>
      ${r.kpi?`<div style="font-size:.71rem;color:var(--accent);margin-bottom:7px">📊 ${esc(r.kpi)}</div>`:''}
      ${r.action_label&&actionHandlers[r.action]?`<button class="btn ba bsm" onclick="${actionHandlers[r.action]}" style="font-size:.75rem;padding:6px 11px">${esc(r.action_label)}</button>`:''}
    </div>
  `).join('');
}

// ============================================================
// APPROVALS
// ============================================================
async function ldApprov(){
  const d=await api('/api/approvals');
  const list=document.getElementById('apprlist');
  if(!d.requests?.length){list.innerHTML='<div class="empty"><div class="ei">✅</div><p>لا طلبات</p></div>';return;}
  list.innerHTML=d.requests.map(r=>`<div class="card" style="padding:13px;margin-bottom:7px"><div style="font-weight:700;margin-bottom:3px">${esc(r.action_type)}</div><div style="color:var(--text2);font-size:.8rem;margin-bottom:9px">${esc((r.action_data||'').substring(0,140))}</div><div style="display:flex;gap:7px"><button class="btn ba bsm" onclick="decAppr(${r.id},'approved')">✅ موافقة</button><button class="btn bd bsm" onclick="decAppr(${r.id},'rejected')">❌ رفض</button></div></div>`).join('');
}
async function decAppr(id,status){await api('/api/approvals/'+id,{method:'PUT',body:JSON.stringify({status})});ldApprov();toast(status==='approved'?'✅ موافقة':'❌ رفض');}

// ============================================================
// ORDERS
// ============================================================
