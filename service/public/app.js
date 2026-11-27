import {evaluateLeadQuality} from './quality.mjs';
import {parseClock,clockParts,parseDateTime,durationMinutes,timingClass} from './timing.mjs';
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,opts={})=>v?new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',year:'numeric',...opts}).format(new Date(v)):'—';
const time=v=>fmt(v,{day:undefined,month:undefined,year:undefined,hour:'2-digit',minute:'2-digit'}),dateKey=v=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
const initials=name=>String(name||'Р').split(/\s+/).slice(0,2).map(s=>s[0]).join('');
let state=null,view='registry',sortKey='date',asc=false,selectedId=null,editorVersion=0,toastTimer,refreshing=false,drafts=new Map();
async function api(path,body){const r=await fetch(path,{...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),credentials:'same-origin'});let data;try{data=await r.json();}catch{throw Error('Не удалось получить ответ сервиса.');}if(!r.ok){if(r.status===401&&!path.startsWith('/api/auth/'))showLogin();throw Error(data.error||'Не удалось выполнить операцию.');}return data;}
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,5000);}
function showLogin(){state=null;$('#app').hidden=true;$('#login').hidden=false;$('#lead-dialog').close();$('#account-edit-dialog').close();$('#access-dialog').close();$('#account-result').hidden=true;}
const STATUS_COLORS = Object.freeze({
  "неразобранное": "#c1c1c1",
  "новые заявки (нераспр)": "#87f2c0",
  "новая заявка": "#87f2c0",
  "взято в работу": "#fffeb2",
  "созвон назначен": "#99ccff",
  "ндз": "#c1e0ff",
  "фокус-клиенты": "#eb93ff",
  "встреча назначена": "#ffce5a",
  "встреча проведена": "#ffce5a",
  "на отправку кп": "#f3beff",
  "кп отправлено": "#f3beff",
  "не прошел защиту кп": "#ffdbdb",
  "защита кп пройдена": "#ffc8c8",
  "на формировании договора": "#ccc8f9",
  "договор отправлен": "#eb93ff",
  "договор подписан": "#deff81",
  "передать заказ": "#ffce5a",
  "ндз-6": "#c1e0ff",
  "на прогрев": "#ff8f92",
  "в биржу": "#ff8f92",
  "первые люди вышли": "#ccff66",
  "закрыто и не реализовано": "#d5d8db"
});
const STATUS_ORDER=['Неразобранное','Новые заявки (Нераспр)','Новая заявка','Взято в работу','Созвон назначен','НДЗ','Фокус-клиенты','Встреча назначена','Встреча проведена','На отправку КП','КП отправлено','Не прошел Защиту КП','Защита КП пройдена','На формировании договора','Договор отправлен','Договор подписан','передать заказ','НДЗ-6','На прогрев','В биржу','Первые люди вышли','Закрыто и не реализовано'];
const sortTitles={quality:'Лид взят качественно',requestedAt:'Время заявки',takenAt:'Время взят в работу',takeover:'Скорость взятия в работу',date:'Дата',status:'Статус',category:'Категория',quotas:'Количество людей',reason:'Причина отказа'};
function statusValues(){return [...new Set([...STATUS_ORDER,...state.leads.map(l=>l.status).filter(Boolean).filter(v=>!STATUS_ORDER.includes(v)).sort((a,b)=>a.localeCompare(b,'ru'))])];}
let selectedStatuses=null,statusListSignature='';
function statusIsSelected(status){return selectedStatuses===null||selectedStatuses.has(status);}
function updateStatusFilter(){
 const statuses=statusValues(),chosen=statuses.filter(statusIsSelected),all=chosen.length===statuses.length;
 const checkbox=$('#status-select-all');checkbox.checked=all;checkbox.indeterminate=chosen.length>0&&!all;
 for(const input of document.querySelectorAll('[data-status-value]'))input.checked=statusIsSelected(input.dataset.statusValue);
 const label=all?'Все статусы':chosen.length===0?'Статусы: не выбраны':chosen.length===1?chosen[0]:'Статусы: '+chosen.length;
 $('#status-filter-label').textContent=label;
 const button=$('#filter-status');button.classList.toggle('active',!all);button.title=label;button.setAttribute('aria-label','Фильтр статусов: '+label);
 button.style.backgroundColor=chosen.length===1?statusColor({status:chosen[0]}):'';
}
function statusOptions(){
 const statuses=statusValues(),signature=JSON.stringify(statuses);
 if(signature!==statusListSignature){
  $('#status-filter-options').innerHTML=statuses.map(status=>`<label class="status-filter-option" style="background:${statusColor({status})}"><input type="checkbox" data-status-value="${esc(status)}"${statusIsSelected(status)?' checked':''}><span>${esc(status)}</span></label>`).join('');
  statusListSignature=signature;
 }
 updateStatusFilter();
}
function selectStatus(status,checked){
 if(selectedStatuses===null)selectedStatuses=new Set(statusValues());
 if(checked)selectedStatuses.add(status);else selectedStatuses.delete(status);
 if(statusValues().every(value=>selectedStatuses.has(value)))selectedStatuses=null;
 updateStatusFilter();renderTable();
}
function selectAllStatuses(checked){selectedStatuses=checked?null:new Set();updateStatusFilter();renderTable();}
let selectedManagers=null,managerListSignature='';
function managerValues(){return [...new Set(state.leads.map(l=>String(l.responsible??'')))].sort((a,b)=>!a||!b?Number(!a)-Number(!b):a.localeCompare(b,'ru'));}
function managerIsSelected(manager){return selectedManagers===null||selectedManagers.has(String(manager??''));}
function updateManagerFilter(){
 const managers=managerValues(),chosen=managers.filter(managerIsSelected),all=chosen.length===managers.length;
 const checkbox=$('#manager-select-all');checkbox.checked=all;checkbox.indeterminate=chosen.length>0&&!all;
 for(const input of document.querySelectorAll('[data-manager-value]'))input.checked=managerIsSelected(input.dataset.managerValue);
 const label=all?'Все ответственные':chosen.length===0?'Ответственные: не выбраны':chosen.length===1?(chosen[0]||'Без ответственного'):'Ответственные: '+chosen.length;
 $('#manager-filter-label').textContent=label;
 const button=$('#filter-manager');button.classList.toggle('active',!all);button.title=label;button.setAttribute('aria-label','Фильтр ответственных: '+label);
}
function managerOptions(){
 const managers=managerValues(),signature=JSON.stringify(managers);
 if(signature!==managerListSignature){
  $('#manager-filter-options').innerHTML=managers.map(manager=>`<label class="status-filter-option manager-filter-option"><input type="checkbox" data-manager-value="${esc(manager)}"${managerIsSelected(manager)?' checked':''}><span>${esc(manager||'Без ответственного')}</span></label>`).join('');
  managerListSignature=signature;
 }
 updateManagerFilter();
}
function selectManager(manager,checked){
 if(selectedManagers===null)selectedManagers=new Set(managerValues());
 if(checked)selectedManagers.add(manager);else selectedManagers.delete(manager);
 if(managerValues().every(value=>selectedManagers.has(value)))selectedManagers=null;
 updateManagerFilter();renderTable();
}
function selectAllManagers(checked){selectedManagers=checked?null:new Set();updateManagerFilter();renderTable();}
function closeChoiceFilter(menuId,buttonId){const menu=$(menuId);if(menu.matches(':popover-open'))menu.hidePopover();$(buttonId).setAttribute('aria-expanded','false');}
function openChoiceFilter(menuId,buttonId,refresh,focusId){
 const menu=$(menuId);
 if(menu.matches(':popover-open')){closeChoiceFilter(menuId,buttonId);return;}
 if(!state)return;
 refresh();menu.showPopover();$(buttonId).setAttribute('aria-expanded','true');
 const rect=$(buttonId).getBoundingClientRect();
 const below=window.innerHeight-rect.bottom-12,above=rect.top-12;
 menu.style.maxHeight=Math.max(80,Math.min(520,Math.max(below,above)))+'px';
 menu.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-menu.offsetWidth-8))+'px';
 menu.style.top=(below>=Math.min(menu.scrollHeight,300)||below>=above?rect.bottom+6:Math.max(8,rect.top-menu.offsetHeight-6))+'px';
 $(focusId).focus();
}
function closeStatusFilter(){closeChoiceFilter('#status-filter-menu','#filter-status');}
function openStatusFilter(){openChoiceFilter('#status-filter-menu','#filter-status',statusOptions,'#status-select-all');}
function closeManagerFilter(){closeChoiceFilter('#manager-filter-menu','#filter-manager');}
function openManagerFilter(){openChoiceFilter('#manager-filter-menu','#filter-manager',managerOptions,'#manager-select-all');}
function closeChoiceFilters(){closeStatusFilter();closeManagerFilter();}

