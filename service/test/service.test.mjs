import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,symlinkSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomBytes,scryptSync} from 'node:crypto';
import {openStore} from '../store.mjs';
import {normalizeLead,runSync,PIPELINE,ENTRY,FIELD,AmoClient} from '../amo.mjs';
import {csv,fullRow} from '../export.mjs';
import {createApp,verifyPassword} from '../server.mjs';
import {seal,unseal} from '../secrets.mjs';
const raw=(id,status=ENTRY)=>({id,name:'Заявка '+id,created_at:1780000000,updated_at:1790000000,responsible_user_id:1,pipeline_id:PIPELINE,status_id:status,price:0,custom_fields_values:[{field_id:FIELD.quotas,field_name:'[п-т] Кол-во людей',values:[{value:'6'}]},{field_id:FIELD.category,field_name:'Квалификация',values:[{value:'3-категория'}]},{field_id:123,field_name:'Необычное поле',values:[{value:false},{value:0}]}],_embedded:{contacts:[{id:2}],tags:[{id:1,name:'квал'}]}});
const ctx={users:new Map([[1,{name:'Менеджер'}]]),statuses:new Map([[PIPELINE+':'+ENTRY,'Новая заявка'],[PIPELINE+':142','Успешно']]),contacts:new Map([[2,{id:2,name:'Клиент',custom_fields_values:[{field_id:100,field_name:'Телефон',values:[{value:'+70000000000'}]}]}]]),companies:new Map()};
const lead=(id,status)=>normalizeLead(raw(id,status),ctx);
function temp(){return mkdtempSync(join(tmpdir(),'b2b-test-'));}
test('people count uses field 1064481 independently of quota shifts',()=>{
 const r=raw(1);r.custom_fields_values=[{field_id:1064481,field_name:'[п-т] Кол-во людей',values:[{value:'3'}]},{field_id:1064487,field_name:'[п-т] Моб: Квото-смен:',values:[{value:'60'}]}];
 const l=normalizeLead(r,ctx);assert.equal(FIELD.quotas,1064481);assert.equal(l.quotas,3);assert.equal(fullRow(l)['Количество людей'],3);
 r.custom_fields_values=r.custom_fields_values.filter(f=>f.field_id!==1064481);assert.equal(normalizeLead(r,ctx).quotas,null);
});
test('snapshot keeps all filled fields and contacts; exports preserve zero and false and escape spreadsheet formulas',()=>{
 const l=lead(1);l.comment='=HYPERLINK("bad")';assert.equal(l.quotas,6);assert.equal(l.category,'3-категория');assert.equal(l.raw.price,0);assert.equal(l.contacts[0].name,'Клиент');const r=fullRow(l);assert.equal(r['Сделка: Необычное поле [123]'],'false | 0');assert.equal(r['Контакт 1: Телефон [100]'],'+70000000000');const c=csv([l]);assert.match(c,/Необычное поле/);assert.match(c,/'=HYPERLINK/);assert.match(c,/'\+70000000000/);
});
test('comments survive amo status update, stale writers rejected, persistence after reopen',()=>{
 const dir=temp(),file=join(dir,'data.sqlite');let s=openStore(file);try{s.saveLeads([lead(1)],Date.now());s.saveComment(1,'Проверить договор',0,'РОП');s.saveLeads([lead(1,142)],Date.now());assert.equal(s.all()[0].comment,'Проверить договор');assert.equal(s.all()[0].status,'Успешно');assert.throws(()=>s.saveComment(1,'Старый текст',0,'Другой'),{status:409});s.db.close();s=openStore(file);assert.equal(s.all()[0].commentVersion,1);assert.equal(s.db.prepare('SELECT count(*) AS n FROM comment_history').get().n,1);}finally{s.db.close();rmSync(dir,{recursive:true,force:true});}
});
test('sync collects a lead that has already left entry stage between polls, with atomic cursor and no comment loss',async()=>{
 const dir=temp(),s=openStore(join(dir,'db.sqlite'));try{
 const client={list:async(path,key)=>key==='pipelines'?[{id:PIPELINE,_embedded:{statuses:[{id:ENTRY,name:'Новая заявка'},{id:142,name:'Успешно'}]}}]:key==='users'?[{id:1,name:'Менеджер'}]:key==='custom_fields'?[]:key==='leads'?[raw(1)]:key==='events'?[{entity_id:2}]:[],byIds:async(kind,ids)=>kind==='leads'?ids.map(id=>raw(id,id===2?142:ENTRY)):kind==='contacts'?[ctx.contacts.get(2)]:[]};
 await runSync(s,client);assert.deepEqual(s.all().map(l=>l.id).sort(),[1,2]);assert.equal(s.all().find(l=>l.id===2).status,'Успешно');s.saveComment(2,'Закрыто',0,'РОП');const cursor=s.get('cursor');client.byIds=async()=>{throw Error('offline');};await assert.rejects(()=>runSync(s,client));assert.equal(s.get('cursor'),cursor);assert.equal(s.all().find(l=>l.id===2).comment,'Закрыто');
 }finally{s.db.close();rmSync(dir,{recursive:true,force:true});}
});
test('amo pagination limit fails rather than committing a partial collection; token is never sent to a redirect target',async()=>{
 let calls=[];const c=new AmoClient('private-token',async(url,opts)=>{calls.push({url,opts});return Response.json({_embedded:{leads:[raw(1)]},_links:{next:{href:'https://elsewhere.invalid'}}});});await assert.rejects(()=>c.list('/api/v4/leads','leads',250,1));assert.equal(calls.length,1);assert.equal(calls[0].opts.redirect,'manual');assert.equal(calls[0].url.startsWith('https://gruz4ikimoskva.amocrm.ru/'),true);
});
test('secret encryption detects modification',()=>{const key=randomBytes(32).toString('hex'),encrypted=seal({token:'secret'},key);assert.equal(unseal(encrypted,key).token,'secret');const p=JSON.parse(encrypted);p.tag='0'.repeat(32);assert.throws(()=>unseal(JSON.stringify(p),key));});
test('production entrypoint starts through a release symlink',async()=>{
 const dir=temp(),link=join(dir,'current.mjs');symlinkSync(fileURLToPath(new URL('../server.mjs',import.meta.url)),link);
 const child=spawn(process.execPath,[link],{env:{...process.env,PORT:'0',B2B_DATA_DIR:dir,B2B_ORIGIN:'http://127.0.0.1',B2B_NO_SYNC:'1'},stdio:['ignore','pipe','pipe']});
 try{const port=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('No startup signal')),5000);child.stdout.on('data',chunk=>{const m=String(chunk).match(/loopback port (\d+)/);if(m){clearTimeout(timeout);resolve(Number(m[1]));}});child.once('exit',code=>{clearTimeout(timeout);reject(Error('Early exit '+code));});});assert.equal((await fetch('http://127.0.0.1:'+port+'/healthz')).status,200);}finally{child.kill('SIGTERM');await new Promise(r=>child.once('close',r));rmSync(dir,{recursive:true,force:true});}
});
test('existing scrypt hashes work with Node crypto',async()=>{const salt=randomBytes(32).toString('hex'),password='Synthetic test passphrase 2026',derived=scryptSync(password,salt,32,{N:32768,r:8,p:3,maxmem:40*1024*1024});const stored=`scrypt$32768$8$3$${salt}$${derived.toString('hex')}`;assert.equal(await verifyPassword(password,stored),true);assert.equal(await verifyPassword('wrong',stored),false);assert.equal(await verifyPassword(password,null),false);});
test('HTTP authentication, origin protection, durable comment, export authorization',async()=>{
 const dir=temp(),app=createApp({dataDir:dir,origin:'https://b2b.example.test',autoSync:false});const salt=randomBytes(32).toString('hex'),password='Synthetic test passphrase 2026',encoded=scryptSync(password,salt,32,{N:32768,r:8,p:3,maxmem:40*1024*1024}).toString('hex');app.store.db.prepare('INSERT INTO users(id,login,name,password_hash) VALUES(?,?,?,?)').run('u1','manager','Руководитель',`scrypt$32768$8$3$${salt}$${encoded}`);app.store.saveLeads([lead(1)],Date.now());
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+app.server.address().port;
 const post=(path,body,cookie,origin='https://b2b.example.test')=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
 try{
 assert.equal((await fetch(url+'/api/state')).status,401);assert.equal((await post('/api/login',{login:'manager',password},null,'https://evil.test')).status,403);
 assert.equal((await post('/api/login',{login:'manager',password})).status,410);
 for(const p of ['platform.full_access','b2b.registry'])app.store.db.prepare('INSERT INTO access_permissions VALUES(?,?)').run('u1',p);
 const t='e'.repeat(64);app.store.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(t).digest('hex'),'u1',Date.now()+100000);const cookie='__Host-b2b_session='+t;
 const before=await (await fetch(url+'/api/state',{headers:{Cookie:cookie.split(';')[0]}})).json();assert.equal(before.leads.length,1);
 assert.equal((await post('/api/comment',{id:1,body:'Новый комментарий',version:0},cookie)).status,200);assert.equal((await post('/api/comment',{id:1,body:'Конфликт',version:0},cookie)).status,409);
 const exp=await post('/api/export',{ids:[1],format:'json'},cookie);assert.equal(exp.status,200);const data=await exp.json();assert.equal(data.leads[0].comment,'Новый комментарий');assert.equal(data.leads[0].raw.custom_fields_values.length,3);
 await post('/api/logout',{},cookie);assert.equal((await fetch(url+'/api/state',{headers:{Cookie:cookie}})).status,401);
 }finally{await new Promise(r=>app.server.close(r));rmSync(dir,{recursive:true,force:true});}
});
