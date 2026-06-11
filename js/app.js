// ============================================================
const navHistory = [];
let currentPage = 'home';

function sp(name, btn) {
  // حفظ الصفحة السابقة
  if (currentPage && currentPage !== name) navHistory.push(currentPage);
  currentPage = name;
  // تحديث زر الرجوع
  updateBackBtn();

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.si-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.mike-btn').forEach(b => b.classList.remove('active'));
  const pg = document.getElementById('page-' + name);
  if (pg) pg.classList.add('active');
  if (btn) btn.classList.add('active');
  if (name === 'mike') document.getElementById('mike-nav-btn')?.classList.add('active');
  closeMobileMenu();
  const ldr = {home:ldHome,mike:ldMike,orders:ldOrds,products:ldProds,customers:ldCusts,knowledge:ldKb,decisions:ldDec,board:ldBoard,approvals:ldApprov,analytics:ldAna,'analytics-adv':ldAdvAna,'digital-team':ldDTeam,coupons:ldCoups,loyalty:ldLoy,'bulk-wa':ldWa,marketplace:ldMkt,social:ldSocial,ads:ldAds,posts:ldPosts,identity:ldIdentity,designer:ldDesigner,team:ldTeam,notifications:ldNotifs,security:ldSec,backup:ldBkps,emergency:ldEm,inventory:ldInv,settings:ldSets,profile:ldProf,employee:ldEmp,training:ldCorrs,departments:loadDepartmentsPage,ai:loadAIPage,more:()=>{}};

  if (ldr[name]) ldr[name]();
  setTimeout(initImgPickers, 100);
  // إخفاء/إظهار الـ FAB حسب الصفحة
  const fab = document.getElementById('mike-fab');
  if (fab) fab.style.display = name === 'mike' ? 'none' : 'flex';
  // إغلاق النافذة العائمة عند الانتقال لصفحة Mike
  if (name === 'mike') closeMikePanel();
}

function goBack() {
  if (navHistory.length === 0) return sp('home', null);
  const prev = navHistory.pop();
  currentPage = prev;
  updateBackBtn();
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.si-btn').forEach(b => b.classList.remove('active'));
  const pg = document.getElementById('page-' + prev);
  if (pg) pg.classList.add('active');
  const ldr = {home:ldHome,orders:ldOrds,products:ldProds,customers:ldCusts,knowledge:ldKb,decisions:ldDec,board:ldBoard,approvals:ldApprov,analytics:ldAna,'analytics-adv':ldAdvAna,'digital-team':ldDTeam,'team-meeting':ldTeamMeeting,coupons:ldCoups,loyalty:ldLoy,'bulk-wa':ldWa,marketplace:ldMkt,social:ldSocial,ads:ldAds,posts:ldPosts,comments:ldCommentsPosts,invoices:ldInvoices,identity:ldIdentity,designer:ldDesigner,team:ldTeam,notifications:ldNotifs,security:ldSec,backup:ldBkps,emergency:ldEm,inventory:ldInv,settings:ldSets,profile:ldProf,employee:ldEmp,training:ldCorrs,delivery:ldDelivery,retargeting:ldRetargeting,'employee-log':ldEmpLog,'session-detail':()=>{},departments:loadDepartmentsPage,ai:loadAIPage};
  if (ldr[prev]) ldr[prev]();
}

function updateBackBtn() {
  const btn = document.getElementById('global-back-btn');
  if (btn) btn.style.display = navHistory.length > 0 ? 'inline-flex' : 'none';
}

// ============================================================
// MIKE MICROPHONE — الميكروفون الصوتي
// ============================================================
let mikeRecognition = null;
let mikeMicActive = false;

function toggleMikeMic() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    toast('⚠️ المتصفح لا يدعم التعرف على الصوت — جرب Chrome');
    return;
  }
  if (mikeMicActive) {
    stopMikeMic();
  } else {
    startMikeMic();
  }
}

function startMikeMic() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  mikeRecognition = new SpeechRecognition();
  mikeRecognition.lang = 'ar-SA';
  mikeRecognition.continuous = false;
  mikeRecognition.interimResults = true;

  mikeRecognition.onstart = () => {
    mikeMicActive = true;
    const btn = document.getElementById('mike-mic-btn');
    if (btn) btn.classList.add('listening');
    const hint = document.getElementById('mike-hint-text');
    if (hint) hint.textContent = '🎤 يستمع... تكلم الآن';
    document.getElementById('mike-input').placeholder = '🎤 يستمع...';
  };

  mikeRecognition.onresult = (e) => {
    let transcript = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      transcript += e.results[i][0].transcript;
    }
    document.getElementById('mike-input').value = transcript;
  };

  mikeRecognition.onend = () => {
    stopMikeMic();
    // إرسال تلقائي إذا كان هناك نص
    const txt = document.getElementById('mike-input').value.trim();
    if (txt) setTimeout(() => sendMike(), 300);
  };

  mikeRecognition.onerror = (e) => {
    stopMikeMic();
    if (e.error === 'not-allowed') toast('⚠️ يرجى السماح بالوصول للميكروفون');
    else toast('⚠️ تعذر التعرف على الصوت');
  };

  mikeRecognition.start();
}

