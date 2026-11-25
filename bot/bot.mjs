import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {authenticate,setupNonces,readBody,bridgeClient,validateKey,validateOrigin} from './protocol.mjs';
import {telegramClient} from './telegram.mjs';

const keyboard={keyboard:[[{text:'Поделиться своим номером',request_contact:true}]],resize_keyboard:true,one_time_keyboard:true};
export async function handleMessage(api,b2b,m,b2bOrigin){
 if(!m||m.chat?.type!=='private'||!Number.isSafeInteger(m.from?.id)||m.from.is_bot||m.chat.id!==m.from.id)return;
 if(m.contact){
  if(m.contact.user_id!==m.from.id){await api('sendMessage',{chat_id:m.chat.id,text:'Нужен ваш собственный контакт. Нажмите кнопку «Поделиться своим номером».',reply_markup:keyboard});return;}
  const result=await b2b('/api/telegram-bridge/contact',{message:{chat:{id:m.chat.id,type:'private'},from:{id:m.from.id,is_bot:false},contact:{user_id:m.contact.user_id,phone_number:m.contact.phone_number}}});
  await api('sendMessage',{chat_id:m.chat.id,text:result.bound?`Номер подтверждён. Откройте ${b2bOrigin}, введите телефон и запросите код входа.`:'Этот номер не удалось привязать. Проверьте, что руководитель добавил ваш номер к аккаунту B2B. Если телефон уже был привязан к другому Telegram, обратитесь к руководителю.',reply_markup:result.bound?{remove_keyboard:true}:keyboard});
 }else if(/^\/(start|help)(?:\s|$)/.test(m.text??'')){
  await api('sendMessage',{chat_id:m.chat.id,text:`Вход в B2B «Наша смена»\n\n1. Подтвердите свой номер кнопкой ниже\n2. Откройте ${b2bOrigin}\n3. Введите телефон и запросите код\n\nДоступ — только сотрудникам с аккаунтом B2B. Код действует 5 минут. Никому его не сообщайте.`,reply_markup:keyboard});
 }
}
export function openBotStore(dir){
 mkdirSync(dir,{recursive:true,mode:0o700});const file=join(dir,'bot-state.sqlite'),db=new DatabaseSync(file);chmodSync(file,0o600);
 db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS bot_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS bot_delivery_ids(id TEXT PRIMARY KEY,expires_at INTEGER NOT NULL,state TEXT NOT NULL);');setupNonces(db);return db;
}
export function createBotServer({db,key,api,ready=()=>true}){
 validateKey(key);
 const server=createServer(async(req,res)=>{
  const reply=(s,p)=>{res.writeHead(s,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(p));};
  try{
   if(req.method!=='POST'||!['/bridge/code','/bridge/health'].includes(req.url))return reply(404,{error:'Not found'});
   const raw=await readBody(req);authenticate(db,key,req.url,raw,req.headers);
   if(!ready())return reply(503,{error:'Bot not ready'});
   if(req.url==='/bridge/health')return reply(200,{ok:true});
   let b;try{b=JSON.parse(raw);}catch{return reply(400,{error:'Invalid JSON'});}
   const now=Date.now();
   if(typeof b.chatId!=='string'||!/^\d{1,16}$/.test(b.chatId)||typeof b.code!=='string'||!/^\d{6}$/.test(b.code)||typeof b.requestId!=='string'||!/^[a-f0-9]{64}$/.test(b.requestId)||!Number.isSafeInteger(b.expiresAt)||b.expiresAt<=now||b.expiresAt>now+305000)return reply(400,{error:'Invalid delivery'});
   db.prepare('DELETE FROM bot_delivery_ids WHERE expires_at<=?').run(now);
   // Claim before sending: identical signed retries never send a second code.
   const claim=db.prepare("INSERT OR IGNORE INTO bot_delivery_ids VALUES(?,?,'pending')").run(b.requestId,b.expiresAt);
   if(claim.changes!==1){const row=db.prepare('SELECT state FROM bot_delivery_ids WHERE id=?').get(b.requestId);return reply(row?.state==='sent'?200:409,{ok:row?.state==='sent'});}
   try{
    await api('sendMessage',{chat_id:b.chatId,text:`Код входа в B2B «Наша смена»: ${b.code}\nДействует до ${new Date(b.expiresAt).toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'})} МСК. Никому не сообщайте код. Если вы не запрашивали вход, проигнорируйте сообщение.`,protect_content:true});
    db.prepare("UPDATE bot_delivery_ids SET state='sent' WHERE id=?").run(b.requestId);return reply(200,{ok:true});
   }catch{return reply(503,{error:'Delivery unavailable'});}
  }catch(e){reply([400,401,413,415].includes(e.status)?e.status:503,{error:'Request rejected'});}
 });
 server.requestTimeout=20000;server.headersTimeout=10000;return server;
}
export async function runPolling({db,api,b2b,b2bOrigin,stop=()=>false,wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 let failures=0;
 while(!stop()){
  try{
   const offset=Number(db.prepare("SELECT value FROM bot_meta WHERE key='offset'").get()?.value??0);
   const updates=await api('getUpdates',{offset,timeout:25,limit:30,allowed_updates:['message']});
   for(const update of updates){
    if(stop())break;if(!Number.isSafeInteger(update.update_id)||update.update_id<offset)continue;
    try{await handleMessage(api,b2b,update.message,b2bOrigin);}catch(e){if(![400,403].includes(e.telegramCode))throw e;}
    db.prepare("INSERT INTO bot_meta VALUES('offset',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(update.update_id+1));
   }failures=0;
  }catch{
   console.error('Polling temporarily unavailable; saved position will be retried.');
   await wait(Math.min(30000,1000*2**Math.min(++failures,5)));
  }
 }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===realpathSync(process.argv[1])){
 const {TELEGRAM_TOKEN,BRIDGE_KEY,B2B_ORIGIN,BOT_DATA_DIR}=process.env;
 validateOrigin(B2B_ORIGIN);validateKey(BRIDGE_KEY);if(!BOT_DATA_DIR)throw Error('BOT_DATA_DIR required');
 const username=process.env.TELEGRAM_USERNAME??'nashasmena_b2b_login_bot';
 const api=telegramClient(TELEGRAM_TOKEN),me=await api('getMe'),webhook=await api('getWebhookInfo');
 if(me.username?.toLowerCase()!==username.toLowerCase())throw Error('Bot username mismatch');
 if(webhook.url)throw Error('Existing webhook detected. Refusing to replace it.');
 const db=openBotStore(BOT_DATA_DIR),b2b=bridgeClient(B2B_ORIGIN,BRIDGE_KEY);let stopped=false;
 const server=createBotServer({db,key:BRIDGE_KEY,api});
 const host=process.env.BOT_BIND??'127.0.0.1';if(!['127.0.0.1','0.0.0.0'].includes(host))throw Error('Invalid BOT_BIND');
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(process.env.PORT??3103),host,resolve);});
 console.log('B2B login bot started; secrets and message bodies are not logged.');
 let closed;for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopped=true;closed??=new Promise(r=>server.close(r));});
 try{await runPolling({db,api,b2b,b2bOrigin:B2B_ORIGIN,stop:()=>stopped});}finally{if(!closed)closed=new Promise(r=>server.close(r));await closed;db.close();}
}
