// ============================================================
async function ldAdvAna(){
  const period=document.getElementById('adv-period')?.value||'30';
  const d=await api('/api/analytics/advanced?period='+period);
  if(!d.success) return;
  const data=d.data||{};
  const cur=data.current||{};
  const prev=data.previous||{};
  const growth=data.growth||{};

  // إحصائيات مع نسبة النمو
  const statsEl=document.getElementById('adv-stats');
  if(statsEl){
    const growthColor=(v)=>v>0?'color:var(--green)':v<0?'color:var(--danger)':'color:var(--text2)';
    const arrow=(v)=>v>0?'↑':v<0?'↓':'→';
    statsEl.innerHTML=`
      <div class="sc"><div class="si">💰</div><div class="sv">${Number(cur.revenue||0).toLocaleString('ar-IQ')}</div><div class="sl">الإيرادات</div><div style="font-size:.72rem;${growthColor(growth.revenue)}">${arrow(growth.revenue)} ${Math.abs(growth.revenue||0)}%</div></div>
      <div class="sc"><div class="si">🛒</div><div class="sv">${cur.orders||0}</div><div class="sl">الطلبات</div><div style="font-size:.72rem;${growthColor(growth.orders)}">${arrow(growth.orders)} ${Math.abs(growth.orders||0)}%</div></div>
      <div class="sc"><div class="si">💵</div><div class="sv">${Number(cur.avg_order||0).toFixed(0)}</div><div class="sl">متوسط الطلب</div></div>
    `;
  }

  // مقارنة الفترات
  const compareEl=document.getElementById('adv-compare');
  if(compareEl){
    compareEl.innerHTML=`
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="background:var(--surface2);border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:.75rem;color:var(--text2);margin-bottom:5px">الفترة الحالية</div>
          <div style="font-size:1.2rem;font-weight:900;color:var(--accent)">${Number(cur.revenue||0).toLocaleString()}</div>
          <div style="font-size:.72rem;color:var(--text2)">${cur.orders||0} طلب</div>
        </div>
        <div style="background:var(--surface2);border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:.75rem;color:var(--text2);margin-bottom:5px">الفترة السابقة</div>
          <div style="font-size:1.2rem;font-weight:900">${Number(prev.revenue||0).toLocaleString()}</div>
          <div style="font-size:.72rem;color:var(--text2)">${prev.orders||0} طلب</div>
        </div>
      </div>
      <div style="margin-top:10px;padding:10px;background:var(--surface2);border-radius:8px;text-align:center">
        <span style="font-size:.82rem;${growth.revenue>0?'color:var(--green)':growth.revenue<0?'color:var(--danger)':'color:var(--text2)'}">
          ${growth.revenue>0?'📈 نمو':growth.revenue<0?'📉 انخفاض':'➡️ مستقر'} ${Math.abs(growth.revenue||0)}% في الإيرادات
        </span>
      </div>
    `;
  }

  // الاتجاه اليومي
  const trendEl=document.getElementById('adv-trend');
  if(trendEl){
    const trend=data.daily_trend||[];
    if(!trend.length){trendEl.innerHTML='<div class="empty"><div class="ei">📅</div><p>لا بيانات</p></div>';return;}
    const max=Math.max(...trend.map(t=>parseFloat(t.revenue||0)),1);
    trendEl.innerHTML=`<div style="display:flex;align-items:flex-end;gap:3px;height:80px;padding:5px 0">${trend.slice(-14).map(t=>{
      const h=Math.max(4,Math.round((parseFloat(t.revenue||0)/max)*70));
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px" title="${new Date(t.day).toLocaleDateString('ar')}: ${Number(t.revenue||0).toLocaleString()}">
        <div style="width:100%;height:${h}px;background:var(--accent);border-radius:3px 3px 0 0;opacity:.8"></div>
      </div>`;
    }).join('')}</div><div style="font-size:.7rem;color:var(--text2);text-align:center;margin-top:4px">آخر ${Math.min(14,trend.length)} يوم</div>`;
  }

  // أفضل العملاء
  const custEl=document.getElementById('adv-customers');
  if(custEl){
    const custs=data.top_customers||[];
    if(!custs.length){custEl.innerHTML='<div class="empty"><div class="ei">👥</div><p>لا بيانات</p></div>';return;}
    custEl.innerHTML=`<div class="tw"><table><tr><th>العميل</th><th>الطلبات</th><th>المبلغ</th><th>آخر طلب</th></tr>${custs.map(c=>`<tr><td>${esc(c.customer_name||c.customer_phone||'')}</td><td>${c.orders}</td><td>${Number(c.spent||0).toLocaleString()}</td><td>${new Date(c.last_order).toLocaleDateString('ar')}</td></tr>`).join('')}</table></div>`;
  }
}

async function getForecast(){
  const days=document.getElementById('forecast-days').value;
  const btn=document.getElementById('forecast-btn');
  const res=document.getElementById('forecast-result');
  btn.disabled=true;btn.textContent='⏳ جاري التوقع...';
  const d=await api('/api/analytics/forecast',{method:'POST',body:JSON.stringify({days:parseInt(days)})});
  btn.disabled=false;btn.textContent='🔮 توقع';
  if(d.success&&d.forecast){
    const f=d.forecast;
    res.innerHTML=`
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px">
        <div style="background:var(--surface2);border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:.72rem;color:var(--text2);margin-bottom:4px">الإيراد المتوقع</div>
          <div style="font-size:1.1rem;font-weight:900;color:var(--accent)">${Number(f.predicted_revenue||0).toLocaleString()}</div>
        </div>
        <div style="background:var(--surface2);border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:.72rem;color:var(--text2);margin-bottom:4px">الطلبات المتوقعة</div>
          <div style="font-size:1.1rem;font-weight:900">${f.predicted_orders||0}</div>
        </div>
        <div style="background:var(--surface2);border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:.72rem;color:var(--text2);margin-bottom:4px">الثقة</div>
          <div style="font-size:1.1rem;font-weight:900;color:var(--green)">${f.confidence||0}%</div>
        </div>
      </div>
      ${f.trend?`<div style="padding:8px 12px;border-radius:8px;background:var(--surface2);margin-bottom:10px;font-size:.82rem">📊 الاتجاه: <b>${esc(f.trend)}</b></div>`:''}
      ${f.insights&&f.insights.length?`<div style="margin-bottom:10px"><div style="font-size:.78rem;color:var(--text2);margin-bottom:5px">💡 ملاحظات:</div>${f.insights.map(i=>`<div style="font-size:.8rem;padding:5px 0;border-bottom:1px solid var(--border)">• ${esc(i)}</div>`).join('')}</div>`:''}
      ${f.recommendations&&f.recommendations.length?`<div style="margin-bottom:10px"><div style="font-size:.78rem;color:var(--text2);margin-bottom:5px">✅ توصيات:</div>${f.recommendations.map(r=>`<div style="font-size:.8rem;padding:5px 0;border-bottom:1px solid var(--border);color:var(--green)">→ ${esc(r)}</div>`).join('')}</div>`:''}
      ${f.risks&&f.risks.length?`<div><div style="font-size:.78rem;color:var(--text2);margin-bottom:5px">⚠️ مخاطر:</div>${f.risks.map(r=>`<div style="font-size:.8rem;padding:5px 0;color:var(--danger)">! ${esc(r)}</div>`).join('')}</div>`:''}
    `;
  } else toast('❌ '+(d.message||'فشل التوقع'));
}

function exportReport(){
  const period=document.getElementById('adv-period')?.value||'30';
  window.open('/api/analytics/export?period='+period+'&format=csv','_blank');
}
function exportPDF(){
  const period=document.getElementById('adv-period')?.value||'30';
  const win=window.open(`/api/analytics/export-pdf?period=${period}`, '_blank');
  if(win) toast('📄 فتح التقرير — اضغط Ctrl+P للطباعة كـ PDF');
  else toast('⚠️ السماح بالنوافذ المنبثقة لتصدير PDF');
}

// ============================================================
// TEAM MEETING — اجتماع الفريق الرقمي
// ============================================================
function setMeetingQ(q){ document.getElementById('meeting-q').value=q; }
async function ldTeamMeeting(){ /* تُحمَّل فارغة */ }
async function startMeeting(){
  const q=document.getElementById('meeting-q').value.trim();
  if(!q) return toast('⚠️ أدخل سؤالاً للفريق');
  const btn=document.getElementById('meeting-btn');
  btn.disabled=true;btn.innerHTML='⏳ الفريق يتداول... (15-20 ثانية)';
  const d=await api('/api/team/digital/meeting',{method:'POST',body:JSON.stringify({question:q})});
  btn.disabled=false;btn.innerHTML='🤝 عقد الاجتماع';
  if(!d.success) return toast('❌ '+(d.message||'خطأ'));
  const resultEl=document.getElementById('meeting-result');
  resultEl.style.display='block';
  document.getElementById('meeting-summary').textContent=d.summary||'';
  const roleColors={sales:'rgba(79,142,247,.12)',customer_service:'rgba(0,212,170,.12)',marketing:'rgba(245,158,11,.12)',designer:'rgba(124,58,237,.12)',orders:'rgba(239,68,68,.12)',advisor:'rgba(16,185,129,.12)'};
  const roleBorders={sales:'rgba(79,142,247,.3)',customer_service:'rgba(0,212,170,.3)',marketing:'rgba(245,158,11,.3)',designer:'rgba(124,58,237,.3)',orders:'rgba(239,68,68,.3)',advisor:'rgba(16,185,129,.3)'};
  document.getElementById('meeting-responses').innerHTML=(d.responses||[]).map(r=>`
    <div style="background:${roleColors[r.role]||'rgba(79,142,247,.1)'};border:1px solid ${roleBorders[r.role]||'rgba(79,142,247,.3)'};border-radius:12px;padding:14px">
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:9px">
        <span style="font-size:1.2rem">${r.icon}</span>
        <div style="font-weight:900;font-size:.86rem">${esc(r.name)}</div>
      </div>
      <div style="font-size:.82rem;line-height:1.7;color:var(--text2)">${esc(r.reply)}</div>
    </div>
  `).join('');
  resultEl.scrollIntoView({behavior:'smooth'});
}

// ============================================================
// DIGITAL TEAM — الفريق الرقمي
// ============================================================
const TEAM_ROLES_INFO={
  sales:{name:'موظف المبيعات',icon:'💼',desc:'إغلاق الصفقات والإقناع',color:'rgba(79,142,247,.2)'},
  customer_service:{name:'خدمة العملاء',icon:'🎧',desc:'الشكاوى والدعم',color:'rgba(0,212,170,.2)'},
  marketing:{name:'موظف التسويق',icon:'📢',desc:'الإعلانات والحملات',color:'rgba(245,158,11,.2)'},
  designer:{name:'موظف التصميم',icon:'🎨',desc:'الصور والإعلانات',color:'rgba(124,58,237,.2)'},
  orders:{name:'موظف الطلبات',icon:'📦',desc:'الطلبات والشحن',color:'rgba(239,68,68,.2)'},
  advisor:{name:'المستشار التنفيذي',icon:'🏛️',desc:'التحليلات والتوصيات',color:'rgba(16,185,129,.2)'}
};

let dTeamHistory={};
let currentDTeamRole='';

let _dteamMembers = {};

async function ldDTeam(){
  const d=await api('/api/team/digital');
  const members=d.members||[];
  _dteamMembers = {};
  members.forEach(m => { _dteamMembers[m.role] = m; });
  const cards=document.getElementById('dteam-cards');
  cards.innerHTML=members.map(m=>{
    const info=TEAM_ROLES_INFO[m.role]||{name:m.role,icon:'🤖',desc:'',color:'rgba(79,142,247,.2)'};
    return `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;border-top:3px solid;border-top-color:${info.color.replace('rgba','rgb').replace(',.2)',',')}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:11px">
          <div style="display:flex;align-items:center;gap:9px">
            <div style="width:42px;height:42px;border-radius:10px;background:${info.color};display:flex;align-items:center;justify-content:center;font-size:1.3rem">${info.icon}</div>
            <div>
              <div style="font-weight:900;font-size:.88rem">${esc(m.name||info.name)}</div>
              <div style="font-size:.72rem;color:var(--text2)">${info.desc}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:5px">
            <span class="badge ${m.is_active?'bgr':'bor'}" style="font-size:.65rem">${m.is_active?'نشط':'غير نشط'}</span>
          </div>
        </div>
        <div style="font-size:.75rem;color:var(--text2);margin-bottom:11px">التفاعلات: ${m.total_interactions||0}</div>
        <div style="display:flex;gap:6px">
          <button class="btn ba bsm" onclick="openDTeamChat('${m.role}')" style="flex:1;padding:9px">💬 محادثة</button>
          <button class="btn bo bsm" onclick="openDTeamSettings('${m.role}')" style="padding:9px">⚙️</button>
        </div>
      </div>
    `;
  }).join('');
}

function openDTeamChat(role){
  const info=TEAM_ROLES_INFO[role]||{name:role,icon:'🤖',desc:''};
  currentDTeamRole=role;
  if(!dTeamHistory[role]) dTeamHistory[role]=[];
  document.getElementById('dteam-chat-icon').textContent=info.icon;
  document.getElementById('dteam-chat-name').textContent=info.name;
  document.getElementById('dteam-chat-desc').textContent=info.desc;
  document.getElementById('dteam-chat-area').style.display='block';
  document.getElementById('dteam-settings-area').style.display='none';
  const msgs=document.getElementById('dteam-msgs');
  if(dTeamHistory[role].length===0){
    msgs.innerHTML='';
    addCm('dteam-msgs','ai','مرحباً! أنا '+info.name+' '+info.icon+' كيف يمكنني مساعدتك اليوم؟');
  } else {
    msgs.innerHTML='';
    dTeamHistory[role].forEach(m=>addCm('dteam-msgs',m.role==='user'?'user':'ai',m.content));
  }
  msgs.scrollTop=msgs.scrollHeight;
  document.getElementById('dteam-input').focus();
  document.getElementById('dteam-chat-area').scrollIntoView({behavior:'smooth'});
}

function closeDTeamChat(){
  document.getElementById('dteam-chat-area').style.display='none';
  currentDTeamRole='';
}

async function sendDTeam(){
  const input=document.getElementById('dteam-input');
  const msg=input.value.trim();
  if(!msg||!currentDTeamRole) return;
  const btn=document.getElementById('dteam-btn');
  input.value='';btn.disabled=true;
  addCm('dteam-msgs','user',msg);
  if(!dTeamHistory[currentDTeamRole]) dTeamHistory[currentDTeamRole]=[];
  dTeamHistory[currentDTeamRole].push({role:'user',content:msg});
  const d=await api('/api/team/digital/'+currentDTeamRole+'/chat',{method:'POST',body:JSON.stringify({message:msg,history:dTeamHistory[currentDTeamRole].slice(-8)})});
  btn.disabled=false;
  if(d.success){
    addCm('dteam-msgs','ai',d.reply);
    dTeamHistory[currentDTeamRole].push({role:'assistant',content:d.reply});
  } else {
    addCm('dteam-msgs','ai','عذراً، حدث خطأ. حاول مرة أخرى.');
  }
  document.getElementById('dteam-msgs').scrollTop=99999;
  input.focus();
}

function openDTeamSettings(role){
  const info=TEAM_ROLES_INFO[role]||{name:role,icon:'🤖'};
  const member=_dteamMembers[role]||{};
  document.getElementById('dteam-set-title').textContent='⚙️ إعدادات '+info.name;
  document.getElementById('dteam-set-role').value=role;
  document.getElementById('dts-name').value=member.name||info.name;
  document.getElementById('dts-personality').value=member.personality||'';
  document.getElementById('dts-expertise').value=member.expertise||'';
  document.getElementById('dts-instructions').value=member.instructions||'';
  document.getElementById('dteam-settings-area').style.display='block';
  document.getElementById('dteam-chat-area').style.display='none';
  document.getElementById('dteam-settings-area').scrollIntoView({behavior:'smooth'});
}

function closeDTeamSettings(){
  document.getElementById('dteam-settings-area').style.display='none';
}

async function saveDTeamMember(){
  const role=document.getElementById('dteam-set-role').value;
  if(!role) return;
  const d=await api('/api/team/digital/'+role,{method:'PUT',body:JSON.stringify({
    name:document.getElementById('dts-name').value.trim(),
    personality:document.getElementById('dts-personality').value.trim(),
    expertise:document.getElementById('dts-expertise').value.trim(),
    instructions:document.getElementById('dts-instructions').value.trim(),
    is_active:true
  })});
  if(d.success){toast('✅ تم حفظ إعدادات الموظف');closeDTeamSettings();ldDTeam();}
  else toast('❌ '+(d.message||'خطأ'));
}

