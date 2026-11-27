import {setupAccess} from '../access.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {openStore} from '../store.mjs';
import {setupReset,resetPassword} from '../password-reset.mjs';
import {setupAccounts,createAccount,reconcileAccount,canManageAccounts,renewInvitation,updateAccount,listAccounts} from '../accounts.mjs';
import {createApp} from '../server.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const origin='https://b2b.n-smena.business';
const manager={id:'manager'},amo={id:123,name:'Тестовый сотрудник',rights:{is_active:true}};
const input={amoUserId:123,login:'test.manager',phone:'+79990000001'};
function fixture(){const dir=mkdtempSync(join(tmpdir(),'accounts-')),store=openStore(join(dir,'db'));setupReset(store.db);setupAccounts(store.db);seed(store.db);return {db:store.db,done(){store.db.close();rmSync(dir,{recursive:true,force:true});}};}
function seed(db){db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(manager.id,'sergey.karpov','Руководитель','invalid','active');db.prepare('INSERT INTO account_permissions VALUES(?,?)').run(manager.id,'accounts.manage');setupAccess(db);for(const p of ['admin.access.manage','platform.full_access','b2b.registry'])db.prepare('INSERT OR IGNORE INTO access_permissions VALUES(?,?)').run(manager.id,p);db.prepare('INSERT OR IGNORE INTO access_metadata(user_id,updated_at) VALUES(?,?)').run(manager.id,Date.now());}
function create(db,over={}){return createAccount(db,manager,{...input,...over},[amo],{origin});}
test('atomic creation binds immutable amo id, phone and phone-only access without manager permission',async()=>{const f=fixture();try{
 const r=create(f.db);assert.equal(r.scope,'own');assert.equal(canManageAccounts(f.db,r.id),false);assert.equal(f.db.prepare('SELECT amo_name FROM account_profiles WHERE user_id=?').get(r.id).amo_name,amo.name);
 assert.equal(f.db.prepare('SELECT count(*) n FROM password_resets').get().n,0);assert.equal(r.url,undefined);assert.equal(r.login,undefined);assert.throws(()=>renewInvitation(f.db,manager,r.id,origin),{status:410});
 }finally{f.done();}});
test('reject unauthorized actor and unknown/inactive amo identities',()=>{const f=fixture();try{
 assert.throws(()=>createAccount(f.db,{id:'intruder'},input,[amo],{origin}),{status:403});
 assert.throws(()=>createAccount(f.db,manager,input,[{...amo,rights:{is_active:false}}],{origin}),{status:409});
 assert.throws(()=>createAccount(f.db,manager,input,[{id:123,name:'X'}],{origin}),{status:502});
 assert.throws(()=>create(f.db,{amoUserId:456}),{status:409});assert.equal(f.db.prepare('SELECT count(*) n FROM users').get().n,1);
 }finally{f.done();}});
test('duplicate amo identity, login and normalized phone cannot create accounts',()=>{const f=fixture();try{
 create(f.db);assert.throws(()=>create(f.db),{status:409});
 const a={...amo,id:124,name:'Другой'};
 for(const i of [{...input,amoUserId:124,phone:'8 (999) 000-00-01'}])assert.throws(()=>createAccount(f.db,manager,i,[a],{origin}),{status:409});
 assert.equal(f.db.prepare('SELECT count(*) n FROM account_profiles').get().n,1);
 }finally{f.done();}});
