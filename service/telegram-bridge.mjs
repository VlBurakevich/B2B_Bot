import {registrationMessage} from './access.mjs';
import {setupTelegram,bindContact} from './telegram-auth.mjs';
import {setupNonces,authenticate,readBody,bridgeClient} from './bot-bridge-protocol.mjs';
export function createRemoteBridge(db,{bridgeKey,botOrigin,allowLocal=false,origin}){
 setupTelegram(db);setupNonces(db);
 const bot=bridgeClient(botOrigin,bridgeKey,{allowLocal});
 return {
  send:async(method,params,meta)=>{
   if(method!=='sendMessage'||!meta?.challenge||!meta?.code)throw Error('Invalid login delivery');
   await bot('/bridge/code',{chatId:String(params.chat_id),code:meta.code,expiresAt:meta.expiresAt,requestId:meta.challenge});
  },
  notify:payload=>bot('/bridge/notify',payload),
  health:()=>bot('/bridge/health',{}),
  handle:async(req)=>{
   const raw=await readBody(req);authenticate(db,bridgeKey,req.url,raw,req.headers);
   let payload;try{payload=JSON.parse(raw);}catch{throw Object.assign(Error('Invalid JSON'),{status:400});}
   if(req.url==='/api/telegram-bridge/message')return registrationMessage(db,payload.message,{eventId:payload.eventId,origin});
   return {bound:bindContact(db,payload.message)};
  }
 };
}
