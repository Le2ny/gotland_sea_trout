// Offline validation of the bundled, unsimplified OSM coastline rings.
const assert=require('node:assert/strict');
const {validateCoast,intersects}=require('../current-field-worker.js');
function contains(elements,lat,lon){let n=0;for(const r of elements)for(let i=1;i<r.geometry.length;i++){const a=r.geometry[i-1],b=r.geometry[i];if((a.lat>lat)!==(b.lat>lat)&&a.lon+(lat-a.lat)*(b.lon-a.lon)/(b.lat-a.lat)>lon)n++}return n%2===1}
function validate(data){
 assert.equal(data.schemaVersion,1);assert.equal(data.source.license,'ODbL-1.0');assert.ok(Number.isFinite(Date.parse(data.source.timestamp)));
 const c=data.coverage;assert.ok(c.west<=17.4&&c.east>=20.1&&c.south<=56.6&&c.north>=58.3,'Coverage must include the complete existing Gotland field');
 const all=[],lengths=[],wayIds=new Set();let area=0;
 for(let r=0;r<data.elements.length;r++){
  const ring=data.elements[r],g=ring.geometry;assert.ok(g.length>=4);assert.deepEqual(g[0],g.at(-1),'Open ring');
  for(const id of ring.sourceWayIds){assert.ok(!wayIds.has(id),'Source way duplicated');wayIds.add(id)}
  let signed=0;for(let i=1;i<g.length;i++){
   const a=g[i-1],b=g[i];assert.ok([a.lat,a.lon,b.lat,b.lon].every(Number.isFinite));assert.ok(a.lat>c.south&&a.lat<c.north&&a.lon>c.west&&a.lon<c.east,'Ring touches survey boundary: expand source area');assert.notDeepEqual(a,b,'Zero-length edge');
   const s={a:[a.lat,a.lon],b:[b.lat,b.lon],ring:r,index:i-1,count:g.length-1,id:all.length};all.push(s);
   signed+=a.lon*b.lat-b.lon*a.lat;lengths.push(Math.hypot((a.lat-b.lat)*111200,(a.lon-b.lon)*111200*Math.cos((a.lat+b.lat)*Math.PI/360)));
  }assert.ok(Math.abs(signed)>1e-12,'Degenerate ring');area+=signed/2;
 }
 assert.equal(wayIds.size,data.source.wayCount,'All source ways must occur exactly once');
 const buckets=new Map(),checked=new Set();let pairs=0;
 for(const s of all){for(let y=Math.floor(Math.min(s.a[0],s.b[0])*100);y<=Math.floor(Math.max(s.a[0],s.b[0])*100);y++)for(let x=Math.floor(Math.min(s.a[1],s.b[1])*100);x<=Math.floor(Math.max(s.a[1],s.b[1])*100);x++){
  const key=x+','+y,bucket=buckets.get(key)||[];
  for(const t of bucket){if(s.ring===t.ring&&(Math.abs(s.index-t.index)===1||Math.abs(s.index-t.index)===s.count-1))continue;const pair=t.id+','+s.id;if(checked.has(pair))continue;checked.add(pair);pairs++;assert.ok(!intersects(s.a,s.b,t.a,t.b),'Coast crossing/touch: rings '+s.ring+'/'+t.ring+' edges '+s.index+'/'+t.index)}
  bucket.push(s);buckets.set(key,bucket);
 }}
 validateCoast(data.elements);
 lengths.sort((a,b)=>a-b);
 return{rings:data.elements.length,sourceWays:wayIds.size,segments:all.length,intersectionPairsChecked:pairs,segmentMetres:{median:+lengths[Math.floor(lengths.length*.5)].toFixed(1),p95:+lengths[Math.floor(lengths.length*.95)].toFixed(1),max:+lengths.at(-1).toFixed(1)},signedAreaDegrees:area};
}
module.exports={validate,contains};
if(require.main===module){const fs=require('node:fs'),path=require('node:path');const file=process.argv[2]||path.join(__dirname,'../data/gotland-coast-mask.json');console.log(JSON.stringify(validate(JSON.parse(fs.readFileSync(file,'utf8'))),null,2))}
