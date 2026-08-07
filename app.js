const API_URL = 'https://script.google.com/macros/s/AKfycbxMALoyL53FXxpAnhP5EJZlcbSqjkf2cW4bM_b8q_eaYYuWS9MAzkcqZLtCmmmB0-X44A/exec';

const state = {
  password: '', actor: '管理者', page: 'home', data: null,
  selectedMeal: '', selectedEvent: '', selectedStore: '', busy: false
};

const $ = (q, root=document) => root.querySelector(q);
const $$ = (q, root=document) => [...root.querySelectorAll(q)];
const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const money = v => `$${Number(v || 0).toLocaleString('zh-TW')}`;
const truthy = v => v === true || String(v).toUpperCase() === 'TRUE';
const active = row => row && (row.active === undefined || truthy(row.active));
const available = row => row && (row.available === undefined || truthy(row.available));
const uid = prefix => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2,7)}`;

function fmtDate(v) {
  if (!v) return '';
  const d = new Date(`${String(v).slice(0,10)}T00:00:00`);
  if (Number.isNaN(d.valueOf())) return String(v).slice(0,10);
  return `${d.getMonth()+1}/${d.getDate()} (${['日','一','二','三','四','五','六'][d.getDay()]})`;
}

async function api(action, payload={}) {
  setSync('同步中…');
  const res = await fetch(API_URL, {
    method: 'POST', redirect: 'follow',
    headers: {'Content-Type':'text/plain;charset=utf-8'},
    body: JSON.stringify({action, password: state.password, actor: state.actor, ...payload})
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'API 操作失敗');
  setSync('資料已同步');
  return data;
}

async function reloadData(silent=false) {
  const result = await api('bootstrap');
  state.data = result.data;
  if (!state.selectedMeal) state.selectedMeal = firstUsefulMeal()?.meal_id || '';
  if (!state.selectedEvent) state.selectedEvent = firstActiveEvent()?.event_id || '';
  if (!silent) render();
}

function setSync(text){ const el=$('#syncText'); if(el) el.textContent=text; }
function toast(text){ const el=$('#toast'); el.textContent=text; el.classList.remove('hidden'); clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.add('hidden'),2200); }
function showModal(html){ $('#modalBody').innerHTML=html; $('#modal').classList.remove('hidden'); }
function closeModal(){ $('#modal').classList.add('hidden'); $('#modalBody').innerHTML=''; }
function setPage(page){ state.page=page; $$('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===page)); render(); window.scrollTo({top:0,behavior:'smooth'}); }

function list(key){ return (state.data?.[key] || []); }
function people(){ return list('people').filter(active).sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0)); }
function stores(){ return list('stores').filter(active); }
function events(){ return list('events').filter(active).sort((a,b)=>String(a.start_date).localeCompare(String(b.start_date))); }
function meals(){ return list('meals').filter(active).sort((a,b)=>`${a.meal_date}${a.meal_type}`.localeCompare(`${b.meal_date}${b.meal_type}`)); }
function eventMeals(eventId){ return meals().filter(m=>String(m.event_id)===String(eventId)); }
function mealMenu(mealId){ return list('mealMenu').filter(x=>available(x)&&String(x.meal_id)===String(mealId)).sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0)); }
function mealPeople(mealId){ return list('mealPeople').filter(active).filter(x=>String(x.meal_id)===String(mealId)); }
function firstActiveEvent(){ return events()[0]; }
function firstUsefulMeal(){ return meals().find(m=>m.status==='登記中') || meals()[0]; }
function personName(id){ return list('people').find(p=>String(p.person_id)===String(id))?.name || id; }
function storeName(id){ return list('stores').find(s=>String(s.store_id)===String(id))?.store_name || '未指定店家'; }
function eventName(id){ return list('events').find(e=>String(e.event_id)===String(id))?.event_name || id; }
function mealLabel(meal){ return meal ? `${fmtDate(meal.meal_date)} ${meal.meal_type || ''}` : '' }
function mpFor(mealId, personId){ return mealPeople(mealId).find(x=>String(x.person_id)===String(personId)); }
function menuIdsForMeal(mealId){ return new Set(mealMenu(mealId).map(x=>String(x.meal_menu_id))); }
function ordersForMeal(mealId){ const ids=menuIdsForMeal(mealId); return list('orders').filter(o=>ids.has(String(o.meal_menu_id)) && o.status!=='取消'); }
function ordersForPersonMeal(personId,mealId){ return ordersForMeal(mealId).filter(o=>String(o.person_id)===String(personId)); }
function ordersForEvent(eventId){ const mids=new Set(eventMeals(eventId).map(m=>m.meal_id)); const mmids=new Set(list('mealMenu').filter(x=>mids.has(x.meal_id)).map(x=>String(x.meal_menu_id))); return list('orders').filter(o=>String(o.event_id)===String(eventId)&&mmids.has(String(o.meal_menu_id))&&o.status!=='取消'); }

function dashboardStats(){
  const reg=meals().filter(m=>m.status==='登記中').length;
  const pick=meals().filter(m=>{ const os=ordersForMeal(m.meal_id); return os.length && people().some(p=>{const mine=os.some(o=>o.person_id===p.person_id);return mine&&mpFor(m.meal_id,p.person_id)?.pickup_status!=='已領';});}).length;
  const pay=events().filter(e=>{ const os=ordersForEvent(e.event_id); if(!os.length)return false; const totals=totalsByPerson(os); return [...totals].some(([pid])=>chargeStatus(e.event_id,pid)!=='已繳'); }).length;
  return {reg,pick,pay};
}

function render(){
  if(!state.data) return;
  const content=$('#content');
  const pages={home:renderHome,events:renderEvents,orders:renderOrders,pickup:renderPickup,charges:renderCharges,more:renderMore,people:renderPeople,stores:renderStores,logs:renderLogs};
  content.innerHTML=(pages[state.page]||renderHome)();
  bindPageControls();
}

function renderHome(){
  const s=dashboardStats(); const upcoming=meals().slice(0,6);
  return `<div class="page-title"><div><h2>首頁</h2><p>一眼看目前要做什麼</p></div><button class="btn small" data-refresh>重新整理</button></div>
    <div class="grid cols-3">
      <button class="card status-card register" data-page-go="orders"><span>準備登記</span><strong class="count">${s.reg}</strong><small>餐次</small></button>
      <button class="card status-card pickup" data-page-go="pickup"><span>準備領餐</span><strong class="count">${s.pick}</strong><small>餐次</small></button>
      <button class="card status-card money" data-page-go="charges"><span>準備收錢</span><strong class="count">${s.pay}</strong><small>活動</small></button>
    </div>
    <div class="section-head"><h3>近期餐次</h3><button class="btn small" data-page-go="events">活動管理</button></div>
    <div class="list">${upcoming.length?upcoming.map(m=>`<div class="row"><div class="row-main"><strong>${mealLabel(m)}</strong><small>${esc(eventName(m.event_id))} · ${esc(storeName(m.primary_store_id))}</small></div><span class="badge ${m.status==='登記中'?'blue':''}">${esc(m.status||'登記中')}</span></div>`).join(''):'<div class="card empty">尚未建立活動</div>'}</div>`;
}

function renderEvents(){
  return `<div class="page-title"><div><h2>活動</h2><p>預設兩天，可延長到四天</p></div><button class="btn primary" data-new-event>＋ 建立活動</button></div>
  <div class="list">${events().length?events().map(e=>{
    const ms=eventMeals(e.event_id); return `<div class="card"><div class="row" style="border:0;padding:0"><div class="row-main"><strong>${esc(e.event_name)}</strong><small>${fmtDate(e.start_date)} ～ ${fmtDate(e.end_date)}</small></div><div class="row-actions"><button class="btn small" data-event-order="${e.event_id}">管理餐次</button><button class="btn danger small" data-delete-event="${e.event_id}">刪除</button></div></div><div class="meal-grid">${ms.map(m=>`<div class="meal-tile"><strong>${mealLabel(m)}</strong><small>${esc(storeName(m.primary_store_id))} · ${mealMenu(m.meal_id).length} 項</small></div>`).join('')}</div></div>`
  }).join(''):'<div class="card empty">還沒有活動，先建立第一個吧。</div>'}</div>`;
}

function mealSelector(extra=''){
  const ms=meals(); if(!ms.length)return '<div class="card empty">請先建立活動</div>';
  return `<div class="toolbar"><label>餐次<select id="mealSelect">${ms.map(m=>`<option value="${m.meal_id}" ${m.meal_id===state.selectedMeal?'selected':''}>${esc(eventName(m.event_id))}｜${mealLabel(m)}</option>`).join('')}</select></label>${extra}</div>`;
}

function renderOrders(){
  const meal=meals().find(m=>m.meal_id===state.selectedMeal)||meals()[0]; if(!meal)return `<div class="page-title"><h2>訂餐</h2></div>${mealSelector()}`;
  state.selectedMeal=meal.meal_id; const mm=mealMenu(meal.meal_id); const p=people();
  const storeOptions=stores().map(s=>`<option value="${s.store_id}" ${s.store_id===meal.primary_store_id?'selected':''}>${esc(s.store_name)}</option>`).join('');
  return `<div class="page-title"><div><h2>訂餐輸入</h2><p>管理者統一輸入，可多樣多量</p></div></div>${mealSelector()}
  <div class="card"><div class="section-head" style="margin:0 0 10px"><h3>${mealLabel(meal)} 餐次菜單</h3><button class="btn small" data-toggle-menu>調整餐點／價格</button></div>
    ${mm.length?`<p>${esc(storeName(meal.primary_store_id))} · ${mm.length} 個開放項目</p>`:`<div class="toolbar"><label>帶入店家<select id="sourceStore"><option value="">選擇店家</option>${storeOptions}</select></label><button class="btn primary" data-import-menu>帶入菜單</button><button class="btn" data-add-special>直接新增餐點</button></div>`}
    <div id="menuEditor" class="hidden">${renderMealMenuEditor(meal,mm)}</div>
  </div>
  <div class="section-head"><h3>人員點餐</h3><span class="badge">依名單順序</span></div>
  <div class="list">${p.map(person=>{ const mp=mpFor(meal.meal_id,person.person_id); const os=ordersForPersonMeal(person.person_id,meal.meal_id); const no=mp?.order_status==='不訂'; return `<div class="row person-order"><span class="dot ${person.group}"></span><div class="row-main"><strong>${esc(person.name)}</strong><small>${esc(person.group)}</small><div class="order-lines">${no?'<span>不訂・可恢復</span>':(os.length?os.map(o=>`<span>${esc(o.item_name_snapshot)} ×${Number(o.qty||1)}</span>`).join(''):'<span>尚未登記</span>')}</div></div><div class="row-actions"><button class="btn small ${no?'primary':''}" data-no-order="${person.person_id}">${no?'恢復':'不訂'}</button><button class="btn primary small" data-order-person="${person.person_id}" ${no||!mm.length?'disabled':''}>${os.length?'修改':'點餐'}</button></div></div>`}).join('')}</div>`;
}

function renderMealMenuEditor(meal,mm){
  return `<div class="list">${mm.map(x=>`<div class="menu-edit-row"><input value="${esc(x.item_name)}" data-mm-name="${x.meal_menu_id}"><input type="number" min="0" value="${Number(x.price||0)}" data-mm-price="${x.meal_menu_id}"><button class="btn small" data-save-mm="${x.meal_menu_id}">儲存</button></div>`).join('')}</div><button class="btn small" style="margin-top:10px" data-add-special>＋ 新增特殊餐點／點心</button>`;
}

function renderPickup(){
  const meal=meals().find(m=>m.meal_id===state.selectedMeal)||meals()[0]; if(!meal)return `<div class="page-title"><h2>領餐</h2></div>${mealSelector()}`; state.selectedMeal=meal.meal_id;
  const os=ordersForMeal(meal.meal_id); const orderedPeople=people().filter(p=>os.some(o=>o.person_id===p.person_id));
  const totals={}; os.forEach(o=>{ totals[o.item_name_snapshot]=(totals[o.item_name_snapshot]||0)+Number(o.qty||1); });
  const remain={...totals}; orderedPeople.forEach(p=>{if(mpFor(meal.meal_id,p.person_id)?.pickup_status==='已領')ordersForPersonMeal(p.person_id,meal.meal_id).forEach(o=>remain[o.item_name_snapshot]-=Number(o.qty||1));});
  return `<div class="page-title"><div><h2>領餐確認</h2><p>手機快速操作</p></div></div>${mealSelector()}
  <div class="summary-strip">${Object.keys(totals).map(k=>`<span class="summary-pill">${esc(k)} ${totals[k]}/剩${Math.max(0,remain[k])}</span>`).join('')||'<span class="summary-pill">尚無餐點</span>'}</div>
  <div class="list">${orderedPeople.map(p=>{const done=mpFor(meal.meal_id,p.person_id)?.pickup_status==='已領';const po=ordersForPersonMeal(p.person_id,meal.meal_id);return `<div class="row pickup-row ${done?'done':''}"><span class="dot ${p.group}"></span><div class="row-main"><strong class="name">${esc(p.name)}</strong><div class="pickup-items">${po.map(o=>`${esc(o.item_name_snapshot)} ×${Number(o.qty||1)}`).join('、')}</div></div><button class="btn ${done?'':'success'}" data-pickup="${p.person_id}">${done?'取消確認':'✓ 確認領取'}</button></div>`}).join('')||'<div class="card empty">這餐還沒有人訂餐</div>'}</div>`;
}

function totalsByPerson(os){ const map=new Map();os.forEach(o=>map.set(String(o.person_id),(map.get(String(o.person_id))||0)+Number(o.amount||Number(o.unit_price_snapshot||0)*Number(o.qty||1))));return map; }
function chargeFor(eventId,personId){ return list('charges').find(c=>String(c.event_id)===String(eventId)&&String(c.person_id)===String(personId)); }
function chargeStatus(eventId,personId){ return chargeFor(eventId,personId)?.payment_status || '未繳'; }

function renderCharges(){
  const es=events(); if(!state.selectedEvent&&es[0])state.selectedEvent=es[0].event_id; const event=es.find(e=>e.event_id===state.selectedEvent)||es[0];
  if(!event)return '<div class="page-title"><h2>收費</h2></div><div class="card empty">尚未建立活動</div>';
  state.selectedEvent=event.event_id; const os=ordersForEvent(event.event_id);const totals=totalsByPerson(os);const rows=people().filter(p=>totals.has(String(p.person_id)));
  const sum=[...totals.values()].reduce((a,b)=>a+b,0);const paid=rows.reduce((n,p)=>n+(chargeStatus(event.event_id,p.person_id)==='已繳'?totals.get(String(p.person_id)):0),0);
  return `<div class="page-title"><div><h2>收費</h2><p>可直接截圖貼大群</p></div><button class="btn" data-fee-share>截圖版</button></div>
  <div class="toolbar"><label>活動<select id="eventSelect">${es.map(e=>`<option value="${e.event_id}" ${e.event_id===event.event_id?'selected':''}>${esc(e.event_name)}</option>`).join('')}</select></label><span class="badge green">已收 ${money(paid)} / ${money(sum)}</span></div>
  <div class="fee-share" id="feeShare"><div class="fee-share-head"><span>${esc(event.event_name)} 餐費</span><span>總計 ${money(sum)}</span></div>${rows.map(p=>{const amount=totals.get(String(p.person_id));const st=chargeStatus(event.event_id,p.person_id);return `<div class="fee-row"><button class="btn ghost" data-fee-detail="${p.person_id}" style="text-align:left">${esc(p.name)}</button><span class="money">${money(amount)}</span><button class="btn small ${st==='已繳'?'':'success'}" data-pay="${p.person_id}">${st==='已繳'?'已繳':'收款'}</button></div>`}).join('')||'<div class="empty">目前沒有餐費</div>'}</div>`;
}

function renderMore(){ return `<div class="page-title"><div><h2>管理</h2><p>基礎資料與追溯紀錄</p></div></div><div class="grid cols-2"><button class="card status-card" data-page-go="people"><h3>人員名單</h3><p>${people().length} 人 · 可新增、停用、移動順序</p></button><button class="card status-card" data-page-go="stores"><h3>店家與菜單</h3><p>${stores().length} 家 · 永久菜單母版</p></button><button class="card status-card" data-page-go="logs"><h3>Log</h3><p>餐點有疑問時追溯修改紀錄</p></button></div>`; }

function renderPeople(){
  return `<div class="page-title"><div><h2>人員名單</h2><p>姓名前台不提供修改；顏色小方塊區分身分</p></div><button class="btn primary" data-add-person>＋ 新增</button></div><div class="list">${people().map((p,i)=>`<div class="row"><span class="dot ${p.group}"></span><div class="row-main"><strong>${esc(p.name)}</strong><small>${esc(p.group)} · 順序 ${Number(p.sort_order||i+1)}</small></div><div class="row-actions"><button class="btn small" data-move-person="${p.person_id}" data-dir="up" ${i===0?'disabled':''}>↑</button><button class="btn small" data-move-person="${p.person_id}" data-dir="down" ${i===people().length-1?'disabled':''}>↓</button>${p.name.startsWith('訪客')?'':`<button class="btn danger small" data-delete-person="${p.person_id}">刪除</button>`}</div></div>`).join('')}</div>`;
}

function renderStores(){
  if(!state.selectedStore&&stores()[0])state.selectedStore=stores()[0].store_id; const s=stores().find(x=>x.store_id===state.selectedStore)||stores()[0]; const master=s?list('menu').filter(m=>available(m)&&m.store_id===s.store_id):[];
  return `<div class="page-title"><div><h2>店家</h2><p>這裡改的是未來預設菜單；當餐價格在活動餐次微調</p></div><button class="btn primary" data-add-store>＋ 新店家</button></div><div class="toolbar"><label>店家<select id="storeSelect">${stores().map(x=>`<option value="${x.store_id}" ${s&&x.store_id===s.store_id?'selected':''}>${esc(x.store_name)}</option>`).join('')}</select></label>${s?`<label>名稱<input id="storeNameInput" value="${esc(s.store_name)}"></label><button class="btn" data-save-store-name>儲存名稱</button>`:''}</div>${s?`<div class="card"><div class="section-head" style="margin:0 0 10px"><h3>永久菜單</h3><button class="btn small" data-add-master-menu>＋ 新增餐點</button></div><div class="list">${master.map(m=>`<div class="menu-edit-row"><input data-master-name="${m.menu_id}" value="${esc(m.item_name)}"><input data-master-price="${m.menu_id}" type="number" min="0" value="${Number(m.price||0)}"><button class="btn small" data-save-master="${m.menu_id}">儲存</button></div>`).join('')||'<div class="empty">尚無菜單</div>'}</div></div>`:'<div class="card empty">先新增店家</div>'}`;
}

function renderLogs(){ const rows=list('log').slice(0,120);return `<div class="page-title"><div><h2>Log</h2><p>最近 120 筆異動</p></div></div><div class="list">${rows.map(l=>`<div class="row"><div class="row-main"><strong>${esc(l.action)} · ${esc(l.entity_type)}</strong><small>${esc(String(l.timestamp||'').replace('T',' ').slice(0,19))} · ${esc(l.actor||'管理者')}</small><div class="order-lines">${esc(l.detail||'')}</div></div><span class="badge">${esc(l.source||'api')}</span></div>`).join('')||'<div class="card empty">目前沒有紀錄</div>'}</div>`; }

function bindPageControls(){
  $$('[data-page-go]').forEach(b=>b.onclick=()=>setPage(b.dataset.pageGo));
  $('[data-refresh]')?.addEventListener('click',()=>reloadData().catch(handleError));
  $('#mealSelect')?.addEventListener('change',e=>{state.selectedMeal=e.target.value;render();});
  $('#eventSelect')?.addEventListener('change',e=>{state.selectedEvent=e.target.value;render();});
  $('#storeSelect')?.addEventListener('change',e=>{state.selectedStore=e.target.value;render();});
  $('[data-new-event]')?.addEventListener('click',openNewEvent);
  $$('[data-delete-event]').forEach(b=>b.onclick=()=>deleteEvent(b.dataset.deleteEvent));
  $$('[data-event-order]').forEach(b=>b.onclick=()=>{state.selectedMeal=eventMeals(b.dataset.eventOrder)[0]?.meal_id||'';setPage('orders');});
  $('[data-toggle-menu]')?.addEventListener('click',()=>$('#menuEditor')?.classList.toggle('hidden'));
  $('[data-import-menu]')?.addEventListener('click',importMenu);
  $$('[data-add-special]').forEach(b=>b.onclick=openAddSpecial);
  $$('[data-save-mm]').forEach(b=>b.onclick=()=>saveMealMenu(b.dataset.saveMm));
  $$('[data-no-order]').forEach(b=>b.onclick=()=>toggleNoOrder(b.dataset.noOrder));
  $$('[data-order-person]').forEach(b=>b.onclick=()=>openOrder(b.dataset.orderPerson));
  $$('[data-pickup]').forEach(b=>b.onclick=()=>togglePickup(b.dataset.pickup));
  $$('[data-pay]').forEach(b=>b.onclick=()=>takePayment(b.dataset.pay));
  $$('[data-fee-detail]').forEach(b=>b.onclick=()=>showFeeDetail(b.dataset.feeDetail));
  $('[data-fee-share]')?.addEventListener('click',()=>toast('現在畫面已整理成適合手機截圖的清單'));
  $('[data-add-person]')?.addEventListener('click',openAddPerson);
  $$('[data-move-person]').forEach(b=>b.onclick=()=>movePerson(b.dataset.movePerson,b.dataset.dir));
  $$('[data-delete-person]').forEach(b=>b.onclick=()=>deletePerson(b.dataset.deletePerson));
  $('[data-add-store]')?.addEventListener('click',openAddStore);
  $('[data-save-store-name]')?.addEventListener('click',saveStoreName);
  $('[data-add-master-menu]')?.addEventListener('click',openAddMasterMenu);
  $$('[data-save-master]').forEach(b=>b.onclick=()=>saveMasterMenu(b.dataset.saveMaster));
}

async function mutate(operations,message){ await api('batch',{operations}); await reloadData(true); if(message)toast(message); render(); }

function openNewEvent(){
  const d=new Date();const start=d.toISOString().slice(0,10);const e=new Date(d);e.setDate(e.getDate()+1);const end=e.toISOString().slice(0,10);
  showModal(`<h3>建立活動</h3><form id="eventForm" class="form-grid"><label class="span-2">活動名稱<input name="name" placeholder="例如：8月長時工作" required></label><label>開始日期<input name="start" type="date" value="${start}" required></label><label>結束日期<input name="end" type="date" value="${end}" required></label><p class="span-2">建立後會自動產生每天的午餐、晚餐；最多 4 天。</p><button class="btn primary span-2" type="submit">建立活動</button></form>`);
  $('#eventForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const s=new Date(f.get('start'));const en=new Date(f.get('end'));const days=Math.round((en-s)/86400000)+1;if(days<1||days>4)return alert('活動日期請設定 1～4 天。');const eventId=uid('E');const ops=[{type:'insert',table:'events',data:{event_id:eventId,event_name:f.get('name'),start_date:f.get('start'),end_date:f.get('end'),status:'進行中',active:true}}];for(let i=0;i<days;i++){const dd=new Date(s);dd.setDate(dd.getDate()+i);const date=dd.toISOString().slice(0,10);['午餐','晚餐'].forEach(type=>ops.push({type:'insert',table:'meals',data:{meal_id:uid('ML'),event_id:eventId,meal_date:date,meal_type:type,status:'登記中',active:true}}));}try{await mutate(ops,'活動已建立');closeModal();state.selectedEvent=eventId;}catch(err){handleError(err)}};
}

async function deleteEvent(id){if(!confirm('確定刪除此活動？系統會封存資料並保留 Log，可追溯但前台不再顯示。'))return;try{await api('archiveEvent',{event_id:id});await reloadData();toast('活動已封存')}catch(e){handleError(e)}}

async function importMenu(){const meal=meals().find(m=>m.meal_id===state.selectedMeal);const storeId=$('#sourceStore')?.value;if(!meal||!storeId)return toast('請先選擇店家');const src=list('menu').filter(m=>available(m)&&m.store_id===storeId);if(!src.length)return toast('這家店還沒有永久菜單');const ops=[{type:'update',table:'meals',id:meal.meal_id,patch:{primary_store_id:storeId}}];src.forEach((m,i)=>ops.push({type:'insert',table:'mealMenu',data:{meal_menu_id:uid('MM'),meal_id:meal.meal_id,source_menu_id:m.menu_id,store_id:storeId,item_name:m.item_name,price:Number(m.price||0),available:true,is_special:false,sort_order:i+1}}));try{await mutate(ops,'已帶入店家菜單')}catch(e){handleError(e)}}

function openAddSpecial(){const meal=meals().find(m=>m.meal_id===state.selectedMeal);if(!meal)return;showModal(`<h3>新增本餐特殊項目</h3><form id="specialForm"><label>餐點名稱<input name="name" required placeholder="例如：加購點心"></label><label>金額<input name="price" type="number" min="0" required></label><button class="btn primary wide">加入這一餐</button></form>`);$('#specialForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await mutate([{type:'insert',table:'mealMenu',data:{meal_menu_id:uid('MM'),meal_id:meal.meal_id,store_id:meal.primary_store_id||'',item_name:f.get('name'),price:Number(f.get('price')),available:true,is_special:true,sort_order:mealMenu(meal.meal_id).length+1}}],'已新增特殊項目');closeModal()}catch(err){handleError(err)}}}

async function saveMealMenu(id){const n=$(`[data-mm-name="${CSS.escape(id)}"]`)?.value;const p=$(`[data-mm-price="${CSS.escape(id)}"]`)?.value;try{await mutate([{type:'update',table:'mealMenu',id,patch:{item_name:n,price:Number(p)}}],'當餐菜單已更新')}catch(e){handleError(e)}}

async function toggleNoOrder(personId){const meal=meals().find(m=>m.meal_id===state.selectedMeal);if(!meal)return;const mp=mpFor(meal.meal_id,personId);const isNo=mp?.order_status==='不訂';const op=mp?{type:'update',table:'mealPeople',id:mp.meal_person_id,patch:{order_status:isNo?'未登記':'不訂'}}:{type:'insert',table:'mealPeople',data:{meal_person_id:uid('MP'),meal_id:meal.meal_id,person_id:personId,order_status:'不訂',pickup_status:'未領',active:true}};try{await mutate([op],isNo?'已恢復，可重新點餐':'已標記不訂')}catch(e){handleError(e)}}

function openOrder(personId){const meal=meals().find(m=>m.meal_id===state.selectedMeal);const p=list('people').find(x=>x.person_id===personId);const mm=mealMenu(meal.meal_id);const old=ordersForPersonMeal(personId,meal.meal_id);const oldQty=new Map(old.map(o=>[String(o.meal_menu_id),Number(o.qty||1)]));showModal(`<h3>${esc(p?.name)}｜${mealLabel(meal)}</h3><form id="orderForm"><div class="quantity-grid">${mm.map(x=>`<div class="quantity-row"><div><strong>${esc(x.item_name)}</strong><small> ${money(x.price)}</small></div><input name="q_${x.meal_menu_id}" type="number" min="0" max="20" value="${oldQty.get(String(x.meal_menu_id))||0}"><span>份</span></div>`).join('')}</div><label>備註<textarea name="note" placeholder="例如：不要辣、醬另外放"></textarea></label><button class="btn primary wide">儲存點餐</button></form>`);$('#orderForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);const selected=mm.map(x=>({x,qty:Number(fd.get(`q_${x.meal_menu_id}`)||0)})).filter(x=>x.qty>0);if(!selected.length)return toast('至少選一項，或回上一頁按「不訂」');const ops=old.map(o=>({type:'softDelete',table:'orders',id:o.order_id}));selected.forEach(({x,qty})=>ops.push({type:'insert',table:'orders',data:{order_id:uid('O'),event_id:meal.event_id,person_id:personId,meal_menu_id:x.meal_menu_id,item_name_snapshot:x.item_name,unit_price_snapshot:Number(x.price),qty,option_text:'',note:fd.get('note')||'',status:'有效'}}));const mp=mpFor(meal.meal_id,personId);ops.push(mp?{type:'update',table:'mealPeople',id:mp.meal_person_id,patch:{order_status:'已訂'}}:{type:'insert',table:'mealPeople',data:{meal_person_id:uid('MP'),meal_id:meal.meal_id,person_id:personId,order_status:'已訂',pickup_status:'未領',active:true}});try{await mutate(ops,'點餐已儲存');closeModal()}catch(err){handleError(err)}}}

async function togglePickup(personId){const meal=meals().find(m=>m.meal_id===state.selectedMeal);let mp=mpFor(meal.meal_id,personId);if(!mp)return;const done=mp.pickup_status==='已領';try{await mutate([{type:'update',table:'mealPeople',id:mp.meal_person_id,patch:{pickup_status:done?'未領':'已領',picked_up_at:done?'':new Date().toISOString()}}],done?'已取消領餐確認':'已確認領餐')}catch(e){handleError(e)}}

async function takePayment(personId){const event=events().find(e=>e.event_id===state.selectedEvent);const total=totalsByPerson(ordersForEvent(event.event_id)).get(String(personId))||0;const ch=chargeFor(event.event_id,personId);const op=ch?{type:'update',table:'charges',id:ch.charge_id,patch:{total_amount:total,paid_amount:ch.payment_status==='已繳'?0:total}}:{type:'insert',table:'charges',data:{charge_id:uid('C'),event_id:event.event_id,person_id:personId,total_amount:total,paid_amount:total,payment_method:'現金'}};try{await mutate([op],ch?.payment_status==='已繳'?'已改回未繳':'收款完成')}catch(e){handleError(e)}}

function showFeeDetail(personId){const event=events().find(e=>e.event_id===state.selectedEvent);const os=ordersForEvent(event.event_id).filter(o=>o.person_id===personId);const byMeal=new Map();os.forEach(o=>{const mm=list('mealMenu').find(x=>x.meal_menu_id===o.meal_menu_id);const m=meals().find(x=>x.meal_id===mm?.meal_id);const key=mealLabel(m)||'其他';if(!byMeal.has(key))byMeal.set(key,[]);byMeal.get(key).push(o);});showModal(`<h3>${esc(personName(personId))}｜餐費明細</h3>${[...byMeal].map(([k,rows])=>`<div class="card" style="margin-bottom:10px"><strong>${esc(k)}</strong>${rows.map(o=>`<div class="row" style="border:0;padding:6px 0"><span class="row-main">${esc(o.item_name_snapshot)} ×${Number(o.qty||1)}</span><span class="money">${money(o.amount)}</span></div>`).join('')}</div>`).join('')}<div class="section-head"><h3>合計</h3><strong class="money">${money(os.reduce((s,o)=>s+Number(o.amount||0),0))}</strong></div>`)}

function openAddPerson(){showModal(`<h3>新增人員</h3><form id="personForm"><label>姓名<input name="name" required></label><label>身分<select name="group"><option>師級</option><option>常日</option><option>輪班</option><option>其他</option></select></label><button class="btn primary wide">新增</button></form>`);$('#personForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await mutate([{type:'insert',table:'people',data:{person_id:uid('P'),name:f.get('name'),group:f.get('group'),active:true,sort_order:people().length+1}}],'人員已新增');closeModal()}catch(err){handleError(err)}}}

async function movePerson(id,dir){const ps=people();const i=ps.findIndex(p=>p.person_id===id);const j=dir==='up'?i-1:i+1;if(i<0||j<0||j>=ps.length)return;const a=ps[i],b=ps[j];try{await mutate([{type:'update',table:'people',id:a.person_id,patch:{sort_order:Number(b.sort_order)}},{type:'update',table:'people',id:b.person_id,patch:{sort_order:Number(a.sort_order)}}],'順序已更新')}catch(e){handleError(e)}}
async function deletePerson(id){if(!confirm('確定停用這位人員？既有訂餐紀錄仍會保留。'))return;try{await mutate([{type:'softDelete',table:'people',id}],'人員已停用')}catch(e){handleError(e)}}

function openAddStore(){showModal(`<h3>新增店家</h3><form id="storeForm"><label>店家名稱<input name="name" required></label><button class="btn primary wide">新增</button></form>`);$('#storeForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const id=uid('S');try{await mutate([{type:'insert',table:'stores',data:{store_id:id,store_name:f.get('name'),active:true}}],'店家已新增');state.selectedStore=id;closeModal()}catch(err){handleError(err)}}}
async function saveStoreName(){const id=state.selectedStore,n=$('#storeNameInput')?.value.trim();if(!n)return;try{await mutate([{type:'update',table:'stores',id,patch:{store_name:n}}],'店家名稱已更新')}catch(e){handleError(e)}}
function openAddMasterMenu(){if(!state.selectedStore)return;showModal(`<h3>新增永久菜單</h3><form id="masterForm"><label>餐點名稱<input name="name" required></label><label>價格<input type="number" min="0" name="price" required></label><button class="btn primary wide">新增</button></form>`);$('#masterForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await mutate([{type:'insert',table:'menu',data:{menu_id:uid('M'),store_id:state.selectedStore,item_name:f.get('name'),price:Number(f.get('price')),available:true}}],'永久菜單已新增');closeModal()}catch(err){handleError(err)}}}
async function saveMasterMenu(id){const name=$(`[data-master-name="${CSS.escape(id)}"]`)?.value;const price=$(`[data-master-price="${CSS.escape(id)}"]`)?.value;try{await mutate([{type:'update',table:'menu',id,patch:{item_name:name,price:Number(price)}}],'永久菜單已更新')}catch(e){handleError(e)}}

function handleError(err){console.error(err);setSync('同步失敗');toast(err.message||'操作失敗')}

$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();$('#loginError').textContent='';state.password=$('#passwordInput').value;state.actor=$('#actorInput').value.trim()||'管理者';try{await reloadData(true);$('#loginView').classList.add('hidden');$('#mainView').classList.remove('hidden');render()}catch(err){state.password='';$('#loginError').textContent=err.message==='Failed to fetch'?'無法連到 Google API，請確認部署權限。':err.message;}});
$('#logoutBtn').addEventListener('click',()=>{state.password='';state.data=null;$('#passwordInput').value='';$('#mainView').classList.add('hidden');$('#loginView').classList.remove('hidden');});
$$('.bottom-nav button').forEach(b=>b.addEventListener('click',()=>setPage(b.dataset.page)));
$('#modal').addEventListener('click',e=>{if(e.target.matches('[data-close-modal]'))closeModal();});