function sortValue(lead){
 if(sortKey==='quality')return evaluateLeadQuality(lead).quality?1:0;
 if(sortKey==='takeover')return lead.takeoverMinutes??null;
 if(sortKey==='requestedAt'||sortKey==='takenAt')return lead[sortKey]??null;
 if(sortKey==='date'){const value=new Date(lead.createdAt).getTime();return Number.isFinite(value)?value:null;}
 if(sortKey==='quotas')return typeof lead.quotas==='number'&&Number.isFinite(lead.quotas)?lead.quotas:null;
 const value=String(lead[sortKey]??'').trim();
 if(!value)return null;
 if(sortKey==='category'){const number=value.match(/^\d+/);return number?-Number(number[0]):value;}
 return value;
}
function compareLeads(a,b){
 const left=sortValue(a),right=sortValue(b);
 if(left===null||right===null){if(left!==right)return left===null?1:-1;}
 let order=0;
 if(left!==null&&right!==null){
  if(sortKey==='status'){
   const x=STATUS_ORDER.indexOf(left),y=STATUS_ORDER.indexOf(right);
   order=(x<0?STATUS_ORDER.length:x)-(y<0?STATUS_ORDER.length:y);
  }
  if(!order)order=typeof left==='number'&&typeof right==='number'?left-right:String(left).localeCompare(String(right),'ru',{numeric:true});
 }
 return (asc?1:-1)*order||new Date(b.createdAt)-new Date(a.createdAt)||b.id-a.id;
}
function updateSortHeaders(){for(const button of document.querySelectorAll('[data-sort]')){
 const active=button.dataset.sort===sortKey;
 button.classList.toggle('active',active);
 button.querySelector('span').textContent=active?(asc?'↑':'↓'):'↕';
 if(active)button.closest('th').setAttribute('aria-sort',asc?'ascending':'descending');else button.closest('th').removeAttribute('aria-sort');
 button.title='Сортировать: '+sortTitles[button.dataset.sort];
}}
function toggleSort(key){if(sortKey===key)asc=!asc;else{sortKey=key;asc=key==='status';}renderTable();}
function statusColor(lead){return STATUS_COLORS[String(lead.status??'').trim().toLocaleLowerCase('ru')]??(lead.statusId===142?'#ccff66':lead.statusId===143?'#d5d8db':'#e6edf3');}
function badge(lead){return `<span class="badge" style="--status-color:${statusColor(lead)}" title="${esc(lead.status)}">${esc(lead.status)}</span>`;}
function options(selector,values,label){const el=$(selector),value=el.value;el.innerHTML=`<option value="">${label}</option>`+[...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru')).map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');if(values.includes(value))el.value=value;}
function categoryClass(category){const match=String(category??'').trim().match(/^([123])\s*(?:[-–—]\s*)?(?:кат|$)/iu);return match?'category-'+match[1]:'';}
function dateBounds(now=Date.now()){
 const period=$('#filter-date').value;
 const day=new Date(dateKey(now)+'T12:00:00Z');
 const key=date=>date.toISOString().slice(0,10);
 if(period==='today'||period==='yesterday'){
  if(period==='yesterday')day.setUTCDate(day.getUTCDate()-1);
  return [key(day),key(day)];
 }
 if(period==='this-week'||period==='last-week'){
  const mondayOffset=(day.getUTCDay()+6)%7;
  day.setUTCDate(day.getUTCDate()-mondayOffset-(period==='last-week'?7:0));
  const from=key(day);day.setUTCDate(day.getUTCDate()+6);
  return [from,key(day)];
 }
 if(period==='this-month'){
  day.setUTCDate(1);const from=key(day);
  day.setUTCMonth(day.getUTCMonth()+1,0);
  return [from,key(day)];
 }
 return period==='range'?[$('#filter-from').value,$('#filter-to').value]:['',''];
}
function updateDateFilter(){
 const range=$('#filter-date').value==='range',from=$('#filter-from'),to=$('#filter-to');
 $('#date-range').hidden=!range;
 from.max=to.value;to.min=from.value;
 $('#date-filter-error').hidden=!(range&&from.value&&to.value&&from.value>to.value);
}
function filtered(){if(!state)return [];const q=$('#search').value.toLocaleLowerCase('ru').trim(),category=$('#filter-category').value,noComment=$('#filter-comment').checked;const [from,to]=dateBounds();
return state.leads.filter(l=>{const d=dateKey(l.createdAt),text=[l.id,l.name,l.responsible,l.category,l.status,l.reason,l.comment,...(l.contacts??[]).map(c=>c.name),...(l.companies??[]).map(c=>c.name)].join(' ').toLocaleLowerCase('ru');return (!q||text.includes(q))&&managerIsSelected(l.responsible)&&statusIsSelected(l.status)&&(!category||category===l.category)&&(!from||d>=from)&&(!to||d<=to)&&(!noComment||!l.comment?.trim());}).sort(compareLeads);}
const timestampDrafts=new Map(),timestampSaving=new Set();
let timestampPicker=null;
const timestampTitles={requestedAt:'Время заявки',takenAt:'Время взят в работу'};
function timestampDraft(lead,field){
 const key=lead.id+':'+field;
 if(timestampDrafts.has(key))return timestampDrafts.get(key);
 const parts=clockParts(lead[field]);
 return {date:parts.date||clockParts(lead.requestedAt??Date.now()).date,clock:parts.clock,version:lead.timingVersion??0,error:''};
}
function timestampEditor(lead,field){
 const draft=timestampDraft(lead,field),saving=timestampSaving.has(lead.id),attrs=`data-timestamp-id="${lead.id}" data-timestamp-field="${field}"`,feedback=`timestamp-feedback-${lead.id}-${field}`;
 return `<div class="timestamp-editor"><input type="date" class="timestamp-date" ${attrs} data-timestamp-input="date" value="${esc(draft.date)}" aria-label="${timestampTitles[field]}: дата, заявка ${lead.id}" aria-describedby="${feedback}"${saving?' disabled':''}><div class="timestamp-clock-row"><input type="text" class="timestamp-clock" ${attrs} data-timestamp-input="clock" value="${esc(draft.clock)}" placeholder="ЧЧ:ММ" inputmode="numeric" maxlength="5" autocomplete="off" aria-label="${timestampTitles[field]}: часы и минуты, заявка ${lead.id}" aria-describedby="${feedback}" aria-invalid="${Boolean(draft.error)}" title="134 → 01:34, 0023 → 00:23. Время по МСК."${saving?' disabled':''}><button type="button" class="timestamp-picker-toggle" ${attrs} data-timestamp-open aria-label="Выбрать дату и время бегунками" title="Выбрать дату и время"${saving?' disabled':''}>◷</button></div><small id="${feedback}" class="takeover-feedback${draft.error?' error':''}" role="status">${esc(draft.error||(saving?'Сохраняем…':''))}</small></div>`;
}
function previewTimestamp(lead,field){
 const draft=timestampDrafts.get(lead.id+':'+field);
 if(!draft)return lead[field]??null;
 if(!draft.clock.trim())return null;
 try{return parseDateTime(draft.date,draft.clock);}catch{return null;}
}
function previewDuration(lead){const minutes=durationMinutes(previewTimestamp(lead,'requestedAt'),previewTimestamp(lead,'takenAt'));return minutes!==null&&minutes<0?null:minutes;}
function formatResponseDuration(minutes){return minutes===null||minutes===undefined?'':Math.floor(minutes/60)+' ч '+String(minutes%60).padStart(2,'0')+' мин';}
function durationCell(lead){const minutes=previewDuration(lead);return `<span id="response-duration-${lead.id}" class="response-duration ${timingClass(minutes)}" title="Разница между временем заявки и взятием в работу">${formatResponseDuration(minutes)||'—'}</span>`;}
function updateDurationPreview(id){
 const lead=state.leads.find(l=>l.id===id),cell=$('#response-duration-'+id);if(!lead||!cell)return;
 const minutes=previewDuration(lead);cell.textContent=formatResponseDuration(minutes)||'—';cell.className='response-duration '+timingClass(minutes);updateQualityPreview(id);
}
function showTimestampError(id,field,error){
 const note=$('#timestamp-feedback-'+id+'-'+field);if(note){note.textContent=error;note.classList.toggle('error',Boolean(error));}
 const input=$('[data-timestamp-id="'+id+'"][data-timestamp-field="'+field+'"][data-timestamp-input="clock"]');if(input)input.setAttribute('aria-invalid',String(Boolean(error)));
}
async function saveTimestamp(id,field){
 const lead=state?.leads.find(l=>l.id===id),key=id+':'+field,draft=timestampDrafts.get(key);
 if(!lead||!draft||timestampSaving.has(id))return false;
 let timestamp;
 try{
  timestamp=draft.clock.trim()?parseDateTime(draft.date,draft.clock):null;
  const requested=field==='requestedAt'?timestamp:lead.requestedAt,taken=field==='takenAt'?timestamp:lead.takenAt;
  if(requested!==null&&taken!==null&&taken<requested)throw Error('Время взятия в работу не может быть раньше времени заявки.');
 }catch(error){draft.error=error.message;showTimestampError(id,field,error.message);return false;}
 if(timestamp===(lead[field]??null)){
  draft.error='';if(timestamp!==null)draft.clock=clockParts(timestamp).clock;
  const input=$('[data-timestamp-id="'+id+'"][data-timestamp-field="'+field+'"][data-timestamp-input="clock"]');if(input)input.value=draft.clock;
  showTimestampError(id,field,'');updateDurationPreview(id);return true;
 }
 timestampSaving.add(id);
 for(const input of document.querySelectorAll('[data-timestamp-id="'+id+'"]'))input.disabled=true;
 showTimestampError(id,field,'Сохраняем…');
 let success=false;
 try{
  const saved=await api('/api/lead-timestamp',{id,field,timestamp,version:draft.version});
  Object.assign(lead,saved);const latest=state?.leads.find(l=>l.id===id);if(latest)Object.assign(latest,saved);
  timestampDrafts.delete(key);
  for(const other of ['requestedAt','takenAt']){const pending=timestampDrafts.get(id+':'+other);if(pending)pending.version=saved.timingVersion;}
  success=true;
 }catch(error){draft.error=error.message;}
 finally{timestampSaving.delete(id);renderTable();}
 return success;
}
function editTimestamp(input){
 const id=Number(input.dataset.timestampId),field=input.dataset.timestampField,lead=state?.leads.find(l=>l.id===id);if(!lead)return;
 const draft={...timestampDraft(lead,field),[input.dataset.timestampInput]:input.value,error:''};
 timestampDrafts.set(id+':'+field,draft);showTimestampError(id,field,'');updateDurationPreview(id);
}
function syncPickerSliders(){
 try{const clock=parseClock($('#picker-clock').value),[hours,minutes]=clock.split(':');$('#picker-hours').value=Number(hours);$('#picker-minutes').value=Number(minutes);$('#picker-hours-value').textContent=hours;$('#picker-minutes-value').textContent=minutes;$('#picker-error').textContent='';}catch{}
}
function movePickerSlider(){
 const hours=String($('#picker-hours').value).padStart(2,'0'),minutes=String($('#picker-minutes').value).padStart(2,'0');
 $('#picker-clock').value=hours+':'+minutes;$('#picker-hours-value').textContent=hours;$('#picker-minutes-value').textContent=minutes;$('#picker-error').textContent='';
}
function openTimestampPicker(button){
 const id=Number(button.dataset.timestampId),field=button.dataset.timestampField,lead=state.leads.find(l=>l.id===id);if(!lead)return;
 const draft=timestampDraft(lead,field);timestampPicker={id,field,version:draft.version};
 $('#timestamp-picker-title').textContent=timestampTitles[field];$('#picker-date').value=draft.date;$('#picker-clock').value=draft.clock||clockParts(Date.now()).clock;$('#picker-error').textContent='';syncPickerSliders();
 const menu=$('#timestamp-picker');if(!menu.matches(':popover-open'))menu.showPopover();
 const rect=button.getBoundingClientRect(),below=window.innerHeight-rect.bottom-12;
 menu.style.maxHeight=Math.max(120,window.innerHeight-24)+'px';
 menu.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-menu.offsetWidth-8))+'px';
 menu.style.top=(below>=menu.offsetHeight?rect.bottom+6:Math.max(8,rect.top-menu.offsetHeight-6))+'px';$('#picker-clock').focus();
}
async function commitTimestampPicker(clear=false){
 const current=timestampPicker;if(!current)return;
 let clock='';
 try{if(!clear)clock=parseClock($('#picker-clock').value);}catch(error){$('#picker-error').textContent=error.message;return;}
 timestampDrafts.set(current.id+':'+current.field,{date:$('#picker-date').value,clock,version:current.version,error:''});
 $('#picker-save').disabled=true;$('#picker-clear').disabled=true;
 try{
  if(await saveTimestamp(current.id,current.field)){if(timestampPicker===current)$('#timestamp-picker').hidePopover();}
  else $('#picker-error').textContent=timestampDrafts.get(current.id+':'+current.field)?.error||'Дождитесь сохранения.';
 }finally{$('#picker-save').disabled=false;$('#picker-clear').disabled=false;}
}