test('rename revokes all sessions, links, Telegram identity and permissions; frees amo id for new user',()=>{const f=fixture();try{
 const old=create(f.db);f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('session',old.id,Date.now()+10000);
 f.db.prepare('INSERT INTO account_permissions VALUES(?,?)').run(old.id,'accounts.manage');
 f.db.prepare('UPDATE telegram_members SET telegram_id=? WHERE user_id=?').run('1234',old.id);
 assert.equal(reconcileAccount(f.db,old.id,{...amo,name:'Новый сотрудник'}),false);
 assert.equal(f.db.prepare('SELECT state FROM users WHERE id=?').get(old.id).state,'blocked');
 for(const table of ['sessions','password_resets','account_permissions'])assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table} WHERE user_id=?`).get(old.id).n,0);
 assert.equal(reconcileAccount(f.db,old.id,amo),false); // A reverted name never reactivates old credentials.
 const next=createAccount(f.db,manager,{...input,phone:'+79990000002'},[{...amo,name:'Новый сотрудник'}],{origin});assert.notEqual(next.id,old.id);assert.equal(f.db.prepare('SELECT count(*) n FROM account_profiles').get().n,2);
 assert.throws(()=>createAccount(f.db,manager,{...input,login:'test.manager'},[{...amo,id:125,name:'Третий'}],{origin}));
 }finally{f.done();}});
test('unchanged amo user stays active; uncertain response does not mutate; disabled user blocked',()=>{const f=fixture();try{
 const r=create(f.db);assert.equal(reconcileAccount(f.db,r.id,amo),true);assert.throws(()=>reconcileAccount(f.db,r.id,{}),{status:503});assert.equal(f.db.prepare('SELECT state FROM users WHERE id=?').get(r.id).state,'active');assert.equal(reconcileAccount(f.db,r.id,{...amo,rights:{is_active:false}}),false);
 }finally{f.done();}});
test('renewal invalidates previous setup link, cannot reset existing manager',()=>{const f=fixture();try{
 const r=create(f.db);assert.throws(()=>renewInvitation(f.db,manager,r.id,origin),{status:410});assert.equal(f.db.prepare('SELECT count(*) n FROM password_resets').get().n,0);
 }finally{f.done();}});
test('transaction failure leaves no partial user or phone',()=>{const f=fixture();try{
 f.db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON account_audit BEGIN SELECT RAISE(ABORT, 'test failure'); END");assert.throws(()=>create(f.db));assert.equal(f.db.prepare('SELECT count(*) n FROM users').get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM telegram_members').get().n,0);
 }finally{f.done();}});
test('HTTP: own lead filtering applies to all mutations/history/export; rename kills sessions on next request; outage fails closed',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'accounts-http-'));let current={...amo},offline=false;
 const app=createApp({dataDir:dir,origin,autoSync:false,token:'synthetic-token',transport:async url=>{
 if(offline)throw Error('offline');return Response.json(url.includes('/users/123')?current:{_embedded:{users:[current]}});
 }});seed(app.store.db);const member=create(app.store.db),session='a'.repeat(64),adminSession='b'.repeat(64);
 app.store.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(session),member.id,Date.now()+100000);
 app.store.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(adminSession),manager.id,Date.now()+100000);
 app.store.saveLeads([1,2].map(id=>({id,name:'Lead '+id,status:'Новая заявка',createdAt:new Date().toISOString(),statusId:1,pipelineId:1,raw:{responsible_user_id:id===1?123:456}})),Date.now());
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 const call=(path,body,s=session)=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Cookie:'__Host-b2b_session='+s,Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 try{
 assert.deepEqual((await (await call('/api/state')).json()).leads.map(x=>x.id),[1]);
 assert.equal((await call('/api/accounts/update',{userId:manager.id})).status,403);
 assert.equal((await call('/api/accounts')).status,403);assert.equal((await call('/api/accounts',input)).status,403);
 assert.equal((await call('/api/history?id=2')).status,404);
 for(const [path,body] of [['comment',{id:2,body:'bad',version:0}],['takeover-time',{id:2,minutes:10,version:0}],['lead-timestamp',{id:2,field:'takenAt',timestamp:null,version:0}],['lead-flag',{id:2,field:'reason',value:true,version:0}]])assert.equal((await call('/api/'+path,body)).status,404);
 assert.deepEqual((await (await call('/api/export',{ids:[1,2],format:'json'})).json()).leads.map(x=>x.id),[1]);
 assert.equal((await call('/api/comment',{id:1,body:'allowed',version:0})).status,200);
 assert.equal((await call('/api/accounts/amo-users',undefined,adminSession)).status,200);
 offline=true;assert.equal((await call('/api/state')).status,503);assert.equal((await call('/api/comment',{id:1,body:'offline',version:1})).status,503);
 offline=false;current={...amo,name:'Replaced'};assert.equal((await call('/api/state')).status,401);assert.equal((await call('/api/state')).status,401);
 const accounts=await (await call('/api/accounts',undefined,adminSession)).json();assert.equal(accounts.accounts.find(a=>a.id===member.id).state,'blocked');
 }finally{await new Promise(r=>app.server.close(r));rmSync(dir,{recursive:true,force:true});}
});

function edit(db,id,over={}){const a=listAccounts(db).find(u=>u.id===id);return updateAccount(db,manager,{userId:id,editVersion:a.editVersion,name:a.name,login:a.login,phone:a.phone,scope:a.scope,...over});}
test('editing name preserves amo identity; phone update revokes Telegram, codes, sessions and reset links but keeps password',()=>{const f=fixture();try{
 const r=create(f.db),oldHash=f.db.prepare('SELECT password_hash FROM users WHERE id=?').get(r.id).password_hash;
 f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('session',r.id,Date.now()+10000);
 f.db.prepare('UPDATE telegram_members SET telegram_id=?,verified_at=? WHERE user_id=?').run('1234',123,r.id);
 edit(f.db,r.id,{name:'Имя в B2B'});
 assert.equal(f.db.prepare('SELECT amo_name FROM account_profiles WHERE user_id=?').get(r.id).amo_name,amo.name);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=?').get(r.id).n,1);
 assert.equal(reconcileAccount(f.db,r.id,amo),true);
 const result=edit(f.db,r.id,{phone:'8 (999) 000-00-02',login:'changed.login',scope:'all'});
 assert.equal(result.phoneChanged,true);assert.equal(result.account.scope,'all');
 assert.deepEqual({...f.db.prepare('SELECT phone,telegram_id,verified_at FROM telegram_members WHERE user_id=?').get(r.id)},{phone:'+79990000002',telegram_id:null,verified_at:null});
 for(const t of ['sessions','password_resets','telegram_challenges'])assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE user_id=?`).get(r.id).n,0);
 assert.equal(f.db.prepare('SELECT password_hash FROM users WHERE id=?').get(r.id).password_hash,oldHash);
 assert.equal(reconcileAccount(f.db,r.id,{...amo,name:'Другой сотрудник'}),false);
 }finally{f.done();}});