function stopMikeMic() {
  mikeMicActive = false;
  if (mikeRecognition) { try { mikeRecognition.stop(); } catch(e) {} mikeRecognition = null; }
  const btn = document.getElementById('mike-mic-btn');
  if (btn) btn.classList.remove('listening');
  const hint = document.getElementById('mike-hint-text');
  if (hint) hint.textContent = 'Mike يستطيع: إضافة طلبات · منتجات · عملاء · نشر على المنصات · إرسال واتساب · تقارير فورية';
  document.getElementById('mike-input').placeholder = 'قل لـ Mike ماذا تريد أو اضغط 🎤 للتحدث...';
}

// IMAGE PICKER — رفع الصور من الجهاز
// ============================================================

// إنشاء input[type=file] مخفي مشترك
const _fileInput = document.createElement('input');
_fileInput.type = 'file';
_fileInput.accept = 'image/*';
_fileInput.style.display = 'none';
document.body.appendChild(_fileInput);

let _currentUploadTarget = null; // { inputId, btnId, prvId }

_fileInput.addEventListener('change', async () => {
  const file = _fileInput.files[0];
  if (!file || !_currentUploadTarget) return;
  _fileInput.value = '';
  const { inputId, btnId, prvId } = _currentUploadTarget;
  const btn = document.getElementById(btnId);
  if (btn) { btn.textContent = '⏳'; btn.classList.add('uploading'); }

  try {
    // تحويل الصورة لـ base64
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });

    // رفع للسيرفر
    const d = await api('/api/upload/image', {
      method: 'POST',
      body: JSON.stringify({ image: b64, folder: 'socialos' })
    });

    if (d.success && d.url) {
      const inp = document.getElementById(inputId);
      if (inp) {
        inp.value = d.url;
        inp.dispatchEvent(new Event('input')); // تشغيل preview
      }
      // عرض المعاينة
      if (prvId) {
        const prv = document.getElementById(prvId);
        if (prv) { prv.src = d.url; prv.style.display = 'block'; }
      }
      toast('✅ تم رفع الصورة');
    } else {
      // إذا لم يكن Cloudinary مضبوطاً — استخدم base64 مباشرة (للتجربة)
      const inp = document.getElementById(inputId);
      if (inp) inp.value = b64;
      toast('⚠️ ' + (d.message || 'رُفع محلياً'));
    }
  } catch (e) {
    toast('❌ فشل الرفع');
  } finally {
    if (btn) { btn.textContent = '🖼️'; btn.classList.remove('uploading'); }
    _currentUploadTarget = null;
  }
});

function pickImg(inputId, btnId, prvId) {
  _currentUploadTarget = { inputId, btnId, prvId };
  _fileInput.click();
}

// Helper: تحويل حقل صورة عادي إلى img-picker
function makeImgPicker(inputId, prvId) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  if (inp._pickerDone) return;
  inp._pickerDone = true;

  const btnId = inputId + '_pickbtn';
  const wrap = document.createElement('div');
  wrap.className = 'img-picker';

  inp.parentNode.insertBefore(wrap, inp);
  wrap.appendChild(inp);

  const btn = document.createElement('button');
  btn.id = btnId;
  btn.className = 'img-pick-btn';
  btn.type = 'button';
  btn.title = 'اختر صورة من جهازك';
  btn.textContent = '🖼️';
  btn.onclick = () => pickImg(inputId, btnId, prvId || (inputId + '_prv'));
  wrap.appendChild(btn);

  if (prvId) {
    const existPrv = document.getElementById(prvId);
    if (existPrv) wrap.appendChild(existPrv);
  } else {
    const prv = document.createElement('img');
    prv.id = inputId + '_prv';
    prv.className = 'img-prv';
    prv.onerror = () => { prv.style.display = 'none'; };
    wrap.appendChild(prv);
    // تحديث preview عند تغيير الرابط يدوياً
    inp.addEventListener('input', () => {
      const v = inp.value.trim();
      if (v.startsWith('https://') || v.startsWith('data:')) {
        prv.src = v; prv.style.display = 'block';
      } else { prv.style.display = 'none'; }
    });
  }
}

// تحويل جميع حقول الصور تلقائياً عند فتح أي صفحة
function initImgPickers() {
  const fields = [
    'pi',      // صورة المنتج
    'pfa',     // صورة الملف الشخصي
    'id-logo', // شعار المتجر
    'id-cover',// غلاف المتجر
    'des-url', // مصمم الصور
    'qp-media',// منشور سريع
    'mp-media',// modal منشور
    'wat-img', // واتساب
  ];
  fields.forEach(id => { if (document.getElementById(id)) makeImgPicker(id); });
}


function bnSwitch(name, btn) {
  document.querySelectorAll('.bn-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (name === 'more') { if (typeof openMobileMenu === 'function') openMobileMenu(); return; }
  sp(name, null);
}
