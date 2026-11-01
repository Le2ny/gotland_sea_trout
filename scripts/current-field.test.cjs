const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const core=require('../current-field-worker.js');
const grid=()=>({xs:new Float32Array([18,19]),ys:new Float32Array([57,58]),u:new Float32Array([0,2,0,2]),v:new Float32Array([0,0,2,2])});
test('field bilinear interpolation uses actual axes and u/v, not magnitudes',()=>{
 const f=grid(),p=core.bilinearField(f,57.5,18.5);assert.equal(p.u,1);assert.equal(p.v,1);assert.equal(p.speed,Math.sqrt(2));
 f.xs=new Float32Array([18,20]);assert.equal(core.bilinearField(f,57.5,18.5).u,.5);
 f.u.set([-1,1,-1,1]);f.v.fill(0);assert.equal(core.bilinearField(f,57.5,19).speed,0);
});
test('field never extrapolates or bridges a single missing corner',()=>{
 for(const v of [-999,NaN,Infinity])for(const component of ['u','v'])for(let i=0;i<4;i++){let f=grid();f[component][i]=v;assert.equal(core.bilinearField(f,57.5,18.5),null)}
 for(const [lat,lon] of [[56,18.5],[59,18.5],[57.5,17],[57.5,20]])assert.equal(core.bilinearField(grid(),lat,lon),null);
 assert.equal(core.bilinearField(grid(),58,19).speed,Math.sqrt(8));
});
test('coast masking clips land and disallows paths through a coastline without changing water speed',()=>{
 const f=grid(),empty=new Map();assert.equal(core.seaSample(f,57.5,18.5,[18.8],empty),null);
 const barrier={a:[57.1,18.4],b:[57.9,18.4]},cells=core.coastIndex([barrier],f);
 assert.equal(core.seaSample(f,57.5,18.5,[],cells),null);
 assert.equal(core.seaSample(f,57.5,18.5,[],empty).speed,Math.sqrt(2));
 assert.equal(core.seaSample(f,57.5,17.7,[],empty),null);
});
test('invalid or incomplete coastline fails closed',()=>{
 assert.throws(()=>core.validateCoast([]));assert.throws(()=>core.validateCoast([{geometry:[{lat:57,lon:18},{lat:57.1,lon:18}]}]));
});
test('official palette interpolates continuously and clamps only color, calm threshold is display-only',()=>{
 const colors=[[0,0,0],[100,200,0]];assert.deepEqual(core.fieldColor(.35,colors),[50,100,0]);assert.deepEqual(core.fieldColor(1,colors),[100,200,0]);assert.equal(core.CALM_SPEED,.01);
});
function rawBlosc(array){const bytes=new Uint8Array(array.buffer,array.byteOffset,array.byteLength),out=new Uint8Array(16+bytes.length),d=new DataView(out.buffer);out.set([2,1,2,array.BYTES_PER_ELEMENT]);d.setUint32(4,bytes.length,true);d.setUint32(8,bytes.length,true);d.setUint32(12,out.length,true);out.set(bytes,16);return out.buffer}
test('Blosc decoder preserves Float32 NoData and rejects damaged streams',()=>{
 const values=new Float32Array([0,-999,.25,-.5]),buffer=rawBlosc(values);assert.deepEqual(new Float32Array(core.decodeBlosc(buffer).buffer),values);
 assert.throws(()=>core.decodeBlosc(new ArrayBuffer(3)));const bad=buffer.slice(0);new DataView(bad).setUint32(4,999999999,true);assert.throws(()=>core.decodeBlosc(bad));
 assert.deepEqual([...core.decodeLz4(new Uint8Array([0x30,65,66,67]),3)],[65,66,67]);assert.throws(()=>core.decodeLz4(new Uint8Array([0,0,0]),4));
});
test('Blosc LZ4 split blocks undo byte shuffle exactly',()=>{
 const values=new Float32Array([1,2]),raw=new Uint8Array(values.buffer),out=new Uint8Array(48),d=new DataView(out.buffer);out.set([2,1,33,4]);d.setUint32(4,8,true);d.setUint32(8,8,true);d.setUint32(12,48,true);d.setUint32(16,20,true);
 for(let i=0;i<4;i++){const p=20+i*7;d.setUint32(p,3,true);out.set([0x20,raw[i],raw[4+i]],p+4)}assert.deepEqual(new Float32Array(core.decodeBlosc(out.buffer).buffer),values);
});
function workerContext(){
 const source=fs.readFileSync(require('node:path').join(__dirname,'../current-field-worker.js'),'utf8'),epoch=Date.UTC(1900,0,1),time=Date.UTC(2026,9,31,12),axis=Array.from({length:8},(_,i)=>(time+i*900000-epoch)/86400000);
 const a={dtype:'<f4',order:'C',fill_value:-999,chunks:[2,2,2],shape:[8,2,2],filters:null},m={'uo/.zarray':a,'vo/.zarray':a,'uo/.zattrs':{units:'m s-1'},'vo/.zattrs':{units:'m s-1'},'time/.zattrs':{units:'days since 1900-01-01'},'time/.zarray':{dtype:'<f8',shape:[8],chunks:[8]}};
 const calls=[],c={console,URL,Map,Set,Date,Math,Number,Promise,Uint8Array,Float32Array,DataView,ArrayBuffer,AbortSignal,setTimeout,performance};
 c.fetch=async url=>{calls.push(url);if(c.fail&&url.includes('/uo/'))return{ok:false,status:503};let data;if(url.includes('stac.json'))data={assets:{timeChunked:{href:'https://data.test'}},properties:{'cube:dimensions':{time:{extent:[new Date(time).toISOString()]}}}};else if(url.endsWith('.zmetadata'))data={metadata:m};let values=url.includes('/time/')?new Float64Array(axis):url.includes('/latitude/')?new Float32Array([57,58]):url.includes('/longitude/')?new Float32Array([18,19]):new Float32Array(8).fill(url.includes('/uo/')?.3:.4);return{ok:true,json:async()=>data,arrayBuffer:async()=>rawBlosc(values)}};
 vm.createContext(c);vm.runInContext(source,c);return{c,calls,time};
}
test('Zarr exact-time read shares work, caches two chunks, preserves NoData and retries failed downloads',async()=>{
 const {c,calls,time}=workerContext(),t=new Date(time).toISOString();const [a,b]=await Promise.all([c.currentField(t),c.currentField(t)]);assert.equal(a.u[0],b.u[0]);assert.equal(calls.filter(x=>x.includes('/uo/')).length,1);
 await c.currentField(new Date(time+900000).toISOString());assert.equal(calls.filter(x=>x.includes('/uo/')).length,1);
 await assert.rejects(c.currentField(new Date(time+1000).toISOString()));
 c.fail=true;await assert.rejects(c.currentField(new Date(time+1800000).toISOString()));c.fail=false;await c.currentField(new Date(time+1800000).toISOString());
 await c.currentField(new Date(time+3600000).toISOString());assert.equal(vm.runInContext('chunks.size',c),2);assert.equal(vm.runInContext('pending.size',c),0);
});
test('queued obsolete time never starts network work',async()=>{
 const {c,calls,time}=workerContext();vm.runInContext('latest=2',c);await assert.rejects(c.queuedField({id:1,time:new Date(time).toISOString()}));assert.equal(calls.length,0);await c.queuedField({id:2,time:new Date(time).toISOString()});assert.ok(calls.length>0);
});
test('Leaflet adapter closes obsolete bitmaps and never attaches a stale field',async()=>{
 const workers=[],oldWorker=global.Worker;global.Worker=class{constructor(){workers.push(this)}postMessage(m){this.job=m}terminate(){}};
 try{const api=await import('../current-field.js'),map={getSize:()=>({x:100,y:100}),getZoom:()=>12,containerPointToLatLng:()=>[57,18],project:()=>({x:1,y:2})};
 const old=api.draw(map,{},'T1',()=>true,{});const rejected=assert.rejects(old,/Veralteter/);const oldId=workers[0].job.id;
 let current=true;const fresh=api.draw(map,{},'T2',()=>current,{});await rejected;let closed=0;workers[0].onmessage({data:{id:oldId,bitmap:{close(){closed++}}}});assert.equal(closed,1);
 current=false;workers[0].onmessage({data:{id:workers[0].job.id,bitmap:{close(){closed++}}}});assert.equal(await fresh,null);assert.equal(closed,2);api.cancel();
 }finally{global.Worker=oldWorker}
});
test('production pixel renderer leaves NoData transparent and calculates regular glyphs from the field',async()=>{
 const {c}=workerContext(),messages=[];let pixels;
 c.self={postMessage:m=>messages.push(m)};c.OffscreenCanvas=class{constructor(w,h){this.width=w;this.height=h}getContext(){return{createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:i=>{pixels=i.data},scale(){},save(){},restore(){},translate(){},rotate(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){},fill(){}}}transferToImageBitmap(){return{}}};
 const f=grid();c.currentField=async()=>f;c.coastline=async()=>[];c.palette=async()=>[[0,0,0],[255,255,255]];
 const scale=256*2**10,origin={x:(18.5+180)/360*scale-40,y:(1-Math.asinh(Math.tan(57.5*Math.PI/180))/Math.PI)/2*scale-40};vm.runInContext('latest=1',c);
 await c.renderField({id:1,time:'test',origin,zoom:10,width:80,height:80,ratio:1});assert.equal(messages.length,1);assert.ok(messages[0].stats.arrows>0);assert.equal(messages[0].stats.colored,6400);assert.equal(pixels[3],204);
 f.u.fill(-999);await c.renderField({id:1,time:'test',origin,zoom:10,width:80,height:80,ratio:1});assert.equal(messages[1].stats.colored,0);assert.equal(messages[1].stats.arrows,0);assert.ok(pixels.every(v=>v===0));
});
test('service worker excludes only the new current Zarr downloads from persistent caching',()=>{
 const listeners={},c={URL,self:{location:{href:'https://gotland.test/gotland_sea_trout/sw.js'},addEventListener:(name,fn)=>{listeners[name]=fn}},fetch:()=>Promise.resolve({clone:()=>({})}),caches:{open:async()=>({put(){}})}};vm.createContext(c);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../sw.js'),'utf8'),c);
 for(const [url,cached] of [['https://s3.waw3-1.cloudferro.com/mdl-arco-time-001/arco/BALTICSEA_ANALYSISFORECAST_PHY_003_006/cmems_mod_bal_phy_anfc_PT15M-i_202411/timeChunked.zarr/uo/1.0.0',false],['https://wmts.marine.copernicus.eu/teroWmts/?request=GetFeatureInfo',true],['https://example.test/app.js',true]]){let used=false;listeners.fetch({request:{method:'GET',url},respondWith(){used=true}});assert.equal(used,cached)}
});

