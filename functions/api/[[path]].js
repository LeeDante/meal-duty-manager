const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json;charset=utf-8','cache-control':'no-store',...headers}});
const now=()=>new Date().toISOString();
const randomToken=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
async function digest(value){const bytes=new TextEncoder().encode(value);return[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function body(request){try{return await request.json()}catch{return{}}}
function bearer(request){const h=request.headers.get('authorization')||'';return h.startsWith('Bearer ')?h.slice(7):''}
async function session(env,request,role){const token=bearer(request);if(!token)return null;const hash=await digest(token),row=await env.DB.prepare('SELECT s.*,p.name,p.group_name FROM auth_sessions s LEFT JOIN people p ON p.id=s.person_id WHERE token_hash=? AND expires_at>?').bind(hash,Date.now()).first();if(!row||role&&row.role!==role)return null;return row}
async function log(env,actor,action,type,id='',detail=''){await env.DB.prepare('INSERT INTO logs(created_at,actor,action,target_type,target_id,detail) VALUES(?,?,?,?,?,?)').bind(now(),actor,action,type,id,detail).run()}
async function publicBootstrap(env){
  const people=await env.DB.prepare("SELECT id,name,group_name AS 'group',sort_order FROM people WHERE active=1 ORDER BY sort_order,name").all();
  const meals=await env.DB.prepare("SELECT m.id,m.event_id AS eventId,e.name AS eventName,m.meal_date AS date,m.meal_type AS type,m.status,s.name AS storeName FROM meals m JOIN events e ON e.id=m.event_id LEFT JOIN stores s ON s.id=m.store_id WHERE m.active=1 AND e.active=1 ORDER BY m.meal_date,CASE m.meal_type WHEN '午餐' THEN 0 ELSE 1 END").all();
  return{people:people.results,meals:meals.results};
}
async function userBootstrap(env,personId){
  const person=await env.DB.prepare("SELECT id,name,group_name AS 'group' FROM people WHERE id=? AND active=1").bind(personId).first();
  const meals=await env.DB.prepare("SELECT m.id,m.event_id AS eventId,e.name AS eventName,m.meal_date AS date,m.meal_type AS type,m.status,s.name AS storeName FROM meals m JOIN events e ON e.id=m.event_id LEFT JOIN stores s ON s.id=m.store_id WHERE m.active=1 AND e.active=1 ORDER BY m.meal_date,CASE m.meal_type WHEN '午餐' THEN 0 ELSE 1 END").all();
  const menus=await env.DB.prepare("SELECT mm.id,mm.meal_id AS mealId,mm.name,mm.price,mm.sort_order AS sortOrder,COALESCE(t.qty,0) AS popularity FROM meal_menu_items mm LEFT JOIN (SELECT meal_menu_id,SUM(qty) qty FROM orders WHERE active=1 GROUP BY meal_menu_id)t ON t.meal_menu_id=mm.id WHERE mm.active=1 ORDER BY mm.meal_id,mm.sort_order").all();
  const orders=await env.DB.prepare("SELECT id,meal_id AS mealId,meal_menu_id AS mealMenuId,name,price,qty,note FROM orders WHERE person_id=? AND active=1 ORDER BY updated_at").bind(personId).all();
  return{person,meals:meals.results,menus:menus.results,orders:orders.results};
}
async function saveOrder(env,s,data){
  const meal=await env.DB.prepare("SELECT m.*,e.id event_id FROM meals m JOIN events e ON e.id=m.event_id WHERE m.id=? AND m.active=1 AND e.active=1").bind(data.mealId).first();
  if(!meal)return json({ok:false,message:'找不到餐次'},404);
  if(meal.status!=='登記中')return json({ok:false,message:'本餐已停止登記'},409);
  const chosen=(Array.isArray(data.items)?data.items:[]).filter(x=>Number(x.qty)>0&&Number(x.qty)<=20);
  const allowed=await env.DB.prepare('SELECT id,name,price FROM meal_menu_items WHERE meal_id=? AND active=1').bind(meal.id).all(),map=new Map(allowed.results.map(x=>[x.id,x]));
  if(chosen.some(x=>!map.has(x.id)))return json({ok:false,message:'餐點資料已更新，請重新整理'},409);
  await env.DB.prepare('UPDATE orders SET active=0,updated_at=? WHERE meal_id=? AND person_id=? AND active=1').bind(now(),meal.id,s.person_id).run();
  for(const item of chosen){const m=map.get(item.id);await env.DB.prepare('INSERT INTO orders(id,meal_id,event_id,person_id,meal_menu_id,name,price,qty,note,active,updated_at) VALUES(?,?,?,?,?,?,?,?,?,1,?)').bind(crypto.randomUUID(),meal.id,meal.event_id,s.person_id,m.id,m.name,m.price,Number(item.qty),String(data.note||'').slice(0,200),now()).run()}
  await env.DB.prepare("INSERT INTO meal_people(meal_id,person_id,status,picked) VALUES(?,?,'已訂',0) ON CONFLICT(meal_id,person_id) DO UPDATE SET status='已訂',picked=0,picked_at=NULL").bind(meal.id,s.person_id).run();
  await log(env,s.name||s.person_id,'SAVE_ORDER','meal',meal.id,`共${chosen.reduce((a,x)=>a+Number(x.qty),0)}份`);
  return json({ok:true});
}
async function importLegacy(env,payload,actor){
  const src=payload?.kind==='meal-duty-diagnostic-backup'?payload.state:payload;
  if(!src||!Array.isArray(src.people)||!Array.isArray(src.events)||!Array.isArray(src.orders))throw new Error('不是有效的NAS診斷JSON');
  const people=[...(src.people||[])],stores=[...(src.stores||[])],events=[...(src.events||[])],meals=[...(src.meals||[])];
  const peopleIds=new Set(people.map(x=>x.id)),storeIds=new Set(stores.map(x=>x.id)),eventIds=new Set(events.map(x=>x.id)),mealIds=new Set(meals.map(x=>x.id));
  const addPerson=id=>{if(id&&!peopleIds.has(id)){peopleIds.add(id);people.push({id,name:`保留人員（${id}）`,group:'其他',active:false})}};
  const addStore=id=>{if(id&&!storeIds.has(id)){storeIds.add(id);stores.push({id,name:`保留店家（${id}）`,active:false})}};
  const addEvent=(id,date='2000-01-01')=>{if(id&&!eventIds.has(id)){eventIds.add(id);events.push({id,name:`保留活動（${id}）`,start:date,end:date,status:'已結束',active:false})}};
  const addMeal=(id,eventId,date='2000-01-01')=>{if(id&&!mealIds.has(id)){const eid=eventId||`legacy-event-${id}`;addEvent(eid,date);mealIds.add(id);meals.push({id,eventId:eid,date,type:'舊餐次',status:'停止登記',active:false})}};
  for(const x of src.menu||[])addStore(x.storeId);
  for(const x of src.mealMenus||[]){addMeal(x.mealId,null);addStore(x.storeId)}
  for(const x of meals){addEvent(x.eventId,x.date);addStore(x.storeId)}
  for(const x of src.orders||[]){addPerson(x.personId);addEvent(x.eventId);addMeal(x.mealId,x.eventId)}
  for(const x of src.mealPeople||[]){addPerson(x.personId);addMeal(x.mealId,null)}
  for(const x of src.payments||[]){addPerson(x.personId);addEvent(x.eventId)}
  let stage='準備匯入';
  try{
    stage='人員';for(const p of people)await env.DB.prepare("INSERT INTO people(id,name,group_name,sort_order,active) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,group_name=excluded.group_name,sort_order=excluded.sort_order,active=excluded.active").bind(p.id,p.name,p.group||'其他',p.sort||0,p.active===false?0:1).run();
    stage='店家';for(const s of stores)await env.DB.prepare("INSERT INTO stores(id,name,sort_order,active) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,sort_order=excluded.sort_order,active=excluded.active").bind(s.id,s.name,s.sort||0,s.active===false?0:1).run();
    stage='店家菜單';for(const x of src.menu||[])await env.DB.prepare("INSERT INTO menu_items(id,store_id,name,price,sort_order,active) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET store_id=excluded.store_id,name=excluded.name,price=excluded.price,sort_order=excluded.sort_order,active=excluded.active").bind(x.id,x.storeId,x.name,x.price||0,x.sort||0,x.active===false?0:1).run();
    stage='活動';for(const e of events)await env.DB.prepare("INSERT INTO events(id,name,start_date,end_date,status,active) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,start_date=excluded.start_date,end_date=excluded.end_date,status=excluded.status,active=excluded.active").bind(e.id,e.name,e.start||'2000-01-01',e.end||e.start||'2000-01-01',e.status||'進行中',e.active===false?0:1).run();
    stage='餐次';for(const m of meals)await env.DB.prepare("INSERT INTO meals(id,event_id,meal_date,meal_type,store_id,status,active) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET event_id=excluded.event_id,meal_date=excluded.meal_date,meal_type=excluded.meal_type,store_id=excluded.store_id,status=excluded.status,active=excluded.active").bind(m.id,m.eventId,m.date||'2000-01-01',m.type||'舊餐次',m.storeId||null,m.status||'登記中',m.active===false?0:1).run();
    stage='餐次菜單';for(const x of src.mealMenus||[])await env.DB.prepare("INSERT INTO meal_menu_items(id,meal_id,source_id,store_id,name,price,special,sort_order,active) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET meal_id=excluded.meal_id,source_id=excluded.source_id,store_id=excluded.store_id,name=excluded.name,price=excluded.price,special=excluded.special,sort_order=excluded.sort_order,active=excluded.active").bind(x.id,x.mealId,x.sourceId||null,x.storeId||null,x.name,x.price||0,x.special?1:0,x.sort||0,x.active===false?0:1).run();
    stage='訂單';for(const o of src.orders||[])await env.DB.prepare("INSERT INTO orders(id,meal_id,event_id,person_id,meal_menu_id,name,price,qty,note,active,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET meal_id=excluded.meal_id,event_id=excluded.event_id,person_id=excluded.person_id,meal_menu_id=excluded.meal_menu_id,name=excluded.name,price=excluded.price,qty=excluded.qty,note=excluded.note,active=excluded.active,updated_at=excluded.updated_at").bind(o.id,o.mealId,o.eventId,o.personId,o.mealMenuId,o.name,o.price||0,o.qty||1,o.note||'',o.active===false?0:1,o.updatedAt||now()).run();
    stage='領餐狀態';for(const x of src.mealPeople||[])await env.DB.prepare("INSERT INTO meal_people(meal_id,person_id,status,picked,picked_at) VALUES(?,?,?,?,?) ON CONFLICT(meal_id,person_id) DO UPDATE SET status=excluded.status,picked=excluded.picked,picked_at=excluded.picked_at").bind(x.mealId,x.personId,x.status||'已訂',x.picked?1:0,x.pickedAt||null).run();
    stage='收費狀態';for(const x of src.payments||[])await env.DB.prepare("INSERT INTO payments(event_id,person_id,paid,paid_at) VALUES(?,?,?,?) ON CONFLICT(event_id,person_id) DO UPDATE SET paid=excluded.paid,paid_at=excluded.paid_at").bind(x.eventId,x.personId,x.paid?1:0,x.paidAt||null).run();
  }catch(error){throw new Error(`匯入「${stage}」時失敗：${error.message}`)}
  await log(env,actor,'IMPORT_LEGACY','system','',`${src.people.length}人｜${(src.stores||[]).length}店｜${src.events.length}活動｜${src.orders.length}訂單`);
  return{people:src.people.length,stores:(src.stores||[]).length,events:src.events.length,meals:(src.meals||[]).length,orders:src.orders.length};
}
export async function onRequest({request,env,params}){
  const segments=Array.isArray(params.path)?params.path:[params.path].filter(Boolean),path='/'+segments.join('/'),method=request.method;
  try{
    if(path==='/health')return json({ok:true,service:'meal-duty-cloudflare',version:'0.1.0'});
    if(path==='/public/bootstrap'&&method==='GET')return json({ok:true,...await publicBootstrap(env)});
    if(path==='/auth/person'&&method==='POST'){
      const d=await body(request),person=await env.DB.prepare('SELECT * FROM people WHERE id=? AND active=1').bind(d.personId).first();
      if(!person||!person.employee_code_hash||person.employee_code_hash!==await digest(String(d.code||'')))return json({ok:false,message:'姓名或五碼工號不正確'},401);
      const token=randomToken(),expires=Date.now()+30*24*3600*1000;await env.DB.prepare("INSERT INTO auth_sessions(token_hash,person_id,role,expires_at,code_version) VALUES(?,?,'person',?,?)").bind(await digest(token),person.id,expires,person.code_version).run();await log(env,person.name,'LOGIN','person',person.id,'登入成功');return json({ok:true,token,person:{id:person.id,name:person.name,group:person.group_name}});
    }
    if(path==='/auth/admin'&&method==='POST'){
      const d=await body(request),stored=await env.DB.prepare("SELECT value FROM settings WHERE key='admin_password_hash'").first();if(!stored||stored.value!==await digest(String(d.password||'')))return json({ok:false,message:stored?'管理密碼不正確':'尚未設定管理密碼'},401);const token=randomToken();await env.DB.prepare("INSERT INTO auth_sessions(token_hash,role,expires_at) VALUES(?,'admin',?)").bind(await digest(token),Date.now()+8*3600*1000).run();return json({ok:true,token});
    }
    if(path==='/me'&&method==='GET'){const s=await session(env,request,'person');if(!s)return json({ok:false,message:'請重新登入'},401);return json({ok:true,...await userBootstrap(env,s.person_id)});}
    if(path==='/orders'&&method==='POST'){const s=await session(env,request,'person');if(!s)return json({ok:false,message:'請重新登入'},401);return saveOrder(env,s,await body(request));}
    if(path==='/admin/bootstrap'&&method==='GET'){const s=await session(env,request,'admin');if(!s)return json({ok:false,message:'管理權限已失效'},401);const counts={};for(const t of ['people','stores','events','meals','orders','logs'])counts[t]=(await env.DB.prepare(`SELECT COUNT(*) n FROM ${t}`).first()).n;const people=await env.DB.prepare("SELECT id,name,group_name AS 'group',sort_order AS sortOrder,CASE WHEN employee_code_hash IS NULL THEN 0 ELSE 1 END AS hasCode FROM people WHERE active=1 ORDER BY sort_order,name").all();return json({ok:true,counts,people:people.results});}
    if(path==='/admin/setup'&&method==='POST'){const existing=await env.DB.prepare("SELECT value FROM settings WHERE key='admin_password_hash'").first();if(existing)return json({ok:false,message:'管理密碼已設定'},409);const d=await body(request);if(String(d.password||'').length<6)return json({ok:false,message:'管理密碼至少6碼'},400);await env.DB.prepare("INSERT INTO settings(key,value) VALUES('admin_password_hash',?)").bind(await digest(String(d.password))).run();return json({ok:true});}
    if(path==='/admin/import-legacy'&&method==='POST'){const s=await session(env,request,'admin');if(!s)return json({ok:false,message:'管理權限已失效'},401);return json({ok:true,summary:await importLegacy(env,await body(request),'管理者')});}
    if(path==='/admin/person-code'&&method==='POST'){const s=await session(env,request,'admin');if(!s)return json({ok:false,message:'管理權限已失效'},401);const d=await body(request),code=String(d.code||'');if(!/^\d{5}$/.test(code))return json({ok:false,message:'工號必須是五位數'},400);await env.DB.prepare('UPDATE people SET employee_code_hash=?,code_version=code_version+1 WHERE id=?').bind(await digest(code),d.personId).run();await env.DB.prepare("DELETE FROM auth_sessions WHERE person_id=? AND role='person'").bind(d.personId).run();return json({ok:true});}
    return json({ok:false,message:'找不到API'},404);
  }catch(error){return json({ok:false,message:error.message||'伺服器錯誤'},500)}
}
