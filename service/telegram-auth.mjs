import {createHash,createHmac,randomBytes,randomInt,timingSafeEqual} from 'node:crypto';

const digest=s=>createHash('sha256').update(String(s)).digest('hex');
const invalid=()=>Object.assign(Error('Код недействителен или истёк. Запросите новый.'),{status:400});
export function normalizePhone(value){
  if(typeof value!=='string'||value.length>40||!/^[+\d\s()\-]+$/.test(value))return null;
  let p=value.replace(/\D/g,'');
  if(p.length===10)p='7'+p;
  if(p.length===11&&p.startsWith('8'))p='7'+p.slice(1);
  return /^7\d{10}$/.test(p)?'+'+p:null;
}
export function setupTelegram(db){
  db.exec(`CREATE TABLE IF NOT EXISTS telegram_members(
    user_id TEXT PRIMARY KEY REFERENCES users(id),phone TEXT NOT NULL UNIQUE,
    telegram_id TEXT UNIQUE,verified_at INTEGER);
    CREATE TABLE IF NOT EXISTS telegram_challenges(
    id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),phone TEXT NOT NULL,
    telegram_id TEXT NOT NULL,password_version TEXT NOT NULL,code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS telegram_auth_limits(key TEXT PRIMARY KEY,window INTEGER NOT NULL,count INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS telegram_cooldowns(key TEXT PRIMARY KEY,next_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS telegram_worker(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
}
function tx(db,fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}
export function assignPhone(db,userId,value){
  const phone=normalizePhone(value);
  if(!phone)throw Error('Нужен российский номер телефона.');
  return tx(db,()=>{
    if(!db.prepare("SELECT id FROM users WHERE id=? AND state='active'").get(userId))throw Error('Активный пользователь не найден.');
    const old=db.prepare('SELECT * FROM telegram_members WHERE user_id=?').get(userId);
    if(old?.phone===phone)return {changed:false};
    db.prepare('INSERT INTO telegram_members(user_id,phone) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone,telegram_id=NULL,verified_at=NULL').run(userId,phone);
    db.prepare('DELETE FROM telegram_challenges WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
    return {changed:true};
  });
}
export function bindContact(db,message,now=Date.now()){
  const m=message,phone=normalizePhone(m?.contact?.phone_number);
  if(m?.chat?.type!=='private'||!Number.isSafeInteger(m?.from?.id)||m.from.is_bot||m.chat.id!==m.from.id||m.contact?.user_id!==m.from.id||!phone)return false;
  const id=String(m.from.id);
  return tx(db,()=>{
    const row=db.prepare("SELECT m.* FROM telegram_members m JOIN users u ON u.id=m.user_id WHERE m.phone=? AND u.state='active' AND EXISTS(SELECT 1 FROM access_permissions p WHERE p.user_id=u.id AND p.permission='platform.full_access')").get(phone);
    if(!row||(row.telegram_id&&row.telegram_id!==id))return false;
    if(db.prepare('SELECT user_id FROM telegram_members WHERE telegram_id=? AND user_id<>?').get(id,row.user_id))return false;
    db.prepare('UPDATE telegram_members SET telegram_id=?,verified_at=? WHERE user_id=?').run(id,now,row.user_id);
    return true;
  });
}
export function createTelegramClient(token,{fetcher=fetch}={}){
  if(!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token??''))throw Error('Проверьте токен Telegram в настройках сервера.');
  return async(method,params={})=>{
    if(!['getMe','getWebhookInfo','getUpdates','sendMessage'].includes(method))throw Error('Недопустимая операция Telegram.');
    try{
      const response=await fetcher(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params),signal:AbortSignal.timeout(method==='getUpdates'?35000:10000)});
      const data=await response.json();
      if(!response.ok||data.ok!==true)throw Object.assign(Error(),{telegramCode:Number(data.error_code)||0});
      return data.result;
    }catch(e){throw Object.assign(Error('Telegram временно недоступен.'),{status:503,telegramCode:e.telegramCode??0});}
  };
}
export function createTelegramAuth(db,{key,send,now=Date.now}={}){
  if(typeof key!=='string'||key.length<32)throw Error('Нужен отдельный секрет кодов Telegram длиной не менее 32 символов.');
  setupTelegram(db);
  const mac=(id,code)=>createHmac('sha256',key).update(id+':'+code).digest('hex');
  function limit(key,max,period=900000){
    const w=Math.floor(now()/period);
    const r=db.prepare('INSERT INTO telegram_auth_limits(key,window,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window RETURNING count').get(digest(key),w);
    return r.count<=max;
  }
  async function request(value,ip){
    if(!limit('request-ip:'+ip,20))throw Object.assign(Error('Слишком много запросов. Повторите через 15 минут.'),{status:429});
    const phone=normalizePhone(value);
    if(!phone)throw Object.assign(Error('Укажите номер телефона в формате +7…'),{status:400});
    const id=randomBytes(32).toString('hex'),result={ok:true,message:'Если доступ разрешён, код придёт в Telegram.',expiresIn:600,retryAfter:60};
    const phoneKey=digest('cooldown:'+phone),previous=db.prepare('SELECT next_at FROM telegram_cooldowns WHERE key=?').get(phoneKey);
    const allowed=limit('phone:'+phone,5)&&(!previous||previous.next_at<=now());
    if(allowed)db.prepare('INSERT INTO telegram_cooldowns VALUES(?,?) ON CONFLICT(key) DO UPDATE SET next_at=excluded.next_at').run(phoneKey,now()+60000);
    db.prepare('DELETE FROM telegram_challenges WHERE expires_at<=?').run(now());
    // Same response for unknown, unlinked and throttled numbers. No public registration.
    if(!allowed)return result;
    const row=db.prepare("SELECT m.*,u.password_hash FROM telegram_members m JOIN users u ON u.id=m.user_id WHERE m.phone=? AND m.telegram_id IS NOT NULL AND u.state='active' AND EXISTS(SELECT 1 FROM access_permissions p WHERE p.user_id=u.id AND p.permission='platform.full_access')").get(phone);
    if(!row)return result;
    const code=String(randomInt(1000000)).padStart(6,'0');
    tx(db,()=>{
      db.prepare('DELETE FROM telegram_challenges WHERE user_id=?').run(row.user_id);
      db.prepare('INSERT INTO telegram_challenges(id,user_id,phone,telegram_id,password_version,code_hash,expires_at) VALUES(?,?,?,?,?,?,?)').run(id,row.user_id,phone,row.telegram_id,digest(row.password_hash),mac(id,code),now()+600000);
    });
    try{
      await send('sendMessage',{chat_id:row.telegram_id,text:`Код входа в B2B «Наша смена»: ${code}\nДействует 10 минут. Никому не сообщайте код. Если вы не запрашивали вход, просто проигнорируйте сообщение.`,protect_content:true},{challenge:id,code,expiresAt:now()+600000});
    }catch{
      db.prepare('DELETE FROM telegram_challenges WHERE id=?').run(id);
      // Do not reveal whether the phone is a registered employee.
    }
    return result;
  }
  function verify(input,ip){
    if(!limit('verify-ip:'+ip,40))throw Object.assign(Error('Слишком много попыток. Повторите через 15 минут.'),{status:429});
    const phone=normalizePhone(input?.phone);if(!phone)throw invalid();
    const validCode=typeof input?.code==='string'&&/^\d{6}$/.test(input.code);
    // Commit attempts even when the supplied code is wrong.
    const userId=tx(db,()=>{
      const row=db.prepare("SELECT c.*,u.password_hash,m.phone AS current_phone,m.telegram_id AS current_telegram FROM telegram_challenges c JOIN users u ON u.id=c.user_id JOIN telegram_members m ON m.user_id=u.id WHERE c.phone=? AND u.state='active' AND EXISTS(SELECT 1 FROM access_permissions p WHERE p.user_id=u.id AND p.permission='platform.full_access') ORDER BY c.expires_at DESC LIMIT 1").get(phone);
      if(!row)return null;
      if(row.expires_at<=now()||row.attempts>=5||row.phone!==row.current_phone||row.telegram_id!==row.current_telegram||row.password_version!==digest(row.password_hash)){
        db.prepare('DELETE FROM telegram_challenges WHERE id=?').run(row.id);return null;
      }
      db.prepare('UPDATE telegram_challenges SET attempts=attempts+1 WHERE id=?').run(row.id);
      if(!validCode||!timingSafeEqual(Buffer.from(row.code_hash,'hex'),Buffer.from(mac(row.id,input.code),'hex')))return null;
      db.prepare('DELETE FROM telegram_challenges WHERE user_id=?').run(row.user_id);
      return row.user_id;
    });
    if(!userId)throw invalid();
    return userId;
  }
  return {request,verify};
}
