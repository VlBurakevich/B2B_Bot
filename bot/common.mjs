import {createServer} from 'node:http';
import {realpathSync,openSync,closeSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {openBotStore,createBotServer} from './legacy-b2b.mjs';
import {bridgeClient,validateKey,validateOrigin,readBody,authenticate as authenticateB2B} from './protocol.mjs';
import {authenticate,kaitenClient} from './kaiten-protocol.mjs';
import {telegramClient} from './telegram.mjs';

export function servicesFromEnv(env,{allowLocal=false}={}){
 const protocol=Number(env.B2B_API_PROTOCOL??2);if(![1,2].includes(protocol))throw Error('B2B_API_PROTOCOL must be 1 or 2');
 const services=[{id:'b2b',label:'B2B',origin:env.B2B_ORIGIN,key:env.BRIDGE_KEY,protocol}];
 for(const [id,prefix,label] of [['kaiten-test','KAITEN_TEST','Kaiten · тест'],['kaiten','KAITEN','Kaiten']]){
  if(env[prefix+'_ORIGIN']||env[prefix+'_BRIDGE_KEY'])services.push({id,label,origin:env[prefix+'_ORIGIN'],key:env[prefix+'_BRIDGE_KEY']});
 }
 for(const s of services){validateOrigin(s.origin,{allowLocal});validateKey(s.key);}
 if(new Set(services.map(s=>s.key)).size!==services.length)throw Error('Each service needs an independent bridge key');
 if(new Set(services.map(s=>s.origin)).size!==services.length)throw Error('Service origins must be distinct');
 return services;
}
export function setupRouter(db){
 db.exec(`CREATE TABLE IF NOT EXISTS kaiten_nonces(nonce TEXT PRIMARY KEY,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS service_contexts(telegram_id TEXT PRIMARY KEY,service TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS service_jobs(id TEXT PRIMARY KEY,service TEXT NOT NULL,message TEXT NOT NULL,created_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL DEFAULT 'pending');`);
}
function privateMessage(m){return m?.chat?.type==='private'&&Number.isSafeInteger(m.from?.id)&&m.from.id>0&&!m.from.is_bot&&m.chat.id===m.from.id&&Number.isSafeInteger(m.message_id);}
export function enqueueMessage(db,services,m,now=Date.now()){
 if(!privateMessage(m))return;
 const tg=String(m.from.id),text=typeof m.text==='string'?m.text:'';
 if(/^\s*[0-9]{6}\s*$/.test(text))return {chat_id:m.chat.id,text:'Код входа вводится только на сайте выбранного сервиса. Не отправляйте его в чат.'};
 const start=/^\/start(?:@\w+)?(?:\s+(\S+))?$/.exec(text);
 const selected=services.find(s=>s.id===start?.[1]||s.label===text||text==='/'+s.id);
 if(start&&!selected){
  return {chat_id:m.chat.id,text:'Выберите сервис для регистрации или входа. Доступы в B2B и Kaiten независимы.',reply_markup:{keyboard:services.map(s=>[{text:s.label}]),resize_keyboard:true}};
 }
 if(selected)db.prepare('INSERT INTO service_contexts VALUES(?,?) ON CONFLICT(telegram_id) DO UPDATE SET service=excluded.service').run(tg,selected.id);
 const service=selected??services.find(s=>s.id===db.prepare('SELECT service FROM service_contexts WHERE telegram_id=?').get(tg)?.service)??services.find(s=>s.id==='b2b');
 if(!service)return;
 if(m.contact&&m.contact.user_id!==m.from.id)return {chat_id:m.chat.id,text:'Отправьте собственный контакт кнопкой Telegram.',reply_markup:{keyboard:[[{text:'Отправить мой номер',request_contact:true}]],resize_keyboard:true}};
 const dto={message_id:m.message_id,chat:{id:m.chat.id,type:'private'},from:{id:m.from.id,is_bot:false,...(typeof m.from.username==='string'?{username:m.from.username}:{})},...(m.contact?{contact:{user_id:m.contact.user_id,phone_number:m.contact.phone_number}}:{}),...(text?{text:selected?'/start':text.slice(0,1000)}:{})};
 db.prepare('INSERT OR IGNORE INTO service_jobs(id,service,message,created_at) VALUES(?,?,?,?)').run(service.id+':'+tg+':'+m.message_id,service.id,JSON.stringify(dto),now);
}
export async function flushJobs(db,services,clients,api,now=Date.now()){
 const blocked=new Set();
 const jobs=db.prepare("SELECT * FROM service_jobs WHERE state='pending' ORDER BY rowid LIMIT 200").all();
 for(const job of jobs){
  const m=JSON.parse(job.message),pair=job.service+':'+m.from.id;
  if(blocked.has(pair))continue;
  if(job.next_at>now){blocked.add(pair);continue;}
  if(job.created_at<now-86400000){db.prepare("UPDATE service_jobs SET state='expired',message='{}' WHERE id=?").run(job.id);continue;}
  const service=services.find(s=>s.id===job.service),client=clients.get(job.service);
  if(!service||!client){blocked.add(pair);continue;}
  try{
   let result;
   if(service.id==='b2b'&&service.protocol===1){
    if(m.contact){const linked=await client('/api/telegram-bridge/contact',{message:m});result={text:linked.bound?'Номер B2B подтверждён. Вернитесь на сайт для входа.':'Для доступа в B2B обратитесь к администратору.',reply_markup:{remove_keyboard:true}};}
    else result={text:'Для входа в B2B подтвердите ваш собственный номер кнопкой Telegram.',reply_markup:{keyboard:[[{text:'Отправить мой номер',request_contact:true}]],resize_keyboard:true,one_time_keyboard:true}};
   }else result=await client('/api/telegram-bridge/message',{eventId:String(m.from.id)+':'+m.message_id,message:m});
   if(typeof result.text!=='string'||result.text.length>4000)throw Error('Invalid registration reply');
   await api('sendMessage',{chat_id:m.chat.id,text:result.text,reply_markup:result.reply_markup});
   db.prepare("UPDATE service_jobs SET state='sent',message='{}' WHERE id=?").run(job.id);
  }catch(e){
   if([400,403].includes(e.telegramCode)){db.prepare("UPDATE service_jobs SET state='unreachable',message='{}' WHERE id=?").run(job.id);continue;}
   db.prepare('UPDATE service_jobs SET attempts=attempts+1,next_at=? WHERE id=?').run(now+Math.min(300000,1000*2**Math.min(job.attempts+1,8)),job.id);
   blocked.add(pair);
  }
 }
 db.prepare("DELETE FROM service_jobs WHERE state!='pending' AND created_at<?").run(now-7*86400000);
}
export function createCommonServer({db,services,api,ready=()=>true}){
 setupRouter(db);
 const b2b=services.find(s=>s.id==='b2b');if(!b2b)throw Error('B2B configuration is required');
 const legacy=createBotServer({db,key:b2b.key,api,ready});
 const server=createServer(async(req,res)=>{
  if(['/bridge/code','/bridge/health','/bridge/notify'].includes(req.url)&&!(req.url==='/bridge/health'&&b2b.protocol===1))return legacy.emit('request',req,res);
  const reply=(s,b)=>{res.writeHead(s,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(b));};
  try{
   if(req.method==='POST'&&req.url==='/bridge/health'&&b2b.protocol===1){const raw=await readBody(req);authenticateB2B(db,b2b.key,req.url,raw,req.headers);return reply(ready()?200:503,ready()?{ok:true,protocol:1,registration:false,otpSeconds:600}:{error:'Bot not ready'});}
   const match=/^\/bridge\/(kaiten(?:-test)?)\/(health|code|notify)$/.exec(req.url??'');
   if(req.method!=='POST'||!match)return reply(404,{error:'Not found'});
   const service=services.find(s=>s.id===match[1]);if(!service)return reply(404,{error:'Not found'});
   const raw=await readBody(req);authenticate(db,service,req.url,raw,req.headers);
   if(!ready())return reply(503,{error:'Bot not ready'});
   if(match[2]==='health')return reply(200,{ok:true,protocol:3,service:service.id,origin:service.origin,registration:true,otpSeconds:600});
   let b;try{b=JSON.parse(raw);}catch{return reply(400,{error:'Invalid JSON'});}
   if(typeof b.chatId!=='string'||!/^\d{1,16}$/.test(b.chatId))return reply(400,{error:'Invalid chat'});
   const now=Date.now(),id=service.id+':'+b.requestId;
   if(match[2]==='notify'){
    if(typeof b.requestId!=='string'||!/^[-a-f0-9]{36}$/.test(b.requestId)||typeof b.text!=='string'||b.text.length>4000)return reply(400,{error:'Invalid notification'});
    if(db.prepare("SELECT 1 FROM bot_delivery_ids WHERE id=? AND state='sent'").get(id))return reply(200,{ok:true});
    await api('sendMessage',{chat_id:b.chatId,text:b.text,reply_markup:b.reply_markup});
    db.prepare("INSERT INTO bot_delivery_ids VALUES(?,?,'sent') ON CONFLICT(id) DO UPDATE SET state='sent'").run(id,now+30*86400000);return reply(200,{ok:true});
   }
   if(typeof b.requestId!=='string'||!/^[a-f0-9]{64}$/.test(b.requestId)||typeof b.code!=='string'||!/^\d{6}$/.test(b.code)||!Number.isSafeInteger(b.expiresAt)||b.expiresAt<=now||b.expiresAt>now+605000)return reply(400,{error:'Invalid code'});
   db.prepare('DELETE FROM bot_delivery_ids WHERE expires_at<=?').run(now);
   if(db.prepare("INSERT OR IGNORE INTO bot_delivery_ids VALUES(?,?,'pending')").run(id,b.expiresAt).changes!==1){const prior=db.prepare('SELECT state FROM bot_delivery_ids WHERE id=?').get(id);return reply(prior?.state==='sent'?200:409,{ok:prior?.state==='sent'});}
   try{
    await api('sendMessage',{chat_id:b.chatId,text:`Код входа в ${service.label}: ${b.code}\nДействует 10 минут. Никому не сообщайте код. Если вы не запрашивали вход, проигнорируйте сообщение.`,protect_content:true});
    db.prepare("UPDATE bot_delivery_ids SET state='sent' WHERE id=?").run(id);reply(200,{ok:true});
   }catch{reply(503,{error:'Delivery unavailable'});}
  }catch(e){reply([400,401,413,415].includes(e.status)?e.status:503,{error:'Request rejected'});}
 });
 server.requestTimeout=20000;server.headersTimeout=10000;return server;
}
export async function polling({db,api,services,clients,stop=()=>false,wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 let failures=0;
 while(!stop()){
  try{
   const offset=Number(db.prepare("SELECT value FROM bot_meta WHERE key='offset'").get()?.value??0);
   const updates=await api('getUpdates',{offset,timeout:10,limit:30,allowed_updates:['message']});
   for(const update of updates){
    if(stop())break;if(!Number.isSafeInteger(update.update_id)||update.update_id<offset)continue;
    const reply=enqueueMessage(db,services,update.message);
    if(reply)try{await api('sendMessage',reply);}catch(e){if(![400,403].includes(e.telegramCode))throw e;}
    db.prepare("INSERT INTO bot_meta VALUES('offset',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(update.update_id+1));
   }
   failures=0;
  }catch(error){if(error.telegramCode===409)throw Error('Another Telegram poller is active; refusing to compete.');console.error('Shared bot polling retry scheduled.');await wait(Math.min(30000,1000*2**Math.min(++failures,5)));}
  await flushJobs(db,services,clients,api);
 }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===realpathSync(process.argv[1])){
 const env=process.env,services=servicesFromEnv(env);
 if(!env.BOT_DATA_DIR)throw Error('BOT_DATA_DIR required');
 const api=telegramClient(env.TELEGRAM_TOKEN),me=await api('getMe'),webhook=await api('getWebhookInfo');
 if(me.username?.toLowerCase()!==(env.TELEGRAM_USERNAME??'nashasmena_b2b_login_bot').toLowerCase())throw Error('Bot username mismatch');
 if(webhook.url)throw Error('Existing webhook detected. Refusing to replace it.');
 const db=openBotStore(env.BOT_DATA_DIR);setupRouter(db);
 const lock=join(env.BOT_DATA_DIR,'common-poller.pid');
 try{const fd=openSync(lock,'wx',0o600);writeFileSync(fd,String(process.pid));closeSync(fd);}catch(e){
  if(e.code!=='EEXIST')throw e;
  const pid=Number(readFileSync(lock,'utf8'));let alive=true;try{process.kill(pid,0);}catch(err){if(err.code==='ESRCH')alive=false;else throw err;}
  if(alive)throw Error('Another common bot poller is running');unlinkSync(lock);const fd=openSync(lock,'wx',0o600);writeFileSync(fd,String(process.pid));closeSync(fd);
 }
 const clients=new Map(services.map(s=>[s.id,s.id==='b2b'?bridgeClient(s.origin,s.key):kaitenClient(s)]));
 let stopped=false,closed;const server=createCommonServer({db,services,api});
 const host=env.BOT_BIND??'127.0.0.1';if(!['127.0.0.1','0.0.0.0'].includes(host))throw Error('Invalid bind address');
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(env.PORT??3103),host,resolve);});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopped=true;closed??=new Promise(r=>server.close(r));});
 console.log('Shared bot started. Service keys, codes and message bodies are not logged.');
 try{await polling({db,api,services,clients,stop:()=>stopped});}finally{if(!closed)closed=new Promise(r=>server.close(r));await closed;db.close();unlinkSync(lock);}
}
