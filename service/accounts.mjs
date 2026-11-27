import {hasPermission,audit} from './access.mjs';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {setupTelegram,normalizePhone} from './telegram-auth.mjs';
import {issueReset} from './password-reset.mjs';
const digest=s=>createHash('sha256').update(s).digest('hex');
const normalize=s=>String(s).trim().toLocaleLowerCase('ru-RU').replace(/\s+/g,' ');
const fail=(message,status=400)=>Object.assign(Error(message),{status});
function editVersion(row){return digest(JSON.stringify([row.id,row.login,row.name,row.state,row.amoUserId??null,row.amoName??null,row.scope??'all',row.revokedAt??null,row.phone??null]));}
export function updateAccount(db,actor,input,{now=Date.now()}={}){
 if(!canManageAccounts(db,actor.id))throw fail('Нет права редактировать учётные записи.',403);
 if(!input||Object.keys(input).some(k=>!['userId','editVersion','name','login','phone','scope','withoutAmo'].includes(k)))throw fail('Недопустимые поля учётной записи.');
 const name=typeof input.name==='string'?input.name.trim().replace(/\s+/g,' '):'',login=db.prepare('SELECT login FROM users WHERE id=?').get(input.userId)?.login??'',phone=normalizePhone(input.phone);
 if(!name||name.length>200||/[\x00-\x1f\x7f]/.test(name))throw fail('Укажите имя длиной до 200 символов.');
 if(!/^[a-z][a-z0-9._-]{2,63}$/.test(login))throw fail('Логин: от 3 до 64 латинских букв, цифр, точек, дефисов или подчёркиваний. Начните с буквы.');
 if(input.withoutAmo!==undefined&&typeof input.withoutAmo!=='boolean')throw fail('Некорректный режим привязки.');
 if(!['own','all'].includes(input.scope))throw fail('Выберите доступ к заявкам.');
 db.exec('BEGIN IMMEDIATE');
 try{
  if(!canManageAccounts(db,actor.id))throw fail('Нет права редактировать учётные записи.',403);
  const target=listAccounts(db).find(u=>u.id===input.userId);
  if(!target||target.state!=='active'||target.revokedAt!=null)throw fail('Редактировать можно только действующую учётную запись.',409);
  if(typeof input.editVersion!=='string'||input.editVersion!==target.editVersion)throw fail('Учётная запись уже изменена. Закройте форму, обновите список и повторите изменение.',409);
  if(!phone&&(target.phone||String(input.phone??'').trim()))throw fail('Укажите российский номер телефона в формате +7…');
  if(!target.amoUserId&&input.withoutAmo===false)throw fail('Обратная привязка к amoCRM через эту форму недоступна.');
  const detach=Boolean(target.amoUserId&&input.withoutAmo);
  if((!target.amoUserId||detach)&&input.scope==='own')throw fail('Доступ к своим заявкам требует привязки к сотруднику amoCRM.');
  if(db.prepare('SELECT 1 FROM users WHERE lower(login)=? AND id<>?').get(login,target.id)||db.prepare('SELECT 1 FROM account_login_history WHERE login=? AND user_id<>?').get(login,target.id))throw fail('Этот логин уже занят или использовался другим сотрудником.',409);
  if(db.prepare("SELECT name FROM users WHERE state='active' AND id<>?").all(target.id).some(u=>normalize(u.name)===normalize(name)))throw fail('Аккаунт с таким именем уже существует.',409);
  if(db.prepare('SELECT 1 FROM telegram_members WHERE phone=? AND user_id<>?').get(phone,target.id))throw fail('Этот телефон уже привязан к другому аккаунту.',409);
  const changes=['name','login','phone','scope'].filter(k=>({name,login,phone,scope:input.scope})[k]!==target[k]);
  if(detach)changes.push('amo_detached');
  const revoke=changes.some(k=>['login','phone','scope','amo_detached'].includes(k));
  if(changes.length){
   if(changes.includes('login'))db.prepare('INSERT OR IGNORE INTO account_login_history(login,user_id) VALUES(?,?)').run(target.login,target.id);
   db.prepare('UPDATE users SET name=?,login=? WHERE id=?').run(name,login,target.id);
   if(detach){
    const old=db.prepare('SELECT * FROM account_profiles WHERE user_id=?').get(target.id);
    db.prepare('INSERT INTO account_profile_history(user_id,profile_json,detached_by,detached_at) VALUES(?,?,?,?)').run(target.id,JSON.stringify(old),actor.id,now);
    db.prepare('DELETE FROM account_profiles WHERE user_id=?').run(target.id);
   }
   if(target.amoUserId&&!detach)db.prepare('UPDATE account_profiles SET scope=? WHERE user_id=?').run(input.scope,target.id);
   if(changes.includes('phone'))db.prepare('INSERT INTO telegram_members(user_id,phone) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone,telegram_id=NULL,verified_at=NULL').run(target.id,phone);
   if(changes.includes('phone')&&db.prepare("SELECT 1 FROM sqlite_master WHERE name='access_metadata'").get())db.prepare('UPDATE access_metadata SET chat_id=NULL,username=NULL WHERE user_id=?').run(target.id);
   if(revoke)for(const table of ['sessions','password_resets','telegram_challenges'])db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(target.id);
   if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='access_metadata'").get()){db.prepare('UPDATE access_metadata SET updated_at=?,version=version+1 WHERE user_id=?').run(now,target.id);audit(db,actor.id,target.id,'account.updated',{fields:changes},now);}
   db.prepare('INSERT INTO account_audit(actor_id,subject_id,action,amo_user_id,at) VALUES(?,?,?,?,?)').run(actor.id,target.id,'updated:'+changes.join(','),target.amoUserId,now);
  }
  const account=listAccounts(db).find(u=>u.id===target.id);
  db.exec('COMMIT');return {ok:true,account,changed:changes.length>0,reauthenticate:revoke&&actor.id===target.id,phoneChanged:changes.includes('phone')};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
export function setupAccounts(db){
 setupTelegram(db);
 db.exec(`CREATE TABLE IF NOT EXISTS account_permissions(user_id TEXT NOT NULL REFERENCES users(id),permission TEXT NOT NULL CHECK(permission='accounts.manage'),PRIMARY KEY(user_id,permission));
 CREATE TABLE IF NOT EXISTS account_profiles(user_id TEXT PRIMARY KEY REFERENCES users(id),amo_user_id INTEGER NOT NULL,amo_name TEXT NOT NULL,revoked_at INTEGER,scope TEXT NOT NULL CHECK(scope IN ('own','all')),created_by TEXT NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS account_current_amo ON account_profiles(amo_user_id) WHERE revoked_at IS NULL;
 CREATE TABLE IF NOT EXISTS account_profile_history(id INTEGER PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),profile_json TEXT NOT NULL,detached_by TEXT NOT NULL,detached_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS account_login_history(login TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id));
 CREATE TABLE IF NOT EXISTS account_audit(id INTEGER PRIMARY KEY,actor_id TEXT NOT NULL,subject_id TEXT NOT NULL,action TEXT NOT NULL,amo_user_id INTEGER,at INTEGER NOT NULL);`);
}
export function canManageAccounts(db,id){if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='access_permissions'").get())return hasPermission(db,id,'admin.access.manage')&&hasPermission(db,id,'platform.full_access');return Boolean(db.prepare("SELECT 1 FROM account_permissions p JOIN users u ON u.id=p.user_id WHERE p.user_id=? AND p.permission='accounts.manage' AND u.state='active'").get(id));}
export function accountAccess(db,user){
 if(!user)return user;
 const profile=db.prepare('SELECT amo_user_id,scope FROM account_profiles WHERE user_id=?').get(user.id);
 return {...user,canManageAccounts:canManageAccounts(db,user.id),amoUserId:profile?.amo_user_id??null,scope:profile?.scope??'all'};
}
export function canAccessLead(actor,lead){return actor.scope!=='own'||Number(lead?.raw?.responsible_user_id)===actor.amoUserId;}
export function listAccounts(db){return db.prepare(`SELECT u.id,u.login,u.name,u.state,p.amo_user_id AS amoUserId,p.amo_name AS amoName,p.scope,p.revoked_at AS revokedAt,t.phone,
 EXISTS(SELECT 1 FROM account_permissions ap WHERE ap.user_id=u.id AND ap.permission='accounts.manage') AS isAdmin,
 CASE WHEN u.password_hash LIKE '!password-setup-pending:%' THEN 1 ELSE 0 END AS setupPending
 FROM users u LEFT JOIN account_profiles p ON p.user_id=u.id LEFT JOIN telegram_members t ON t.user_id=u.id ORDER BY u.name`).all().map(r=>({...r,scope:r.scope??'all',setupPending:Boolean(r.setupPending),isAdmin:Boolean(r.isAdmin),editVersion:editVersion(r)}));}
export function eligibleAmoUsers(users){
 if(!Array.isArray(users)||users.some(u=>!Number.isSafeInteger(u?.id)||u.id<=0||typeof u.name!=='string'||typeof u.rights?.is_active!=='boolean'))throw fail('amoCRM не вернула полный список сотрудников и их статусы. Повторите загрузку.',502);
 return users.filter(u=>u.rights.is_active).map(u=>({id:u.id,name:u.name})).sort((a,b)=>a.name.localeCompare(b.name,'ru'));
}
export function createAccount(db,actor,input,amoUsers,{scope='own',origin,now=Date.now()}={}){
 if(!canManageAccounts(db,actor.id))throw fail('Нет права создавать учётные записи.',403);
 if(!['own','all'].includes(scope)||origin!=='https://b2b.n-smena.business'&&!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin??''))throw fail('Некорректные настройки сервиса.',500);
 const login='phone-'+randomUUID(),phone=normalizePhone(input?.phone);
 if(!/^[a-z][a-z0-9._-]{2,63}$/.test(login))throw fail('Логин: от 3 до 64 латинских букв, цифр, точек, дефисов или подчёркиваний. Начните с буквы.');
 if(!phone)throw fail('Укажите российский номер телефона в формате +7…');
 const local=input?.amoUserId===null;
 if(!local&&!Number.isSafeInteger(input?.amoUserId))throw fail('Выберите сотрудника amoCRM или создание без привязки.');
 if(local&&scope!=='all')throw fail('Для учётки без amoCRM доступен весь реестр.');
 const amo=local?{id:null,name:typeof input.name==='string'?input.name.trim().replace(/\s+/g,' '):''}:eligibleAmoUsers(amoUsers).find(u=>u.id===input.amoUserId);
 if(!amo)throw fail('Этот сотрудник amoCRM недоступен или неактивен.',409);
 if(!amo.name.trim()||amo.name.length>200||/[\x00-\x1f\x7f]/.test(amo.name))throw fail('Укажите имя длиной до 200 символов.');
 db.exec('BEGIN IMMEDIATE');
 try{
  // Recheck permissions after any network await, and refuse duplicate identities.
  if(!canManageAccounts(db,actor.id))throw fail('Нет права создавать учётные записи.',403);
  if(db.prepare('SELECT 1 FROM account_profiles WHERE amo_user_id=? AND revoked_at IS NULL').get(amo.id))throw fail('Для этого сотрудника amoCRM аккаунт уже создан.',409);
  if(db.prepare('SELECT 1 FROM users WHERE lower(login)=?').get(login)||db.prepare('SELECT 1 FROM account_login_history WHERE login=?').get(login))throw fail('Этот логин уже занят.',409);
  if(db.prepare("SELECT name FROM users WHERE state='active'").all().some(u=>normalize(u.name)===normalize(amo.name)))throw fail('Аккаунт с таким именем уже существует. Используйте существующую учётную запись; дубль не создан.',409);
  if(db.prepare('SELECT 1 FROM telegram_members WHERE phone=?').get(phone))throw fail('Этот телефон уже привязан к другому аккаунту.',409);
  const id=randomUUID(),password='!phone-only:'+randomBytes(32).toString('hex');
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(id,login,amo.name.trim(),password,'active');
  if(!local)db.prepare('INSERT INTO account_profiles(user_id,amo_user_id,amo_name,scope,created_by,created_at) VALUES(?,?,?,?,?,?)').run(id,amo.id,amo.name,scope,actor.id,now);
  db.prepare('INSERT INTO telegram_members(user_id,phone) VALUES(?,?)').run(id,phone);
  db.prepare('INSERT INTO access_metadata(user_id,registered_at,reviewed_at,updated_at) VALUES(?,?,?,?)').run(id,now,now,now);
  for(const permission of ['platform.full_access','b2b.registry'])db.prepare('INSERT INTO access_permissions VALUES(?,?)').run(id,permission);
  audit(db,actor.id,id,'account.created',{permissions:['platform.full_access','b2b.registry']},now);
  db.prepare('INSERT INTO account_audit(actor_id,subject_id,action,amo_user_id,at) VALUES(?,?,?,?,?)').run(actor.id,id,'created',amo.id,now);
  db.exec('COMMIT');return {id,name:amo.name.trim(),phone,amoUserId:amo.id,scope};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
export function renewInvitation(){throw fail('Вход по паролю отключён.',410);}

// Preserve the historical identity; never transfer credentials to a renamed amo user.
export function reconcileAccount(db,userId,amo,now=Date.now()){
 const p=db.prepare('SELECT * FROM account_profiles WHERE user_id=?').get(userId);
 if(!p)return true;
 if(p.revoked_at!==null)return false;
 if(!amo||amo.id!==p.amo_user_id||typeof amo.name!=='string'||typeof amo.rights?.is_active!=='boolean')throw fail('Не удалось проверить аккаунт в amoCRM. Повторите позже.',503);
 if(amo.name===p.amo_name&&amo.rights.is_active)return true;
 db.exec('BEGIN IMMEDIATE');
 try{
  db.prepare("UPDATE users SET state='blocked' WHERE id=?").run(userId);
  db.prepare('UPDATE account_profiles SET revoked_at=? WHERE user_id=?').run(now,userId);
  for(const table of ['sessions','password_resets','telegram_challenges','account_permissions'])db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(userId);
  db.prepare('INSERT INTO account_audit(actor_id,subject_id,action,amo_user_id,at) VALUES(?,?,?,?,?)').run('amo-sync',userId,amo.rights.is_active?'amo_renamed':'amo_disabled',amo.id,now);
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='access_metadata'").get()){db.prepare('UPDATE access_metadata SET updated_at=?,version=version+1 WHERE user_id=?').run(now,userId);audit(db,'amo-sync',userId,'access.blocked.amo',{},now);}
  db.exec('COMMIT');return false;
 }catch(e){db.exec('ROLLBACK');throw e;}
}