const flagDrafts=new Map(),flagSaving=new Set();
let qualityExpanded=false;
const flagLabels={dk:'ДК [НДЗ]',messenger:'Мессенджер [НДЗ]',notReturned:'Прогрев/биржа не вернули',reasonCorrect:'Причина отказа верна'};
function qualityPreview(lead){
 const values={...lead,takeoverMinutes:previewDuration(lead)};
 for(const field of Object.keys(flagLabels)){const draft=flagDrafts.get(lead.id+':'+field);if(draft&&!draft.error)values[field]=draft.value;}
 return evaluateLeadQuality(values);
}
function qualityCell(lead){const result=qualityPreview(lead),explanation=result.checks.filter(check=>!check.passed).map(check=>check.label).join('; ')||'Все условия выполнены';return `<span id="lead-quality-${lead.id}" class="lead-quality-value ${result.quality?'is-yes':'is-no'}" title="${esc(explanation)}" aria-label="Лид взят качественно: ${result.quality?'Да':'Нет'}. ${esc(explanation)}">${result.quality?'Да':'Нет'}</span>`;}
function updateQualityPreview(id){const lead=state?.leads.find(l=>l.id===id),cell=$('#lead-quality-'+id);if(!lead||!cell)return;const result=qualityPreview(lead),explanation=result.checks.filter(check=>!check.passed).map(check=>check.label).join('; ')||'Все условия выполнены';cell.textContent=result.quality?'Да':'Нет';cell.className='lead-quality-value '+(result.quality?'is-yes':'is-no');cell.title=explanation;cell.setAttribute('aria-label','Лид взят качественно: '+cell.textContent+'. '+explanation);}
function updateQualityVisibility(){
 for(const cell of document.querySelectorAll('[data-quality-detail]'))cell.hidden=!qualityExpanded;
 const toggle=$('#toggle-quality-details');toggle.textContent=qualityExpanded?'−':'+';toggle.setAttribute('aria-expanded',String(qualityExpanded));toggle.title=qualityExpanded?'Свернуть показатели качества':'Развернуть показатели качества';toggle.setAttribute('aria-label',toggle.title);
}
function toggleQualityDetails(){qualityExpanded=!qualityExpanded;if(!qualityExpanded&&$('#timestamp-picker').matches(':popover-open'))$('#timestamp-picker').hidePopover();updateQualityVisibility();}

