const schema=`
CREATE TABLE IF NOT EXISTS people(id TEXT PRIMARY KEY,name TEXT NOT NULL,group_name TEXT NOT NULL DEFAULT '其他',sort_order INTEGER NOT NULL DEFAULT 0,employee_code_hash TEXT,code_version INTEGER NOT NULL DEFAULT 1,active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS stores(id TEXT PRIMARY KEY,name TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS menu_items(id TEXT PRIMARY KEY,store_id TEXT NOT NULL,name TEXT NOT NULL,price INTEGER NOT NULL DEFAULT 0,sort_order INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,FOREIGN KEY(store_id) REFERENCES stores(id));
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,name TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,status TEXT NOT NULL DEFAULT '進行中',active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS meals(id TEXT PRIMARY KEY,event_id TEXT NOT NULL,meal_date TEXT NOT NULL,meal_type TEXT NOT NULL,store_id TEXT,status TEXT NOT NULL DEFAULT '登記中',active INTEGER NOT NULL DEFAULT 1,FOREIGN KEY(event_id) REFERENCES events(id));
CREATE TABLE IF NOT EXISTS meal_menu_items(id TEXT PRIMARY KEY,meal_id TEXT NOT NULL,source_id TEXT,store_id TEXT,name TEXT NOT NULL,price INTEGER NOT NULL DEFAULT 0,special INTEGER NOT NULL DEFAULT 0,sort_order INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,FOREIGN KEY(meal_id) REFERENCES meals(id));
CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,meal_id TEXT NOT NULL,event_id TEXT NOT NULL,person_id TEXT NOT NULL,meal_menu_id TEXT NOT NULL,name TEXT NOT NULL,price INTEGER NOT NULL DEFAULT 0,qty INTEGER NOT NULL DEFAULT 1,note TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL,FOREIGN KEY(meal_id) REFERENCES meals(id),FOREIGN KEY(person_id) REFERENCES people(id));
CREATE TABLE IF NOT EXISTS meal_people(meal_id TEXT NOT NULL,person_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT '已訂',picked INTEGER NOT NULL DEFAULT 0,picked_at TEXT,PRIMARY KEY(meal_id,person_id));
CREATE TABLE IF NOT EXISTS payments(event_id TEXT NOT NULL,person_id TEXT NOT NULL,paid INTEGER NOT NULL DEFAULT 0,paid_at TEXT,PRIMARY KEY(event_id,person_id));
CREATE TABLE IF NOT EXISTS auth_sessions(token_hash TEXT PRIMARY KEY,person_id TEXT,role TEXT NOT NULL,expires_at INTEGER NOT NULL,code_version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY AUTOINCREMENT,created_at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT,detail TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS idx_orders_person ON orders(person_id,active);
CREATE INDEX IF NOT EXISTS idx_orders_meal ON orders(meal_id,active);
CREATE INDEX IF NOT EXISTS idx_meals_event ON meals(event_id,active);
CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at DESC);`;

export async function onRequestGet({env}){
  try{
    await env.DB.exec(schema);
    const tables=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    return Response.json({ok:true,service:'meal-duty-installer',message:'資料庫初始化完成',tables:tables.results.map(x=>x.name)});
  }catch(error){
    return Response.json({ok:false,message:error.message||'初始化失敗'},{status:500});
  }
}