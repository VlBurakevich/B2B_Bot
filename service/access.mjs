import {randomUUID,createHash} from 'node:crypto';
import {normalizePhone} from './telegram-auth.mjs';
export const permissionsCatalog={
 'platform.full_access':'Вход в веб-платформу',
 'b2b.registry':'Работа с реестром B2B',
 'admin.access.manage':'Управление доступами',
 'reimbursements.create':'Выдача средств',
 'performer.payouts':'Выплаты исполнителям'
};
const fail=(message,status=400)=>Object.assign(Error(message),{status});
export function transaction(db,fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}
export function audit(db,actor,subject,action,detail={},now=Date.now()){
 db.prepare('INSERT INTO access_audit(actor_id,subject_id,action,detail,at) VALUES(?,?,?,?,?)').run(actor??null,subject??null,action,JSON.stringify(detail),now);
}
export function setupAccess(db,now=Date.now()){
 db.exec(`CREATE TABLE IF NOT EXISTS access_permissions(user_id TEXT NOT NULL REFERENCES users(id),permission TEXT NOT NULL,PRIMARY KEY(user_id,permission));
 CREATE TABLE IF NOT EXISTS access_metadata(user_id TEXT PRIMARY KEY REFERENCES users(id),chat_id TEXT,username TEXT,registered_at INTEGER,reviewed_at INTEGER,updated_at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS access_audit(id INTEGER PRIMARY KEY,actor_id TEXT,subject_id TEXT,action TEXT NOT NULL,detail TEXT NOT NULL,at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS registration_drafts(telegram_id TEXT PRIMARY KEY,phone TEXT NOT NULL UNIQUE,chat_id TEXT NOT NULL,username TEXT,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS registration_updates(event_id TEXT PRIMARY KEY,response TEXT NOT NULL,at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS access_outbox(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,subject_id TEXT,created_at INTEGER NOT NULL,sent_at INTEGER,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS access_schema(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
 transaction(db,()=>{
 if(db.prepare("SELECT 1 FROM access_schema WHERE key='v1'").get())return;
 for(const u of db.prepare('SELECT id,state FROM users').all()){
  // Explicit one-time migration; subsequent registrations never inherit rights.
  db.prepare('INSERT OR IGNORE INTO access_metadata(user_id,updated_at) VALUES(?,?)').run(u.id,now);
  for(const p of ['platform.full_access','b2b.registry'])db.prepare('INSERT OR IGNORE INTO access_permissions VALUES(?,?)').run(u.id,p);
  if(db.prepare("SELECT 1 FROM account_permissions WHERE user_id=? AND permission='accounts.manage'").get(u.id))db.prepare('INSERT OR IGNORE INTO access_permissions VALUES(?,?)').run(u.id,'admin.access.manage');
 }
 db.prepare("INSERT INTO access_schema VALUES('v1','1')").run();
 // Password-era sessions and reset links cannot bypass the new login policy.
 db.exec('DELETE FROM sessions; DELETE FROM password_resets; DELETE FROM telegram_challenges;');
 audit(db,null,null,'migration.phone_only',{},now);
 });
}
export function hasPermission(db,id,p){return Boolean(db.prepare("SELECT 1 FROM access_permissions p JOIN users u ON u.id=p.user_id WHERE u.id=? AND u.state='active' AND p.permission=?").get(id,p));}
export function publicUser(db,id){
 const row=db.prepare(`SELECT u.id,u.name,u.state AS status,t.phone,t.telegram_id AS telegramUserId,m.chat_id AS telegramChatId,m.username AS telegramUsername,m.registered_at AS registeredAt,m.reviewed_at AS reviewedAt,m.updated_at AS updatedAt,m.version FROM users u LEFT JOIN telegram_members t ON t.user_id=u.id LEFT JOIN access_metadata m ON m.user_id=u.id WHERE u.id=?`).get(id);
 return row?{...row,permissions:db.prepare('SELECT permission FROM access_permissions WHERE user_id=? ORDER BY permission').all(id).map(x=>x.permission)}:null;
}
export function listAccess(db){return db.prepare('SELECT id FROM users ORDER BY state,name').all().map(u=>publicUser(db,u.id));}
export function requireAdmin(db,id){if(!hasPermission(db,id,'admin.access.manage')||!hasPermission(db,id,'platform.full_access'))throw fail('Нет права управлять доступами.',403);}
export function revokeSessions(db,id){for(const t of ['sessions','telegram_challenges','password_resets'])db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id);}
function enqueue(db,userId,kind,subject,now){db.prepare('INSERT INTO access_outbox(id,user_id,kind,subject_id,created_at) VALUES(?,?,?,?,?)').run(randomUUID(),userId,kind,subject,now);}
export function changeAccess(db,actor,input,now=Date.now()){
 return transaction(db,()=>{
 requireAdmin(db,actor);
 const u=publicUser(db,input?.userId);if(!u)throw fail('Пользователь не найден.',404);
 if(input.version!==u.version)throw fail('Карточка уже изменена. Обновите список.',409);
 if(input.action==='revoke-sessions'){
  revokeSessions(db,u.id);db.prepare('UPDATE access_metadata SET version=version+1,updated_at=? WHERE user_id=?').run(now,u.id);audit(db,actor,u.id,'sessions.revoked',{},now);return publicUser(db,u.id);
 }
 const status=input.status,permissions=input.permissions;
 if(!['pending','active','blocked'].includes(status)||!Array.isArray(permissions)||permissions.length>100||permissions.some(p=>!Object.hasOwn(permissionsCatalog,p))||new Set(permissions).size!==permissions.length)throw fail('Проверьте статус и права.');
 if(u.status==='active'&&status==='pending')throw fail('Для закрытия доступа используйте блокировку.');
 if(status==='active'&&db.prepare('SELECT 1 FROM account_profiles WHERE user_id=? AND revoked_at IS NOT NULL').get(u.id))throw fail('Привязка amoCRM отозвана. Требуется новая учётная запись.',409);
 const nextAdmin=status==='active'&&permissions.includes('admin.access.manage')&&permissions.includes('platform.full_access');
 if(hasPermission(db,u.id,'admin.access.manage')&&!nextAdmin&&!listAccess(db).some(x=>x.id!==u.id&&x.status==='active'&&x.permissions.includes('admin.access.manage')&&x.permissions.includes('platform.full_access')))throw fail('Нельзя закрыть доступ последнему администратору.',409);
 db.prepare('UPDATE users SET state=? WHERE id=?').run(status,u.id);
 db.prepare('DELETE FROM access_permissions WHERE user_id=?').run(u.id);
 for(const p of permissions)db.prepare('INSERT INTO access_permissions VALUES(?,?)').run(u.id,p);
 // Mirror only for legacy account profile helpers, never as the auth authority.
 db.prepare('DELETE FROM account_permissions WHERE user_id=?').run(u.id);
 if(permissions.includes('admin.access.manage'))db.prepare("INSERT INTO account_permissions VALUES(?,'accounts.manage')").run(u.id);
 db.prepare('UPDATE access_metadata SET reviewed_at=CASE WHEN ?!=\'pending\' THEN ? ELSE reviewed_at END,updated_at=?,version=version+1 WHERE user_id=?').run(status,now,now,u.id);
 revokeSessions(db,u.id);
 audit(db,actor,u.id,'access.changed',{before:{status:u.status,permissions:u.permissions},after:{status,permissions}},now);
 enqueue(db,u.id,'access',u.id,now);
 return publicUser(db,u.id);
 });
}
const contactKeyboard={keyboard:[[{text:'Отправить мой номер',request_contact:true}]],resize_keyboard:true,one_time_keyboard:true};
export function menu(user,origin){
 if(!user)return {text:'Для регистрации отправьте свой номер кнопкой Telegram.',reply_markup:contactKeyboard};
 if(user.status==='pending')return {text:'Заявка отправлена. Дождитесь одобрения администратора.',reply_markup:{remove_keyboard:true}};
 if(user.status!=='active')return {text:'Доступ закрыт. Обратитесь к администратору.',reply_markup:{remove_keyboard:true}};
 const buttons=[];
 if(user.permissions.includes('platform.full_access'))buttons.push([{text:'Открыть B2B',url:origin}]);
 if(user.permissions.includes('admin.access.manage')&&user.permissions.includes('platform.full_access'))buttons.push([{text:'Доступы',url:origin+'/#access'}]);
 // Financial modules are not implemented in this B2B repository. Do not invent operations.
 const rights=user.permissions.map(p=>permissionsCatalog[p]??p);
 return {text:'Доступ разрешён'+(rights.length?'\n\nВаши права:\n'+rights.map(p=>'• '+p).join('\n'):'\nРазрешённых функций пока нет'),reply_markup:buttons.length?{inline_keyboard:buttons}:{remove_keyboard:true}};
}
export function registrationMessage(db,message,{eventId,origin,now=Date.now()}={}){
 const m=message;
 if(m?.chat?.type!=='private'||!Number.isSafeInteger(m.from?.id)||m.from.id<=0||m.from.is_bot||m.chat.id!==m.from.id)throw fail('Нужен личный чат с ботом.');
 const tg=String(m.from.id),username=typeof m.from.username==='string'&&/^[a-zA-Z0-9_]{1,32}$/.test(m.from.username)?m.from.username:null;
 if(typeof eventId!=='string'||!/^\d{1,20}:\d{1,20}$/.test(eventId)||!eventId.startsWith(tg+':'))throw fail('Некорректное сообщение.');
 return transaction(db,()=>{
 const prior=db.prepare('SELECT response FROM registration_updates WHERE event_id=?').get(eventId);if(prior)return JSON.parse(prior.response);
 db.prepare('DELETE FROM registration_drafts WHERE expires_at<=?').run(now);
 const bound=db.prepare('SELECT user_id,phone FROM telegram_members WHERE telegram_id=?').get(tg);
 let result;
 if(m.contact){
  const phone=normalizePhone(m.contact.phone_number);
  if(m.contact.user_id!==m.from.id||!phone)result={text:'Отправьте собственный российский номер через кнопку «Отправить мой номер».',reply_markup:contactKeyboard};
  else if(bound&&bound.phone!==phone)result={text:'Этот Telegram уже связан с учётной записью. Для смены номера обратитесь к администратору.',reply_markup:{remove_keyboard:true}};
  else{
   const target=db.prepare('SELECT user_id,telegram_id FROM telegram_members WHERE phone=?').get(phone);
   if(target?.telegram_id&&target.telegram_id!==tg)result={text:'Номер уже связан с другой учётной записью. Обратитесь к администратору.',reply_markup:{remove_keyboard:true}};
   else if(target){
    db.prepare('UPDATE telegram_members SET telegram_id=?,verified_at=? WHERE user_id=?').run(tg,now,target.user_id);
    db.prepare('UPDATE access_metadata SET chat_id=?,username=?,updated_at=?,version=version+1 WHERE user_id=?').run(tg,username,now,target.user_id);
    db.prepare('DELETE FROM registration_drafts WHERE telegram_id=?').run(tg);
    audit(db,target.user_id,target.user_id,'telegram.bound',{},now);
    result=menu(publicUser(db,target.user_id),origin);
   }else if(db.prepare('SELECT 1 FROM registration_drafts WHERE phone=? AND telegram_id<>?').get(phone,tg))result={text:'Номер уже ожидает регистрации. Обратитесь к администратору.'};
   else{
    db.prepare('INSERT INTO registration_drafts VALUES(?,?,?,?,?) ON CONFLICT(telegram_id) DO UPDATE SET phone=excluded.phone,chat_id=excluded.chat_id,username=excluded.username,expires_at=excluded.expires_at').run(tg,phone,tg,username,now+86400000);
    result={text:'Номер подтверждён. Напишите ваши фамилию, имя и отчество одним сообщением.',reply_markup:{remove_keyboard:true}};
   }
  }
 }else if(bound){
  db.prepare('UPDATE access_metadata SET chat_id=?,username=? WHERE user_id=?').run(tg,username,bound.user_id);
  result=menu(publicUser(db,bound.user_id),origin);
 }else{
  const draft=db.prepare('SELECT * FROM registration_drafts WHERE telegram_id=?').get(tg),name=typeof m.text==='string'?m.text.trim().replace(/\s+/g,' '):'';
  if(!draft||name.startsWith('/'))result=menu(null,origin);
  else if(name.length<3||name.length>200||/[\x00-\x1f\x7f<>]/.test(name)||name.split(' ').length<2)result={text:'Укажите фамилию, имя и отчество, если оно есть (до 200 символов).'};
  else{
   const id=randomUUID();
   db.prepare("INSERT INTO users(id,login,name,password_hash,state) VALUES(?,?,?,?,'pending')").run(id,'phone-'+id,name,'!phone-only:'+randomUUID());
   db.prepare('INSERT INTO telegram_members VALUES(?,?,?,?)').run(id,draft.phone,tg,now);
   db.prepare('INSERT INTO access_metadata(user_id,chat_id,username,registered_at,updated_at) VALUES(?,?,?,?,?)').run(id,tg,username,now,now);
   db.prepare('DELETE FROM registration_drafts WHERE telegram_id=?').run(tg);
   audit(db,id,id,'registration.pending',{},now);
   for(const admin of db.prepare("SELECT p.user_id FROM access_permissions p JOIN users u ON u.id=p.user_id WHERE p.permission='admin.access.manage' AND u.state='active'").all())enqueue(db,admin.user_id,'registration',id,now);
   result=menu(publicUser(db,id),origin);
  }
 }
 db.prepare('INSERT INTO registration_updates VALUES(?,?,?)').run(eventId,JSON.stringify(result),now);
 return result;
 });
}
export async function flushNotifications(db,send,origin,now=Date.now()){
 for(const row of db.prepare('SELECT * FROM access_outbox WHERE sent_at IS NULL AND next_at<=? ORDER BY created_at LIMIT 20').all(now)){
  const u=publicUser(db,row.user_id);
  if(row.kind==='registration'&&!hasPermission(db,row.user_id,'admin.access.manage')){db.prepare('UPDATE access_outbox SET sent_at=? WHERE id=?').run(now,row.id);continue;}
  if(!u?.telegramUserId)continue;
  const subject=publicUser(db,row.subject_id);
  const content=row.kind==='registration'?{text:`Новая заявка B2B\n${subject?.name??''}\n${subject?.phone??''}\nОткройте раздел «Доступы».`,reply_markup:{inline_keyboard:[[{text:'Рассмотреть заявку',url:origin+'/#access'}]]}}:menu(u,origin);
  try{await send({chatId:u.telegramUserId,requestId:row.id,...content});db.prepare('UPDATE access_outbox SET sent_at=? WHERE id=?').run(now,row.id);}
  catch{db.prepare('UPDATE access_outbox SET attempts=attempts+1,next_at=? WHERE id=?').run(now+Math.min(3600000,30000*2**Math.min(row.attempts,7)),row.id);}
 }
}
