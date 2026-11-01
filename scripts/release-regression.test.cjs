const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{webcrypto,createHash}=require('node:crypto');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'sw.js'),'utf8'),base='https://example.test/gotland_sea_trout/';
const sha=s=>createHash('sha256').update(s).digest('hex');
function harness(options={}){
 const id=options.id||'6240',bodies={'index.html':'HTML '+id,['app.js?v='+id]:'APP '+id,['current-field.js?v='+id]:'MODULE '+id,['current-field-worker.js?v='+id]:'WORKER '+id,['data/gotland-coast-mask.json?v='+id]:'MASK '+id};
 const table=Object.entries(bodies).map(([p,b])=>[p,sha(b)]),stores=options.stores||new Map(),calls=[],listeners={};let writes=0;
 const caches={keys:async()=>[...stores.keys()],delete:async k=>stores.delete(k),open:async name=>{if(!stores.has(name))stores.set(name,new Map());const map=stores.get(name);return{match:async req=>map.get(typeof req==='string'?req:req.url)?.clone(),put:async(req,r)=>{if(options.failWrite&&++writes===2)throw Error('disk full');map.set(typeof req==='string'?req:req.url,r.clone())}}}};
 const c={URL,Response,Map,Set,crypto:webcrypto,self:{location:{href:base+'sw.js'},addEventListener:(n,f)=>listeners[n]=f,skipWaiting(){throw Error('Unsafe takeover')},clients:{claim(){throw Error('Unsafe claim')}}},caches,fetch:async(req,opts)=>{const url=typeof req==='string'?req:req.url;calls.push({url,opts});if(options.offline)throw Error('offline');if(options.fail===url)return new Response('failed',{status:503});const key=url.slice(base.length);return new Response(options.corrupt===url?'WRONG RELEASE':bodies[key]||'LIVE')}};
 vm.createContext(c);vm.runInContext(source.replace("const RELEASE='6240'","const RELEASE='"+id+"'").replace(/const RELEASE_FILES=\[[\s\S]*?\];/,'const RELEASE_FILES='+JSON.stringify(table)+';'),c);
 const lifecycle=async name=>{let p;listeners[name]({waitUntil:x=>p=x});await p};
 const request=async(url,mode='cors')=>{let p,used=false;const waits=[];listeners.fetch({request:{method:'GET',url,mode},respondWith:x=>{used=true;p=x},waitUntil:x=>waits.push(x)});const response=await p;await Promise.all(waits);return{used,response}};
 return{c,calls,stores,options,lifecycle,request,listeners,bodies};
}
test('release installation verifies and commits all local files with an exact completion marker',async()=>{
 const h=harness();await h.lifecycle('install');const cache=h.stores.get('gst-release-6240');assert.equal(cache.size,6);for(const [p,b]of Object.entries(h.bodies))assert.equal(await cache.get(base+p).clone().text(),b);assert.ok(h.calls.every(x=>x.opts.cache==='no-store'));await h.lifecycle('activate');
});
test('failed HTTP, wrong bytes, offline or interrupted cache write never replaces the previous release',async()=>{
 for(const failure of [{fail:base+'current-field.js?v=6240'},{corrupt:base+'current-field.js?v=6240'},{offline:true},{failWrite:true}]){const stores=new Map([['gst-release-6230',new Map([['old',new Response('OLD')]])]]),h=harness({...failure,stores});await assert.rejects(h.lifecycle('install'));assert.equal(stores.has('gst-release-6240'),false);assert.equal(await stores.get('gst-release-6230').get('old').clone().text(),'OLD')}
});
test('same release cannot be reused with changed manifest and cannot damage the complete cache',async()=>{
 const h=harness();await h.lifecycle('install');h.stores.get('gst-release-6240').set(base+'__release_complete__',new Response('DIFFERENT'));await assert.rejects(h.lifecycle('install'));assert.equal(h.stores.get('gst-release-6240').size,6);
});
test('online and offline restarts serve only the installed release, including Pages navigation',async()=>{
 const h=harness();await h.lifecycle('install');const count=h.calls.length;for(const offline of [false,true]){h.options.offline=offline;assert.equal(await(await h.request(base+'?campaign=test','navigate')).response.text(),'HTML 6240');for(const [p,b] of Object.entries(h.bodies))assert.equal(await(await h.request(base+p)).response.text(),b)}assert.equal(h.calls.length,count);
});
test('wrong-version URLs and missing release files fail closed rather than mixing caches or network',async()=>{
 const h=harness();await h.lifecycle('install');assert.equal((await h.request(base+'app.js?v=6230')).response.status,409);h.stores.get('gst-release-6240').delete(base+'current-field.js?v=6240');assert.equal((await h.request(base+'current-field.js?v=6240')).response.status,503);h.stores.get('gst-release-6240').delete(base+'__release_complete__');assert.equal((await h.request(base,'navigate')).response.status,503);
});
test('waiting installation preserves old and unrelated caches; activation cleans only this app',async()=>{
 const stores=new Map([['gst-v6.2.3-truth',new Map()],['other-app',new Map()]]),h=harness({stores});await h.lifecycle('install');assert.ok(stores.has('gst-v6.2.3-truth'));await h.lifecycle('activate');assert.ok(!stores.has('gst-v6.2.3-truth'));assert.ok(stores.has('other-app'));
});
test('two release workers keep their own bytes while an update is installed but waiting',async()=>{
 const old=harness(),next=harness({id:'6241',stores:old.stores});await old.lifecycle('install');await next.lifecycle('install');assert.equal(await(await old.request(base,'navigate')).response.text(),'HTML 6240');assert.equal(await(await next.request(base,'navigate')).response.text(),'HTML 6241');assert.equal((await old.request(base+'app.js?v=6241')).response.status,409);await next.lifecycle('activate');assert.equal((await old.request(base,'navigate')).response.status,503);
});
test('external Zarr data bypass persistence; live-data cache cannot supply application code',async()=>{
 const h=harness();const z='https://s3.waw3-1.cloudferro.com/test/cmems_mod_bal_phy_anfc_PT15M-i_202411/timeChunked.zarr/uo/1.0.0';assert.equal((await h.request(z)).used,false);await h.request('https://api.test/weather');assert.ok(h.stores.has('gst-runtime-6240'));assert.equal(h.stores.has('gst-release-6240'),false);
});
test('production manifest covers every local import and verifies canonical LF bytes and bootstrap SRI',()=>{
 const table=JSON.parse(source.match(/const RELEASE_FILES=(\[[\s\S]*?\]);/)[1]),id=source.match(/const RELEASE='([^']+)'/)[1];
 for(const [url,hash] of table.filter(([u])=>!u.startsWith('https:'))){const bytes=fs.readFileSync(path.join(root,url.split('?')[0]));assert.equal(sha(bytes),hash,url);assert.equal(bytes.includes(Buffer.from('\r\n')),false,url)}
 for(const p of ['app.js','styles.css','current-field.js','current-field-worker.js','data/gotland-coast-mask.json','manifest.webmanifest','icon.svg','release.js'])assert.ok(table.some(([u])=>u===p+'?v='+id));
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),boot=fs.readFileSync(path.join(root,'release.js'));assert.ok(html.includes('integrity="sha256-'+createHash('sha256').update(boot).digest('base64')+'"'));assert.ok(html.includes('release.js?v='+id));
 assert.ok(fs.readFileSync(path.join(root,'app.js'),'utf8').includes("import('./current-field.js?v="+id+"')"));assert.ok(fs.readFileSync(path.join(root,'current-field.js'),'utf8').includes("'./current-field-worker.js?v="+id+"'"));assert.ok(fs.readFileSync(path.join(root,'current-field-worker.js'),'utf8').includes("'./data/gotland-coast-mask.json?v="+id+"'"));
});
function bootstrap({controller='6240',active='6240',registerFails=false,unsupported=false}={}){
 const nodes=new Map(),scripts=[],registrations=[],state={reload:false},channel=()=>{const a={close(){}},b={postMessage:data=>queueMicrotask(()=>a.onmessage?.({data}))};return{port1:a,port2:b}};
 const worker=v=>v===null?null:{postMessage:(m,ports)=>{if(v!=='legacy')ports[0].postMessage({release:v})}};
 const sw={controller:worker(controller),addEventListener(){},ready:Promise.resolve({active:worker(active)}),register:async(...a)=>{registrations.push(a);if(registerFails)throw Error('network');return{}}};
 const c={console:{error(){}},MessageChannel:function(){return channel()},setTimeout:(f,ms)=>setTimeout(f,ms===1200?1:10),clearTimeout,setInterval(){},navigator:unsupported?{}:{serviceWorker:sw},location:{reload:()=>state.reload=true},document:{getElementById:id=>nodes.get(id),createElement:tag=>({tag,style:{},setAttribute(){},remove(){nodes.delete(this.id)}}),body:{appendChild:el=>{if(el.tag==='script'){scripts.push(el.src);queueMicrotask(()=>el.onload())}else nodes.set(el.id,el)}}}};
 vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'release.js'),'utf8').replace('startRelease();','globalThis.started=startRelease();'),c);return{c,state,scripts,nodes,registrations};
}
test('bootstrap starts only matching release, including offline registration failure',async()=>{
 const h=bootstrap({registerFails:true});await h.c.started;assert.equal(h.scripts.length,3);assert.equal(h.scripts.at(-1),'app.js?v=6240');assert.equal(h.nodes.has('releaseStatus'),false);
});
test('first installation reloads under the verified active worker before loading any app code',async()=>{
 const h=bootstrap({controller:null});await h.c.started;assert.equal(h.state.reload,true);assert.equal(h.scripts.length,0);assert.equal(h.registrations[0][1].updateViaCache,'none');
});
test('legacy or different controller cannot start new app code or force takeover',async()=>{
 for(const controller of ['legacy','6241']){const h=bootstrap({controller});await h.c.started;assert.equal(h.scripts.length,0);assert.equal(h.state.reload,false);assert.match(h.nodes.get('releaseStatus').textContent,/alle alten Fenster/)}
});
test('failed migration and unsupported browsers show an error without executing mixed app code',async()=>{
 for(const options of [{controller:'legacy',registerFails:true},{unsupported:true}]){const h=bootstrap(options);await h.c.started;assert.equal(h.scripts.length,0);assert.ok(h.nodes.get('releaseStatus').textContent)}
});
function activationHarness(clients,after=clients){
 const h=harness();h.c.setTimeout=(fn,ms)=>setTimeout(fn,Math.min(ms,10));h.c.clearTimeout=clearTimeout;h.c.MessageChannel=function(){const port1={close(){}};return{port1,port2:{postMessage:data=>queueMicrotask(()=>port1.onmessage?.({data}))}}};let lookups=0,activated=0;h.c.self.clients.matchAll=async()=>++lookups===1?clients:after;h.c.self.skipWaiting=async()=>activated++;return{h,activated:()=>activated};
}
const gateClient=(id,release='6240',ready=true)=>({id,url:base,postMessage:(message,ports)=>{if(release!==null)ports[0].postMessage({release,ready})}});
test('waiting worker activates only when every remaining window confirms an app-free matching gate',async()=>{
 const {h,activated}=activationHarness([gateClient('a'),gateClient('b')]);assert.equal(await h.c.activateReadyGates(),true);assert.equal(activated(),1);
});
test('legacy, running or differently versioned windows prevent early activation',async()=>{
 for(const client of [gateClient('old',null),gateClient('running','6240',false),gateClient('different','6241')]){const {h,activated}=activationHarness([gateClient('new'),client]);assert.equal(await h.c.activateReadyGates(),false);assert.equal(activated(),0)}
});
test('client-set race prevents activation; no remaining windows can safely activate',async()=>{
 const {h,activated}=activationHarness([gateClient('a')],[gateClient('a'),gateClient('new')]);assert.equal(await h.c.activateReadyGates(),false);assert.equal(activated(),0);const empty=activationHarness([]);assert.equal(await empty.h.c.activateReadyGates(),true);assert.equal(empty.activated(),1);
});