function flagEditor(lead,field){
 const key=lead.id+':'+field,draft=flagDrafts.get(key),value=draft?draft.value:(lead[field]??null),error=draft?.error||'',saving=flagSaving.has(key);
 const selected=value===true?'yes':value===false?'no':'';
 return `<div class="lead-flag-editor"><select class="lead-flag-input${value===true?' is-yes':value===false?' is-no':''}" data-flag-id="${lead.id}" data-flag-field="${field}" aria-label="${flagLabels[field]} для заявки ${lead.id}" aria-describedby="flag-feedback-${lead.id}-${field}" aria-invalid="${Boolean(error)}"${saving?' disabled':''}><option value=""${selected===''?' selected':''}>—</option><option value="yes"${selected==='yes'?' selected':''}>Да</option><option value="no"${selected==='no'?' selected':''}>Нет</option></select><small id="flag-feedback-${lead.id}-${field}" class="takeover-feedback${error?' error':''}" role="status">${esc(error||(saving?'Сохраняем…':''))}</small></div>`;
}
async function saveLeadFlag(input){
 const id=Number(input.dataset.flagId),field=input.dataset.flagField,key=id+':'+field,lead=state?.leads.find(l=>l.id===id);
 if(!lead||!Object.hasOwn(flagLabels,field)||flagSaving.has(key))return;
 const value=input.value==='yes'?true:input.value==='no'?false:null,previous=flagDrafts.get(key);
 if(value===(lead[field]??null)&&!previous){return;}
 input.classList.toggle('is-yes',value===true);input.classList.toggle('is-no',value===false);const draft={value,version:previous?.version??lead[field+'Version']??0,error:''};flagDrafts.set(key,draft);updateQualityPreview(id);flagSaving.add(key);input.disabled=true;$('#flag-feedback-'+id+'-'+field).textContent='Сохраняем…';
 try{
  const saved=await api('/api/lead-flag',{id,field,value,version:draft.version});
  Object.assign(lead,saved);const latest=state?.leads.find(l=>l.id===id);if(latest)Object.assign(latest,saved);
  flagDrafts.delete(key);
 }catch(error){draft.error=error.message;}
 finally{flagSaving.delete(key);renderTable();}
}
function renderTable(){
const active=document.activeElement;const focused=active?.matches('[data-timestamp-input]')?{id:active.dataset.timestampId,field:active.dataset.timestampField,part:active.dataset.timestampInput,start:active.selectionStart,end:active.selectionEnd}:null;
updateSortHeaders();const rows=filtered();$('#rows').innerHTML=rows.map(l=>{
return `<tr class="${l.comment?.trim()?'':'needs-rop-comment'}" data-id="${l.id}" tabindex="0" aria-label="Открыть заявку ${l.id}">
<td class="cell-date"><strong>${esc(fmt(l.createdAt))}</strong><small>${esc(time(l.createdAt))}</small></td>
<td class="cell-status">${badge(l)}</td>
<td class="cell-category">${l.category?`<span class="category-pill ${categoryClass(l.category)}">${esc(l.category)}</span>`:'—'}</td>
<td class="lead-cell"><a class="lead-amo-link" href="https://gruz4ikimoskva.amocrm.ru/leads/detail/${l.id}" target="_blank" rel="noopener noreferrer" aria-label="Открыть сделку ${l.id} в amoCRM">Открыть в amoCRM</a></td>
<td><span class="manager-name"><span class="manager-avatar">${esc(initials(l.responsible))}</span>${esc(l.responsible)}</span></td>
<td class="number quota">${l.quotas===null?'—':esc(l.quotas)}</td>
<td class="${l.reason?'':'dash'}" title="${esc(l.reason)}">${esc(l.reason||'—')}</td>
<td>${l.comment?`<span class="comment-cell" title="${esc(l.comment)}">${esc(l.comment)}</span>`:'<button class="comment-empty">＋ Комментарий</button>'}</td>
<td class="lead-quality-cell">${qualityCell(l)}</td><td class="timestamp-cell" data-quality-detail${qualityExpanded?'':' hidden'}>${timestampEditor(l,'takenAt')}</td><td class="takeover-cell" data-quality-detail${qualityExpanded?'':' hidden'}>${durationCell(l)}</td><td class="lead-flag-cell" data-quality-detail${qualityExpanded?'':' hidden'}>${flagEditor(l,'reasonCorrect')}</td><td class="lead-flag-cell" data-quality-detail${qualityExpanded?'':' hidden'}>${flagEditor(l,'notReturned')}</td><td class="lead-flag-cell" data-quality-detail${qualityExpanded?'':' hidden'}>${flagEditor(l,'dk')}</td><td class="lead-flag-cell" data-quality-detail${qualityExpanded?'':' hidden'}>${flagEditor(l,'messenger')}</td>
<td class="row-arrow">›</td></tr>`;}).join('');
if(focused){const input=$('[data-timestamp-id="'+focused.id+'"][data-timestamp-field="'+focused.field+'"][data-timestamp-input="'+focused.part+'"]');if(input&&!input.disabled){input.focus({preventScroll:true});if(focused.part==='clock')input.setSelectionRange(focused.start,focused.end);}}
updateQualityVisibility();$('#empty-state').hidden=rows.length>0;$('#row-count').textContent=`Показано ${rows.length} из ${state.leads.length}`;$('#stat-total').textContent=rows.length;$('#stat-new').textContent=rows.filter(l=>l.statusId===66462274&&l.pipelineId===8122290).length;
const known=rows.filter(l=>typeof l.quotas==='number');$('#stat-quotas').textContent=known.length?new Intl.NumberFormat('ru-RU').format(known.reduce((s,l)=>s+l.quotas,0)):'—';$('#stat-quotas-note').textContent=`Поле заполнено в ${known.length} из ${rows.length} заявок`;$('#stat-unreviewed').textContent=rows.filter(l=>!l.comment?.trim()).length;
}
function groupChart(selector,key){const groups=new Map();for(const l of state.leads)groups.set(l[key]||'Не указано',(groups.get(l[key]||'Не указано')??0)+1);const max=Math.max(1,...groups.values());$(selector).innerHTML=groups.size?[...groups].sort((a,b)=>b[1]-a[1]).map(([name,n])=>`<div class="chart-row"><div><span>${esc(name)}</span><strong>${n}</strong></div><div class="chart-bar"><div style="width:${Math.round(n/max*100)}%;${key==='status'?'background:'+statusColor({status:name}):''}"></div></div></div>`).join(''):'<p class="muted">Данные появятся после загрузки заявок.</p>';}
function renderState(){
for(const el of document.querySelectorAll('[data-view]')){if(el.dataset.view!=='accounts')el.hidden=!state.user.permissions?.includes('b2b.registry');}$('#accounts-nav').hidden=!state.user.canManageAccounts;if(view==='accounts'&&!state.user.canManageAccounts)switchView('registry');
$('#total-heading').textContent=state.leads.length;$('#nav-count').textContent=state.leads.length;$('#user-name').textContent=state.user.name;$('#avatar').textContent=initials(state.user.name);$('#preview-label').hidden=!state.preview;$('#preview-label').textContent='Локальная версия';$('#logout').hidden=state.preview;$('#refresh span').textContent=state.preview?'Перечитать':'Обновить';$('.private-label').textContent=state.preview?'◈ На этом компьютере':'◈ Закрытый доступ';$('#connection-mode-note').textContent=state.preview?'Сохранённая копия заявок. Синхронизация с amoCRM отключена. Комментарии сохраняются только локально.':'Данные amoCRM обновляются автоматически. Комментарии РОП хранятся в этом сервисе.';
managerOptions();statusOptions();options('#filter-category',['1-категория','2-категория','3-категория',...state.leads.map(l=>l.category)],'Все категории');
const when=state.lastSync?.at?`${fmt(state.lastSync.at)} в ${time(state.lastSync.at)}`:null;
$('#sync-label').textContent=state.syncing?'Синхронизация…':when?'Обновлено '+when:state.preview?'Локальная копия':'Первая загрузка ещё не завершена';$('#sync-dot').classList.toggle('warn',!state.preview&&(Boolean(state.syncError)||!state.connection.connected));$('#sidebar-sync').textContent=state.preview?'Сохранённая копия':state.connection.connected?'Подключено · раз в минуту':'Ожидает подключения';$('#refresh').disabled=state.syncing;
const error=state.preview?'':state.syncError?.message||(!state.connection.connected?'Подключение к amoCRM ещё не настроено. В реестре будут отображаться только последние сохранённые данные.':'');$('#error-banner').hidden=!error;$('#error-banner').textContent=error;
$('#connection-state').textContent=state.preview?'Локальная версия · сохранённая копия заявок':state.connection.connected?'Подключение настроено · только чтение данных':'Не подключено';const details=[['Аккаунт',state.connection.domain],['Воронка','[П] B2B воронка — основная'],['Входной этап','Новая заявка'],['Часовой пояс','Москва (UTC+3)'],['Диапазон дат','Дата создания: обе даты включительно'],['Неделя','С понедельника по воскресенье'],['Месяц','С первого по последний день месяца'],['Количество людей','[п-т] Кол-во людей'],['Категория','[п-т] (авто) Квалификация'],['Причина отказа','[п] Причина отказа'],['Комментарий РОП','В этом сервисе, с историей изменений'],['Состав данных','Все доступные заполненные поля сделки, контактов и компаний'],['Фоновое обновление',state.preview?'Отключено для локальной копии':'Раз в минуту после завершения предыдущей синхронизации'],['Последнее обновление',when||'Пока не выполнялось']];$('#connection-details').innerHTML=details.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
renderTable();groupChart('#status-chart','status');groupChart('#manager-chart','responsible');if(!state.user.permissions?.includes('b2b.registry')){if(state.user.canManageAccounts)switchView('accounts');else{for(const el of document.querySelectorAll('.view'))el.hidden=true;$('#error-banner').hidden=false;$('#error-banner').textContent='Доступ к веб-платформе открыт. Функции B2B вам пока не назначены.';}}
}
async function load(){if(refreshing)return;refreshing=true;try{state=await api('/api/state');$('#login').hidden=true;$('#app').hidden=false;renderState();}catch(e){if(state){showLogin();$('#telegram-error').textContent=e.message;}if(!$('#app').hidden){$('#error-banner').hidden=false;$('#error-banner').textContent=e.message;}}finally{refreshing=false;}}
function switchView(next){view=next;for(const el of document.querySelectorAll('.view'))el.hidden=el.id!==next;for(const b of document.querySelectorAll('[data-view]'))b.classList.toggle('active',b.dataset.view===next);$('#crumb').textContent={registry:'Реестр заявок',overview:'Обзор',connection:'Подключение',accounts:'Доступы'}[next];$('#access-audit-panel').hidden=next!=='accounts';if(next==='accounts')loadAccounts();}
function valueString(v){return v===null||v===undefined?'':typeof v==='object'?JSON.stringify(v):String(v);}
function field(label,value){return `<div class="field-pair"><small>${esc(label)}</small><span>${esc(valueString(value))}</span></div>`;}
function customFields(entity){return (entity.custom_fields_values??[]).flatMap(f=>{const v=(f.values??[]).filter(x=>x.value!==null&&x.value!==undefined&&x.value!=='').map(x=>valueString(x.value)).join(', ');return v!==''?[field(f.field_name||'Поле '+f.field_id,v)]:[];}).join('');}
function entityFields(entity){const meta=[];if(entity.name)meta.push(field('Название',entity.name));if(entity.price!==null&&entity.price!==undefined)meta.push(field('Бюджет',entity.price));const tags=entity._embedded?.tags?.map(t=>t.name).join(', ');if(tags)meta.push(field('Теги',tags));return meta.join('')+customFields(entity);}
function contactFields(contact){
 const phones=[...new Set((contact.custom_fields_values??[]).filter(f=>f.field_code==='PHONE'||/^(телефон|phone)$/iu.test(String(f.field_name??'').trim())).flatMap(f=>(f.values??[]).map(v=>String(v.value??'').trim()).filter(Boolean)))];
 return field('Имя',contact.name||'Не указано')+field('Телефон',phones.join(', ')||'Не указан');
}
function openLead(id){const l=state.leads.find(l=>l.id===id);if(!l)return;selectedId=id;editorVersion=l.commentVersion;const draft=drafts.has(id)?drafts.get(id):l.comment;
$('#lead-content').innerHTML=`<div class="lead-heading"><div><span class="tiny-label">AMOCRM · #${l.id}</span><h2>${esc(l.name)}</h2>${badge(l)}</div><a href="https://gruz4ikimoskva.amocrm.ru/leads/detail/${l.id}" target="_blank" rel="noopener noreferrer">Открыть в amoCRM ↗</a></div><div class="lead-summary"><div><small>Ответственный</small><strong>${esc(l.responsible)}</strong></div><div><small>Количество людей</small><strong>${l.quotas===null?'Не заполнено':esc(l.quotas)}</strong></div><div><small>Категория</small><strong>${esc(l.category||'Не заполнена')}</strong></div></div><div class="comment-editor"><h3>Комментарий РОП</h3><textarea id="comment-input" aria-label="Комментарий РОП" maxlength="10000" placeholder="Обратная связь, причина решения или следующий шаг…">${esc(draft)}</textarea><div class="editor-footer"><small id="comment-meta">${l.commentAt?`${esc(l.commentAuthor)}<br>${fmt(l.commentAt)} в ${time(l.commentAt)}`:'Сохраняется отдельно от amoCRM'}</small><button id="save-comment" class="primary">Сохранить комментарий</button></div><p id="comment-error" class="form-error" role="alert"></p></div><section class="field-section"><details class="lead-fields"><summary>Все заполненные поля сделки</summary><div class="fields-grid">${entityFields(l.raw)}${l.reason?field('Причина отказа',l.reason):''}</div>${(l.contacts??[]).map((c,i)=>`<section class="field-section"><h3>Контакт${l.contacts.length>1?' '+(i+1):''}</h3><div class="fields-grid">${contactFields(c)}</div></section>`).join('')}</details></section>${(l.companies??[]).map((c,i)=>`<section class="field-section"><h3>Компания ${i+1} · ${esc(c.name)}</h3><div class="fields-grid">${entityFields(c)}</div></section>`).join('')}<section class="field-section"><details><summary>История комментариев и статусов</summary><div id="lead-history"><p class="muted">Загружаем историю…</p></div></details></section><p class="data-note">Последняя проверка amoCRM: ${fmt(l.syncedAt)} в ${time(l.syncedAt)}. Все данные доступны также в полной выгрузке JSON.</p>`;
$('#comment-input').addEventListener('input',e=>drafts.set(id,e.target.value));$('#save-comment').addEventListener('click',saveComment);$('#lead-dialog').showModal();
api('/api/history?id='+id).then(h=>{if(selectedId!==id)return;$('#lead-history').innerHTML=h.comments.map(c=>`<div class="history-item"><small>Комментарий · ${esc(c.author)} · ${fmt(c.updated_at)} ${time(c.updated_at)} · версия ${c.version}</small><p>${esc(c.body||'Комментарий очищен')}</p></div>`).join('')+h.statuses.map(s=>`<div class="history-item"><small>Статус · ${fmt(s.at)} ${time(s.at)}</small><p>${esc(s.old_status||'Добавлено в реестр')} → ${esc(s.new_status)}</p></div>`).join('')||'<p class="muted">История пока пуста.</p>';}).catch(e=>{if(selectedId===id)$('#lead-history').textContent=e.message;});
}
async function saveComment(){const id=selectedId,b=$('#save-comment');b.disabled=true;$('#comment-error').textContent='';try{const data=await api('/api/comment',{id,body:$('#comment-input').value,version:editorVersion});const l=state.leads.find(l=>l.id===id);Object.assign(l,data);editorVersion=data.commentVersion;drafts.delete(id);$('#comment-input').value=data.comment;$('#comment-meta').textContent=`Сохранено · ${data.commentAuthor} · ${time(data.commentAt)}`;renderTable();toast('Комментарий сохранён');}catch(e){$('#comment-error').textContent=e.message;}finally{b.disabled=false;}}
async function exportData(format){$('#export-menu').hidden=true;$('#export-toggle').setAttribute('aria-expanded','false');const b=$('#export-toggle');b.disabled=true;try{const r=await fetch('/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:filtered().map(l=>l.id),format})});if(!r.ok){const e=await r.json();throw Error(e.error||'Не удалось выгрузить данные.');}const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`b2b-leads-${new Date().toISOString().slice(0,10)}.${format}`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Выгружены все поля выбранных заявок');}catch(e){toast(e.message);}finally{b.disabled=false;}}
let telegramConfig=null,telegramChallenge=null,nextCodeAt=0;
function configureTelegram(config){
 $('#telegram-login').hidden=false;
 $('#telegram-bot-link').href='https://t.me/'+encodeURIComponent(config?.username||'nashasmena_b2b_login_bot');
 if(!config)$('#telegram-error').textContent='Вход через Telegram временно недоступен. Повторите позже.';
}
$('#phone-form').addEventListener('submit',async e=>{
 e.preventDefault();const f=e.currentTarget,b=f.querySelector('button');$('#telegram-error').textContent='';
 if(Date.now()<nextCodeAt){$('#telegram-error').textContent='Подождите '+Math.ceil((nextCodeAt-Date.now())/1000)+' сек. перед повторным запросом.';return;}
 b.disabled=true;try{const r=await api('/api/auth/request-code',{phone:f.elements.phone.value});nextCodeAt=Date.now()+r.retryAfter*1000;f.hidden=true;$('#code-form').hidden=false;$('#code-form').elements.code.value='';$('#code-form').elements.code.focus();}catch(e){$('#telegram-error').textContent=e.message;}finally{b.disabled=false;}
});
$('#new-code').addEventListener('click',()=>{telegramChallenge=null;$('#code-form').hidden=true;$('#phone-form').hidden=false;$('#telegram-error').textContent='';});
$('#code-form').addEventListener('submit',async e=>{
 e.preventDefault();const f=e.currentTarget,b=f.querySelector('button');b.disabled=true;$('#telegram-error').textContent='';
 try{await api('/api/auth/verify',{phone:$('#phone-form').elements.phone.value,code:f.elements.code.value});f.elements.code.value='';telegramChallenge=null;await load();}catch(e){$('#telegram-error').textContent=e.message;}finally{b.disabled=false;}
});
$('#logout').addEventListener('click',async()=>{try{await api('/api/auth/logout',{});showLogin();state=null;}catch(e){toast(e.message);}});
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
for(const id of ['#search','#filter-category','#filter-comment'])$(id).addEventListener(id==='#search'?'input':'change',renderTable);
for(const id of ['#filter-date','#filter-from','#filter-to'])$(id).addEventListener('change',()=>{updateDateFilter();renderTable();});
$('#filter-manager').addEventListener('click',openManagerFilter);
$('#manager-select-all').addEventListener('change',e=>selectAllManagers(e.target.checked));
$('#manager-filter-options').addEventListener('change',e=>{if(e.target.matches('[data-manager-value]'))selectManager(e.target.dataset.managerValue,e.target.checked);});
$('#manager-filter-menu').addEventListener('toggle',e=>$('#filter-manager').setAttribute('aria-expanded',String(e.newState==='open')));
$('#filter-status').addEventListener('click',openStatusFilter);
$('#status-select-all').addEventListener('change',e=>selectAllStatuses(e.target.checked));
$('#status-filter-options').addEventListener('change',e=>{if(e.target.matches('[data-status-value]'))selectStatus(e.target.dataset.statusValue,e.target.checked);});
$('#status-filter-menu').addEventListener('toggle',e=>$('#filter-status').setAttribute('aria-expanded',String(e.newState==='open')));
window.addEventListener('resize',closeChoiceFilters);$('.filter-bar').addEventListener('scroll',closeChoiceFilters);
$('#toggle-quality-details').addEventListener('click',toggleQualityDetails);
document.querySelectorAll('[data-sort]').forEach(button=>button.addEventListener('click',()=>toggleSort(button.dataset.sort)));
$('#rows').addEventListener('input',e=>{if(e.target.matches('[data-timestamp-input]'))editTimestamp(e.target);});
$('#rows').addEventListener('change',e=>{if(e.target.matches('[data-flag-field]'))saveLeadFlag(e.target);if(e.target.matches('[data-timestamp-input="date"]')){editTimestamp(e.target);const draft=timestampDrafts.get(e.target.dataset.timestampId+':'+e.target.dataset.timestampField);if(draft?.clock.trim())saveTimestamp(Number(e.target.dataset.timestampId),e.target.dataset.timestampField);}});
$('#rows').addEventListener('focusout',e=>{if(e.target.matches('[data-timestamp-input="clock"]'))saveTimestamp(Number(e.target.dataset.timestampId),e.target.dataset.timestampField);});
$('#rows').addEventListener('click',e=>{const picker=e.target.closest('[data-timestamp-open]');if(picker){openTimestampPicker(picker);return;}if(e.target.closest('a,.timestamp-editor,.lead-flag-editor'))return;const row=e.target.closest('tr[data-id]');if(row)openLead(Number(row.dataset.id));});
$('#rows').addEventListener('keydown',e=>{if(e.target.closest('.lead-flag-editor'))return;if(e.target.matches('[data-timestamp-input]')){if(e.key==='Enter'){e.preventDefault();editTimestamp(e.target);saveTimestamp(Number(e.target.dataset.timestampId),e.target.dataset.timestampField);}return;}if(e.target.closest('a,.timestamp-editor'))return;if(['Enter',' '].includes(e.key)){const row=e.target.closest('tr[data-id]');if(row){e.preventDefault();openLead(Number(row.dataset.id));}}});
$('#picker-hours').addEventListener('input',movePickerSlider);$('#picker-minutes').addEventListener('input',movePickerSlider);
$('#picker-clock').addEventListener('input',syncPickerSliders);
$('#picker-clock').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();commitTimestampPicker();}});
$('#picker-save').addEventListener('click',()=>commitTimestampPicker());$('#picker-clear').addEventListener('click',()=>commitTimestampPicker(true));
$('#timestamp-picker').addEventListener('toggle',e=>{if(e.newState==='closed')timestampPicker=null;});
$('#more-filters').addEventListener('click',()=>{const hidden=!$('#extra-filters').hidden;$('#extra-filters').hidden=hidden;$('#more-filters').setAttribute('aria-expanded',String(!hidden));});
$('#reset-filters').addEventListener('click',()=>{for(const id of ['#search','#filter-category','#filter-date','#filter-from','#filter-to'])$(id).value='';$('#filter-comment').checked=false;selectedStatuses=null;selectedManagers=null;updateStatusFilter();updateManagerFilter();updateDateFilter();renderTable();});
$('#refresh').addEventListener('click',async()=>{try{if(state?.preview){await load();toast('Локальные данные перечитаны');return;}await api('/api/sync',{});toast('Синхронизация запущена');await load();}catch(e){toast(e.message);}});
$('#export-toggle').addEventListener('click',()=>{const hidden=!$('#export-menu').hidden;$('#export-menu').hidden=hidden;$('#export-toggle').setAttribute('aria-expanded',String(!hidden));});document.querySelectorAll('[data-export]').forEach(b=>b.addEventListener('click',()=>exportData(b.dataset.export)));document.addEventListener('click',e=>{if(!e.target.closest('.export-wrap')){$('#export-menu').hidden=true;$('#export-toggle').setAttribute('aria-expanded','false');}});
$('#close-dialog').addEventListener('click',()=>$('#lead-dialog').close());$('#lead-dialog').addEventListener('close',()=>selectedId=null);
api('/api/auth/me').then(s=>{configureTelegram(s.telegram);return s.user?load().then(()=>{if(location.hash==='#access'&&state?.user.canManageAccounts)switchView('accounts');}):showLogin();}).catch(()=>{showLogin();$('#telegram-error').textContent='Сервис временно недоступен. Попробуйте ещё раз.';});setInterval(()=>{if(state&&!document.hidden)load();},15000);

