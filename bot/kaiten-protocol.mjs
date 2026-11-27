import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {validateKey,validateOrigin} from './protocol.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
const mac=(key,service,ts,nonce,path,raw)=>createHmac('sha256',Buffer.from(key,'hex')).update(['kaiten-bot-v1',service,ts,nonce,'POST',path,hash(raw)].join('\n')).digest('hex');
export function signedHeaders(key,service,path,raw,now=Date.now()){
 validateKey(key);const ts=String(Math.floor(now/1000)),nonce=randomBytes(16).toString('hex');
 return {'Content-Type':'application/json','X-Kaiten-Service':service,'X-Kaiten-Time':ts,'X-Kaiten-Nonce':nonce,'X-Kaiten-Signature':mac(key,service,ts,nonce,path,raw)};
}
export function authenticate(db,service,path,raw,headers,now=Date.now()){
 const ts=headers['x-kaiten-time'],nonce=headers['x-kaiten-nonce'],signature=headers['x-kaiten-signature'];
 const denied=()=>Object.assign(Error('Unauthorized Kaiten bridge request'),{status:401});
 if(headers['x-kaiten-service']!==service.id||!/^\d{10,12}$/.test(ts??'')||Math.abs(now-Number(ts)*1000)>60000||!/^[a-f0-9]{32}$/.test(nonce??'')||!/^[a-f0-9]{64}$/.test(signature??''))throw denied();
 const expected=mac(service.key,service.id,ts,nonce,path,raw);
 if(!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(signature,'hex')))throw denied();
 db.prepare('DELETE FROM kaiten_nonces WHERE expires<=?').run(now);
 if(db.prepare('INSERT OR IGNORE INTO kaiten_nonces VALUES(?,?)').run(service.id+':'+nonce,now+120000).changes!==1)throw denied();
}
export function kaitenClient(service,{fetcher=fetch,allowLocal=false}={}){
 validateKey(service.key);validateOrigin(service.origin,{allowLocal});
 return async(path,payload)=>{
  if(path!=='/api/telegram-bridge/message')throw Error('Unsupported Kaiten endpoint');
  const raw=JSON.stringify(payload);
  try{const r=await fetcher(service.origin+path,{method:'POST',redirect:'error',headers:signedHeaders(service.key,service.id,path,raw),body:raw,signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error();return await r.json();}
  catch{throw Error('Kaiten bridge unavailable');}
 };
}