test('no-op and scope-only edit preserve verified Telegram; self change asks for reauthentication',()=>{const f=fixture();try{
 const r=create(f.db);f.db.prepare('UPDATE telegram_members SET telegram_id=?,verified_at=? WHERE user_id=?').run('1234',123,r.id);
 const before=f.db.prepare('SELECT COUNT(*) n FROM account_audit').get().n;
 assert.equal(edit(f.db,r.id).changed,false);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM account_audit').get().n,before);
 edit(f.db,r.id,{scope:'all'});assert.equal(f.db.prepare('SELECT telegram_id FROM telegram_members WHERE user_id=?').get(r.id).telegram_id,'1234');
 assert.equal(edit(f.db,manager.id,{phone:'+79990000003',login:'manager.new'}).reauthenticate,true);
 assert.equal(canManageAccounts(f.db,manager.id),true);
 }finally{f.done();}});
test('edit rejects stale state, duplicates, invalid data, permission escalation and blocked identities atomically',()=>{const f=fixture();try{
 const r=create(f.db),stale=listAccounts(f.db).find(u=>u.id===r.id);
 edit(f.db,r.id,{name:'Переименован'});
 assert.throws(()=>edit(f.db,r.id,{editVersion:stale.editVersion}),{status:409});
 for(const over of [{name:'Руководитель'}])assert.throws(()=>edit(f.db,r.id,over),{status:409});
 for(const over of [{scope:'admin'},{phone:'123'},{name:''},{amoUserId:999},{state:'active'}])assert.throws(()=>edit(f.db,r.id,over),{status:400});
 assert.throws(()=>updateAccount(f.db,{id:r.id},{userId:manager.id}),{status:403});
 assert.throws(()=>edit(f.db,manager.id,{phone:'+79990000003',scope:'own'}),{status:400});
 f.db.exec("CREATE TRIGGER reject_edit BEFORE INSERT ON account_audit WHEN NEW.action LIKE 'updated:%' BEGIN SELECT RAISE(ABORT, 'test'); END");
 assert.throws(()=>edit(f.db,r.id,{name:'Не сохранено'}));assert.equal(f.db.prepare('SELECT name FROM users WHERE id=?').get(r.id).name,'Переименован');
 f.db.exec('DROP TRIGGER reject_edit');reconcileAccount(f.db,r.id,{...amo,name:'replacement'});assert.throws(()=>edit(f.db,r.id,{phone:'+79990000004'}),{status:409});
 }finally{f.done();}});