test('bundled coastline is geometrically valid, unsimplified, and covers islands and field edges',()=>{
 const data=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../data/gotland-coast-mask.json'),'utf8'));
 const {validate,contains}=require('./validate-coast-mask.cjs'),result=validate(data);
 assert.equal(result.rings,228);assert.equal(result.segments,40180);assert.equal(result.sourceWays,629);
 for(const [name,lat,lon] of [['Gotland',57.5,18.5],['Fårö',57.93,19.15],['Gotska Sandön',58.367,19.25],['Stora Karlsö',57.286,17.97],['Lilla Karlsö',57.31,18.064],['Asunden',57.708,18.848]])assert.equal(contains(data.elements,lat,lon),true,name);
 for(const [name,lat,lon] of [['West sea',57.5,17.8],['East sea',57.5,19.45],['Fårösund',57.8705,19.058],['North edge',58.3,19.2],['West edge',57.5,17.4],['South edge',56.6,18.5],['East edge',57.5,20.1]])assert.equal(contains(data.elements,lat,lon),false,name);
});
test('local coast loader shares one request, never contacts Overpass, and retries a failed load',async()=>{
 const {c}=workerContext(),data=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../data/gotland-coast-mask.json'),'utf8'));let calls=0,fail=true;
 c.fetch=async url=>{assert.equal(url,'./data/gotland-coast-mask.json?v=6240');calls++;return{ok:!fail,status:503,json:async()=>data}};
 await assert.rejects(c.coastline());assert.equal(calls,1);fail=false;
 const [a,b]=await Promise.all([c.coastline(),c.coastline()]);assert.strictEqual(a,b);assert.equal(a.length,40180);assert.equal(calls,2);await c.coastline();assert.equal(calls,2);
});
test('local mask with missing coverage or open rings is rejected rather than replaced',async()=>{
 const source=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../data/gotland-coast-mask.json'),'utf8'));
 for(const kind of ['coverage','open','corrupt']){const {c}=workerContext(),data=structuredClone(source);if(kind==='coverage')data.coverage.west=18;if(kind==='open')data.elements[0].geometry.pop();c.fetch=async()=>({ok:true,json:async()=>{if(kind==='corrupt')throw Error('invalid JSON');return data}});await assert.rejects(c.coastline(),undefined,kind)}
});


