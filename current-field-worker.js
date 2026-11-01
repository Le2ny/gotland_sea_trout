/* Map only. Official PT15M u/v; no changes to ranking or its requests.
 * Blosc v1/LZ4 byte-shuffle decoder follows c-blosc README_CHUNK_FORMAT.
 * Unsupported encodings fail closed. NoData is never treated as zero.
 */
'use strict';
const FIELD_STAC='https://stac.marine.copernicus.eu/metadata/BALTICSEA_ANALYSISFORECAST_PHY_003_006/cmems_mod_bal_phy_anfc_PT15M-i_202411/dataset.stac.json';
const FIELD_STYLE='vectorStyle:solid,cmap:rainbow,range:0/0.7';
const FIELD_LEGEND='https://wmts.marine.copernicus.eu/teroWmts/?service=WMTS&version=1.0.0&request=GetLegend&format=application%2Fjson&layer=BALTICSEA_ANALYSISFORECAST_PHY_003_006/cmems_mod_bal_phy_anfc_PT15M-i_202411/sea_water_velocity&STYLE='+encodeURIComponent(FIELD_STYLE);
const CALM_SPEED=.01; // Display only: below 1 cm/s, direction is shown as a dot. Values stay unchanged.
function requireField(ok,message){if(!ok)throw Error(message)}
function decodeLz4(input,size){
 const out=new Uint8Array(size);let i=0,j=0;
 while(i<input.length){const token=input[i++];let n=token>>>4;
  if(n===15){let v;do{requireField(i<input.length,'LZ4 literal');v=input[i++];n+=v}while(v===255)}
  requireField(i+n<=input.length&&j+n<=size,'LZ4 bounds');out.set(input.subarray(i,i+n),j);i+=n;j+=n;
  if(i===input.length)break;
  requireField(i+2<=input.length,'LZ4 offset');const offset=input[i++]|input[i++]<<8;let count=(token&15)+4;
  if((token&15)===15){let v;do{requireField(i<input.length,'LZ4 match');v=input[i++];count+=v}while(v===255)}
  requireField(offset>0&&offset<=j&&j+count<=size,'LZ4 match bounds');for(let k=0;k<count;k++)out[j+k]=out[j-offset+k];j+=count;
 }
 requireField(j===size,'LZ4 length');return out;
}
function decodeBlosc(buffer){
 const b=new Uint8Array(buffer),d=new DataView(buffer);requireField(b.length>=16,'Blosc header');
 const flags=b[2],type=b[3],size=d.getUint32(4,true),block=d.getUint32(8,true);
 requireField(size<=12000000&&block>0&&type>0&&d.getUint32(12,true)===b.length,'Blosc size');
 if(flags&2){requireField(b.length===size+16,'Blosc copy');return b.slice(16)}
 requireField((flags>>>5)===1&&!(flags&4),'Unsupported Blosc codec');const out=new Uint8Array(size);
 for(let base=0,index=0;base<size;base+=block,index++){
  const len=Math.min(block,size-base),splits=(flags&16)||len<block?1:type,step=len/splits;
  requireField(16+4*index+4<=b.length&&Number.isInteger(step),'Blosc blocks');let pos=d.getUint32(16+4*index,true);const tmp=new Uint8Array(len);
  for(let s=0;s<splits;s++){requireField(pos+4<=b.length,'Blosc split');const n=d.getUint32(pos,true);pos+=4;requireField(pos+n<=b.length,'Blosc split size');const bytes=b.subarray(pos,pos+n);tmp.set(n===step?bytes:decodeLz4(bytes,step),s*step);pos+=n}
  if(flags&1){const count=Math.floor(len/type);for(let k=0;k<count;k++)for(let j=0;j<type;j++)out[base+k*type+j]=tmp[j*count+k];out.set(tmp.subarray(count*type),base+count*type)}else out.set(tmp,base);
 }
 return out;
}
function lowerCell(axis,value){let lo=0,hi=axis.length-1;if(value<axis[lo]||value>axis[hi])return -1;while(hi-lo>1){const m=(lo+hi)>>1;if(axis[m]<=value)lo=m;else hi=m}return lo}
function validComponent(v){return Number.isFinite(v)&&v!==-999}
function bilinearField(field,lat,lon){
 const y=lowerCell(field.ys,lat),x=lowerCell(field.xs,lon);if(x<0||y<0)return null;
 const ids=[y*field.xs.length+x,y*field.xs.length+x+1,(y+1)*field.xs.length+x,(y+1)*field.xs.length+x+1];
 if(!ids.every(i=>validComponent(field.u[i])&&validComponent(field.v[i])))return null;
 const a=(lon-field.xs[x])/(field.xs[x+1]-field.xs[x]),b=(lat-field.ys[y])/(field.ys[y+1]-field.ys[y]);
 const weights=[(1-a)*(1-b),a*(1-b),(1-a)*b,a*b];let u=0,v=0;ids.forEach((i,k)=>{u+=weights[k]*field.u[i];v+=weights[k]*field.v[i]});
 return{u,v,speed:Math.hypot(u,v),x,y};
}
function intersects(a,b,c,d){
 const cross=(p,q,r)=>(q[1]-p[1])*(r[0]-p[0])-(q[0]-p[0])*(r[1]-p[1]);
 if(Math.max(a[0],b[0])<Math.min(c[0],d[0])||Math.min(a[0],b[0])>Math.max(c[0],d[0])||Math.max(a[1],b[1])<Math.min(c[1],d[1])||Math.min(a[1],b[1])>Math.max(c[1],d[1]))return false;
 return cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0;
}
// Broad phase only: conservative bounding boxes skip unrelated coast segments.
// Leaves use the unchanged exact intersection predicate, including touching edges.
function coastBarrierTree(segments){
 if(!segments.length)return null;
 const south=Math.min(...segments.map(s=>Math.min(s.a[0],s.b[0]))),north=Math.max(...segments.map(s=>Math.max(s.a[0],s.b[0]))),west=Math.min(...segments.map(s=>Math.min(s.a[1],s.b[1]))),east=Math.max(...segments.map(s=>Math.max(s.a[1],s.b[1])));
 if(segments.length<=8)return{south,north,west,east,segments};
 const axis=north-south>=east-west?0:1,sorted=segments.slice().sort((a,b)=>(a.a[axis]+a.b[axis])-(b.a[axis]+b.b[axis])),mid=sorted.length>>1;
 return{south,north,west,east,left:coastBarrierTree(sorted.slice(0,mid)),right:coastBarrierTree(sorted.slice(mid))};
}
function coastBarrierHit(a,b,tree){
 const south=Math.min(a[0],b[0]),north=Math.max(a[0],b[0]),west=Math.min(a[1],b[1]),east=Math.max(a[1],b[1]);
 function visit(t){
  if(!t||north<t.south||south>t.north||east<t.west||west>t.east)return false;
  if(t.segments)return t.segments.some(s=>intersects(a,b,s.a,s.b));
  return visit(t.left)||visit(t.right);
 }
 return visit(tree);
}
function coastIndex(segments,field){
 const cells=new Map();for(const s of segments){let y0=lowerCell(field.ys,Math.max(field.ys[0],Math.min(s.a[0],s.b[0]))),y1=lowerCell(field.ys,Math.min(field.ys.at(-1),Math.max(s.a[0],s.b[0]))),x0=lowerCell(field.xs,Math.max(field.xs[0],Math.min(s.a[1],s.b[1]))),x1=lowerCell(field.xs,Math.min(field.xs.at(-1),Math.max(s.a[1],s.b[1])));if([y0,y1,x0,x1].some(x=>x<0))continue;for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){let key=y*field.xs.length+x;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(s)}}return cells;
}
function seaSample(field,lat,lon,crossings,cells){
 // Closed coastline rings: parity includes small islands. Restrict to the surveyed domain.
 if(lat<56.72||lat>58.25||lon<17.72||lon>19.72)return null;
 let right=0;for(const x of crossings)if(x>lon)right++;if(right%2)return null;
 const p=bilinearField(field,lat,lon);if(!p)return null;
 const barriers=cells.get(p.y*field.xs.length+p.x)||[];
 for(const s of barriers)for(const [dy,dx] of [[0,0],[0,1],[1,0],[1,1]])if(intersects([lat,lon],[field.ys[p.y+dy],field.xs[p.x+dx]],s.a,s.b))return null;
 return p;
}
// Map-only, mask-aware reconstruction. Positive compact weights cannot overshoot
// the contributing u/v components. Radius is 1.5 native grid intervals (about
// 2.5–2.8 km here), independent of zoom; it is NOT extra model resolution.
// Coastal estimates may lie outside the convex hull of wet source nodes, but
// never beyond this radius, never through land, and never from one lone node.
function maskedSampler(field,segments,cells){
 const nx=field.xs.length,ny=field.ys.length,radius=1.5,nodeCache=new Map(),rowCache=new Map(),cellCache=new Map();
 function node(y,x){
  if(x<0||y<0||x>=nx||y>=ny)return null;const key=y*nx+x;if(nodeCache.has(key))return nodeCache.get(key);
  let value=null;if(validComponent(field.u[key])&&validComponent(field.v[key])){
   if(!rowCache.has(y))rowCache.set(y,segments.filter(s=>(s.a[0]>field.ys[y])!==(s.b[0]>field.ys[y])).map(s=>s.a[1]+(field.ys[y]-s.a[0])*(s.b[1]-s.a[1])/(s.b[0]-s.a[0])));
   let right=0;for(const lon of rowCache.get(y))if(lon>field.xs[x])right++;
   if(!(right%2))value={lat:field.ys[y],lon:field.xs[x],u:field.u[key],v:field.v[key],x,y};
  }nodeCache.set(key,value);return value;
 }
 function candidates(y,x){
  const key=y*nx+x;if(cellCache.has(key))return cellCache.get(key);const out=[];
  for(let j=y-1;j<=y+2;j++)for(let i=x-1;i<=x+2;i++){
   const p=node(j,i);if(!p)continue;const barriers=new Set();
   for(let cy=Math.min(y,j);cy<=Math.max(y,j);cy++)for(let cx=Math.min(x,i);cx<=Math.max(x,i);cx++)for(const s of cells.get(cy*nx+cx)||[])barriers.add(s);
   out.push({p,barriers:coastBarrierTree([...barriers])});
  }cellCache.set(key,out);return out;
 }
 return(lat,lon,crossings)=>{
  if(lat<56.72||lat>58.25||lon<17.72||lon>19.72)return null;
  let right=0;for(const x of crossings)if(x>lon)right++;if(right%2)return null;
  const y=lowerCell(field.ys,lat),x=lowerCell(field.xs,lon);if(x<0||y<0)return null;
  const gx=x+(lon-field.xs[x])/(field.xs[x+1]-field.xs[x]),gy=y+(lat-field.ys[y])/(field.ys[y+1]-field.ys[y]);
  let su=0,sv=0,sw=0,count=0,exact=null;
  for(const {p,barriers} of candidates(y,x)){
   const d2=(gx-p.x)**2+(gy-p.y)**2;if(d2>=radius*radius)continue;
   if(coastBarrierHit([lat,lon],[p.lat,p.lon],barriers))continue;
   count++;if(d2<1e-18){exact=p;continue}
   const r=Math.sqrt(d2)/radius,w=(1-r)**4*(1+4*r)/d2;su+=w*p.u;sv+=w*p.v;sw+=w;
  }
  if(count<2)return null;
  const u=exact?exact.u:su/sw,v=exact?exact.v:sv/sw;if(!Number.isFinite(u)||!Number.isFinite(v))return null;
  return{u,v,speed:Math.hypot(u,v),x,y,support:count};
 };
}
let metaPromise,coastPromise,palettePromise,latest=0,dataQueue=Promise.resolve();const chunks=new Map(),pending=new Map();let requests=0,bytes=0;
async function fieldFetch(url,options={}){requests++;const response=await fetch(url,{...options,signal:AbortSignal.timeout(55000),cache:'no-store'});requireField(response.ok,'HTTP '+response.status);return response}
async function chunk(base,key){const r=await fieldFetch(base+'/'+key),buffer=await r.arrayBuffer();bytes+=buffer.byteLength;return decodeBlosc(buffer)}
async function metadata(){
 if(!metaPromise)metaPromise=(async()=>{const d=await(await fieldFetch(FIELD_STAC)).json(),base=d.assets.timeChunked.href,m=(await(await fieldFetch(base+'/.zmetadata')).json()).metadata;
  for(const name of ['uo','vo']){const a=m[name+'/.zarray'];requireField(a.dtype==='<f4'&&a.order==='C'&&a.fill_value===-999&&a.chunks[0]===2&&a.chunks[1]===a.shape[1]&&a.chunks[2]===a.shape[2]&&!a.filters,'Unexpected current grid');requireField(m[name+'/.zattrs'].units==='m s-1','Current units')}
  const [yb,xb]=await Promise.all([chunk(base,'latitude/0'),chunk(base,'longitude/0')]),ys=new Float32Array(yb.buffer),xs=new Float32Array(xb.buffer);
  requireField(ys.every((v,i)=>Number.isFinite(v)&&(!i||v>ys[i-1]))&&xs.every((v,i)=>Number.isFinite(v)&&(!i||v>xs[i-1])),'Coordinate axes');
  requireField(m['time/.zattrs'].units==='days since 1900-01-01'&&m['time/.zarray'].dtype==='<f8','Time encoding');return{base,m,ys,xs,stac:d};
 })().catch(e=>{metaPromise=null;throw e});return metaPromise;
}
async function currentField(time){
 const m=await metadata(),t=Date.parse(time),dim=m.stac.properties['cube:dimensions'].time;
 const index=(t-Date.parse(dim.extent[0]))/900000;requireField(Number.isInteger(index)&&index>=0&&index<m.m['time/.zarray'].shape[0],'Zeitpunkt nicht verfügbar');
 const key=Math.floor(index/2),hit=chunks.get(key);if(hit&&Date.now()-hit.at<300000)return sliceField(hit,m,index);
 if(!pending.has(key))pending.set(key,(async()=>{
  // Verify the actual coordinate, never rely solely on catalogue start/step.
  const timeChunk=m.m['time/.zarray'].chunks[0],tb=await chunk(m.base,'time/'+Math.floor(index/timeChunk)),td=new DataView(tb.buffer);
  for(const i of [key*2,key*2+1]){const actual=Date.UTC(1900,0,1)+td.getFloat64((i%timeChunk)*8,true)*86400000;requireField(Math.abs(actual-(Date.parse(dim.extent[0])+i*900000))<1,'Kein exakter Zeitstempel')}
  const [u,v]=await Promise.all([chunk(m.base,'uo/'+key+'.0.0'),chunk(m.base,'vo/'+key+'.0.0')]);
  requireField(u.length===2*m.xs.length*m.ys.length*4&&v.length===u.length,'Grid length');const value={u:new Float32Array(u.buffer),v:new Float32Array(v.buffer),at:Date.now()};
  chunks.delete(key);chunks.set(key,value);while(chunks.size>2)chunks.delete(chunks.keys().next().value);return value;
 })().finally(()=>pending.delete(key)));
 return sliceField(await pending.get(key),m,index);
}
function sliceField(data,m,index){const n=m.xs.length*m.ys.length,start=index%2*n;return{xs:m.xs,ys:m.ys,u:data.u.subarray(start,start+n),v:data.v.subarray(start,start+n)}}
function validateCoast(elements){
 const segments=[],degree=new Map(),seen=new Set(),key=p=>p.lat+','+p.lon;
 for(const way of elements){const g=way.geometry||[];for(let i=1;i<g.length;i++){const a=g[i-1],b=g[i];requireField([a.lat,a.lon,b.lat,b.lon].every(Number.isFinite),'Coast coordinates');const ka=key(a),kb=key(b);if(ka===kb)continue;const edge=[ka,kb].sort().join(':');if(seen.has(edge))continue;seen.add(edge);degree.set(ka,(degree.get(ka)||0)+1);degree.set(kb,(degree.get(kb)||0)+1);segments.push({a:[a.lat,a.lon],b:[b.lat,b.lon]})}}
 requireField(segments.length>100&&[...degree.values()].every(n=>n===2),'Küstenmaske ist nicht geschlossen');
 const land=(lat,lon)=>segments.filter(s=>(s.a[0]>lat)!==(s.b[0]>lat)&&s.a[1]+(lat-s.a[0])*(s.b[1]-s.a[1])/(s.b[0]-s.a[0])>lon).length%2===1;
 requireField(land(57.5,18.5)&&land(57.93,19.15)&&!land(57.5,19.45),'Küstenmaske unvollständig');return segments;
}
async function coastline(){
 if(!coastPromise)coastPromise=(async()=>{const d=await(await fieldFetch('./data/gotland-coast-mask.json?v=6240')).json(),c=d.coverage;
  requireField(d.schemaVersion===1&&c&&c.west<=17.4&&c.east>=20.1&&c.south<=56.6&&c.north>=58.3,'Lokale Küstenmaske deckt das Kartengebiet nicht ab');
  return validateCoast(d.elements||[]);
 })().catch(e=>{coastPromise=null;throw e});return coastPromise;
}
async function palette(){if(!palettePromise)palettePromise=(async()=>{const response=await(await fieldFetch(FIELD_LEGEND)).json(),d=response.continuous;requireField(d&&d.valueMin===0&&d.valueMax===.7&&!d.logScale&&d.cmap?.colorMap?.length>=2&&d.cmap.colorMap.every(c=>Array.isArray(c)&&c.length===3&&c.every(v=>Number.isFinite(v)&&v>=0&&v<=255)),'Offizielle Farbskala fehlt');return d.cmap.colorMap})().catch(e=>{palettePromise=null;throw e});return palettePromise}
function fieldColor(speed,colors){const f=Math.max(0,Math.min(1,speed/.7))*(colors.length-1),i=Math.floor(f),j=Math.min(i+1,colors.length-1);return colors[i].map((v,k)=>Math.round(v+(colors[j][k]-v)*(f-i)))}
async function renderField(job){
 const start=performance.now();const [field,segments,colors]=await Promise.all([queuedField(job),coastline(),palette()]);if(job.id!==latest)return;
 requireField(typeof OffscreenCanvas!=='undefined','Browser unterstützt OffscreenCanvas nicht');
 const ratio=Math.min(2,job.ratio||1,Math.sqrt(2400000/(job.width*job.height))),w=Math.round(job.width*ratio),h=Math.round(job.height*ratio),canvas=new OffscreenCanvas(w,h),ctx=canvas.getContext('2d'),image=ctx.createImageData(w,h),scale=256*2**job.zoom;
 const latAt=y=>Math.atan(Math.sinh(Math.PI*(1-2*(job.origin.y+y/ratio)/scale)))*180/Math.PI,lonAt=x=>(job.origin.x+x/ratio)/scale*360-180;
 const cells=coastIndex(segments,field),sample=maskedSampler(field,segments,cells),waterMask=new Uint8Array(w*h);let colored=0;
 function crossAt(lat){return segments.filter(s=>(s.a[0]>lat)!==(s.b[0]>lat)).map(s=>s.a[1]+(lat-s.a[0])*(s.b[1]-s.a[1])/(s.b[0]-s.a[0]))}
 for(let y=0;y<h;y++){const lat=latAt(y+.5),cross=crossAt(lat);
  for(let x=0;x<w;x++){const p=sample(lat,lonAt(x+.5),cross);if(!p)continue;const color=fieldColor(p.speed,colors),i=(y*w+x)*4;image.data[i]=color[0];image.data[i+1]=color[1];image.data[i+2]=color[2];image.data[i+3]=204;waterMask[y*w+x]=1;colored++}
  if(y%24===0){await new Promise(r=>setTimeout(r,0));if(job.id!==latest)return}
 }
 ctx.putImageData(image,0,0);ctx.scale(ratio,ratio);ctx.strokeStyle='#000';ctx.fillStyle='#000';ctx.lineWidth=1.4;ctx.lineCap='round';ctx.lineJoin='round';let arrows=0,dots=0;
 for(let y=20;y<job.height;y+=38)for(let x=20;x<job.width;x+=38){const lat=latAt(y*ratio),p=sample(lat,lonAt(x*ratio),crossAt(lat));if(!p)continue;
  // The whole glyph must fit inside the valid rendered water area, not cross onto land/NoData.
  let safe=true;for(let dy=-9;dy<=9&&safe;dy++)for(let dx=-9;dx<=9;dx++){let px=Math.floor((x+dx)*ratio),py=Math.floor((y+dy)*ratio);if(px<0||py<0||px>=w||py>=h||!waterMask[py*w+px]){safe=false;break}}if(!safe)continue;
  ctx.save();ctx.translate(x,y);if(p.speed<CALM_SPEED){ctx.beginPath();ctx.arc(0,0,1.7,0,Math.PI*2);ctx.fill();dots++}else{ctx.rotate(Math.atan2(p.u,p.v));ctx.beginPath();ctx.moveTo(0,7);ctx.lineTo(0,-7);ctx.moveTo(-3,-3);ctx.lineTo(0,-7);ctx.lineTo(3,-3);ctx.stroke();arrows++}ctx.restore();
 }
 if(job.id!==latest)return;const bitmap=canvas.transferToImageBitmap();self.postMessage({id:job.id,bitmap,stats:{ms:Math.round(performance.now()-start),requests,bytes,arrows,dots,colored,coastSegments:segments.length,time:job.time}},[bitmap]);
}
async function queuedField(job){
 const previous=dataQueue;let release;dataQueue=new Promise(r=>{release=r});await previous;
 try{requireField(job.id===latest,'Veralteter Zeitpunkt');return await currentField(job.time)}finally{release()}
}
if(typeof self!=='undefined')self.onmessage=e=>{latest=e.data.id;if(e.data.cancel)return;renderField(e.data).catch(error=>{if(e.data.id===latest)self.postMessage({id:e.data.id,error:error.message})})};
if(typeof module!=='undefined')module.exports={decodeLz4,decodeBlosc,lowerCell,bilinearField,intersects,seaSample,coastIndex,coastBarrierTree,coastBarrierHit,validateCoast,fieldColor,maskedSampler,CALM_SPEED};