test('legacy login cannot be changed through account editing; duplicate phone is rejected',()=>{const f=fixture();try{
 const r=create(f.db),original=f.db.prepare('SELECT login FROM users WHERE id=?').get(r.id).login;edit(f.db,r.id,{login:'new.login'});assert.equal(f.db.prepare('SELECT login FROM users WHERE id=?').get(r.id).login,original);
 const other={id:124,name:'Другой сотрудник',rights:{is_active:true}};const next=createAccount(f.db,manager,{amoUserId:124,phone:'+79990000005'},[other],{origin});assert.throws(()=>edit(f.db,next.id,{phone:input.phone}),{status:409});
 }finally{f.done();}});
test('HTTP edit validates origin and identity, persists allowed fields, rejects stale writes and revokes access',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'account-edit-http-'));let current={...amo};
 const app=createApp({dataDir:dir,origin,autoSync:false,token:'synthetic',transport:async()=>Response.json(current)});
 seed(app.store.db);const member=create(app.store.db),session='c'.repeat(64),memberSession='d'.repeat(64);
 for(const [token,id] of [[session,manager.id],[memberSession,member.id]])app.store.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token),id,Date.now()+100000);
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 const request=(payload,site=origin)=>fetch(base+'/api/accounts/update',{method:'POST',headers:{Cookie:'__Host-b2b_session='+session,Origin:site,'Content-Type':'application/json'},body:JSON.stringify(payload)});
 try{
  const account=listAccounts(app.store.db).find(u=>u.id===member.id),payload={userId:member.id,editVersion:account.editVersion,name:account.name,login:'new.http.login',phone:account.phone,scope:'all'};
  assert.equal((await request(payload,'https://bad.example')).status,403);
  const response=await request(payload);assert.equal(response.status,200);assert.equal((await response.json()).account.scope,'all');
  assert.equal((await request(payload)).status,409);
  assert.equal((await fetch(base+'/api/state',{headers:{Cookie:'__Host-b2b_session='+memberSession}})).status,401);
  current={...amo,name:'replacement'};assert.equal((await request({...payload,editVersion:listAccounts(app.store.db).find(u=>u.id===member.id).editVersion})).status,401);
 }finally{await new Promise(r=>app.server.close(r));rmSync(dir,{recursive:true,force:true});}
});
test('standalone account gets full registry but no administrator rights; invitation and edits work without amo identity',async()=>{const f=fixture();try{
 const r=createAccount(f.db,manager,{amoUserId:null,name:'Локальный пользователь',login:'local.user',phone:'+79990000006'},[],{origin,scope:'all'});
 assert.equal(r.amoUserId,null);assert.equal(r.scope,'all');assert.equal(canManageAccounts(f.db,r.id),false);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM account_profiles WHERE user_id=?').get(r.id).n,0);
 assert.equal(reconcileAccount(f.db,r.id,null),true);assert.throws(()=>renewInvitation(f.db,manager,r.id,origin),{status:410});
 edit(f.db,r.id,{name:'Новое локальное имя'});assert.equal(listAccounts(f.db).find(u=>u.id===r.id).name,'Новое локальное имя');
 assert.throws(()=>createAccount(f.db,manager,{amoUserId:null,login:'no.name',phone:'+79990000007'},[],{origin,scope:'all'}),{status:400});
 assert.throws(()=>createAccount(f.db,manager,{amoUserId:null,name:'Ограниченный',login:'no.scope',phone:'+79990000007'},[],{origin,scope:'own'}),{status:400});
 }finally{f.done();}});
