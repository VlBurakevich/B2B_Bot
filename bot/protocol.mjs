import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
const denied=()=>Object.assign(Error('Unauthorized bridge request'),{status:401});
export function validateKey(key){if(!/^[a-f0-9]{64}$/.test(key??''))throw Error('BRIDGE_KEY must be 32 random bytes encoded as 64 hex characters');}
export function validateOrigin(origin,{allowLocal=false}={}){
 const u=new URL(origin);
 if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||u.origin!==origin||u.protocol!=='https:'&&!(allowLocal&&u.protocol==='http:'&&u.hostname==='127.0.0.1'))throw Error('An HTTPS origin without path or trailing slash is required');
 return origin;
}
function signature(key,ts,nonce,path,body){return createHmac('sha256',Buffer.from(key,'hex')).update(['b2b-bot-v1',ts,nonce,'POST',path,hash(body)].join('\n')).digest('hex');}
export function signedHeaders(key,path,body,now=Date.now()){
 validateKey(key);const ts=String(Math.floor(now/1000)),nonce=randomBytes(16).toString('hex');
 return {'Content-Type':'application/json','X-B2B-Time':ts,'X-B2B-Nonce':nonce,'X-B2B-Signature':signature(key,ts,nonce,path,body)};
}
export function setupNonces(db){db.exec('CREATE TABLE IF NOT EXISTS bot_bridge_nonces(nonce TEXT PRIMARY KEY,expires_at INTEGER NOT NULL)');}
export function authenticate(db,key,path,body,headers,now=Date.now()){
 validateKey(key);const ts=headers['x-b2b-time'],nonce=headers['x-b2b-nonce'],sig=headers['x-b2b-signature'];
 if(typeof ts!=='string'||!/^\d{10,12}$/.test(ts)||Math.abs(now-Number(ts)*1000)>60000||typeof nonce!=='string'||!/^[a-f0-9]{32}$/.test(nonce)||typeof sig!=='string'||!/^[a-f0-9]{64}$/.test(sig))throw denied();
 const expected=signature(key,ts,nonce,path,body);
 if(!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(sig,'hex')))throw denied();
 db.prepare('DELETE FROM bot_bridge_nonces WHERE expires_at<=?').run(now);
 const result=db.prepare('INSERT OR IGNORE INTO bot_bridge_nonces(nonce,expires_at) VALUES(?,?)').run(nonce,now+120000);
 if(result.changes!==1)throw denied();
}
export async function readBody(req){
 if(!req.headers['content-type']?.startsWith('application/json'))throw Object.assign(Error('JSON required'),{status:415});
 const parts=[];let n=0;
 for await(const chunk of req){n+=chunk.length;if(n>8192)throw Object.assign(Error('Body too large'),{status:413});parts.push(chunk);}
 return Buffer.concat(parts).toString('utf8');
}
export function bridgeClient(origin,key,{fetcher=fetch,allowLocal=false}={}){
 validateOrigin(origin,{allowLocal});validateKey(key);
 return async(path,payload)=>{
  if(!['/bridge/code','/bridge/health','/api/telegram-bridge/contact'].includes(path))throw Error('Unsupported bridge path');
  const body=JSON.stringify(payload);
  try{
   const r=await fetcher(origin+path,{method:'POST',redirect:'error',headers:signedHeaders(key,path,body),body,signal:AbortSignal.timeout(15000)});
   if(!r.ok)throw Error();return await r.json();
  }catch{throw Object.assign(Error('Bot bridge unavailable'),{status:503});}
 };
}
