const MOSCOW_OFFSET=3*60*60*1000;
export function parseClock(value){
  let text=String(value??'').trim();
  if(/^[0-9]{1,4}$/.test(text)){const digits=text.padStart(4,'0');text=digits.slice(0,2)+':'+digits.slice(2);}
  const match=text.match(/^([0-9]{1,2}):([0-5][0-9])$/);
  if(!match||Number(match[1])>23)throw Error('Время от 00:00 до 23:59. Например, 134 → 01:34.');
  return match[1].padStart(2,'0')+':'+match[2];
}
export function clockParts(timestamp){
  if(timestamp===null||timestamp===undefined)return {date:'',clock:''};
  const iso=new Date(timestamp+MOSCOW_OFFSET).toISOString();
  return {date:iso.slice(0,10),clock:iso.slice(11,16)};
}
export function parseDateTime(date,clock){
  if(!date&&!String(clock??'').trim())return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Выберите дату.');
  const time=parseClock(clock),timestamp=Date.parse(date+'T'+time+':00+03:00');
  if(!validTimestamp(timestamp)||clockParts(timestamp).date!==date)throw Error('Проверьте дату.');
  return timestamp;
}
export function validTimestamp(value){return value===null||(Number.isSafeInteger(value)&&value>=0&&value<=253402289340000&&value%60000===0);}
export function durationMinutes(requestedAt,takenAt){return requestedAt===null||takenAt===null?null:(takenAt-requestedAt)/60000;}
export function formatDuration(minutes){return minutes===null||minutes===undefined?'':String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');}
export function formatDateTime(timestamp){const {date,clock}=clockParts(timestamp);return date?date.split('-').reverse().join('.')+' '+clock:'';}
export function timingClass(minutes){return minutes===null||minutes===undefined?'':minutes>15?'is-late':'is-fast';}
export function withTiming(lead,row){
  const created=Date.parse(lead.createdAt),fallback=Number.isFinite(created)?Math.floor(created/60000)*60000:null;
  const requestedAt=row?row.requested_at:fallback;
  const takenAt=row?row.taken_at:fallback!==null&&lead.takeoverMinutes!==null&&lead.takeoverMinutes!==undefined?fallback+lead.takeoverMinutes*60000:null;
  return {...lead,requestedAt,takenAt,timingVersion:row?.version??0,timingAuthor:row?.author??'',timingAt:row?.updated_at??null,takeoverMinutes:durationMinutes(requestedAt,takenAt)};
}