test('unlink archives original amo identity, preserves credentials and admin rights, revokes sessions and frees amo slot',()=>{const f=fixture();try{
 const r=create(f.db);edit(f.db,r.id,{scope:'all'});
 f.db.prepare('INSERT INTO account_permissions VALUES(?,?)').run(r.id,'accounts.manage');f.db.prepare("INSERT INTO access_permissions VALUES(?,'admin.access.manage')").run(r.id);
 f.db.prepare('UPDATE telegram_members SET telegram_id=?,verified_at=? WHERE user_id=?').run('4321',123,r.id);
 f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('session',r.id,Date.now()+10000);
 const user=f.db.prepare('SELECT * FROM users WHERE id=?').get(r.id),tg=f.db.prepare('SELECT * FROM telegram_members WHERE user_id=?').get(r.id);
 const result=edit(f.db,r.id,{withoutAmo:true,scope:'all'});
 assert.equal(result.changed,true);assert.equal(result.account.amoUserId,null);assert.equal(result.account.scope,'all');assert.equal(canManageAccounts(f.db,r.id),true);
 assert.deepEqual(f.db.prepare('SELECT * FROM users WHERE id=?').get(r.id),user);assert.deepEqual(f.db.prepare('SELECT * FROM telegram_members WHERE user_id=?').get(r.id),tg);
 assert.equal(JSON.parse(f.db.prepare('SELECT profile_json FROM account_profile_history WHERE user_id=?').get(r.id).profile_json).amo_user_id,123);
 for(const t of ['sessions','password_resets','telegram_challenges'])assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE user_id=?`).get(r.id).n,0);
 assert.equal(reconcileAccount(f.db,r.id,{...amo,name:'Replacement'}),true);
 assert.equal(edit(f.db,r.id,{withoutAmo:true}).changed,false);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM account_profile_history').get().n,1);
 const newAmo={...amo,name:'Replacement'};
 assert.ok(createAccount(f.db,manager,{amoUserId:123,login:'replacement',phone:'+79990000007'},[newAmo],{origin}).id);
 }finally{f.done();}});
test('unlink handles legacy accounts without phone and refuses blocked or invalid detach requests',()=>{const f=fixture();try{
 const r=create(f.db);f.db.prepare('DELETE FROM telegram_members WHERE user_id=?').run(r.id);
 assert.throws(()=>edit(f.db,r.id,{withoutAmo:'yes',scope:'all'}),{status:400});
 assert.throws(()=>edit(f.db,r.id,{withoutAmo:true,scope:'own'}),{status:400});
 assert.throws(()=>edit(f.db,r.id,{withoutAmo:true,scope:'all',phone:'bad'}),{status:400});
 assert.equal(edit(f.db,r.id,{withoutAmo:true,scope:'all',phone:''}).account.amoUserId,null);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM telegram_members WHERE user_id=?').get(r.id).n,0);
 assert.throws(()=>edit(f.db,r.id,{withoutAmo:false}),{status:400});
 }finally{f.done();}});
test('unlink transaction rolls back profile archive and preserves access when audit fails',()=>{const f=fixture();try{
 const r=create(f.db);f.db.exec("CREATE TRIGGER fail_unlink BEFORE INSERT ON account_audit WHEN NEW.action LIKE '%amo_detached%' BEGIN SELECT RAISE(ABORT,'fail'); END");
 assert.throws(()=>edit(f.db,r.id,{withoutAmo:true,scope:'all'}));
 assert.equal(listAccounts(f.db).find(u=>u.id===r.id).amoUserId,123);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM account_profile_history').get().n,0);
 f.db.exec('DROP TRIGGER fail_unlink');reconcileAccount(f.db,r.id,{...amo,name:'replacement'});
 assert.throws(()=>edit(f.db,r.id,{withoutAmo:true,scope:'all'}),{status:409});
 }finally{f.done();}});