let accountsLoading=false,accountRows=[],editingAccount=null;
function showInvite(result){$('#account-result').textContent='Доступ создан для '+result.name+'. Вход по телефону: '+result.phone+'. Сотруднику нужно подтвердить номер в Telegram-боте.';$('#account-result').hidden=false;}
async function loadAccounts(){
 if(accountsLoading||!state?.user.canManageAccounts)return;
 accountsLoading=true;$('#account-create').disabled=true;$('#accounts-error').textContent='';
 try{
 const access=await api('/api/access');renderAccess(access);accountRows=access.accounts;
 const data={accounts:access.accounts,users:[]},selected=$('#account-amo').value;
 $('#account-amo').innerHTML='<option value="local">Без привязки к amoCRM</option>';updateCreationMode();
 // Directory failure must not hide pending requests or block access administration.
 try{const directory=await api('/api/accounts/amo-users');data.users=directory.users;const taken=new Set(data.accounts.filter(a=>a.amoUserId&&!a.revokedAt).map(a=>a.amoUserId));$('#account-amo').innerHTML+='<option disabled>— Сотрудники amoCRM —</option>'+data.users.map(u=>`<option value="${u.id}" ${taken.has(u.id)?'disabled':''}>${esc(u.name)}${taken.has(u.id)?' — аккаунт уже есть':''}</option>`).join('');if(selected)$('#account-amo').value=selected;updateCreationMode();}catch{ /* Local registration remains available. */ }
 $('#accounts-list').innerHTML='<table><thead><tr><th>Сотрудник</th><th>Телефон</th><th>Доступ</th><th>Состояние</th><th></th></tr></thead><tbody>'+data.accounts.map(a=>`<tr><td>${esc(a.name)}${a.isAdmin?'<br><small>Администратор</small>':!a.amoUserId?'<br><small>Без amoCRM</small>':''}</td><td>${esc(a.phone||'Телефон не привязан')}</td><td>${a.scope==='own'?'Свои заявки':'Весь реестр'}</td><td>${a.state==='pending'?'Ожидает рассмотрения':a.state==='blocked'?'Заблокирован':'Активен'}</td><td>${a.state==='active'&&!a.revokedAt?`<button class="secondary" data-edit-account="${esc(a.id)}">Редактировать</button>`:''}</td></tr>`).join('')+'</tbody></table>';
 $('#account-create').disabled=false;
 }catch(e){$('#accounts-error').textContent=e.message;}finally{accountsLoading=false;}
}
$('#accounts-refresh').addEventListener('click',loadAccounts);
$('#account-form').addEventListener('submit',async e=>{
 e.preventDefault();$('#account-create').disabled=true;$('#accounts-error').textContent='';$('#account-result').hidden=true;
 try{const result=await api('/api/accounts',{amoUserId:$('#account-amo').value==='local'?null:Number($('#account-amo').value),name:$('#account-local-name').value,phone:$('#account-phone').value});showInvite(result);$('#account-form').reset();await loadAccounts();}
 catch(e){await loadAccounts();$('#accounts-error').textContent=e.message+' Если ответ потерялся, проверьте список сотрудников перед повтором.';}
 finally{$('#account-create').disabled=false;}
});
$('#accounts-list').addEventListener('click',e=>{
 const button=e.target.closest('[data-edit-account]');if(!button)return;
 editingAccount=accountRows.find(a=>a.id===button.dataset.editAccount);if(!editingAccount)return;
 $('#account-edit-name').value=editingAccount.name;$('#account-edit-phone').value=editingAccount.phone||'';$('#account-edit-phone').required=Boolean(editingAccount.phone);
 $('#account-edit-without-amo').checked=!editingAccount.amoUserId;$('#account-edit-without-amo').disabled=!editingAccount.amoUserId;$('#account-edit-unlink-note').hidden=!$('#account-edit-without-amo').checked;
 $('#account-edit-scope').value=editingAccount.scope;$('#account-edit-scope').disabled=!editingAccount.amoUserId;
 $('#account-edit-amo').textContent=editingAccount.amoUserId?'amoCRM: '+editingAccount.amoName+' · ID '+editingAccount.amoUserId+'.':'Учётная запись без привязки к amoCRM';
 $('#account-edit-error').textContent='';$('#account-edit-dialog').showModal();$('#account-edit-name').focus();
});
for(const selector of ['#account-edit-close','#account-edit-cancel'])$(selector).addEventListener('click',()=>$('#account-edit-dialog').close());
$('#account-edit-form').addEventListener('submit',async e=>{
 e.preventDefault();if(!editingAccount)return;$('#account-edit-save').disabled=true;$('#account-edit-error').textContent='';
 try{
  const result=await api('/api/accounts/update',{userId:editingAccount.id,editVersion:editingAccount.editVersion,name:$('#account-edit-name').value,phone:$('#account-edit-phone').value,scope:$('#account-edit-scope').value,withoutAmo:$('#account-edit-without-amo').checked});
  $('#account-edit-dialog').close();$('#access-dialog').close();$('#account-result').hidden=true;
  if(result.reauthenticate){showLogin();toast('Изменения сохранены. Войдите с обновлёнными данными.');return;}
  if(state?.user.id===result.account.id)state.user.name=result.account.name;
  await loadAccounts();toast(result.phoneChanged?'Сохранено. Подтвердите новый номер в Telegram-боте.':result.changed?'Учётная запись обновлена':'Данные не изменились');
 }catch(e){$('#account-edit-error').textContent=e.message;}finally{$('#account-edit-save').disabled=false;}
});

