import {setupAccess,publicUser,listAccess,hasPermission,permissionsCatalog,changeAccess,flushNotifications,audit,requireAdmin} from './access.mjs';
import {setupAccounts,accountAccess,canManageAccounts,canAccessLead,listAccounts,eligibleAmoUsers,createAccount,renewInvitation,reconcileAccount,updateAccount} from './accounts.mjs';
import {createRemoteBridge} from './telegram-bridge.mjs';
import {createTelegramAuth} from './telegram-auth.mjs';
import {setupReset,resetPassword} from './password-reset.mjs';
import {createServer} from 'node:http';
import {readFileSync,existsSync,realpathSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {openStore} from './store.mjs';
import {AmoClient,DOMAIN,PIPELINE,ENTRY,FIELD,runSync} from './amo.mjs';
import {csv} from './export.mjs';
import {unseal} from './secrets.mjs';
const root=dirname(fileURLToPath(import.meta.url)),derive=promisify(scrypt),hash=s=>createHash('sha256').update(s).digest('hex');
export async function verifyPassword(password,stored){const m=stored?.match(/^scrypt\$32768\$8\$3\$([a-f0-9]{64})\$([a-f0-9]{64})$/);const actual=await derive(password,m?.[1]??'0'.repeat(64),32,{N:32768,r:8,p:3,maxmem:40*1024*1024});return Boolean(m&&timingSafeEqual(actual,Buffer.from(m[2],'hex')));}
export function createApp({dataDir,origin,preview=false,autoSync=true,token,transport,telegram}={}){
  if(!dataDir||!origin)throw Error('B2B_DATA_DIR и B2B_ORIGIN обязательны.');
  const configured=new URL(origin);if(configured.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(configured.hostname))throw Error('Нужен HTTPS.');
  if(preview&&!['127.0.0.1','localhost'].includes(configured.hostname))throw Error('Preview доступен только локально.');
  if(telegram&&!telegram.send&&!telegram.bridgeKey)throw Error('Telegram bridge configuration is incomplete.');
  const store=openStore(join(dataDir,'b2b.sqlite'));setupReset(store.db);setupAccounts(store.db);setupAccess(store.db);let busy=false,timer,closed=false,hashing=0;
  function connection(){if(token)return {domain:DOMAIN,token};const p=join(dataDir,'connection.enc');if(!existsSync(p))return null;const c=unseal(readFileSync(p,'utf8'),process.env.B2B_KEY);if(c.domain!==DOMAIN)throw Error('Аккаунт amoCRM не совпадает с настройками сервиса.');return c;}
  const connected=()=>{try{return Boolean(connection()?.token);}catch{return false;}};
  function amoClient(){const c=connection();if(!c?.token)throw Object.assign(Error('Подключение amoCRM недоступно. Доступ откроется после проверки аккаунта.'),{status:503});return new AmoClient(c.token,transport);}
  async function checkIdentity(id){
    const p=store.db.prepare('SELECT * FROM account_profiles WHERE user_id=?').get(id);if(!p)return;
    if(p.revoked_at!==null)throw Object.assign(Error('Учётная запись заблокирована. Обратитесь к Сергею Карпову.'),{status:401});
    let current;try{current=await amoClient().get('/api/v4/users/'+p.amo_user_id);}catch{throw Object.assign(Error('Не удалось проверить сотрудника в amoCRM. Повторите позже.'),{status:503});}
    if(!reconcileAccount(store.db,id,current))throw Object.assign(Error('Имя или доступ в amoCRM изменились. Учётная запись заблокирована; нужна новая ссылка от руководителя.'),{status:401});
  }
  async function directory(){
    const users=await amoClient().list('/api/v4/users','users');eligibleAmoUsers(users);
    for(const p of store.db.prepare('SELECT user_id,amo_user_id FROM account_profiles WHERE revoked_at IS NULL').all()){
      const current=users.find(u=>u.id===p.amo_user_id);if(current)reconcileAccount(store.db,p.user_id,current);
    }return users;
  }
  async function sync(){if(busy)return;busy=true;try{const c=connection();if(!c?.token)return;if(store.db.prepare('SELECT 1 FROM account_profiles WHERE revoked_at IS NULL LIMIT 1').get())await directory();return await runSync(store,new AmoClient(c.token,transport));}catch(e){store.set('syncError',{at:Date.now(),message:e.message});}finally{busy=false;}}
  async function loop(){try{await sync();}finally{if(!closed)timer=setTimeout(loop,60000).unref();}}
  if(autoSync)timer=setTimeout(loop,2000).unref();
  const remoteBridge=telegram?.bridgeKey?createRemoteBridge(store.db,{...telegram,origin}):null;
  const tg=telegram?createTelegramAuth(store.db,{...telegram,...(remoteBridge?{send:remoteBridge.send}:{})}):null;
  const telegramUsername=telegram?.username??null;
  if(tg&&!/^[A-Za-z0-9_]{5,32}$/.test(telegramUsername??''))throw Error('Проверьте имя Telegram-бота.');
  const cookieName=configured.protocol==='https:'?'__Host-b2b_session':'b2b_session';
  function getToken(req){const t=String(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);return /^[a-f0-9]{64}$/.test(t??'')?t:null;}
  async function user(req){
    if(preview)return {id:'preview',name:'Руководитель',permissions:['platform.full_access','b2b.registry'],scope:'all'};
    const t=getToken(req),found=t?store.db.prepare("SELECT u.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires_at>? AND u.state='active'").get(hash(t),Date.now()):null;
    if(!found)return null;
    if(!hasPermission(store.db,found.id,'platform.full_access'))return null;
    await checkIdentity(found.id);
    // Re-read after the async amo lookup: revocations must win over in-flight requests.
    if(!store.db.prepare('SELECT 1 FROM sessions WHERE hash=? AND expires_at>?').get(hash(t),Date.now())||!hasPermission(store.db,found.id,'platform.full_access'))return null;
    return accountAccess(store.db,publicUser(store.db,found.id));
  }
  const cookie=(t,age=2592000)=>`${cookieName}=${t}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
  let notifying=false;
  async function notify(){if(notifying||closed||!remoteBridge)return;notifying=true;try{await flushNotifications(store.db,remoteBridge.notify,origin);}finally{notifying=false;}}
  const notificationTimer=setInterval(()=>void notify().catch(()=>{}),30000).unref();
  function limit(key,max){const w=Math.floor(Date.now()/900000);const r=store.db.prepare('INSERT INTO auth_limits(key,window,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window RETURNING count').get(hash(key),w);return r.count<=max;}
  function json(res,value,status=200,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(value));}
  const bodies=new WeakMap();
  async function body(req){if(bodies.has(req))return bodies.get(req);if(!req.headers['content-type']?.startsWith('application/json'))throw Object.assign(Error('Нужен JSON.'),{status:415});let data='',size=0;for await(const chunk of req){size+=chunk.length;if(size>1000000)throw Object.assign(Error('Слишком большой запрос.'),{status:413});data+=chunk;}try{const parsed=JSON.parse(data);if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw Error();bodies.set(req,parsed);return parsed;}catch{throw Object.assign(Error('Некорректный запрос.'),{status:400});}}
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try{
      const url=new URL(req.url,origin),path=url.pathname;
      if(req.method==='POST'&&['/api/telegram-bridge/contact','/api/telegram-bridge/message'].includes(path)&&remoteBridge){const result=await remoteBridge.handle(req);void notify().catch(()=>{});return json(res,result);}
      if(req.method==='POST'&&req.headers.origin!==origin) return json(res,{error:'Недопустимый источник запроса.'},403);
      if(req.method==='GET'&&path==='/healthz')return json(res,{ok:true});
      if(req.method==='GET'&&['/','/app.js','/style.css','/favicon.svg','/timing.mjs','/quality.mjs'].includes(path)){
        const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/favicon.svg':'favicon.svg','/timing.mjs':'timing.mjs','/quality.mjs':'quality.mjs'},types={'/':'text/html; charset=utf-8','/app.js':'text/javascript; charset=utf-8','/style.css':'text/css; charset=utf-8','/favicon.svg':'image/svg+xml','/timing.mjs':'text/javascript; charset=utf-8','/quality.mjs':'text/javascript; charset=utf-8'};
        res.writeHead(200,{'Content-Type':types[path]});return res.end(readFileSync(join(root,'public',files[path])));
      }
      if(['/api/login','/api/reset-password','/reset-password','/reset-password.js','/api/accounts/invite'].includes(path))return json(res,{error:'Вход по паролю отключён. Используйте телефон и Telegram.'},410);
      if(['/api/auth/request-code','/api/telegram/request'].includes(path)&&req.method==='POST'){
        if(!tg)return json(res,{error:'Вход через Telegram ещё не подключён.'},503);
        const b=await body(req),ip=req.headers['x-real-ip']??req.socket.remoteAddress;
        return json(res,await tg.request(b.phone,ip));
      }
      if(['/api/auth/verify','/api/telegram/verify'].includes(path)&&req.method==='POST'){
        if(!tg)return json(res,{error:'Вход через Telegram ещё не подключён.'},503);
        const b=await body(req),ip=req.headers['x-real-ip']??req.socket.remoteAddress;
        let id,version;try{id=tg.verify(b,ip);version=publicUser(store.db,id)?.version;}catch(e){audit(store.db,null,null,'login.failed',{ipHash:hash(String(ip))});throw e;}await checkIdentity(id);if(!hasPermission(store.db,id,'platform.full_access')||publicUser(store.db,id)?.version!==version)return json(res,{error:'Доступ закрыт.'},401);const t=randomBytes(32).toString('hex');
        store.db.prepare('INSERT INTO sessions(hash,user_id,expires_at) VALUES(?,?,?)').run(hash(t),id,Date.now()+2592000000);
        store.db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
        audit(store.db,id,id,'login.success',{ipHash:hash(String(ip))});return json(res,{ok:true},200,{'Set-Cookie':cookie(t)});
      }
      if(['/api/auth/logout','/api/logout'].includes(path)&&req.method==='POST'){const t=getToken(req);if(t){const session=store.db.prepare('SELECT user_id FROM sessions WHERE hash=?').get(hash(t));store.db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(t));if(session)audit(store.db,session.user_id,session.user_id,'logout');}return json(res,{ok:true},200,{'Set-Cookie':cookie('',0)});}
      if(['/api/auth/me','/api/session'].includes(path)&&req.method==='GET')return json(res,{user:await user(req),preview,telegram:tg?{username:telegramUsername}:null});
      if(req.method==='POST')await body(req);
      const actor=await user(req);if(!actor)return json(res,{error:'Войдите в сервис.'},401);
      if(path.startsWith('/api/access')){
        requireAdmin(store.db,actor.id);
        if(path==='/api/access'&&req.method==='GET')return json(res,{users:listAccess(store.db),permissions:permissionsCatalog,accounts:listAccounts(store.db).map(({login,...u})=>u)});
        if(path==='/api/access/audit'&&req.method==='GET')return json(res,{events:store.db.prepare('SELECT * FROM access_audit ORDER BY id DESC LIMIT 200').all()});
        if(path==='/api/access/update'&&req.method==='POST'){
          const b=await body(req);if(!limit('access:'+actor.id,60))return json(res,{error:'Повторите позже.'},429);
          const updated=changeAccess(store.db,actor.id,b);void notify().catch(()=>{});return json(res,{user:updated});
        }
      }
      if(path.startsWith('/api/accounts')){
        if(!hasPermission(store.db,actor.id,'admin.access.manage'))return json(res,{error:'Нет права управлять аккаунтами.'},403);
        if(path==='/api/accounts'&&req.method==='GET')return json(res,{accounts:listAccounts(store.db)});
        if(path==='/api/accounts/amo-users'&&req.method==='GET'){const users=eligibleAmoUsers(await directory());if(!await user(req))return json(res,{error:'Войдите заново.'},401);requireAdmin(store.db,actor.id);return json(res,{users,accounts:listAccounts(store.db)});}
        if(req.method==='POST'&&!limit('accounts:'+actor.id,30))return json(res,{error:'Слишком много операций. Повторите позже.'},429);
        if(path==='/api/accounts'&&req.method==='POST'){const b=await body(req),local=b.amoUserId===null,users=local?[]:await directory();if(!await user(req))return json(res,{error:'Войдите заново.'},401);return json(res,createAccount(store.db,actor,b,users,{origin,scope:local?'all':'own'}),201);}
        if(path==='/api/accounts/update'&&req.method==='POST'){const b=await body(req);if(typeof b.userId!=='string')return json(res,{error:'Выберите аккаунт.'},400);await checkIdentity(b.userId);if(!await user(req))return json(res,{error:'Войдите заново.'},401);return json(res,updateAccount(store.db,actor,b));}
        if(path==='/api/accounts/invite'&&req.method==='POST'){const b=await body(req);if(typeof b.userId!=='string')return json(res,{error:'Выберите аккаунт.'},400);await checkIdentity(b.userId);return json(res,renewInvitation(store.db,actor,b.userId,origin));}
      }
      const visible=()=>{
        if(preview)return store.all().filter(l=>canAccessLead(actor,l));
        const t=getToken(req);
        if(!t||!store.db.prepare('SELECT 1 FROM sessions WHERE hash=? AND expires_at>?').get(hash(t),Date.now())||!hasPermission(store.db,actor.id,'platform.full_access')||!hasPermission(store.db,actor.id,'b2b.registry'))return [];
        const current=accountAccess(store.db,publicUser(store.db,actor.id));
        return store.all().filter(l=>canAccessLead(current,l));
      };
      if(path!=='/api/state'&&!preview&&!hasPermission(store.db,actor.id,'b2b.registry'))return json(res,{error:'Нет права работать с реестром B2B.'},403);
      const requireLead=id=>{if(!visible().some(l=>l.id===id))throw Object.assign(Error('Заявка недоступна.'),{status:404});};
      if(path==='/api/state'&&req.method==='GET')return json(res,{user:actor,leads:visible(),connection:{domain:DOMAIN,connected:connected(),pipelineId:PIPELINE,statusId:ENTRY,fields:FIELD},lastSync:store.get('lastSync'),syncError:store.get('syncError'),syncing:busy,preview});
      if(path==='/api/comment'&&req.method==='POST'){
        const b=await body(req);if(!Number.isSafeInteger(b.id)||typeof b.body!=='string'||b.body.length>10000||!Number.isSafeInteger(b.version)||b.version<0)return json(res,{error:'Проверьте комментарий (до 10 000 символов).'},400);
        requireLead(b.id);return json(res,store.saveComment(b.id,b.body.trim(),b.version,actor.name));
      }
      if(path==='/api/takeover-time'&&req.method==='POST'){
        const b=await body(req);
        if(!Number.isSafeInteger(b.id)||!Number.isSafeInteger(b.version)||b.version<0||(b.minutes!==null&&(!Number.isSafeInteger(b.minutes)||b.minutes<0||b.minutes>599999)))return json(res,{error:'Укажите длительность в формате ЧЧ:ММ.'},400);
        requireLead(b.id);return json(res,store.saveTakeoverTime(b.id,b.minutes,b.version,actor.name));
      }
      if(path==='/api/lead-timestamp'&&req.method==='POST'){
        const b=await body(req);
        if(!Number.isSafeInteger(b.id))return json(res,{error:'Некорректная заявка.'},400);
        requireLead(b.id);return json(res,store.saveLeadTimestamp(b.id,b.field,b.timestamp,b.version,actor.name));
      }
      if(path==='/api/lead-flag'&&req.method==='POST'){
        const b=await body(req);
        if(!Number.isSafeInteger(b.id))return json(res,{error:'Некорректная заявка.'},400);
        requireLead(b.id);return json(res,store.saveLeadFlag(b.id,b.field,b.value,b.version,actor.name));
      }
      if(path==='/api/history'&&req.method==='GET'){
        const id=Number(url.searchParams.get('id'));if(!Number.isSafeInteger(id))return json(res,{error:'Некорректный ID.'},400);
        requireLead(id);return json(res,{comments:store.db.prepare('SELECT body,version,author,updated_at FROM comment_history WHERE lead_id=? ORDER BY version DESC').all(id),statuses:store.db.prepare('SELECT old_status,new_status,at FROM status_history WHERE lead_id=? ORDER BY at DESC,id DESC').all(id)});
      }
      if(path==='/api/sync'&&req.method==='POST'){if(!connected())return json(res,{error:'Подключение amoCRM ещё не настроено.'},409);void sync();return json(res,{ok:true,syncing:true},202);}
      if(path==='/api/export'&&req.method==='POST'){
        const b=await body(req);if(!Array.isArray(b.ids)||b.ids.some(x=>!Number.isSafeInteger(x))||!['csv','json'].includes(b.format))return json(res,{error:'Проверьте параметры выгрузки.'},400);
        const ids=new Set(b.ids),items=visible().filter(l=>ids.has(l.id));
        const date=new Date().toISOString().slice(0,10);res.writeHead(200,{'Content-Type':b.format==='csv'?'text/csv; charset=utf-8':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="b2b-leads-${date}.${b.format}"`});
        return res.end(b.format==='csv'?csv(items):JSON.stringify({exportedAt:new Date().toISOString(),source:DOMAIN,leads:items},null,2));
      }
      return json(res,{error:'Не найдено.'},404);
    }catch(e){if(res.headersSent)res.destroy();else json(res,{error:e.status?e.message:'Не удалось выполнить операцию. Сохранённые данные не изменены.'},e.status??500);}
  });
  server.on('close',()=>{closed=true;clearTimeout(timer);clearInterval(notificationTimer);if(!notifying)store.db.close();else{const wait=setInterval(()=>{if(!notifying){clearInterval(wait);store.db.close();}},10);}});
  server.requestTimeout=30000;server.headersTimeout=15000;
  return {server,store,sync};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===realpathSync(process.argv[1])){
 const app=createApp({dataDir:process.env.B2B_DATA_DIR,origin:process.env.B2B_ORIGIN,preview:process.env.B2B_PREVIEW==='1',autoSync:process.env.B2B_NO_SYNC!=='1',telegram:process.env.B2B_TELEGRAM_ENABLED==='1'?{username:process.env.B2B_TELEGRAM_USERNAME,key:process.env.B2B_TELEGRAM_OTP_KEY,bridgeKey:process.env.B2B_TELEGRAM_BRIDGE_KEY,botOrigin:process.env.B2B_TELEGRAM_BOT_ORIGIN}:null});
 app.server.listen(Number(process.env.PORT||3102),'127.0.0.1',()=>console.log('B2B service listening on loopback port '+app.server.address().port));
 for(const s of ['SIGTERM','SIGINT'])process.on(s,()=>app.server.close(()=>process.exit(0)));
}
