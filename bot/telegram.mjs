export function telegramClient(token,{fetcher=fetch}={}){
 if(!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token??''))throw Error('Invalid TELEGRAM_TOKEN configuration');
 return async(method,params={})=>{
  if(!['getMe','getWebhookInfo','getUpdates','sendMessage'].includes(method))throw Error('Unsupported Telegram operation');
  try{
   const r=await fetcher(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(params),signal:AbortSignal.timeout(method==='getUpdates'?35000:10000)});
   const data=await r.json();if(!r.ok||data.ok!==true)throw Object.assign(Error(),{telegramCode:Number(data.error_code)||0});return data.result;
  }catch(e){throw Object.assign(Error('Telegram unavailable'),{telegramCode:e.telegramCode??0,status:503});}
 };
}