function updateCreationMode(){const local=$('#account-amo').value==='local';$('#account-local-name-label').hidden=!local;$('#account-local-name').required=local;$('#account-create-policy').textContent=local?'Учётка увидит весь реестр B2B. Права администратора не выдаются.':'Менеджер увидит только свои заявки. Имя берём из amoCRM.';}
$('#account-amo').addEventListener('change',updateCreationMode);

$('#account-edit-without-amo').addEventListener('change',()=>{const detached=$('#account-edit-without-amo').checked;$('#account-edit-unlink-note').hidden=!detached;$('#account-edit-scope').disabled=detached;$('#account-edit-scope').value=detached?'all':editingAccount.scope;});

let accessUsers=[],accessCatalog={},editingAccess=null;
function renderAccess(data){
 accessUsers=data.users;accessCatalog=data.permissions;data.users.sort((a,b)=>Number(b.status==='pending')-Number(a.status==='pending')||a.name.localeCompare(b.name,'ru'));
 const labels={pending:'Ожидает рассмотрения',active:'Доступ разрешён',blocked:'Доступ закрыт'};
 $('#access-list').innerHTML='<table><thead><tr><th>Сотрудник / телефон</th><th>Telegram</th><th>Состояние</th><th>Права</th><th></th></tr></thead><tbody>'+data.users.map(u=>`<tr><td>${esc(u.name)}<br><small>${esc(u.phone||'Номер не указан')}</small></td><td>${esc(u.telegramUsername?'@'+u.telegramUsername:u.telegramUserId||'Не подтверждён')}</td><td>${labels[u.status]||esc(u.status)}</td><td>${u.permissions.map(p=>esc(data.permissions[p]||p)).join('<br>')||'Нет прав'}</td><td><button data-access-id="${esc(u.id)}" class="secondary">${u.status==='pending'?'Рассмотреть':'Изменить доступ'}</button></td></tr>`).join('')+'</tbody></table>';
 api('/api/access/audit').then(r=>{$('#access-audit').innerHTML=r.events.slice(0,40).map(x=>`<p><small>${fmt(x.at)} ${time(x.at)}</small> · ${esc(auditLabel(x.action))} · ${esc(accessUsers.find(u=>u.id===x.subject_id)?.name||'Система')}<br><small>${esc(auditDetails(x))}</small></p>`).join('');}).catch(()=>{});
}
$('#access-list').addEventListener('click',e=>{
 const b=e.target.closest('[data-access-id]');if(!b)return;editingAccess=accessUsers.find(u=>u.id===b.dataset.accessId);if(!editingAccess)return;
 $('#access-title').textContent=editingAccess.name;$('#access-summary').textContent=[editingAccess.phone,'Зарегистрирован: '+fmt(editingAccess.registeredAt),'Рассмотрен: '+fmt(editingAccess.reviewedAt),'Изменён: '+fmt(editingAccess.updatedAt)].join(' · ');
 $('#access-status').value=editingAccess.status;$('#access-dialog-error').textContent='';
 $('#access-permissions').innerHTML='<legend>Разрешённые функции</legend>'+Object.entries(accessCatalog).map(([p,label])=>`<label class="check-label"><input type="checkbox" value="${esc(p)}" ${editingAccess.permissions.includes(p)?'checked':''}>${esc(label)}</label>`).join('');$('#access-dialog').showModal();
});
$('#access-close').addEventListener('click',()=>$('#access-dialog').close());
async function saveAccess(action){
 if(!editingAccess)return;const buttons=$('#access-form').querySelectorAll('button');buttons.forEach(b=>b.disabled=true);$('#access-dialog-error').textContent='';
 try{await api('/api/access/update',{userId:editingAccess.id,version:editingAccess.version,action,status:$('#access-status').value,permissions:[...$('#access-permissions').querySelectorAll('input:checked')].map(i=>i.value)});$('#access-dialog').close();if(editingAccess.id===state?.user.id){showLogin();toast('Изменения сохранены. Войдите заново.');}else{await loadAccounts();toast('Изменения сохранены');}}
 catch(e){$('#access-dialog-error').textContent=e.message;}finally{buttons.forEach(b=>b.disabled=false);}
}
$('#access-form').addEventListener('submit',e=>{e.preventDefault();void saveAccess('update');});
$('#access-revoke').addEventListener('click',()=>void saveAccess('revoke-sessions'));
function auditLabel(action){return ({'login.success':'Успешный вход','login.failed':'Неудачная попытка входа','logout':'Выход','access.changed':'Изменение доступа','sessions.revoked':'Все сессии завершены','registration.pending':'Новая заявка','telegram.bound':'Telegram подтверждён','migration.phone_only':'Включён вход по телефону','account.created':'Аккаунт создан','account.updated':'Данные аккаунта изменены','access.blocked.amo':'Блокировка после изменения amoCRM'})[action]||action;}
function auditDetails(event){const d=JSON.parse(event.detail),actor=accessUsers.find(u=>u.id===event.actor_id)?.name;const parts=actor?['Кто: '+actor]:[];if(d.after){const status={active:'разрешён',blocked:'закрыт',pending:'ожидает рассмотрения'};parts.push('Доступ '+status[d.after.status]);parts.push('Права: '+(d.after.permissions.map(p=>accessCatalog[p]||p).join(', ')||'нет'));}return parts.join(' · ');}
