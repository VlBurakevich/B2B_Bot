import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:http';
import {signedHeaders,authenticate,setupNonces,bridgeClient,validateOrigin} from '../protocol.mjs';
import {createBotServer,handleMessage,runPolling} from '../bot.mjs';
import {telegramClient} from '../telegram.mjs';
import {createRemoteBridge} from '../../b2b-patch/telegram-bridge.mjs';
import {setupTelegram,assignPhone,createTelegramAuth} from '../../b2b-patch/telegram-auth.mjs';
const key='ab'.repeat(32),phone='+79990000001',userId=101;
function dbFixture(t){const db=new DatabaseSync(':memory:');db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY,login TEXT,name TEXT,password_hash TEXT,state TEXT); CREATE TABLE sessions(hash TEXT,user_id TEXT,expires_at INTEGER); CREATE TABLE bot_delivery_ids(id TEXT PRIMARY KEY,expires_at INTEGER,state TEXT);CREATE TABLE bot_meta(key TEXT PRIMARY KEY,value TEXT);");setupNonces(db);setupTelegram(db);db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run('u1','fixture','Fixture','hash','active');t.after(()=>db.close());return db;}
const contact=()=>({chat:{id:userId,type:'private'},from:{id:userId,is_bot:false},contact:{user_id:userId,phone_number:phone}});
async function listen(t,server){await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});t.after(()=>new Promise(r=>server.close(r)));return 'http://127.0.0.1:'+server.address().port;}
const lower=h=>Object.fromEntries(Object.entries(h).map(([k,v])=>[k.toLowerCase(),v]));
test('signature enforces key, exact path, exact body, clock and replay protection',t=>{
 const db=dbFixture(t),path='/bridge/code',body='{"fixture":true}',now=Date.now(),h=lower(signedHeaders(key,path,body,now));
 assert.throws(()=>authenticate(db,key,path,body+' ',h,now));assert.throws(()=>authenticate(db,key,'/bridge/health',body,h,now));assert.throws(()=>authenticate(db,'cd'.repeat(32),path,body,h,now));assert.throws(()=>authenticate(db,key,path,body,h,now+61000));
 authenticate(db,key,path,body,h,now);assert.throws(()=>authenticate(db,key,path,body,h,now));
});
test('bridge client permits HTTPS only and will not follow redirects',async()=>{
 for(const v of ['http://example.org','https://user:pass@example.org','https://example.org/path','https://example.org/'])assert.throws(()=>validateOrigin(v));
 assert.equal(validateOrigin('https://example.org'),'https://example.org');let seen;
 const rpc=bridgeClient('https://example.org',key,{fetcher:async(url,opts)=>{seen=opts;throw Error('private details');}});
 await assert.rejects(rpc('/bridge/health',{}),e=>e.message==='Bot bridge unavailable');assert.equal(seen.redirect,'error');
});
test('contact must belong to sender; private-only processing and help keyboard',async()=>{
 const calls=[],api=async(m,p)=>{calls.push(p);},b2b=async()=>{throw Error('must not run');};
 await handleMessage(api,b2b,{...contact(),chat:{id:userId,type:'group'}},'https://b2b.example.org');assert.equal(calls.length,0);
 await handleMessage(api,b2b,{...contact(),contact:{...contact().contact,user_id:102}},'https://b2b.example.org');assert.equal(calls.length,1);
 await handleMessage(api,b2b,{...contact(),contact:undefined,text:'/start'},'https://b2b.example.org');assert.equal(calls[1].reply_markup.keyboard[0][0].request_contact,true);
});
test('remote bot binds a preassigned user and delivers a real B2B challenge via signed HTTPS-shaped RPC',async t=>{
 const db=dbFixture(t),botDb=dbFixture(t),messages=[];assignPhone(db,'u1',phone);
 const botUrl=await listen(t,createBotServer({db:botDb,key,api:async(m,p)=>messages.push(p)}));
 const bridge=createRemoteBridge(db,{bridgeKey:key,botOrigin:botUrl,allowLocal:true});
 const b2bServer=createServer(async(req,res)=>{try{const result=await bridge.handle(req);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));}catch(e){res.writeHead(e.status??500);res.end('{}');}});
 const b2bUrl=await listen(t,b2bServer),rpc=bridgeClient(b2bUrl,key,{allowLocal:true});
 const bound=await rpc('/api/telegram-bridge/contact',{message:contact()});assert.equal(bound.bound,true);
 const auth=createTelegramAuth(db,{key:'different-otp-hmac-secret-for-synthetic-test',send:bridge.send});
 const request=await auth.request(phone,'fixture');assert.equal(messages.length,1);const code=messages[0].text.match(/: (\d{6})/)[1];
 assert.equal(auth.verify({challenge:request.challenge,code},'fixture'),'u1');assert.throws(()=>auth.verify({challenge:request.challenge,code},'fixture'));
 const row=botDb.prepare('SELECT * FROM bot_delivery_ids').get();assert.deepEqual(Object.keys(row).sort(),['expires_at','id','state']);assert.equal(row.state,'sent');
});
test('unsigned contact RPC cannot bind an account',async t=>{
 const db=dbFixture(t);assignPhone(db,'u1',phone);const bridge=createRemoteBridge(db,{bridgeKey:key,botOrigin:'https://bot.example.org'});
 const req=Object.assign((async function*(){yield Buffer.from(JSON.stringify({message:contact()}));})(),{headers:{'content-type':'application/json'}});
 await assert.rejects(bridge.handle(req),e=>e.status===401);assert.equal(db.prepare('SELECT telegram_id FROM telegram_members').get().telegram_id,null);
});
test('bot delivery authenticates, validates expiry, deduplicates and does not expose plaintext storage',async t=>{
 const db=dbFixture(t);let sends=0;const url=await listen(t,createBotServer({db,key,api:async()=>{sends++;}}));
 const payload={chatId:'101',code:'123456',requestId:'c'.repeat(64),expiresAt:Date.now()+60000};
 const send=(p,headers)=>fetch(url+'/bridge/code',{method:'POST',headers:headers??signedHeaders(key,'/bridge/code',JSON.stringify(p)),body:JSON.stringify(p)});
 assert.equal((await send(payload,{'Content-Type':'application/json'})).status,401);
 assert.equal((await send({...payload,expiresAt:Date.now()-1})).status,400);
 assert.equal((await send(payload)).status,200);assert.equal((await send(payload)).status,200);assert.equal(sends,1);
 assert.equal((await fetch(url+'/bridge/health')).status,404);
});
test('delivery outage invalidates B2B challenge instead of granting access',async t=>{
 const db=dbFixture(t),botDb=dbFixture(t);assignPhone(db,'u1',phone);db.prepare("UPDATE telegram_members SET telegram_id='101'").run();
 const botUrl=await listen(t,createBotServer({db:botDb,key,api:async()=>{throw Error('offline');}}));const bridge=createRemoteBridge(db,{bridgeKey:key,botOrigin:botUrl,allowLocal:true});
 const auth=createTelegramAuth(db,{key:'synthetic-hmac-secret-with-32-characters',send:bridge.send}),r=await auth.request(phone,'fixture');
 assert.equal(db.prepare('SELECT count(*) n FROM telegram_challenges').get().n,0);assert.throws(()=>auth.verify({challenge:r.challenge,code:'123456'},'fixture'));
});
test('Telegram transport refuses redirects and hides token in errors',async()=>{
 let seen;const api=telegramClient('123456:synthetic_token_not_real_12345',{fetcher:async(u,o)=>{seen=o;throw Error(u);}});
 await assert.rejects(api('getMe'),e=>e.message==='Telegram unavailable');assert.equal(seen.redirect,'error');await assert.rejects(api('deleteWebhook'));
});
test('polling persists offset after success and skips permanently blocked chat',async t=>{
 const db=dbFixture(t);let stop=false;const api=async(m,p)=>{
  if(m==='getUpdates'){if(p.offset===10){stop=true;return [];}return [{update_id:9,message:{...contact(),contact:undefined,text:'/start'}}];}
  throw Object.assign(Error('blocked'),{telegramCode:403});
 };await runPolling({db,api,b2b:()=>{},b2bOrigin:'https://example.org',stop:()=>stop});assert.equal(db.prepare("SELECT value FROM bot_meta WHERE key='offset'").get().value,'10');
});
