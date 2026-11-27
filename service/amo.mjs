export const DOMAIN='gruz4ikimoskva.amocrm.ru';
export const PIPELINE=8122290, ENTRY=66462274;
export const FIELD={quotas:1064481,category:1054425,reason:1019381};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
export class AmoClient {
  constructor(token,transport=fetch){if(!token)throw Error('Подключение amoCRM не настроено.');this.token=token;this.transport=transport;this.next=0;}
  async get(path){
    if(!path.startsWith('/api/v4/')||path.includes('://'))throw Error('Недопустимый путь API.');
    await delay(Math.max(0,this.next-Date.now()));this.next=Date.now()+300;
    for(let attempt=0;attempt<3;attempt++){
      let r;try{r=await this.transport('https://'+DOMAIN+path,{headers:{Authorization:'Bearer '+this.token,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(20000)});}catch{throw Error('Не удалось соединиться с amoCRM. Последние сохранённые данные доступны.');}
      if(r.status===429||r.status>=500){if(attempt<2){await delay(1000*(attempt+1));continue;}}
      if(r.status===204)return {};
      if(!r.ok){const errors={401:'amoCRM отклонила токен. Обновите доступ интеграции.',403:'Недостаточно прав на чтение данных amoCRM.',429:'amoCRM ограничила частоту запросов. Повторим позже.'};throw Error(errors[r.status]??'Ошибка amoCRM: HTTP '+r.status);}
      return r.json();
    }
  }
  async list(path,key,limit=250,max=200){let out=[];for(let page=1;page<=max;page++){
    const r=await this.get(path+(path.includes('?')?'&':'?')+new URLSearchParams({limit:String(limit),page:String(page)}));
    const items=r._embedded?.[key]??[];if(!Array.isArray(items))throw Error('Неожиданный формат ответа amoCRM.');out.push(...items);
    if(!r._links?.next)return out;
  }throw Error('Выборка amoCRM превышает предел безопасной загрузки. Сохранённые данные не заменены.');}
  async byIds(kind,ids){let out=[];const unique=[...new Set(ids)].filter(id=>Number.isSafeInteger(id)&&id>0);for(let i=0;i<unique.length;i+=80){const p=new URLSearchParams();for(const id of unique.slice(i,i+80))p.append('filter[id][]',id);if(kind==='leads')p.set('with','contacts');out.push(...await this.list('/api/v4/'+kind+'?'+p,kind));}return out;}
}
export const fieldValue=(entity,id)=>{const f=entity.custom_fields_values?.find(f=>f.field_id===id);return f?.values?.map(x=>x.value).filter(x=>x!==null&&x!==undefined&&x!=='')??[];};
export const display=value=>value===null||value===undefined?'':typeof value==='object'?JSON.stringify(value):String(value);
export function normalizeLead(raw,{users,statuses,contacts,companies}){
  const custom=raw.custom_fields_values??[];
  const q=fieldValue(raw,FIELD.quotas)[0];const number=q===undefined?null:Number(String(q).replace(',','.'));
  return {id:raw.id,name:raw.name||'Сделка #'+raw.id,createdAt:new Date(raw.created_at*1000).toISOString(),updatedAt:new Date(raw.updated_at*1000).toISOString(),responsible:users.get(raw.responsible_user_id)?.name??'ID '+raw.responsible_user_id,quotas:Number.isFinite(number)?number:null,
    category:fieldValue(raw,FIELD.category).map(display).join(', '),statusId:raw.status_id,pipelineId:raw.pipeline_id,status:statuses.get(raw.pipeline_id+':'+raw.status_id)??'Этап '+raw.status_id,
    reason:fieldValue(raw,FIELD.reason).map(display).join(', ')||raw._embedded?.loss_reason?.name||'',
    customFields:custom,contacts:(raw._embedded?.contacts??[]).map(x=>contacts.get(x.id)).filter(Boolean),companies:(raw._embedded?.companies??[]).map(x=>companies.get(x.id)).filter(Boolean),raw};
}
export async function runSync(store,client){
  const started=Date.now(),to=Math.floor(started/1000),cohortStart=store.get('cohortStart',to);
  store.set('cohortStart',cohortStart);
  const from=Math.max(cohortStart,store.get('cursor',to)-300);
  const pipelines=await client.list('/api/v4/leads/pipelines','pipelines');
  const users=await client.list('/api/v4/users','users');
  const fields=await client.list('/api/v4/leads/custom_fields','custom_fields');
  const statuses=new Map(pipelines.flatMap(p=>(p._embedded?.statuses??[]).map(s=>[p.id+':'+s.id,s.name])));
  if(!pipelines.some(p=>p.id===PIPELINE&&p._embedded?.statuses?.some(s=>s.id===ENTRY)))throw Error('Нужная воронка или этап не доступны интеграции.');
  const current=await client.list('/api/v4/leads?'+new URLSearchParams({'filter[statuses][0][pipeline_id]':String(PIPELINE),'filter[statuses][0][status_id]':String(ENTRY),with:'contacts'}),'leads');
  const candidates=new Set(current.map(l=>l.id));
  const prior=store.all();const tracked=new Set(prior.map(l=>l.id));
  // Read both entries and exits: a lead created directly in the entry stage can leave between polls.
  for(const side of ['value_after','value_before']){
    const p=new URLSearchParams({'filter[entity]':'lead','filter[type]':'lead_status_changed','filter[created_at][from]':String(from),'filter[created_at][to]':String(to),[`filter[${side}][leads_statuses][0][pipeline_id]`]:String(PIPELINE),[`filter[${side}][leads_statuses][0][status_id]`]:String(ENTRY)});
    for(const e of await client.list('/api/v4/events?'+p,'events',100))candidates.add(e.entity_id);
  }
  const fresh=await client.byIds('leads',[...new Set([...tracked,...candidates])]);
  // A new fetch is authoritative; do not overwrite it with an older page from the entry-stage scan.
  const map=new Map(current.map(l=>[l.id,l]));for(const l of fresh)map.set(l.id,l);
  const rawLeads=[...map.values()];
  const contacts=await client.byIds('contacts',rawLeads.flatMap(l=>(l._embedded?.contacts??[]).map(x=>x.id)));
  const companies=await client.byIds('companies',rawLeads.flatMap(l=>(l._embedded?.companies??[]).map(x=>x.id)));
  const ctx={users:new Map(users.map(u=>[u.id,u])),statuses,contacts:new Map(contacts.map(c=>[c.id,c])),companies:new Map(companies.map(c=>[c.id,c]))};
  const normalized=rawLeads.map(l=>normalizeLead(l,ctx));
  const returned=new Set(rawLeads.map(l=>l.id));
  // Retain the last snapshot for removed or newly inaccessible leads, with an explicit marker.
  const unavailable=prior.filter(l=>!returned.has(l.id)).map(l=>({id:l.id,name:l.name,createdAt:l.createdAt,updatedAt:l.updatedAt,responsible:l.responsible,quotas:l.quotas,category:l.category,statusId:l.statusId,pipelineId:l.pipelineId,status:l.status,reason:l.reason,customFields:l.customFields,contacts:l.contacts,companies:l.companies,raw:l.raw,unavailable:true}));
  const at=Date.now();store.transaction(()=>{store.saveLeads(normalized,at);for(const l of unavailable)store.db.prepare('UPDATE leads SET data=? WHERE id=?').run(JSON.stringify(l),l.id);store.set('metadata',{pipelines,fields,users:users.map(u=>({id:u.id,name:u.name}))});store.set('cursor',to);store.set('lastSync',{at,count:normalized.length,unavailable:unavailable.length,durationMs:at-started});store.set('syncError',null);});
  return {count:normalized.length,at};
}
