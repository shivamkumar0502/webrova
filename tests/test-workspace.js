import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connectStore, digest } from '../server/workspace/store.js';
import { createFreeApp } from '../server/free/index.js';
import { demoProject } from '../dashboard/src/free/demoProject.js';
import { generateProject } from '../server/free/generation.js';
import { compareFiles } from '../shared/buildReport.js';
let replica;
async function database() {
  replica ||= await MongoMemoryReplSet.create({ replSet: { count: 1, args: ['--nounixsocket', '--setParameter', 'diagnosticDataCollectionEnabled=false'] }, binary: { version: '7.0.24' } });
  return connectStore(replica.getUri(), { dbName: 'test_' + crypto.randomUUID().replaceAll('-', '') });
}
after(async () => { if (replica) await replica.stop(); });
test('atomic daily reservations prevent overuse and roll back all counters',async()=>{
  const store=await database();
  try{
    const limits={global:2,user:1,ip:2};
    const results=await Promise.allSettled([store.reserve('alice','one',limits),store.reserve('alice','one',limits)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal((await store.credits('alice',limits)).remaining,0);
    assert.equal((await store.credits('alice',limits)).globalRemaining,1,'rejected reservation rolls back global counter');
    await store.reserve('bob','two',limits);
    const restarted=await connectStore(replica.getUri(),{dbName:store.db.databaseName});
    assert.equal((await restarted.credits('alice',limits)).remaining,0,'quota survives a new application connection');
    await restarted.close();
    await assert.rejects(store.reserve('charlie','three',limits),/Daily demo limit/);
    const tomorrow=Date.now()+86400000;
    await store.reserve('alice','one',limits,tomorrow);
  }finally{await store.close();}
});
test('cloud workflow enforces auth, ownership, versions, public snapshot boundaries and revocation',async()=>{
  const store=await database();let delivered=[];
  const ownerKey='owner-secret-never-exposed';
  const server=createFreeApp({store,ownerKey,secure:false,limits:{user:3,global:5,ip:5},generate:async o=>{delivered.push(o);return{...demoProject,title:o.existingProject?'Edited board':'My cloud board',files:demoProject.files.map(f=>({...f,content:f.content+(o.existingProject?'\n<!-- edit -->':'' )})),usage:{input:120,output:250}};}}).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/workspace`;
  async function request(path,body,cookie=''){const r=await fetch(base+path,{headers:{'Content-Type':'application/json',Cookie:cookie},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});return{status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')};}
  try{
    assert.equal((await request('/build',{requirement:'Build a task board'})).status,401);
    const alice=await request('/auth/register',{email:'alice@example.test',password:'Unique-password-123'});
    assert.equal(alice.status,200);assert.match(alice.cookie,/HttpOnly/);assert.match(alice.cookie,/SameSite=Strict/);
    const a=alice.cookie.split(';')[0];
    const token=a.split('=')[1];
    assert.ok(await store.sessions.findOne({_id:digest(token)}));
    assert.equal(await store.sessions.findOne({_id:token}),null,'raw session credentials are not stored');
    const secondConnection=await connectStore(replica.getUri(),{dbName:store.db.databaseName});
    assert.equal((await secondConnection.user(token)).email,'alice@example.test','session survives reconnect');
    await secondConnection.close();
    const bob=await request('/auth/register',{email:'bob@example.test',password:'Unique-password-456'});const b=bob.cookie.split(';')[0];
    assert.equal((await request('/auth/login',{email:'alice@example.test',password:'Wrong-password'})).status,401);
    const first=await request('/build',{requirement:'Build a useful task board'},a);assert.equal(first.status,200);const p=first.body.project;
    assert.equal(p.head,1);assert.equal(p.report.usage.output,250);assert.equal(p.report.checks.find(c=>c.label.includes('Backend')).status,'not run');
    assert.equal((await request('/projects/'+p.id,undefined,b)).status,404);
    assert.equal((await request('/projects/'+p.id+'/versions',undefined,b)).status,404);
    const share=await request('/projects/'+p.id+'/share',{head:p.head},a);assert.equal(share.status,200);
    const publicV1=await request('/shares/'+share.body.token);assert.equal(publicV1.body.title,'My cloud board');assert.equal(publicV1.body.email,undefined);assert.equal(JSON.stringify(publicV1.body).includes(ownerKey),false);
    const edit=await request('/build',{requirement:'Add a dark mode toggle',id:p.id,head:1},a);assert.equal(edit.status,200);assert.equal(edit.body.project.head,2);assert.equal(delivered[1].existingProject.title,'My cloud board');assert.equal(delivered[1].apiKey,ownerKey);
    assert.equal((await request('/shares/'+share.body.token)).body.title,'My cloud board','later edits do not update published snapshot');
    assert.equal((await request('/projects/save',{id:p.id,head:1,project:demoProject},a)).status,409,'stale save cannot overwrite newer work');
    const restore=await request('/projects/'+p.id+'/restore',{number:1,head:2},a);assert.equal(restore.status,200);assert.equal(restore.body.head,3);assert.equal(restore.body.title,'My cloud board');
    assert.equal((await request('/projects/'+p.id+'/versions',undefined,a)).body.versions.length,3);
    assert.equal((await request('/auth/me',undefined,a)).body.credits.remaining,1,'restore does not consume AI credit');
    assert.equal((await request('/projects/'+p.id+'/unshare',{},b)).status,404);
    assert.equal((await request('/projects/'+p.id+'/unshare',{},a)).status,200);
    assert.equal((await request('/shares/'+share.body.token)).status,404);
    const csrf=await fetch(base+'/auth/logout',{method:'POST',headers:{'Content-Type':'application/json',Cookie:a,Origin:'https://evil.example'},body:'{}'});assert.equal(csrf.status,403);
    assert.equal((await request('/auth/logout',{},a)).status,200);assert.equal((await request('/auth/me',undefined,a)).status,401);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await store.close();}
});
test('AI edit sends complete prior source and change within one bounded call',async()=>{
  let calls=0;
  await generateProject({requirement:'Add a dark mode toggle',existingProject:demoProject,client:{models:{generateContent:async options=>{calls++;const content=JSON.parse(options.contents);assert.equal(content.change,'Add a dark mode toggle');assert.equal(content.existingProject.files.length,5);return{text:JSON.stringify(demoProject),candidates:[{finishReason:'STOP'}]};}}}});
  assert.equal(calls,1);
  const diff=compareFiles([{path:'a',content:'old'},{path:'b',content:'removed'}],[{path:'a',content:'new'},{path:'c',content:'added'}]);
  assert.deepEqual(diff.map(f=>f.change),['modified','removed','added']);
});
test('missing database fails closed rather than creating temporary accounts',async()=>{
 const server=createFreeApp({ownerKey:'server-secret'}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const base=`http://127.0.0.1:${server.address().port}/api/workspace`;const config=await(await fetch(base+'/config')).json();assert.equal(config.accounts,false);assert.equal(config.aiReady,false);assert.equal((await fetch(base+'/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'x@y.test',password:'Something-unique'})})).status,503);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('parallel MongoDB reservations respect the global cap without overspending', async()=>{
  const store=await database();const limits={global:5,user:2,ip:2};
  try {
    const outcomes=await Promise.allSettled(Array.from({length:10},(_,i)=>store.reserve('parallel-'+i,'ip-'+i,limits)));
    assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,5);
    assert.equal(outcomes.filter(r=>r.status==='rejected').every(r=>r.reason.status===429),true);
    assert.equal((await store.credits('unused-user',limits)).globalRemaining,0);
    const rows=await store.quotas.find({_id:/build:user:parallel-/}).toArray();
    assert.equal(rows.reduce((sum,r)=>sum+r.used,0),5,'failed reservations do not spend user counters');
  } finally {await store.close();}
});
test('MongoDB optimistic writes preserve versions and enforce session expiry', async()=>{
  const store=await database();
  try {
    const user=await store.createUser('versions@example.test','test-only-hash','versions-ip');
    const first=await store.save(user.id,null,0,demoProject,'Initial snapshot');
    const outcomes=await Promise.allSettled([
      store.save(user.id,first.id,1,{...demoProject,title:'First tab'},'First tab edit'),
      store.save(user.id,first.id,1,{...demoProject,title:'Second tab'},'Second tab edit')
    ]);
    assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(outcomes.find(r=>r.status==='rejected').reason.status,409);
    assert.equal((await store.versions(user.id,first.id)).length,2);
    assert.equal((await store.version(user.id,first.id,1)).title,demoProject.title);
    await assert.rejects(store.project(user.id,{$ne:null}),/Project not found/);
    const token=await store.session(user.id);
    await store.sessions.updateOne({_id:digest(token)},{$set:{expires:new Date(Date.now()-1000)}});
    assert.equal(await store.user(token),null,'expired session rejected before TTL cleanup');
  } finally {await store.close();}
});
