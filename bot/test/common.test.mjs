import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openBotStore} from '../legacy-b2b.mjs';
import {servicesFromEnv,setupRouter,enqueueMessage,flushJobs,createCommonServer,polling} from '../common.mjs';
import {signedHeaders as kaitenHeaders} from '../kaiten-protocol.mjs';
import {signedHeaders as b2bHeaders} from '../protocol.mjs';

const services=[{id:'b2b',label:'B2B',origin:'https://b2b.test',protocol:2,key:'11'.repeat(32)},{id:'kaiten-test',label:'Kaiten · тест',origin:'https://test-kaiten.test',key:'22'.repeat(32)}];
function fixture(){const dir=mkdtempSync(join(tmpdir(),'common-bot-test-')),db=openBotStore(dir);setupRouter(db);return {db,close(){db.close();rmSync(dir,{recursive:true,force:true});}};}
const message=(id=1,extra={})=>({message_id:id,chat:{id:123,type:'private'},from:{id:123,is_bot:false},...extra});
test('deployed B2B registration protocol 2 is the default; legacy 1 requires explicit configuration',()=>{
 const env={B2B_ORIGIN:services[0].origin,BRIDGE_KEY:services[0].key};
 assert.equal(servicesFromEnv(env)[0].protocol,2);
 assert.equal(servicesFromEnv({...env,B2B_API_PROTOCOL:'1'})[0].protocol,1);
});
test('separate keys and origins are mandatory',()=>{
 assert.equal(servicesFromEnv({B2B_ORIGIN:services[0].origin,BRIDGE_KEY:services[0].key,KAITEN_TEST_ORIGIN:services[1].origin,KAITEN_TEST_BRIDGE_KEY:services[1].key}).length,2);
 assert.throws(()=>servicesFromEnv({B2B_ORIGIN:services[0].origin,BRIDGE_KEY:services[0].key,KAITEN_TEST_ORIGIN:services[1].origin,KAITEN_TEST_BRIDGE_KEY:services[0].key}));
});
test('start asks for service; explicit start routes only to Kaiten',()=>{
 const f=fixture();try{
  assert.equal(enqueueMessage(f.db,services,message(1,{text:'/start'})).reply_markup.keyboard.length,2);
  enqueueMessage(f.db,services,message(2,{text:'/start kaiten-test'}));
  enqueueMessage(f.db,services,message(3,{contact:{user_id:123,phone_number:'+79990000123'}}));
  const jobs=f.db.prepare('SELECT * FROM service_jobs').all();assert.equal(jobs.length,2);assert.ok(jobs.every(j=>j.service==='kaiten-test'));assert.equal(JSON.parse(jobs[0].message).text,'/start');
 }finally{f.close();}
});
test('private own contact only; no forwarded contact reaches either backend',()=>{
 const f=fixture();try{
  enqueueMessage(f.db,services,message(1,{chat:{id:-1,type:'group'},text:'/start kaiten-test'}));
  const result=enqueueMessage(f.db,services,message(2,{contact:{user_id:999,phone_number:'+79990000123'}}));
  assert.match(result.text,/собственный/);assert.equal(f.db.prepare('SELECT count(*) n FROM service_jobs').get().n,0);
 }finally{f.close();}
});
test('legacy users without selected service continue to B2B',()=>{
 const f=fixture();try{enqueueMessage(f.db,services,message(1,{text:'Иванов Иван'}));assert.equal(f.db.prepare('SELECT service FROM service_jobs').get().service,'b2b');}finally{f.close();}
});
test('a failed Kaiten job does not block B2B; per-user message order is retained',async()=>{
 const f=fixture(),sent=[],calls=[];try{
  enqueueMessage(f.db,services,message(1,{text:'/start kaiten-test'}));enqueueMessage(f.db,services,message(2,{text:'Контакт'}));enqueueMessage(f.db,services,message(3,{text:'/start b2b'}));
  const clients=new Map([['kaiten-test',async()=>{calls.push('kaiten');throw Error('down');}],['b2b',async()=>{calls.push('b2b');return {text:'B2B работает'};}]]);
  await flushJobs(f.db,services,clients,async(method,b)=>sent.push(b));
  assert.deepEqual(calls,['kaiten','b2b']);assert.equal(sent[0].text,'B2B работает');
  const pending=f.db.prepare("SELECT * FROM service_jobs WHERE state='pending'").all();assert.equal(pending.length,2);
 }finally{f.close();}
});
test('duplicate update is one job; processed job drops contact payload',async()=>{
 const f=fixture();try{
  enqueueMessage(f.db,services,message(1,{text:'/start kaiten-test'}));enqueueMessage(f.db,services,message(1,{text:'/start kaiten-test'}));
  assert.equal(f.db.prepare('SELECT count(*) n FROM service_jobs').get().n,1);
  await flushJobs(f.db,services,new Map([['kaiten-test',async()=>({text:'Готово'})]]),async()=>{});
  assert.equal(f.db.prepare('SELECT message FROM service_jobs').get().message,'{}');
 }finally{f.close();}
});
async function serverFixture(run){
 const f=fixture(),sent=[],server=createCommonServer({db:f.db,services,api:async(method,b)=>{sent.push(b);return {};}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 try{await run({f,sent,origin});}finally{await new Promise(r=>server.close(r));f.close();}
}
async function post(origin,path,raw,headers){return fetch(origin+path,{method:'POST',headers,body:raw});}
test('B2B protocol 2 remains backward compatible; Kaiten health is isolated protocol 3',async()=>serverFixture(async({origin})=>{
 let path='/bridge/health',raw='{}';let r=await post(origin,path,raw,b2bHeaders(services[0].key,path,raw));assert.equal((await r.json()).protocol,2);
 path='/bridge/kaiten-test/health';r=await post(origin,path,raw,kaitenHeaders(services[1].key,'kaiten-test',path,raw));assert.equal(r.status,200);const health=await r.json();assert.equal(health.protocol,3);assert.equal(health.origin,services[1].origin);
 r=await post(origin,path,raw,b2bHeaders(services[0].key,path,raw));assert.equal(r.status,401);
 r=await post(origin,path,raw,kaitenHeaders(services[0].key,'kaiten-test',path,raw));assert.equal(r.status,401);
 r=await post(origin,path,raw,kaitenHeaders(services[1].key,'kaiten',path,raw));assert.equal(r.status,401);
}));
test('OTP is sent once, is labelled Kaiten and is never persisted in bot database',async()=>serverFixture(async({origin,sent,f})=>{
 const path='/bridge/kaiten-test/code',payload={chatId:'123',requestId:'ab'.repeat(32),code:'654321',expiresAt:Date.now()+600000},raw=JSON.stringify(payload);
 let r=await post(origin,path,raw,kaitenHeaders(services[1].key,'kaiten-test',path,raw));assert.equal(r.status,200);
 r=await post(origin,path,raw,kaitenHeaders(services[1].key,'kaiten-test',path,raw));assert.equal(r.status,200);assert.equal(sent.length,1);assert.match(sent[0].text,/Kaiten/);assert.ok(!sent[0].text.includes('B2B'));assert.equal(sent[0].protect_content,true);
 assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM bot_delivery_ids').all()).includes('654321'));
}));
test('signed replay and expired OTP are rejected',async()=>serverFixture(async({origin})=>{
 const path='/bridge/kaiten-test/health',raw='{}',headers=kaitenHeaders(services[1].key,'kaiten-test',path,raw);
 assert.equal((await post(origin,path,raw,headers)).status,200);assert.equal((await post(origin,path,raw,headers)).status,401);
 const p='/bridge/kaiten-test/code',body=JSON.stringify({chatId:'123',requestId:'cd'.repeat(32),code:'111111',expiresAt:Date.now()-1});
 assert.equal((await post(origin,p,body,kaitenHeaders(services[1].key,'kaiten-test',p,body))).status,400);
}));

test('B2B protocol 1 keeps existing contact flow and cannot create registrations',async()=>{
 const f=fixture(),old=[{...services[0],protocol:1},services[1]],calls=[],sent=[];try{
  enqueueMessage(f.db,old,message(1,{text:'/start b2b'}));enqueueMessage(f.db,old,message(2,{contact:{user_id:123,phone_number:'+79990000123'}}));
  await flushJobs(f.db,old,new Map([['b2b',async(path)=>{calls.push(path);return {bound:true};}]]),async(method,b)=>sent.push(b));
  assert.deepEqual(calls,['/api/telegram-bridge/contact']);assert.match(sent[0].text,/подтвердите/);assert.match(sent[1].text,/подтверждён/);
 }finally{f.close();}
});
test('B2B protocol 1 health remains 1 alongside new Kaiten protocol 3',async()=>{
 const f=fixture(),old=[{...services[0],protocol:1},services[1]],server=createCommonServer({db:f.db,services:old,api:async()=>{}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));try{
  const origin='http://127.0.0.1:'+server.address().port,path='/bridge/health',raw='{}';
  const r=await post(origin,path,raw,b2bHeaders(old[0].key,path,raw));assert.equal((await r.json()).protocol,1);
 }finally{await new Promise(r=>server.close(r));f.close();}
});
test('Kaiten HMAC agrees with the Python UTF-8 reference vector',async()=>{
 const {authenticate}=await import('../kaiten-protocol.mjs');const f=fixture();try{
  const raw='{"message":"Привет","code":"123456"}',path='/bridge/kaiten-test/code';
  assert.doesNotThrow(()=>authenticate(f.db,services[1],path,raw,{'x-kaiten-service':'kaiten-test','x-kaiten-time':'1800000000','x-kaiten-nonce':'ab'.repeat(16),'x-kaiten-signature':'143c36252a254f53b568f635740f6189729c1ff3f653ab9388e0dc4ff3ed48a1'},1800000000000));
 }finally{f.close();}
});

test('a Telegram poller conflict stops the new process instead of competing',async()=>{
 const f=fixture();try{await assert.rejects(polling({db:f.db,services,clients:new Map(),api:async()=>{throw Object.assign(Error('conflict'),{telegramCode:409});}}),/Another Telegram poller/);}finally{f.close();}
});

test('an accidentally replied OTP is not persisted as a registration job',()=>{
 const f=fixture();try{const result=enqueueMessage(f.db,services,message(1,{text:'123456'}));assert.match(result.text,/только на сайте/);assert.equal(f.db.prepare('SELECT count(*) n FROM service_jobs').get().n,0);}finally{f.close();}
});
