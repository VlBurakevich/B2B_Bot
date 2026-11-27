import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../store.mjs';
import {createApp} from '../server.mjs';
import {fullRow} from '../export.mjs';
import {evaluateLeadQuality} from '../public/quality.mjs';
const fixture={id:1,name:'Тест',createdAt:'2026-11-23T09:00:00Z',pipelineId:8122290,statusId:75744006,status:'НДЗ',reason:'',raw:{}};
const quality=lead=>evaluateLeadQuality(lead).quality;

test('quality applies the 15 minute limit and only the criteria for the current stage',()=>{
 const base={status:'Новая заявка',takeoverMinutes:15};
 assert.equal(quality(base),true);
 for(const takeoverMinutes of [null,undefined,-1,16,NaN])assert.equal(quality({...base,takeoverMinutes}),false);
 for(const status of ['НДЗ','НДЗ-6','Недозвон']){
  assert.equal(quality({...base,status}),false);
  assert.equal(quality({...base,status,dk:true,messenger:false}),false);
  assert.equal(quality({...base,status,dk:true,messenger:true}),true);
 }
 for(const status of ['Прогрев','На прогрев','В биржу']){
  const lead={...base,status,reason:'Дорого / Нашли дешевле',reasonCorrect:true,notReturned:true};
  assert.equal(quality(lead),true);
  assert.equal(quality({...lead,reason:' '}),false);
  assert.equal(quality({...lead,reasonCorrect:null}),false);
  assert.equal(quality({...lead,reasonCorrect:false}),false);
  assert.equal(quality({...lead,notReturned:false}),false);
  assert.equal(quality({...lead,takeoverMinutes:16}),false);
 }
 assert.equal(quality({...base,dk:false,messenger:false,notReturned:false,reasonCorrect:false}),true);
});

test('controller checks persist independently and quality recalculates after updates and reopening',()=>{
 const dir=mkdtempSync(join(tmpdir(),'b2b-quality-')),file=join(dir,'b2b.sqlite');let store=openStore(file);
 try{
  store.saveLeads([fixture],Date.now());store.saveTakeoverTime(1,10,0,'РОП');assert.equal(store.all()[0].leadQuality,false);
  store.saveLeadFlag(1,'dk',true,0,'Контролёр');store.saveLeadFlag(1,'messenger',true,0,'Контролёр');assert.equal(store.all()[0].leadQuality,true);
  store.saveLeads([{...fixture,status:'На прогрев',reason:'Дорого / Нашли дешевле'}],Date.now());assert.equal(store.all()[0].leadQuality,false);
  store.saveLeadFlag(1,'notReturned',true,0,'Контролёр');assert.equal(store.all()[0].leadQuality,false);
  store.saveLeadFlag(1,'reasonCorrect',true,0,'Контролёр');assert.equal(store.all()[0].leadQuality,true);
  assert.throws(()=>store.saveLeadFlag(1,'reasonCorrect',false,0,'Другой'),{status:409});
  store.db.close();store=openStore(file);let lead=store.all()[0];assert.equal(lead.leadQuality,true);assert.equal(lead.notReturned,true);assert.equal(lead.reasonCorrect,true);assert.equal(lead.dk,true);
  const row=fullRow(lead);assert.equal(row['Лид взят качественно'],'Да');assert.equal(row['Прогрев/биржа не вернули'],'Да');assert.equal(row['Причина отказа верна'],'Да');
  store.saveLeadFlag(1,'notReturned',false,1,'Контролёр');lead=store.all()[0];assert.equal(lead.leadQuality,false);assert.equal(lead.reasonCorrect,true);assert.ok(lead.leadQualityIssues.some(x=>x.includes('не вернули')));
  store.saveLeadFlag(1,'notReturned',null,2,'Контролёр');assert.equal(store.all()[0].notReturned,null);
  assert.throws(()=>store.saveLeadFlag(1,'leadQuality',true,0,'Контролёр'),{status:400});
 }finally{store.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('quality API returns computed result and validates new controller fields and authorization',async()=>{
 const origin='http://127.0.0.1';
 for(const preview of [true,false]){
  const dir=mkdtempSync(join(tmpdir(),'b2b-quality-api-')),app=createApp({dataDir:dir,origin,preview,autoSync:false});
  app.store.saveLeads([{...fixture,status:'В биржу',reason:'Нет потребности'}],Date.now());app.store.saveTakeoverTime(1,15,0,'РОП');
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});const url='http://127.0.0.1:'+app.server.address().port;
  const post=(field,value,version=0,source=origin)=>fetch(url+'/api/lead-flag',{method:'POST',headers:{Origin:source,'Content-Type':'application/json'},body:JSON.stringify({id:1,field,value,version})});
  try{
   if(!preview){assert.equal((await post('notReturned',true)).status,401);continue;}
   assert.equal((await fetch(url+'/quality.mjs')).status,200);
   assert.equal((await post('notReturned',true,0,'http://wrong.example')).status,403);
   assert.equal((await post('notReturned','yes')).status,400);
   assert.equal((await post('reasonCorrect',true,-1)).status,400);
   assert.equal((await post('notReturned',true)).status,200);
   assert.equal((await post('reasonCorrect',true)).status,200);
   let state=await(await fetch(url+'/api/state')).json();assert.equal(state.leads[0].leadQuality,true);
   assert.equal((await post('notReturned',false,0)).status,409);
   assert.equal((await post('notReturned',false,1)).status,200);
   state=await(await fetch(url+'/api/state')).json();assert.equal(state.leads[0].leadQuality,false);assert.equal(state.leads[0].notReturned,false);
  }finally{await new Promise(resolve=>app.server.close(resolve));rmSync(dir,{recursive:true,force:true});}
 }
});
