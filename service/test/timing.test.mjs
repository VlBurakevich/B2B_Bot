import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../store.mjs';
import {createApp} from '../server.mjs';
import {fullRow} from '../export.mjs';
import {parseClock,parseDateTime,clockParts,durationMinutes,formatDuration,timingClass} from '../public/timing.mjs';
const fixture={id:1,name:'Тест',createdAt:'2026-11-20T09:00:37Z',pipelineId:8122290,statusId:66462274,status:'Новая заявка',raw:{}};

test('clock input, Moscow dates, midnight, long duration and exact 15 minute threshold',()=>{
 for(const [input,result] of [['0023','00:23'],['134','01:34'],['5','00:05'],['2359','23:59'],['1:05','01:05']])assert.equal(parseClock(input),result);
 for(const input of ['2400','2360','-1','12345','1:5','x'])assert.throws(()=>parseClock(input));
 assert.throws(()=>parseDateTime('2026-02-30','1200'));
 assert.deepEqual(clockParts(parseDateTime('2026-11-20','134')),{date:'2026-11-20',clock:'01:34'});
 const start=parseDateTime('2026-11-20','2359'),end=parseDateTime('2026-11-21','0010');
 assert.equal(durationMinutes(start,end),11);assert.equal(formatDuration(11),'00:11');
 assert.equal(formatDuration(durationMinutes(start,parseDateTime('2026-11-22','0010'))),'24:11');
 assert.equal(timingClass(14),'is-fast');assert.equal(timingClass(15),'is-fast');assert.equal(timingClass(16),'is-late');assert.equal(timingClass(null),'');
});

test('timestamps preserve legacy durations, persist, reject negative delay and survive CRM sync',()=>{
 const dir=mkdtempSync(join(tmpdir(),'b2b-timing-')),file=join(dir,'b2b.sqlite');let store=openStore(file);
 try{
  store.saveLeads([fixture],Date.now());let lead=store.all()[0];
  assert.equal(lead.requestedAt,parseDateTime('2026-11-20','1200'));assert.equal(lead.takenAt,null);assert.equal(lead.takeoverMinutes,null);
  store.saveTakeoverTime(1,34,0,'РОП');lead=store.all()[0];assert.equal(lead.takenAt,parseDateTime('2026-11-20','1234'));assert.equal(lead.takeoverMinutes,34);
  store.saveLeadTimestamp(1,'takenAt',parseDateTime('2026-11-20','1215'),0,'РОП');lead=store.all()[0];assert.equal(lead.takeoverMinutes,15);
  assert.throws(()=>store.saveLeadTimestamp(1,'takenAt',parseDateTime('2026-11-20','1216'),0,'Другой'),{status:409});
  assert.throws(()=>store.saveLeadTimestamp(1,'takenAt',parseDateTime('2026-11-20','1159'),1,'РОП'),{status:400});
  assert.equal(store.all()[0].takeoverMinutes,15);
  store.saveLeadTimestamp(1,'requestedAt',parseDateTime('2026-11-19','1200'),1,'РОП');assert.equal(store.all()[0].takeoverMinutes,1455);
  store.saveLeads([{...fixture,createdAt:'2026-11-21T09:00:00Z',status:'Взято в работу',statusId:75837274}],Date.now());
  assert.equal(store.all()[0].requestedAt,parseDateTime('2026-11-19','1200'));
  store.db.close();store=openStore(file);lead=store.all()[0];assert.equal(lead.takeoverMinutes,1455);
  const exported=fullRow(lead);assert.equal(exported['Время заявки'],'19.11.2026 12:00');assert.equal(exported['Скорость взятия в работу (ЧЧ:ММ)'],'24:15');
  store.saveLeadTimestamp(1,'takenAt',null,2,'РОП');assert.equal(store.all()[0].takeoverMinutes,null);assert.equal(store.all()[0].takenAt,null);
  for(const bad of [undefined,'134',Date.now()+1,-60000])assert.throws(()=>store.saveLeadTimestamp(1,'takenAt',bad,3,'РОП'),{status:400});
  assert.throws(()=>store.saveLeadTimestamp(1,'other',null,3,'РОП'),{status:400});
 }finally{store.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('timestamp API validates origin, date, order, version, authorization and serves shared helpers',async()=>{
 const origin='http://127.0.0.1';
 for(const preview of [true,false]){
  const dir=mkdtempSync(join(tmpdir(),'b2b-timing-api-')),app=createApp({dataDir:dir,origin,preview,autoSync:false});app.store.saveLeads([fixture],Date.now());
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});const url='http://127.0.0.1:'+app.server.address().port;
  const post=(data,source=origin)=>fetch(url+'/api/lead-timestamp',{method:'POST',headers:{Origin:source,'Content-Type':'application/json'},body:JSON.stringify(data)});
  try{
   const data={id:1,field:'takenAt',timestamp:parseDateTime('2026-11-20','1216'),version:0};
   if(!preview){assert.equal((await post(data)).status,401);continue;}
   assert.equal((await fetch(url+'/timing.mjs')).status,200);
   assert.equal((await post(data,'http://wrong.example')).status,403);
   assert.equal((await post({...data,timestamp:'1216'})).status,400);
   assert.equal((await post({...data,timestamp:parseDateTime('2026-11-20','1159')})).status,400);
   assert.equal((await post({...data,field:'other'})).status,400);
   assert.equal((await post({...data,id:999})).status,404);
   const saved=await post(data);assert.equal(saved.status,200);assert.equal((await saved.json()).takeoverMinutes,16);
   assert.equal((await post(data)).status,409);
   const state=await(await fetch(url+'/api/state')).json();assert.equal(state.leads[0].takeoverMinutes,16);
  }finally{await new Promise(resolve=>app.server.close(resolve));rmSync(dir,{recursive:true,force:true});}
 }
});