test('active masked sampler preserves supported native nodes and interpolates components before speed',()=>{
 const f=grid(),s=core.maskedSampler(f,[],new Map());
 for(let y=0;y<2;y++)for(let x=0;x<2;x++){const p=s(f.ys[y],f.xs[x],[]);assert.equal(p.u,f.u[y*2+x]);assert.equal(p.v,f.v[y*2+x])}
 const p=s(57.5,18.5,[]);assert.equal(p.u,1);assert.equal(p.v,1);assert.equal(p.speed,Math.SQRT2);
 f.u.set([-1,1,-1,1]);f.v.fill(0);const calm=core.maskedSampler(f,[],new Map())(57.5,18.5,[]);assert.equal(calm.speed,0);
});
test('active masked sampler accepts partial cells but not lone nodes or distant unsupported gaps',()=>{
 const f=grid();f.u[0]=-999;let p=core.maskedSampler(f,[],new Map())(57.5,18.5,[]);assert.ok(p);assert.equal(p.support,3);assert.ok(p.u>=0&&p.u<=2&&p.v>=0&&p.v<=2);
 f.u[1]=-999;f.u[2]=-999;assert.equal(core.maskedSampler(f,[],new Map())(57.5,18.5,[]),null);
 const g={xs:Float32Array.from({length:9},(_,i)=>18+i*.02),ys:Float32Array.from({length:9},(_,i)=>57+i*.02),u:new Float32Array(81).fill(-999),v:new Float32Array(81).fill(0)};g.u[0]=1;g.u[1]=1;assert.equal(core.maskedSampler(g,[],new Map())(g.ys[4],g.xs[4],[]),null);
});
test('active masked sampler clips land and excludes contributors behind a small island',()=>{
 const f=grid(),ring=[[57.2,18.2],[57.2,18.3],[57.8,18.3],[57.8,18.2],[57.2,18.2]],segments=ring.slice(1).map((b,i)=>({a:ring[i],b}));
 const s=core.maskedSampler(f,segments,core.coastIndex(segments,f));assert.equal(s(57.5,18.25,[18.2,18.3]),null);
 const p=s(57.5,18.5,[18.2,18.3]);assert.ok(p);assert.equal(p.u,2);assert.equal(p.support,2);assert.equal(p.v,1);
});
test('active masked sampler remains continuous across an unobstructed native cell boundary',()=>{
 const f={xs:new Float32Array([18,18.1,18.2]),ys:new Float32Array([57,57.1,57.2]),u:new Float32Array([0,.1,.2,0,.1,.2,0,.1,.2]),v:new Float32Array(9).fill(.2)},s=core.maskedSampler(f,[],new Map());
 const a=s(57.05,f.xs[1]-1e-8,[]),b=s(57.05,f.xs[1]+1e-8,[]);assert.ok(Math.abs(a.u-b.u)<1e-6);assert.ok(Math.abs(a.v-b.v)<1e-6);
});

