import {createHash,randomBytes,scrypt} from 'node:crypto';import {promisify} from 'node:util';
const derive=promisify(scrypt),digest=s=>createHash('sha256').update(s).digest('hex');
export function setupReset(db){db.exec(`CREATE TABLE IF NOT EXISTS password_resets(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),password_version TEXT NOT NULL,expires_at INTEGER NOT NULL);`);}
export function issueReset(db,userId,now=Date.now()){
 const u=db.prepare("SELECT id,password_hash FROM users WHERE id=? AND state='active'").get(userId);if(!u)throw Error('Активная учётная запись не найдена');
 const token=randomBytes(32).toString('hex'),expiresAt=now+3600000;
 db.exec('BEGIN IMMEDIATE');try{db.prepare('DELETE FROM password_resets WHERE user_id=? OR expires_at<=?').run(userId,now);db.prepare('INSERT INTO password_resets(token_hash,user_id,password_version,expires_at) VALUES(?,?,?,?)').run(digest(token),userId,digest(u.password_hash),expiresAt);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 return {token,expiresAt};
}
const invalid=()=>Object.assign(Error('Ссылка недействительна или истекла. Запросите новую ссылку.'),{status:400});
export async function resetPassword(db,input,now=Date.now()){
 if(typeof input?.token!=='string'||!/^[a-f0-9]{64}$/.test(input.token))throw invalid();
 if(typeof input.password!=='string'||input.password.length<12||input.password.length>128||input.password!==input.confirmPassword)throw Object.assign(Error('Пароли должны совпадать и содержать от 12 до 128 символов.'),{status:400});
 const key=digest(input.token),row=db.prepare("SELECT r.*,u.password_hash FROM password_resets r JOIN users u ON u.id=r.user_id WHERE r.token_hash=? AND r.expires_at>? AND u.state='active'").get(key,now);
 if(!row||row.password_version!==digest(row.password_hash))throw invalid();
 const salt=randomBytes(32).toString('hex'),bytes=await derive(input.password,salt,32,{N:32768,r:8,p:3,maxmem:40*1024*1024}),encoded=`scrypt$32768$8$3$${salt}$${bytes.toString('hex')}`;
 db.exec('BEGIN IMMEDIATE');try{
  const current=db.prepare("SELECT r.*,u.password_hash FROM password_resets r JOIN users u ON u.id=r.user_id WHERE r.token_hash=? AND r.expires_at>? AND u.state='active'").get(key,Math.max(now,Date.now()));
  if(!current||current.password_version!==digest(current.password_hash)||current.password_version!==row.password_version)throw invalid();
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(encoded,row.user_id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.user_id);
  db.prepare('DELETE FROM password_resets WHERE user_id=?').run(row.user_id);
  db.exec('COMMIT');return {ok:true};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
