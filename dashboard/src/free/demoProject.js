const frontend = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Focus Board</title><style>
*{box-sizing:border-box}body{margin:0;background:#f2f0e9;color:#202c29;font:15px system-ui;padding:40px 24px}main{max-width:850px;margin:auto}.label{font-size:11px;letter-spacing:2px;color:#668578}h1{font-size:44px;margin:12px 0}.desc{color:#6b7770;margin-bottom:30px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.card{padding:22px;border:1px solid #d9dfd7;border-radius:15px;background:#fffdf7}h2{font-size:15px;margin:0 0 20px}.task{display:flex;align-items:center;gap:10px;border-top:1px solid #e8e9e1;padding:15px 0}.task span{flex:1}.done{text-decoration:line-through;color:#839087}button{border:0;border-radius:6px;padding:8px 12px;background:#245f4c;color:white;cursor:pointer}button.delete{background:#f1e6df;color:#85554b}form{display:flex;gap:8px;margin-bottom:24px}input[type=text]{flex:1;min-width:0;border:1px solid #cdd6ca;border-radius:7px;padding:12px;font:inherit}.note{font-size:12px;color:#758277;margin-top:24px}@media(max-width:600px){.grid{grid-template-columns:1fr}h1{font-size:32px}}
</style></head><body><main><div class="label">FOCUS BOARD / SAMPLE PROJECT</div><h1>Make room for good work.</h1><p class="desc">A small place for the things that move your day forward.</p><form id="add"><input id="title" type="text" aria-label="Task title" placeholder="What needs your focus?" required maxlength="120"><button>Add task</button></form><div class="grid"><section class="card"><h2>UP NEXT</h2><div id="todo"></div></section><section class="card"><h2>DONE & DUSTED</h2><div id="done"></div></section></div><p class="note" id="note"></p></main><script>
const preview=location.protocol==='about:';let tasks=[{id:1,title:'Sketch the product idea',done:false},{id:2,title:'Build the first version',done:false},{id:3,title:'Choose a name',done:true}];
async function load(){if(!preview){const r=await fetch('/api/tasks');if(!r.ok)throw Error('Could not load tasks');tasks=await r.json()}render()}
function render(){for(const [target,done]of [['todo',false],['done',true]]){const root=document.getElementById(target);root.replaceChildren();const list=tasks.filter(t=>!!t.done===done);if(!list.length)root.textContent=done?'Finished tasks appear here.':'All clear. Add your next task.';for(const t of list){const row=document.createElement('div');row.className='task';const check=document.createElement('input');check.type='checkbox';check.checked=!!t.done;check.setAttribute('aria-label','Complete '+t.title);check.onchange=async()=>{if(!preview){const r=await fetch('/api/tasks/'+t.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({done:check.checked})});if(!r.ok){document.getElementById('note').textContent='Update failed';return}}t.done=check.checked;render()};const title=document.createElement('span');title.textContent=t.title;if(done)title.className='done';const del=document.createElement('button');del.className='delete';del.textContent='×';del.setAttribute('aria-label','Delete '+t.title);del.onclick=async()=>{if(!preview){const r=await fetch('/api/tasks/'+t.id,{method:'DELETE'});if(!r.ok){document.getElementById('note').textContent='Delete failed';return}}tasks=tasks.filter(x=>x.id!==t.id);render()};row.append(check,title,del);root.append(row)}}document.getElementById('note').textContent=preview?'Preview uses sample data in memory. Backend is not running.':'Connected to your SQLite backend.'}
document.getElementById('add').onsubmit=async e=>{e.preventDefault();const input=document.getElementById('title');const title=input.value.trim();if(!title)return;try{if(preview)tasks.push({id:Date.now(),title,done:false});else{const r=await fetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title})});if(!r.ok)throw Error('Could not save task');tasks.push(await r.json())}input.value='';render()}catch(err){document.getElementById('note').textContent=err.message}};load().catch(err=>document.getElementById('note').textContent=err.message);
</script></body></html>`;
const backend = `import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const db=new DatabaseSync(process.env.DATABASE_PATH || path.join(root,'tasks.db'));
db.exec('CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY,title TEXT NOT NULL,done INTEGER NOT NULL DEFAULT 0)');
const app=express(); app.disable('x-powered-by'); app.use(express.json({limit:'10kb'}));
app.get('/api/health',(_req,res)=>res.json({status:'ok'}));
app.get('/api/tasks',(_req,res)=>res.json(db.prepare('SELECT * FROM tasks ORDER BY id DESC').all()));
app.post('/api/tasks',(req,res)=>{const title=typeof req.body.title==='string'?req.body.title.trim():'';if(!title||title.length>120)return res.status(400).json({error:'Title must contain 1–120 characters'});const result=db.prepare('INSERT INTO tasks(title) VALUES(?)').run(title);res.status(201).json({id:Number(result.lastInsertRowid),title,done:0})});
app.patch('/api/tasks/:id',(req,res)=>{if(typeof req.body.done!=='boolean')return res.status(400).json({error:'done must be boolean'});const result=db.prepare('UPDATE tasks SET done=? WHERE id=?').run(req.body.done?1:0,req.params.id);if(!result.changes)return res.status(404).json({error:'Task not found'});res.json({ok:true})});
app.delete('/api/tasks/:id',(req,res)=>{const result=db.prepare('DELETE FROM tasks WHERE id=?').run(req.params.id);if(!result.changes)return res.status(404).json({error:'Task not found'});res.json({ok:true})});
app.use(express.static(path.join(root,'../frontend')));
app.use((err,_req,res,_next)=>res.status(500).json({error:'Request failed'}));
const server=app.listen(process.env.PORT || 3000,'0.0.0.0');
process.on('SIGTERM',()=>server.close(()=>{db.close();process.exit(0)}));
`;
export const demoProject = {
  title: 'Focus Board',
  summary: 'A working sample task board. Browser preview uses in-memory sample data; the exported backend implements the API with SQLite.',
  sample: true,
  files: [
    { path: 'frontend/index.html', content: frontend },
    { path: 'backend/server.mjs', content: backend },
    { path: 'backend/package.json', content: JSON.stringify({name:'focus-board',type:'module',engines:{node:'>=22.13'},scripts:{start:'node server.mjs'},dependencies:{express:'^4.21.2'}},null,2) },
    { path: 'database/schema.sql', content: 'CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0);\n' },
    { path: 'README.md', content: '# Focus Board\n\nSample project supplied by Webrova. This sample was not AI-generated during your session.\n\n## Run the exported full-stack app\n\nUse Node 22.13+; inside backend run npm install then npm start. Open http://localhost:3000.\n\n## Deploy\n\nDeploy the backend folder as a Node web service. Build: npm install. Start: npm start. Include the sibling frontend folder in the deployment.\n\nSQLite on free ephemeral hosting loses data on restart. Use a suitable persistent database before storing important data. Webrova itself previews only the frontend and never executes this backend. No user accounts/authentication are provided.\n' },
  ],
};
