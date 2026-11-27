import {evaluateLeadQuality} from './public/quality.mjs';
import {formatDateTime,formatDuration} from './public/timing.mjs';
import {display,DOMAIN} from './amo.mjs';
const filled=v=>v!==null&&v!==undefined&&v!==''&&(!Array.isArray(v)||v.length>0);
function flatten(out,prefix,entity){
  for(const [k,v] of Object.entries(entity??{})){
    if(!filled(v))continue;
    if(k==='custom_fields_values'){for(const f of v){const values=(f.values??[]).map(x=>display(x.value)).filter(x=>x!=='');if(values.length)out[`${prefix}${f.field_name||'Поле '+f.field_id} [${f.field_id}]`]=values.join(' | ');}continue;}
    if(k==='_embedded'){for(const [name,items] of Object.entries(v)){if(name==='tags')out[prefix+'Теги']=items.map(t=>t.name).join(', ');else if(filled(items))out[prefix+name]=display(items);}continue;}
    if(k==='_links')continue;
    out[prefix+k]=display(v);
  }
}
export function fullRow(lead){
 const out={'ID':lead.id,'Заявка':lead.name,'Ссылка':`https://${DOMAIN}/leads/detail/${lead.id}`,'Дата создания':lead.createdAt,'Ответственный':lead.responsible,'Время заявки':formatDateTime(lead.requestedAt),'Время взят в работу':formatDateTime(lead.takenAt),'Скорость взятия в работу (ЧЧ:ММ)':formatDuration(lead.takeoverMinutes),'Количество людей':lead.quotas??'','Категория':lead.category,'Статус':lead.status,'Причина отказа':lead.reason,'Лид взят качественно':evaluateLeadQuality(lead).quality?'Да':'Нет','Причина отказа верна':lead.reasonCorrect===true?'Да':lead.reasonCorrect===false?'Нет':'','Прогрев/биржа не вернули':lead.notReturned===true?'Да':lead.notReturned===false?'Нет':'','ДК':lead.dk===true?'Да':lead.dk===false?'Нет':'','Мессенджер':lead.messenger===true?'Да':lead.messenger===false?'Нет':'','Комментарий РОП':lead.comment??'','Автор комментария':lead.commentAuthor??'','Комментарий обновлён':lead.commentAt?new Date(lead.commentAt).toISOString():''};
 flatten(out,'Сделка: ',lead.raw);
 for(const [i,c] of (lead.contacts??[]).entries())flatten(out,`Контакт ${i+1}: `,c);
 for(const [i,c] of (lead.companies??[]).entries())flatten(out,`Компания ${i+1}: `,c);
 return out;
}
function cell(v){let s=display(v);if(/^[\s]*[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
export function csv(leads){const rows=leads.map(fullRow),keys=[...new Set(rows.flatMap(Object.keys))];return '\uFEFF'+[keys.map(cell).join(';'),...rows.map(r=>keys.map(k=>cell(r[k]??'')).join(';'))].join('\r\n');}
