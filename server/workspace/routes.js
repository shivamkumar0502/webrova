import express from 'express';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { fail } from './store.js';
import { validateProject, generateProject } from '../free/generation.js';
import { buildReport } from '../../shared/buildReport.js';
const derive = promisify(scrypt);
const hashPassword = async (password,salt=randomBytes(16).toString('hex')) => salt+':'+(await derive(password,salt,64,{N:32768,maxmem:64*1024*1024})).toString('hex');
const checkPassword = async (password,hash) => { const actual=await hashPassword(password,hash.split(':')[0]); return actual.length===hash.length && timingSafeEqual(Buffer.from(actual),Buffer.from(hash)); };
const sessionToken = req => /(?:^|;\s*)wr_session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(req.headers.cookie||'')?.[1];
const bounded = (value, fallback, max) => Number.isInteger(Number(value)) && Number(value)>0 ? Math.min(Number(value),max) : fallback;
export function workspaceRouter({ store, ownerKey = '', model = 'gemini-2.5-flash', generate = generateProject, secure = true, limits = {} }={}) {
  const router=express.Router();
  const caps={user:bounded(limits.user,3,20),global:bounded(limits.global,20,200),ip:bounded(limits.ip,6,30)};
  const route=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  const protect=(req,res,next)=>{ Promise.resolve(store.user(sessionToken(req))).then(user=>{if(!user)throw fail(401,'Sign in to use your cloud workspace.');req.user=user;next();}).catch(next); };
  router.get('/config', (_req,res)=>res.json({accounts:!!store, aiReady:!!store&&!!ownerKey, creditsPerDay:caps.user, globalBuildsPerDay:caps.global, storage:store?'mongodb':'not-configured', version:'4.1.0'}));
  router.use((req,res,next)=>{
    if(!store)return res.status(503).json({error:'Cloud workspace needs MONGODB_URI in the server environment. Sample projects and local history still work.'});
    if(!['GET','HEAD'].includes(req.method)) {
      const origin=req.get('origin');
      if(origin) { try { if(new URL(origin).host!==req.get('host'))throw Error(); } catch { return res.status(403).json({error:'Use this app from its own website.'}); } }
      if(!req.is('application/json'))return res.status(415).json({error:'Use a JSON request.'});
    }
    next();
  });
  const authAttempts=new Map(); let activeAuth=0;
  const guardAuth=(req,res,next)=>{
    const now=Date.now(); for(const [ip,r] of authAttempts)if(now-r.at>600000)authAttempts.delete(ip);
    const entry=authAttempts.get(req.ip)||{at:now,count:0};
    if(entry.count>=10 || activeAuth>=4 || authAttempts.size>=2000&&!authAttempts.has(req.ip))return res.status(429).json({error:'Too many sign-in attempts. Retry in 10 minutes.'});
    entry.count++;authAttempts.set(req.ip,entry);activeAuth++;res.once('finish',()=>activeAuth--);next();
  };
  const cookie=(res,token,age=7*86400000)=>res.cookie('wr_session',token,{httpOnly:true,secure,sameSite:'strict',path:'/',maxAge:age});
  for(const action of ['register','login']) router.post('/auth/'+action,guardAuth,route(async(req,res)=>{
    const {email:raw,password}=req.body||{}; const email=typeof raw==='string'?raw.trim().toLowerCase():'';
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||typeof password!=='string'||password.length<10||password.length>128)throw fail(400,'Use a valid email and a password of 10–128 characters.');
    await store.authAttempt(req.ip);
    let user;
    if(action==='register'){
      try { user=await store.createUser(email,await hashPassword(password),req.ip); }
      catch(e){ if(e.code===11000)throw fail(409,'Account cannot be created. Try signing in.'); throw e; }
    } else {
      const found=await store.userByEmail(email);
      // Always run scrypt, even for unknown users.
      const hash=found?.password || '00000000000000000000000000000000:'+ '0'.repeat(128);
      if(!await checkPassword(password,hash)||!found)throw fail(401,'Email or password is incorrect.');
      user={id:found.id,email:found.email};
    }
    cookie(res,await store.session(user.id));res.json({user,credits:await store.credits(user.id,caps)});
  }));
  router.get('/auth/me',protect,route(async(req,res)=>res.json({user:req.user,credits:await store.credits(req.user.id,caps)})));
  router.post('/auth/logout',route(async(req,res)=>{await store.logout(sessionToken(req));cookie(res,'',0);res.json({ok:true});}));
  router.get('/shares/:token',route(async(req,res)=>res.json(await store.shared(req.params.token))));
  router.use(protect);
  router.get('/projects',route(async(req,res)=>res.json({projects:await store.list(req.user.id)})));
  router.get('/projects/:id',route(async(req,res)=>res.json(await store.project(req.user.id,req.params.id))));
  router.get('/projects/:id/versions',route(async(req,res)=>res.json({versions:await store.versions(req.user.id,req.params.id)})));
  router.get('/projects/:id/versions/:number',route(async(req,res)=>res.json(await store.version(req.user.id,req.params.id,Number(req.params.number)))));
  router.post('/projects/save',route(async(req,res)=>{
    const body=req.body||{}, snapshot=validateProject(body.project), id=typeof body.id==='string'?body.id:null;
    const previous=id?await store.project(req.user.id,id):null;
    snapshot.report=buildReport(snapshot,previous,{kind:id?'manual edit':'import'});
    snapshot.generatedAt=new Date().toISOString();
    res.json(await store.save(req.user.id,id,Number(body.head||0),snapshot,id?'Manual code edit':'Imported project'));
  }));
  router.post('/projects/:id/restore',route(async(req,res)=>{
    const snapshot=await store.version(req.user.id,req.params.id,Number(req.body.number));
    // Restore appends a version. It never removes newer snapshots or charges credits.
    res.json(await store.save(req.user.id,req.params.id,Number(req.body.head),snapshot,'Restored version '+req.body.number));
  }));
  router.post('/projects/:id/share',route(async(req,res)=>res.json({token:await store.share(req.user.id,req.params.id,Number(req.body.head))})));
  router.post('/projects/:id/unshare',route(async(req,res)=>{await store.unshare(req.user.id,req.params.id);res.json({ok:true});}));
  let active=0;
  const inFlight=new Set();
  router.post('/build',route(async(req,res)=>{
    if(!ownerKey)throw fail(503,'AI builds are not configured yet. The owner must set GEMINI_API_KEY on the server. No personal key is required.');
    const {requirement,id,head}=req.body||{};
    if(typeof requirement!=='string'||requirement.trim().length<10||requirement.length>6000)throw fail(400,'Describe your change in 10–6000 characters.');
    if(active>=2||inFlight.has(req.user.id))throw fail(429,'A build is already running. Please wait.');
    active++;inFlight.add(req.user.id);
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),100000);
    const onClose=()=>{if(!res.writableEnded)controller.abort();}; res.on('close',onClose);
    try {
      const previous=id?await store.project(req.user.id,id):null;
      if(previous && previous.head!==Number(head))throw fail(409,'Project changed. Reopen the latest version before editing.');
      if(previous && JSON.stringify(previous.files).length>150000)throw fail(413,'This project is too large for the demo edit budget. Export it to continue elsewhere.');
      if(previous?.head>=30)throw fail(409,'Version limit reached. Export this project.');
      if(!previous&&(await store.list(req.user.id)).length>=20)throw fail(409,'Project limit reached. This demo holds 20 projects.');
      await store.reserve(req.user.id,req.ip,caps);
      const started=Date.now(); let generated;
      try { generated=await generate({requirement:requirement.trim(),existingProject:previous,apiKey:ownerKey,model,signal:controller.signal}); }
      catch(e) {
        const quota=Number(e.status||e.code)===429;
        throw fail(quota?429:controller.signal.aborted?504:502,quota?'AI provider quota reached. Please retry after the provider resets.':controller.signal.aborted?'Build timed out or was cancelled.':'AI generation failed. Try a smaller change or contact the owner.');
      }
      const snapshot={...validateProject(generated),usage:generated.usage,generatedAt:new Date().toISOString()};
      snapshot.report=buildReport(snapshot,previous,{durationMs:Date.now()-started,model,kind:previous?'AI edit':'AI build'});
      const saved=await store.save(req.user.id,previous?.id||null,previous?.head||0,snapshot,previous?'AI edit: '+requirement:'Initial AI build');
      if(!res.destroyed)res.json({project:saved,credits:await store.credits(req.user.id,caps)});
    } finally {clearTimeout(timer);res.off('close',onClose);active--;inFlight.delete(req.user.id);}
  }));
  router.use((e,_req,res,_next)=>{ if(!res.destroyed)res.status([400,401,403,404,409,413,415,422,429,502,503,504].includes(e.status)?e.status:503).json({error:e.status?e.message:'Cloud workspace is temporarily unavailable. Please retry.'}); });
  return router;
}