test('production renderer arrow rotation points along interpolated east/north components',async()=>{
 for(const [u,v] of [[1,0],[0,1],[-1,0],[0,-1],[1,-1]]){
  const {c}=workerContext(),angles=[];c.self={postMessage(){}};c.OffscreenCanvas=class{getContext(){return{createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){},scale(){},save(){},restore(){},translate(){},rotate:a=>angles.push(a),beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){},fill(){}}}transferToImageBitmap(){return{}}};
  const f=grid();f.u.fill(u);f.v.fill(v);c.currentField=async()=>f;c.coastline=async()=>[];c.palette=async()=>[[0,0,0],[255,255,255]];const scale=256*2**10,origin={x:(18.5+180)/360*scale-40,y:(1-Math.asinh(Math.tan(57.5*Math.PI/180))/Math.PI)/2*scale-40};vm.runInContext('latest=1',c);await c.renderField({id:1,time:'test',origin,zoom:10,width:80,height:80,ratio:1});assert.ok(angles.length);for(const a of angles){assert.ok(Math.abs(Math.sin(a)-u/Math.hypot(u,v))<1e-12);assert.ok(Math.abs(-Math.cos(a)+v/Math.hypot(u,v))<1e-12)}
 }
});

test('coast barrier tree agrees with exhaustive intersections including touches and collinearity',()=>{
 let seed=92317;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 const segments=Array.from({length:160},()=>({a:[57+rand(),18+rand()],b:[57+rand(),18+rand()]}));const original=JSON.stringify(segments),tree=core.coastBarrierTree(segments);
 const rays=Array.from({length:2000},()=>[[56.8+rand()*1.4,17.8+rand()*1.4],[56.8+rand()*1.4,17.8+rand()*1.4]]);
 rays.push([segments[0].a,segments[0].b],[segments[0].a,segments[0].a],[[55,17],[56,17]]);
 for(const [a,b] of rays)assert.equal(core.coastBarrierHit(a,b,tree),segments.some(s=>core.intersects(a,b,s.a,s.b)));
 assert.equal(JSON.stringify(segments),original);assert.equal(core.coastBarrierHit([57,18],[58,19],core.coastBarrierTree([])),false);
});
test('indexed production sampler is bit-identical to exhaustive coast checks with the bundled mask',()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../current-field-worker.js'),'utf8');
 const oldSource=source.replace('barriers:coastBarrierTree([...barriers])','barriers:[...barriers]').replace('coastBarrierHit([lat,lon],[p.lat,p.lon],barriers)','barriers.some(s=>intersects([lat,lon],[p.lat,p.lon],s.a,s.b))');
 assert.notEqual(oldSource,source);const c={module:{exports:{}}};vm.createContext(c);vm.runInContext(oldSource,c);
 const data=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../data/gotland-coast-mask.json'),'utf8')),segments=core.validateCoast(data.elements);
 const xs=Float32Array.from({length:101},(_,i)=>17.72+i*.02),ys=Float32Array.from({length:103},(_,i)=>56.72+i*.015),u=Float32Array.from({length:xs.length*ys.length},(_,i)=>i%17===0?-999:Math.sin(i)*.2),v=Float32Array.from(u,(n,i)=>n===-999?-999:Math.cos(i)*.2),f={xs,ys,u,v},cells=core.coastIndex(segments,f),fast=core.maskedSampler(f,segments,cells),slow=c.module.exports.maskedSampler(f,segments,cells);
 for(const [lat,lon] of [[57.3084,18.135],[57.43,18.98],[57.968,19.08]])for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
  const y=lat+dy*.004,x=lon+dx*.004,cross=segments.filter(s=>(s.a[0]>y)!==(s.b[0]>y)).map(s=>s.a[1]+(y-s.a[0])*(s.b[1]-s.a[1])/(s.b[0]-s.a[0]));assert.equal(JSON.stringify(fast(y,x,cross)),JSON.stringify(slow(y,x,cross)));
 }
});
