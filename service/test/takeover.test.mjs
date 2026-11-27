import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../store.mjs';
import {createApp} from '../server.mjs';
import {fullRow} from '../export.mjs';
const fixture={id:1,name:'Тест',createdAt:'2026-11-20T09:00:00Z',pipelineId:8122290,statusId:66462274,status:'Новая заявка',raw:{}};

test('takeover duration persists separately from CRM updates, protects stale writers and preserves zero/empty',()=>{
 const dir=mkdtempSync(join(tmpdir(),'b2b-duration-')),file=join(dir,'b2b.sqlite');let store=openStore(file);
 try{
  store.saveLeads([fixture],Date.now());assert.equal(store.all()[0].takeoverMinutes,null);
  store.saveTakeoverTime(1,0,0,'РОП');assert.equal(store.all()[0].takeoverMinutes,0);
  assert.throws(()=>store.saveTakeoverTime(1,90,0,'Другой'),{status:409});
  store.saveTakeoverTime(1,1515,1,'РОП');
  store.saveLeads([{...fixture,status:'Взято в работу',statusId:75837274}],Date.now());
  assert.equal(store.all()[0].takeoverMinutes,1515);
  assert.equal(fullRow(store.all()[0])['Скорость взятия в работу (ЧЧ:ММ)'],'25:15');
  store.db.close();store=openStore(file);assert.equal(store.all()[0].takeoverMinutes,1515);
  for(const invalid of [-1,1.5,600000,undefined,'01:30'])assert.throws(()=>store.saveTakeoverTime(1,invalid,2,'РОП'),{status:400});
  assert.throws(()=>store.saveTakeoverTime(999,30,0,'РОП'),{status:404});
  store.saveTakeoverTime(1,null,2,'РОП');assert.equal(store.all()[0].takeoverMinutes,null);assert.equal(store.all()[0].takeoverVersion,3);
 }finally{store.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('takeover API validates duration, origin, versions, persistence and authenticated access',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'b2b-duration-api-')),origin='http://127.0.0.1';
 const app=createApp({dataDir:dir,origin,preview:true,autoSync:false});
 app.store.saveLeads([fixture],Date.now());
 await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
 const url='http://127.0.0.1:'+app.server.address().port;
 const post=(data,source=origin)=>fetch(url+'/api/takeover-time',{method:'POST',headers:{Origin:source,'Content-Type':'application/json'},body:JSON.stringify(data)});
 try{
  assert.equal((await post({id:1,minutes:90,version:0},'http://wrong.example')).status,403);
  for(const minutes of [-1,0.5,600000,'01:30'])assert.equal((await post({id:1,minutes,version:0})).status,400);
  assert.equal((await post({id:1,version:0})).status,400);
  const saved=await post({id:1,minutes:90,version:0});assert.equal(saved.status,200);assert.equal((await saved.json()).takeoverMinutes,90);
  assert.equal((await post({id:1,minutes:120,version:0})).status,409);
  const state=await (await fetch(url+'/api/state')).json();assert.equal(state.leads[0].takeoverMinutes,90);
  assert.equal((await post({id:1,minutes:null,version:1})).status,200);
 }finally{await new Promise(resolve=>app.server.close(resolve));rmSync(dir,{recursive:true,force:true});}
 const authDir=mkdtempSync(join(tmpdir(),'b2b-duration-auth-'));
 const auth=createApp({dataDir:authDir,origin,autoSync:false});
 await new Promise((resolve,reject)=>{auth.server.once('error',reject);auth.server.listen(0,'127.0.0.1',resolve);});
 try{
  const response=await fetch('http://127.0.0.1:'+auth.server.address().port+'/api/takeover-time',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({id:1,minutes:30,version:0})});
  assert.equal(response.status,401);
 }finally{await new Promise(resolve=>auth.server.close(resolve));rmSync(authDir,{recursive:true,force:true});}
});
