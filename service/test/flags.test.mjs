import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../store.mjs';
import {createApp} from '../server.mjs';
import {fullRow} from '../export.mjs';
const fixture={id:1,name:'Тест',createdAt:'2026-11-20T09:00:00Z',pipelineId:8122290,statusId:66462274,status:'Новая заявка',raw:{}};

test('yes/no fields persist independently, preserve false and survive CRM updates',()=>{
 const dir=mkdtempSync(join(tmpdir(),'b2b-flags-')),file=join(dir,'b2b.sqlite');let store=openStore(file);
 try{
  store.saveLeads([fixture],Date.now());assert.equal(store.all()[0].dk,null);assert.equal(store.all()[0].messenger,null);
  store.saveLeadFlag(1,'dk',true,0,'РОП');store.saveLeadFlag(1,'messenger',false,0,'РОП');
  assert.throws(()=>store.saveLeadFlag(1,'dk',false,0,'Другой'),{status:409});
  store.saveLeads([{...fixture,status:'Взято в работу',statusId:75837274}],Date.now());
  let item=store.all()[0];assert.equal(item.dk,true);assert.equal(item.messenger,false);assert.equal(item.dkVersion,1);assert.equal(item.messengerVersion,1);
  assert.equal(fullRow(item)['ДК'],'Да');assert.equal(fullRow(item)['Мессенджер'],'Нет');
  store.db.close();store=openStore(file);item=store.all()[0];assert.equal(item.dk,true);assert.equal(item.messenger,false);
  for(const value of ['yes',0,1,undefined])assert.throws(()=>store.saveLeadFlag(1,'dk',value,1,'РОП'),{status:400});
  assert.throws(()=>store.saveLeadFlag(1,'unapproved',true,0,'РОП'),{status:400});
  assert.throws(()=>store.saveLeadFlag(1,'dk',true,-1,'РОП'),{status:400});
  store.saveLeadFlag(1,'dk',null,1,'РОП');assert.equal(store.all()[0].dk,null);assert.equal(store.all()[0].messenger,false);
 }finally{store.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('yes/no API validates values, source, versions and authentication',async()=>{
 const origin='http://127.0.0.1';
 for(const preview of [true,false]){
  const dir=mkdtempSync(join(tmpdir(),'b2b-flags-api-')),app=createApp({dataDir:dir,origin,preview,autoSync:false});
  app.store.saveLeads([fixture],Date.now());
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
  const url='http://127.0.0.1:'+app.server.address().port;
  const post=(data,source=origin)=>fetch(url+'/api/lead-flag',{method:'POST',headers:{Origin:source,'Content-Type':'application/json'},body:JSON.stringify(data)});
  try{
   const data={id:1,field:'dk',value:true,version:0};
   if(!preview){assert.equal((await post(data)).status,401);continue;}
   assert.equal((await post(data,'http://wrong.example')).status,403);
   assert.equal((await post({...data,field:'other'})).status,400);
   assert.equal((await post({...data,value:'yes'})).status,400);
   assert.equal((await post({...data,version:-1})).status,400);
   assert.equal((await post({...data,id:999})).status,404);
   assert.equal((await post(data)).status,200);
   assert.equal((await post({...data,value:false})).status,409);
   assert.equal((await post({...data,field:'messenger',value:false})).status,200);
   const state=await (await fetch(url+'/api/state')).json();assert.equal(state.leads[0].dk,true);assert.equal(state.leads[0].messenger,false);
   assert.equal((await post({...data,value:null,version:1})).status,200);
  }finally{await new Promise(resolve=>app.server.close(resolve));rmSync(dir,{recursive:true,force:true});}
 }
});
