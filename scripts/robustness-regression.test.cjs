const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
function setup(){
  const elements={},callbacks={},statuses=[];
  const element=id=>elements[id]??={innerHTML:'',textContent:'unchanged',classList:{items:new Set(),add(k){this.items.add(k)},remove(k){this.items.delete(k)},contains(k){return this.items.has(k)}},querySelectorAll:()=>[]};
  const c={rankingCurrentInFlight:new Map(),console:{warn(){}},Date,Map,Set,URL,requestVersions:{},weatherGeneration:0,timelineHours:[new Date('2026-09-15T12:00Z'),new Date('2026-09-15T13:00Z')],timelineIndex:0,active:{},document:{querySelector:element},$:element,status:s=>statuses.push(s),setTimeout:()=>1,clearTimeout(){},updateTimeline(){},updateLandCover(){},renderLegends(){},cancelModes(){},applySpotVisibility(){},satCenters:()=>[],favs:new Set(),customSpots:[],coastSegments:[],coastMaskPolys:[],coastMaskPromise:null,stitchCoastWays:()=>[],validLandRing:()=>true,live:async()=>({w:{current:{}},m:{current:{}}}),score:()=>50,compass:()=> 'N',exposure:()=> 'auflandig',currentKnots:()=>0,roundedCurrentTime:()=>new Date('2026-09-15T12:00Z')};
  c.map={layers:new Set(),setView(){},getCenter:()=>({lat:57,lng:18}),hasLayer(l){return this.layers.has(l)},removeLayer(l){this.layers.delete(l)},on(name,fn){callbacks[name]=fn}};
  for(const name of ['spotLayer','customLayer','homeLayer','protectedLayer','parkingLayer','bathy','windLayer','currentLayer','tempLayer','turbidityLayer','seaLevelLayer','waveLayer','shore50Layer'])c[name]={drawn:null,clearLayers(){this.drawn=null},addTo(map){map.layers.add(this)}};
  c.officialCurrentWmtsLayer=()=>({addTo(){}});c.drawScalarBands=(samples,layer)=>{layer.drawn=samples[0].value};c.drawStaticVectors=(samples,layer)=>{layer.drawn=samples[0].value};
  for(const name of ['currentColor','windColor','tempColor','levelColor','waveColor'])c[name]=()=>'';
  vm.createContext(c);
  for(const prefix of ['const CURRENT_SOLID_STYLE=','const CURRENT_VECTOR_STYLE='])vm.runInContext(source.split(/\r?\n/).find(l=>l.startsWith(prefix)),c);
  c.copernicusTime=d=>d.toISOString().replace('.000Z','Z');
  for(const name of ['readStored','storedPoint','requestGuard','invalidateRequest','timelineTime','hourlyIndex','rankingHour','openSheet','closeSheet','snapOneSpot','loadCoastMask','loadParkingNear','loadVectors','loadTemp','loadSeaLevel','loadWave','refreshConditionStrip','setLayer','today','fetchWindSamples','fetchTempSamples','fetchSeaLevelSamples','fetchWaveSamples','fetchCurrentSamples','uvFrom']){
    const line=source.split(/\r?\n/).find(l=>l.startsWith('function '+name+'(')||l.startsWith('async function '+name+'('));if(line)vm.runInContext(line,c);
  }
  vm.runInContext(source.slice(source.indexOf('async function openSpot('),source.indexOf('\nfunction renderSpots(')),c);
  vm.runInContext(source.split(/\r?\n/).find(l=>l.startsWith('let refreshTimer;')),c);
  vm.runInContext(source.split(/\r?\n/).find(l=>l.startsWith('let viewportTimer=')),c);
  return {c,elements,element,callbacks,statuses};
}
function storage(c,data){const writes=[];c.localStorage={getItem:key=>data[key]??null,setItem:(...args)=>writes.push(args),removeItem:(...args)=>writes.push(args)};return writes}
function startup(c){const lines=source.split(/\r?\n/).filter(l=>l.startsWith('let customSpots=')||l.startsWith('const favs='));vm.runInContext(lines.join('\n')+'\nthis.loaded={customSpots,home,favs:[...favs]};',c);return JSON.parse(JSON.stringify(c.loaded))}
test('invalid persisted JSON and wrong container types fall back without modifying storage',async()=>{
  for(const key of ['gst-custom-v6','gst-home-v6','gst-favs','gst-coastsnap-v611'])for(const value of ['{broken','null','42','"wrong"']){
    const {c}=setup(),writes=storage(c,{[key]:value});c.json=async()=>({elements:[]});
    assert.deepEqual(startup(c),{customSpots:[],home:null,favs:[]});
    await assert.doesNotReject(c.snapOneSpot({id:1,lat:57,lon:18}));assert.equal(writes.length,0);
  }
});
test('valid user storage and coast-snap entries load unchanged without writes',async()=>{
  const {c}=setup(),custom=[{id:'c1',name:'Own',lat:57,lon:18,rating:4,facing:0}],home={lat:57.1,lon:18.1,name:'Home'},favs=[1,3];
  const writes=storage(c,{'gst-custom-v6':JSON.stringify(custom),'gst-home-v6':JSON.stringify(home),'gst-favs':JSON.stringify(favs),'gst-coastsnap-v611':'{"1":[57.2,18.2]}'});
  assert.deepEqual(startup(c),{customSpots:custom,home,favs});const spot={id:1,lat:57,lon:18};assert.equal(await c.snapOneSpot(spot),true);assert.equal(spot.lat,57.2);assert.equal(spot.lon,18.2);assert.equal(writes.length,0);
});
test('late spot responses cannot overwrite a newer spot or a reopened same spot',async()=>{
  for(const same of [false,true]){const {c,element}=setup(),a=deferred(),b=deferred();let calls=0;c.live=()=>calls++?b.promise:a.promise;
    const spot={id:1,name:'A',rating:3,lat:57,lon:18};const first=c.openSpot(spot),second=c.openSpot(same?spot:{...spot,id:2,name:'B'});
    b.resolve({m:{current:{sea_surface_temperature:12}}});await second;const latest=element('#spotLive').innerHTML;
    a.resolve({m:{current:{sea_surface_temperature:1}}});await first;assert.equal(element('#spotLive').innerHTML,latest);
  }
});
test('closing or replacing a sheet invalidates its pending spot request',async()=>{
  for(const action of ['closeSheet','openSheet']){const {c,element}=setup(),pending=deferred();c.live=()=>pending.promise;const request=c.openSpot({id:1,name:'A',rating:3,lat:57,lon:18});c[action]('replacement');const before=element('#spotLive').innerHTML;pending.resolve({m:{current:{sea_surface_temperature:1}}});await request;assert.equal(element('#spotLive').innerHTML,before)}
});
test('condition strip ignores older responses arriving after the latest response',async()=>{
  const {c,element}=setup(),a=deferred(),b=deferred();let calls=0;c.live=()=>calls++?b.promise:a.promise;
  const first=c.refreshConditionStrip(),second=c.refreshConditionStrip();const data=value=>({m:{hourly:{time:c.timelineHours.map(t=>+t/1000),sea_surface_temperature:[value,value]}}});
  b.resolve(data(12));await second;a.resolve(data(1));await first;assert.equal(element('#stripTemp').textContent,'12.0°');
});
const layers=[['loadTemp','fetchTempSamples','tempLayer','temp'],['loadSeaLevel','fetchSeaLevelSamples','seaLevelLayer','level'],['loadWave','fetchWaveSamples','waveLayer','wave'],['loadVectors','fetchWindSamples','windLayer','wind'],['loadVectors','fetchCurrentSamples','currentLayer','current']];
test('late weather/current layer responses never redraw over a newer request',async()=>{
  for(const [load,fetch,layer,key] of layers){const {c}=setup(),a=deferred(),b=deferred();let calls=0;c[fetch]=()=>calls++?b.promise:a.promise;const first=c[load](key),second=c[load](key);b.resolve([{value:12}]);await second;a.resolve([{value:1}]);await first;assert.equal(c[layer].drawn,key==='current'?null:12,key)}
});
test('disabled layers ignore late successes and errors',async()=>{
  for(const [load,fetch,layer,key] of layers)for(const fail of [false,true]){const {c,statuses}=setup(),pending=deferred();c[fetch]=()=>pending.promise;const request=c[load](key);c.setLayer(key,false);const statusCount=statuses.length;
    if(fail)pending.reject(Error('old failure'));else pending.resolve([{value:1}]);await request;
    assert.equal(c.map.hasLayer(c[layer]),false,key);assert.equal(c[layer].drawn,null,key);assert.equal(statuses.length,statusCount,key);
  }
});
test('timeline and viewport changes invalidate pending layer work before debounce starts another request',async()=>{
  for(const [load,fetch,layer,key] of layers)for(const action of ['time','viewport']){const {c,callbacks}=setup(),pending=deferred();c[fetch]=()=>pending.promise;const request=c[load](key);
    if(action==='time'){c.timelineIndex=1;c.refreshTimed()}else callbacks['moveend zoomend']();pending.resolve([{value:1}]);await request;assert.equal(c[layer].drawn,null,key+' '+action);
  }
});
test('an older ranking run cannot overwrite a newer ranking result',async()=>{
  const {c,element}=setup(),a=deferred(),b=deferred();let calls=0;c.spots=[{id:1,name:'A'}];c.fetchCurrentSamples=async()=>null;c.live=()=>calls++?b.promise:a.promise;c.scoreDetailed=(w,m)=>({score:m.wave_height,reasons:[]});
  const first=c.today();await new Promise(setImmediate);assert.equal(calls,1);const second=c.today();await new Promise(setImmediate);assert.equal(calls,2);b.resolve(rankingWave(c,90));await second;const latest=element('#ranking').innerHTML;a.resolve(rankingWave(c,1));await first;assert.equal(element('#ranking').innerHTML,latest);
});
test('failed coast request is retryable; concurrent callers share the in-flight request',async()=>{
  const {c}=setup(),pending=deferred();let calls=0;c.overpass=()=>{calls++;return calls===1?pending.promise:Promise.resolve({elements:[{geometry:[{lat:57,lon:18},{lat:57.1,lon:18.1}]}]})};
  const first=c.loadCoastMask(),also=c.loadCoastMask();assert.equal(calls,1);pending.reject(Error('offline'));assert.equal((await first).length,0);assert.equal((await also).length,0);
  assert.equal((await c.loadCoastMask()).length,1);assert.equal(calls,2);await c.loadCoastMask();assert.equal(calls,2);
});

test('late sample responses cannot replace newer cached weather or current data',async()=>{
  for(const [name,cache,field] of [['fetchWindSamples','windCache','wind_speed_10m'],['fetchTempSamples','tempCache','sea_surface_temperature'],['fetchSeaLevelSamples','levelCache','sea_level_height_msl'],['fetchWaveSamples','waveCache','wave_height'],['fetchCurrentSamples','currentNumericCache',null]]){
    const {c}=setup(),a=deferred(),b=deferred();let calls=0;
    const pts=Array.from({length:8},(_,i)=>({lat:57+i/100,lon:18}));c[cache]=new Map();c.viewCacheKey=()=> 'same';c.currentSourcePoints=()=>pts;c.currentNumericPoints=()=>pts;c.sampleBounds=()=>({s:57,n:58,w:18,e:19});c.copernicusTime=()=> 'same';
    c.weatherBatch=c.marineBatch=()=>calls++?b.promise:a.promise;c.fetchCurrentPoint=p=>(calls++<8?a.promise:b.promise).then(v=>({...p,value:v}));
    const first=c[name](),second=c[name]();const data=v=>field?pts.map(()=>({hourly:{time:c.timelineHours.map(t=>+t/1000),[field]:[v,v],wind_direction_10m:[90,90]}})):v;
    b.resolve(data(12));await second;a.resolve(data(1));await first;const cached=[...c[cache].values()][0];assert.equal(cached[0].value??cached[0].v,12,name);
  }
});
test('a stale failed ranking request cannot replace a newer result',async()=>{
  const {c,element}=setup(),a=deferred(),b=deferred();let calls=0;c.spots=[{id:1,name:'A'}];c.fetchCurrentSamples=async()=>null;c.live=()=>calls++?b.promise:a.promise;c.scoreDetailed=()=>({score:90,reasons:[]});
  const first=c.today();await new Promise(setImmediate);const second=c.today();await new Promise(setImmediate);b.resolve({});await second;const latest=element('#ranking').innerHTML;a.reject(Error('offline'));await first;assert.equal(element('#ranking').innerHTML,latest);
});

function parkingSetup(){const state=setup(),{c}=state;c.loadCoastMask=async()=>[];c.parseParking=d=>d;c.parkingMarker=p=>p;c.parkingLayer.addLayer=p=>{c.parkingLayer.drawn=p};return state}
const parkingSpot={id:1,name:'A',rating:3,lat:57,lon:18};
const parkingData=name=>[{id:name,name,lat:57,lon:18,spot:100,coast:50}];
test('parking: late Spot A response never writes parking information into Spot B',async()=>{
  for(const fail of [false,true]){
    const {c,element,statuses}=parkingSetup(),pending=deferred();let calls=0;c.parkingQuery=()=>{calls++;return pending.promise};
    await c.openSpot(parkingSpot);const request=c.loadParkingNear(parkingSpot,true);await new Promise(setImmediate);assert.equal(calls,1);
    await c.openSpot({...parkingSpot,id:2,name:'B'});element('#parkResults').innerHTML='Spot B parking';const count=statuses.length;
    if(fail)pending.reject(Error('old parking error'));else pending.resolve(parkingData('Parking A'));await request;
    assert.equal(element('#parkResults').innerHTML,'Spot B parking');assert.equal(c.parkingLayer.drawn,null);assert.equal(statuses.length,count);
  }
});
test('parking: starting a parking request preserves pending live spot details and latest parking results',async()=>{
  const {c,element}=parkingSetup(),live=deferred(),a=deferred(),b=deferred();c.live=()=>live.promise;let calls=0;c.parkingQuery=()=>calls++?b.promise:a.promise;
  const spot=c.openSpot(parkingSpot),first=c.loadParkingNear(parkingSpot,true);await new Promise(setImmediate);const second=c.loadParkingNear(parkingSpot,true);await new Promise(setImmediate);
  live.resolve({m:{current:{sea_surface_temperature:12}}});await spot;assert.match(element('#spotLive').innerHTML,/12 °C/);
  b.resolve(parkingData('Latest parking'));await second;const latest=element('#parkResults').innerHTML;assert.match(latest,/Latest parking/);
  a.resolve(parkingData('Old parking'));await first;assert.equal(element('#parkResults').innerHTML,latest);
});
test('parking: a closed sheet stops work after coast loading; map-only requests remain valid',async()=>{
  const {c,element}=parkingSetup(),coast=deferred();let calls=0;c.loadCoastMask=()=>coast.promise;c.parkingQuery=async()=>{calls++;return parkingData('Map parking')};
  await c.openSpot(parkingSpot);const request=c.loadParkingNear(parkingSpot,true);c.closeSheet();coast.resolve([]);await request;assert.equal(calls,0);
  const mapRequest=c.loadParkingNear(parkingSpot,false);c.openSheet('Another sheet');await mapRequest;assert.equal(calls,1);assert.equal(c.parkingLayer.drawn.name,'Map parking');assert.equal(element('#parkResults').innerHTML,'');
});

function viewportTimers(c){const timers=new Map();let id=0;c.setTimeout=fn=>{timers.set(++id,fn);return id};c.clearTimeout=id=>timers.delete(id);return {timers,flush:async()=>{const work=[...timers.values()];timers.clear();work.forEach(fn=>fn());await new Promise(setImmediate)}}}
test('viewport movement does not start a ranking that has never been opened',async()=>{
  const {c,element,callbacks}=setup(),clock=viewportTimers(c);element('#ranking').classList.add('hidden');let calls=0;c.today=()=>calls++;c.refreshConditionStrip=()=>{};callbacks['moveend zoomend']();await clock.flush();assert.equal(calls,0);
});

const invalidCoastEntries=[null,'broken',{},[],[57],[57,18,19],['57',18],[57,null]];
test('coast-position cache: valid entries survive a damaged neighbour without fetching or writing',async()=>{
  for(const bad of invalidCoastEntries){const {c}=setup(),data={'gst-coastsnap-v611':JSON.stringify({1:[57,18],2:bad,3:[57.3,18.3]})},writes=storage(c,data);let calls=0;c.json=async()=>{calls++;return {elements:[]}};
    for(const [id,coords] of [[1,[57,18]],[3,[57.3,18.3]]]){const spot={id,lat:0,lon:0};assert.equal(await c.snapOneSpot(spot),true);assert.deepEqual([spot.lat,spot.lon],coords)}assert.equal(calls,0);assert.equal(writes.length,0);
  }
});
test('coast-position cache: reloading a damaged entry preserves all other valid stored entries',async()=>{
  for(const bad of invalidCoastEntries){const {c}=setup(),original={1:[57,18],2:bad,3:[57.3,18.3]},writes=storage(c,{'gst-coastsnap-v611':JSON.stringify(original)});c.json=async()=>({elements:[{geometry:[{},{}]}]});c.nearestOnSegment=()=>({lat:57.2,lon:18.2});c.hav=()=>1;
    assert.equal(await c.snapOneSpot({id:2,lat:57,lon:18}),true);assert.equal(writes.length,1);assert.equal(writes[0][0],'gst-coastsnap-v611');assert.deepEqual(JSON.parse(writes[0][1]),{1:[57,18],2:[57.2,18.2],3:[57.3,18.3]});
  }
});
test('coast-position cache: completely invalid data and malformed JSON fall back without crashing',async()=>{
  for(const raw of ['{broken','null','42','[]','"bad"',JSON.stringify({1:null,2:['bad',18]})]){const {c}=setup(),writes=storage(c,{'gst-coastsnap-v611':raw});c.json=async()=>({elements:[]});const spot={id:1,lat:57,lon:18};assert.equal(await c.snapOneSpot(spot),false);assert.deepEqual(spot,{id:1,lat:57,lon:18});assert.equal(writes.length,0)}
});
test('coast-position cache: fully valid cache is reused unchanged',async()=>{
  const {c}=setup(),entries={1:[57,18],2:[57.2,18.2],3:[57.3,18.3]},writes=storage(c,{'gst-coastsnap-v611':JSON.stringify(entries)});let calls=0;c.json=async()=>{calls++;return {elements:[]}};
  for(const [id,coords] of Object.entries(entries)){const spot={id,lat:0,lon:0};assert.equal(await c.snapOneSpot(spot),true);assert.deepEqual([spot.lat,spot.lon],coords)}assert.equal(calls,0);assert.equal(writes.length,0);
});

function rankingHourly(c,values){return {hourly:{time:c.timelineHours.map(t=>+t/1000),...Object.fromEntries(Object.entries(values).map(([k,v])=>[k,c.timelineHours.map(()=>v)]))}}}
function rankingWave(c,value){return {m:rankingHourly(c,{wave_height:value})}}
function timedRankingSetup(){const state=setup(),{c}=state,clock=viewportTimers(c),requests=[];c.refreshConditionStrip=()=>{};c.spots=[{id:1,name:'A'}];c.fetchCurrentSamples=async()=>null;c.scoreDetailed=(w,m)=>({score:m.wave_height,reasons:[]});c.live=()=>{const d=deferred();requests.push({...d,index:c.timelineIndex});return d.promise};return {...state,clock,requests}}
test('timeline ranking: pending ranking is invalidated and restarted for the selected time',async()=>{
  const {c,element,clock,requests}=timedRankingSetup();const old=c.today();await new Promise(setImmediate);c.timelineIndex=1;c.refreshTimed();requests[0].resolve(rankingWave(c,1));await old;assert.match(element('#ranking').innerHTML,/Lade Wind/);
  await clock.flush();assert.equal(requests.length,2);assert.equal(requests[1].index,1);requests[1].resolve(rankingWave(c,90));await new Promise(setImmediate);assert.ok(element('#ranking').innerHTML.includes('90/100'));assert.doesNotMatch(element('#ranking').innerHTML,/Lade Wind/);
});
test('timeline ranking: late response from the old time cannot replace the new ranking',async()=>{
  const {c,element,clock,requests}=timedRankingSetup();const old=c.today();await new Promise(setImmediate);c.timelineIndex=1;c.refreshTimed();await clock.flush();assert.equal(requests.length,2);requests[1].resolve(rankingWave(c,90));await new Promise(setImmediate);const latest=element('#ranking').innerHTML;assert.ok(latest.includes('90/100'));requests[0].resolve(rankingWave(c,1));await old;assert.equal(element('#ranking').innerHTML,latest);
});
test('timeline ranking: rapid changes show only the latest selected state',async()=>{
  const {c,element,clock,requests}=timedRankingSetup();const old=c.today();await new Promise(setImmediate);c.timelineIndex=1;c.refreshTimed();await clock.flush();assert.equal(requests.length,2);
  for(const index of [0,1,0]){c.timelineIndex=index;c.refreshTimed()}assert.equal(clock.timers.size,1);await clock.flush();assert.equal(requests.length,3);assert.equal(requests[2].index,0);requests[2].resolve(rankingWave(c,80));await new Promise(setImmediate);const latest=element('#ranking').innerHTML;assert.ok(latest.includes('80/100'));requests[1].resolve(rankingWave(c,20));requests[0].resolve(rankingWave(c,1));await old;await new Promise(setImmediate);assert.equal(element('#ranking').innerHTML,latest);
});
test('timeline ranking: changing time does not open or start a hidden ranking',async()=>{
  const {c,element,clock,requests}=timedRankingSetup();element('#ranking').classList.add('hidden');c.timelineIndex=1;c.refreshTimed();await clock.flush();assert.equal(requests.length,0);assert.ok(element('#ranking').classList.contains('hidden'));assert.equal(element('#ranking').innerHTML,'');
});

const savedOwn={id:'old',name:'Saved',lat:57,lon:18,rating:4,facing:0};
test('own storage: valid spot survives a null neighbour without writes',()=>{const {c}=setup(),writes=storage(c,{'gst-custom-v6':JSON.stringify([savedOwn,null])});assert.deepEqual(startup(c).customSpots,[savedOwn]);assert.equal(writes.length,0)});
test('own storage: subsequent normal save retains the old valid spot and the new spot',()=>{const {c}=setup(),writes=storage(c,{'gst-custom-v6':JSON.stringify([savedOwn,null])});startup(c);vm.runInContext(source.split(/\r?\n/).find(l=>l.startsWith('function saveCustom(')),c);const added={...savedOwn,id:'new'};c.added=added;vm.runInContext('customSpots.push(added);saveCustom()',c);assert.equal(writes.length,1);assert.deepEqual(JSON.parse(writes[0][1]),[savedOwn,added])});
test('own storage: mixed entries retain only individually valid spots',()=>{const {c}=setup(),second={...savedOwn,id:'second'},writes=storage(c,{'gst-custom-v6':JSON.stringify([savedOwn,null,{},42,'bad',{lat:'57',lon:18},second])});assert.deepEqual(startup(c).customSpots,[savedOwn,second]);assert.equal(writes.length,0)});
test('own storage: invalid containers and JSON use the empty default without writes',()=>{for(const raw of ['{broken','null','{}','42','"bad"']){const {c}=setup(),writes=storage(c,{'gst-custom-v6':raw});assert.deepEqual(startup(c).customSpots,[]);assert.equal(writes.length,0)}});
test('own storage: valid list loads unchanged without writes',()=>{const {c}=setup(),list=[savedOwn,{...savedOwn,id:'second'}],writes=storage(c,{'gst-custom-v6':JSON.stringify(list)});assert.deepEqual(startup(c).customSpots,list);assert.equal(writes.length,0)});
const cacheCases=[['fetchWindSamples','windCache','wind_speed_10m'],['fetchTempSamples','tempCache','sea_surface_temperature'],['fetchSeaLevelSamples','levelCache','sea_level_height_msl'],['fetchWaveSamples','waveCache','wave_height'],['fetchCurrentSamples','currentNumericCache',null]];
function keyedCacheSetup([name,cache,field]){const {c}=setup(),pts=Array.from({length:8},(_,i)=>({lat:57+i/100,lon:18})),pending=[];let selected='A';c[cache]=new Map();c.viewCacheKey=()=>selected;c.currentSourcePoints=c.currentNumericPoints=()=>pts;c.sampleBounds=()=>({s:57,n:58,w:18,e:19});c.copernicusTime=()=>selected;
 c.weatherBatch=c.marineBatch=()=>{const d=deferred();pending.push(d);return d.promise};let calls=0;c.fetchCurrentPoint=p=>{if(calls++%8===0)pending.push(deferred());return pending.at(-1).promise.then(v=>({...p,value:v}))};
 return {c,pending,cache:c[cache],select:k=>selected=k,key:k=>field?k:k+':57.00:58.00:18.00:19.00',start:()=>c[name](),finish:(i,v)=>pending[i].resolve(field?pts.map(()=>({hourly:{time:c.timelineHours.map(t=>+t/1000),[field]:[v,v],wind_direction_10m:[90,90]}})):v)};
}
test('keyed caches: B cache hit does not invalidate pending A',async()=>{for(const entry of cacheCases){const h=keyedCacheSetup(entry);h.cache.set(h.key('B'),[{value:8}]);const a=h.start();h.select('B');await h.start();h.finish(0,12);await a;assert.equal(h.cache.get(h.key('A'))?.[0].value??h.cache.get(h.key('A'))?.[0].v,12,entry[0])}});
test('keyed caches: later A1 response cannot overwrite newer A2',async()=>{for(const entry of cacheCases){const h=keyedCacheSetup(entry),a=h.start(),b=h.start();h.finish(1,12);await b;h.finish(0,1);await a;const result=h.cache.get(h.key('A'))[0];assert.equal(result.value??result.v,12,entry[0])}});
test('keyed caches: overlapping independent keys both cache successfully',async()=>{for(const entry of cacheCases){const h=keyedCacheSetup(entry),a=h.start();h.select('B');const b=h.start();h.finish(1,12);await b;h.finish(0,7);await a;for(const [key,value] of [['A',7],['B',12]]){const result=h.cache.get(h.key(key))?.[0];assert.equal(result?.value??result?.v,value,entry[0]+' '+key)}}});

test('favourites storage: valid IDs survive a null neighbour without writes',()=>{const {c}=setup(),writes=storage(c,{'gst-favs':'[1,3,null]'});assert.deepEqual(startup(c).favs,[1,3]);assert.equal(writes.length,0)});
test('favourites storage: ordinary favourite click preserves valid saved IDs',async()=>{const {c,element}=setup(),writes=storage(c,{'gst-favs':'[1,3,null]'});startup(c);assert.equal(writes.length,0);c.renderList=()=>{};await c.openSpot({id:5,name:'Five',rating:3,lat:57,lon:18});element('#favA').onclick();await new Promise(setImmediate);assert.equal(writes.length,1);assert.equal(writes[0][0],'gst-favs');assert.deepEqual(JSON.parse(writes[0][1]),[1,3,5])});
test('favourites storage: mixed entries retain valid numeric and string IDs',()=>{const {c}=setup(),writes=storage(c,{'gst-favs':JSON.stringify([1,null,{},3,[],false,'c1',true])});assert.deepEqual(startup(c).favs,[1,3,'c1']);assert.equal(writes.length,0)});
test('favourites storage: invalid JSON and containers use the empty default without writes',()=>{for(const raw of ['{broken','null','{}','42','"bad"']){const {c}=setup(),writes=storage(c,{'gst-favs':raw});assert.deepEqual(startup(c).favs,[]);assert.equal(writes.length,0)}});
test('favourites storage: a fully valid list loads unchanged without writes',()=>{const {c}=setup(),values=[1,3,'c1'],writes=storage(c,{'gst-favs':JSON.stringify(values)});assert.deepEqual(startup(c).favs,values);assert.equal(writes.length,0)});

function rankingSpatialSetup(){const state=setup(),{c}=state;for(const name of ['sampleBounds','currentNumericPoints','rankingCurrentPoints','currentContext','idwVector','vdFrom','scoreDetailed','angleDiff','copernicusTime','roundedCurrentTime']){const line=source.split(/\r?\n/).find(l=>l.startsWith('function '+name+'('));if(line)vm.runInContext(line,c)}vm.runInContext(source.slice(source.indexOf('const spots=['),source.indexOf('const map='))+';this.spots=spots;',c);c.SEA_DOMAIN={s:54,n:61.5,w:12,e:25};c.isLandCoast=()=>false;c.currentNumericCache=new Map();let bounds,zoom,requests=0;const setView=(b,z)=>{bounds=b;zoom=z};setView({s:56.85,n:57.05,w:18,e:18.2},10);c.map.getBounds=()=>({getSouth:()=>bounds.s,getNorth:()=>bounds.n,getWest:()=>bounds.w,getEast:()=>bounds.e});c.map.getZoom=()=>zoom;c.live=async()=>({w:rankingHourly(c,{wind_speed_10m:15,wind_direction_10m:90}),m:rankingHourly(c,{wave_height:.5,sea_surface_temperature:10,ocean_current_velocity:.2,ocean_current_direction:90})});c.fetchCurrentPoint=async(p,time)=>{requests++;const u=p.lat<57.5?.4:0,n=p.lat<57.5?0:.02;return {...p,u,n,...c.vdFrom(u,n)}};let scores=[];const original=c.scoreDetailed;c.scoreDetailed=(w,m,s,ctx)=>{const d=original(w,m,s,ctx);scores.push({id:s.id,score:d.score});return d};return {...state,setView,requests:()=>requests,run:async()=>{scores=[];await c.today();assert.equal(scores.length,25);return scores.slice().sort((a,b)=>b.score-a.score)}}}
test('ranking spatial independence: all 25 scores and full order match across bounds and zoom',async()=>{const h=rankingSpatialSetup(),first=await h.run();h.setView({s:58.1,n:58.3,w:19,e:19.2},15);h.c.currentNumericCache.clear();const second=await h.run();assert.deepEqual(second,first);assert.equal(new Set(second.map(s=>s.id)).size,25)});
test('ranking viewport movement: pending ranking stays valid and opened ranking is not restarted',async()=>{for(const phase of ['current','live']){const {c,element,callbacks}=setup(),clock=viewportTimers(c),pending=deferred();let currentCalls=0,liveCalls=0;c.spots=[{id:1,name:'A'}];c.refreshConditionStrip=()=>{};c.scoreDetailed=()=>({score:90,reasons:[]});c.fetchCurrentSamples=()=>{currentCalls++;return phase==='current'?pending.promise:Promise.resolve(null)};c.live=()=>{liveCalls++;return phase==='live'?pending.promise:Promise.resolve({})};const run=c.today();await new Promise(setImmediate);callbacks['moveend zoomend']();callbacks['moveend zoomend']();await clock.flush();assert.equal(currentCalls,1,'no new ranking on map movement');pending.resolve(phase==='current'?null:{});await run;assert.ok(element('#ranking').innerHTML.includes('90/100'));assert.equal(liveCalls,1);callbacks['moveend zoomend']();await clock.flush();assert.equal(currentCalls,1);assert.equal(liveCalls,1)}});

test('ranking currents: map movement preserves the ranking cache; a new timeline uses a new cache entry',async()=>{const h=rankingSpatialSetup();const a=await h.c.fetchCurrentSamples(true);assert.equal(h.requests(),125);h.setView({s:58.1,n:58.3,w:19,e:19.2},15);h.callbacks['moveend zoomend']();assert.strictEqual(await h.c.fetchCurrentSamples(true),a);assert.equal(h.requests(),125);h.c.timelineIndex=1;h.c.refreshTimed();await h.c.fetchCurrentSamples(true);assert.equal(h.requests(),250)});
test('ranking currents: pending cache write survives map movement',async()=>{const h=rankingSpatialSetup(),pending=deferred();let calls=0;const original=h.c.fetchCurrentPoint;h.c.fetchCurrentPoint=async(p,t)=>{calls++;await pending.promise;return original(p,t)};const first=h.c.fetchCurrentSamples(true);h.callbacks['moveend zoomend']();pending.resolve();const samples=await first;assert.equal(calls,125);assert.strictEqual(await h.c.fetchCurrentSamples(true),samples);assert.equal(calls,125)});


test('ranking coverage: eight successes and total failure use uniform fallback without caching',async()=>{for(const limit of [8,0,124]){const h=rankingSpatialSetup(),fetch=h.c.fetchCurrentPoint;let calls=0,contexts=[];h.c.fetchCurrentPoint=(p,t)=>calls++<limit?fetch(p,t):Promise.reject(Error('missing'));const score=h.c.scoreDetailed;h.c.scoreDetailed=(w,m,s,ctx)=>{contexts.push(ctx);return score(w,m,s,ctx)};await h.run();assert.ok(calls<=Math.min(125,limit+10));if(limit===124)assert.equal(calls,125);assert.equal(contexts.length,25);assert.ok(contexts.every(x=>x===null));assert.equal(h.c.currentNumericCache.size,0)}});
test('ranking coverage: each of the five local positions must be valid',async()=>{for(let offset=0;offset<5;offset++){const h=rankingSpatialSetup(),fetch=h.c.fetchCurrentPoint;let i=0;h.c.fetchCurrentPoint=async(p,t)=>{const x=await fetch(p,t);return i++===offset?{...x,u:NaN}:x};await assert.rejects(h.c.fetchCurrentSamples(true));assert.equal(h.c.currentNumericCache.size,0)}});
test('ranking coverage: duplicate coordinates cannot replace a missing local position',async()=>{const h=rankingSpatialSetup(),fetch=h.c.fetchCurrentPoint,first=h.c.rankingCurrentPoints()[0];let i=0;h.c.fetchCurrentPoint=(p,t)=>fetch(i++===1?first:p,t);await assert.rejects(h.c.fetchCurrentSamples(true));assert.equal(h.c.currentNumericCache.size,0)});
test('ranking sharing: concurrent cold callers make 125 requests and reuse finished cache',async()=>{const h=rankingSpatialSetup(),gate=deferred(),fetch=h.c.fetchCurrentPoint;let calls=0;h.c.fetchCurrentPoint=async(p,t)=>{calls++;await gate.promise;return fetch(p,t)};const a=h.c.fetchCurrentSamples(true),b=h.c.fetchCurrentSamples(true);gate.resolve();const [x,y]=await Promise.all([a,b]);assert.equal(calls,125);assert.strictEqual(x,y);assert.equal(x.length,125);assert.strictEqual(await h.c.fetchCurrentSamples(true),x);assert.equal(calls,125)});
test('ranking sharing: failed shared request is released for a real subsequent retry',async()=>{const h=rankingSpatialSetup(),fetch=h.c.fetchCurrentPoint;let calls=0,fail=true;h.c.fetchCurrentPoint=async(p,t)=>{calls++;if(fail)throw Error('offline');return fetch(p,t)};const result=await Promise.allSettled([h.c.fetchCurrentSamples(true),h.c.fetchCurrentSamples(true)]);assert.ok(result.every(x=>x.status==='rejected'));assert.equal(calls,10);assert.equal(h.c.currentNumericCache.size,0);fail=false;assert.equal((await h.c.fetchCurrentSamples(true)).length,125);assert.equal(calls,135)});


test('ranking snapshot: real coast snap during current or weather wait preserves all local positions; next run uses new coordinates',async()=>{for(const phase of ['current','live']){const h=rankingSpatialSetup(),gate=deferred(),original={...h.c.spots[0]},fetch=h.c.fetchCurrentPoint,live=h.c.live,context=h.c.currentContext;let evaluated=[],weather=[];h.c.fetchCurrentPoint=async(p,t)=>{if(phase==='current')await gate.promise;return fetch(p,t)};h.c.live=async s=>{weather.push({...s});if(phase==='live')await gate.promise;return live(s)};h.c.currentContext=(s,samples)=>{for(const [dy,dx] of [[0,0],[.006,0],[-.006,0],[0,.010],[0,-.010]])assert.ok(samples.some(p=>p.lat===s.lat+dy&&p.lon===s.lon+dx),'missing local point for '+s.id);evaluated.push({...s});return context(s,samples)};const running=h.run();await new Promise(setImmediate);const moved=[original.lat+.02,original.lon+.02];storage(h.c,{'gst-coastsnap-v611':JSON.stringify({1:moved})});assert.equal(await h.c.snapOneSpot(h.c.spots[0]),true);gate.resolve();await running;assert.equal(evaluated.length,25);assert.deepEqual([evaluated[0].lat,evaluated[0].lon],[original.lat,original.lon]);assert.deepEqual([weather[0].lat,weather[0].lon],[original.lat,original.lon]);assert.deepEqual([h.c.spots[0].lat,h.c.spots[0].lon],moved);evaluated=[];weather=[];await h.run();assert.equal(evaluated.length,25);assert.deepEqual([evaluated[0].lat,evaluated[0].lon],moved);assert.deepEqual([weather[0].lat,weather[0].lon],moved);assert.equal(h.requests(),250)}});
test('ranking snapshot: rating and facing used by scoring stay at the start state',async()=>{const h=rankingSpatialSetup(),gate=deferred(),fetch=h.c.fetchCurrentPoint,original={...h.c.spots[0]},score=h.c.scoreDetailed;let observed;h.c.fetchCurrentPoint=async(p,t)=>{await gate.promise;return fetch(p,t)};h.c.scoreDetailed=(w,m,s,ctx)=>{if(s.id===1)observed={rating:s.rating,facing:s.facing};return score(w,m,s,ctx)};const pending=h.run();h.c.spots[0].rating=1;h.c.spots[0].facing=0;gate.resolve();await pending;assert.deepEqual(observed,{rating:original.rating,facing:original.facing});assert.equal(h.c.spots[0].rating,1);assert.equal(h.c.spots[0].facing,0)});


function rankingTimeSetup(times){
  const h=rankingSpatialSetup(),{c}=h;if(times)c.timelineHours=times.map(t=>new Date(t));
  for(const name of ['json','hourlyQuery','normalizeMarine','marineJson','live'])vm.runInContext(source.split(/\r?\n/).find(l=>l.startsWith('function '+name+'(')||l.startsWith('async function '+name+'(')),c);
  const [t0,t1]=c.timelineHours.map(t=>+t/1000),requests=[],inputs=[],currentTimes=[];
  const weather={current:{wind_speed_10m:77,wind_direction_10m:77},hourly:{time:[t0-3600,t0,t1],wind_speed_10m:[99,15,35],wind_direction_10m:[99,90,270]}};
  const marine={current:{wave_height:77,sea_surface_temperature:77,ocean_current_velocity:77,ocean_current_direction:77},current_units:{ocean_current_velocity:'m/s'},hourly_units:{ocean_current_velocity:'m/s'},hourly:{time:[t0,t1,t1+3600,t1+7200],wave_height:[.5,2,8,9],sea_surface_temperature:[10,18,25,26],ocean_current_velocity:[.2,.8,2,3],ocean_current_direction:[90,180,270,0]}};
  c.fetch=async url=>{requests.push(new URL(url));return {ok:true,json:async()=>JSON.parse(JSON.stringify(url.includes('marine-api')?marine:weather))}};
  const fetch=c.fetchCurrentPoint;c.fetchCurrentPoint=(p,t)=>{currentTimes.push(t);return fetch(p,t)};
  const score=c.scoreDetailed;c.scoreDetailed=(w,m,s,ctx)=>{inputs.push({w,m,id:s.id,ctx});return score(w,m,s,ctx)};
  return {...h,weather,marine,requests,inputs,currentTimes};
}
test('ranking time: independent hourly axes match Copernicus time, change scores and repeat reproducibly',async()=>{
  const h=rankingTimeSetup(),a=await h.run();assert.equal(h.inputs.length,25);assert.ok(h.inputs.every(x=>x.w.wind_speed_10m===15&&x.w.wind_direction_10m===90&&x.m.ocean_current_direction===90&&x.m.wave_height===.5&&x.m.sea_surface_temperature===10&&x.m.ocean_current_velocity===.2));assert.ok(h.currentTimes.every(t=>Date.parse(t)===+h.c.timelineHours[0]));
  h.c.timelineIndex=1;h.c.refreshTimed();const b=await h.run();assert.notDeepEqual(a,b);assert.ok(h.inputs.slice(25).every(x=>x.w.wind_speed_10m===35&&x.w.wind_direction_10m===270&&x.m.ocean_current_direction===180&&x.m.wave_height===2&&x.m.sea_surface_temperature===18&&x.m.ocean_current_velocity===.8));assert.ok(h.currentTimes.slice(125).every(t=>Date.parse(t)===+h.c.timelineHours[1]));assert.deepEqual(await h.run(),b);assert.equal(h.requests.length,150);
  for(const url of h.requests){assert.ok(url.searchParams.get('hourly'));assert.equal(url.searchParams.get('timeformat'),'unixtime');assert.equal(url.searchParams.get('timezone'),'GMT')}
});
test('ranking time: absent exact timestamp never uses current or neighbouring hours',async()=>{
  for(const missing of ['weather','marine','both']){const h=rankingTimeSetup();for(const key of missing==='both'?['weather','marine']:[missing])h[key].hourly.time=h[key].hourly.time.map(t=>t+1800);await h.run();assert.equal(h.inputs.length,25);for(const x of h.inputs){if(missing!=='marine')assert.equal(x.w,null);if(missing!=='weather')assert.equal(x.m,null)}}
});
test('ranking time: missing and non-finite hourly values remain unavailable',async()=>{
  const h=rankingTimeSetup();h.weather.hourly.wind_speed_10m[1]=null;h.marine.hourly.wave_height[0]=null;h.marine.hourly.sea_surface_temperature=[];await h.run();for(const x of h.inputs){assert.equal(x.w.wind_speed_10m,undefined);assert.equal(x.m.wave_height,undefined);assert.equal(x.m.sea_surface_temperature,undefined);assert.equal(x.m.ocean_current_velocity,.2)}
});
test('ranking time: repeated local DST hour maps to two distinct UTC timestamps',async()=>{
  const h=rankingTimeSetup(['2026-10-25T02:00:00+02:00','2026-10-25T02:00:00+01:00']);await h.run();h.c.timelineIndex=1;h.c.refreshTimed();await h.run();assert.equal(h.inputs[0].w.wind_speed_10m,15);assert.equal(h.inputs[25].w.wind_speed_10m,35);assert.equal(Date.parse(h.currentTimes[0]),Date.parse('2026-10-25T00:00Z'));assert.equal(Date.parse(h.currentTimes[125]),Date.parse('2026-10-25T01:00Z'));
});
test('ranking time: delayed old hourly responses cannot overwrite the new timeline ranking',async()=>{
 const h=rankingTimeSetup(),gate=deferred(),fetch=h.c.fetch;let calls=0;h.c.fetch=async url=>{if(calls++<2)await gate.promise;return fetch(url)};const old=h.c.today();await new Promise(setImmediate);h.c.timelineIndex=1;h.c.refreshTimed();await h.c.today(true);const latest=h.element('#ranking').innerHTML;assert.ok(h.inputs.every(x=>x.w.wind_speed_10m===35));gate.resolve();await old;assert.equal(h.element('#ranking').innerHTML,latest);assert.equal(h.inputs.length,25);
});

test('ranking time: current hour through plus 72 hours use exact hours within the requested UTC window',async()=>{
 const initial=timelineSetup('2026-09-16T11:37:00Z'),times=Array.from(initial.c.timelineHours,Number),h=rankingTimeSetup(times);
 h.weather.hourly={time:times.map(t=>t/1000),wind_speed_10m:times.map((_,i)=>i+1),wind_direction_10m:times.map(()=>90)};
 h.marine.hourly={time:times.slice().reverse().map(t=>t/1000),wave_height:times.map((_,i)=>(73-i)/10),sea_surface_temperature:times.map(()=>10),ocean_current_velocity:times.map(()=>.2),ocean_current_direction:times.map(()=>90)};
 for(const index of [0,24,48,72]){h.c.timelineIndex=index;h.c.refreshTimed();const before=h.inputs.length,points=h.currentTimes.length;await h.run();assert.ok(h.inputs.slice(before).every(x=>x.w.wind_speed_10m===index+1&&x.m.wave_height===(index+1)/10));assert.ok(h.currentTimes.slice(points).every(t=>Date.parse(t)===times[index]))}
 for(const url of h.requests){assert.equal(url.searchParams.get('start_hour'),'2026-09-16T11:00');assert.equal(url.searchParams.get('end_hour'),'2026-09-19T11:00')}
});


test('ranking early coverage: failed first worker stops queue while nine requests drain',async()=>{
 const h=rankingSpatialSetup(),first=deferred(),rest=deferred(),fetch=h.c.fetchCurrentPoint;let starts=0,contexts=[];
 h.c.fetchCurrentPoint=async(p,t)=>{const i=starts++;await(i===0?first.promise:rest.promise);return fetch(p,t)};
 const score=h.c.scoreDetailed;h.c.scoreDetailed=(w,m,s,ctx)=>{contexts.push(ctx);return score(w,m,s,ctx)};
 const run=h.run();assert.equal(starts,10);first.reject(Error('missing'));await new Promise(setImmediate);assert.equal(starts,10);
 rest.resolve();await run;assert.equal(starts,10);assert.equal(contexts.length,25);assert.ok(contexts.every(x=>x===null));assert.equal(h.c.currentNumericCache.size,0);
});
test('ranking early coverage: invalid successful response stops queue too',async()=>{
 const h=rankingSpatialSetup(),fetch=h.c.fetchCurrentPoint;let starts=0;h.c.fetchCurrentPoint=async(p,t)=>{const i=starts++;const x=await fetch(p,t);return i===0?{...x,u:NaN}:x};
 await assert.rejects(h.c.fetchCurrentSamples(true));assert.equal(starts,10);assert.equal(h.c.currentNumericCache.size,0);
});
test('ranking early coverage: complete coverage is used for every scored spot',async()=>{
 const h=rankingSpatialSetup(),score=h.c.scoreDetailed;let contexts=[];h.c.scoreDetailed=(w,m,s,ctx)=>{contexts.push(ctx);return score(w,m,s,ctx)};
 await h.run();assert.equal(h.requests(),125);assert.equal(contexts.length,25);assert.ok(contexts.every(x=>x!==null));assert.equal(h.c.currentNumericCache.size,1);
});
test('ranking early coverage: map path still attempts every point after failure',async()=>{
 const h=rankingSpatialSetup(),fetch=h.c.fetchCurrentPoint,points=h.c.currentNumericPoints();let starts=0;h.c.fetchCurrentPoint=(p,t)=>starts++===0?Promise.reject(Error('missing')):fetch(p,t);
 const samples=await h.c.fetchCurrentSamples(false);assert.equal(starts,points.length);assert.equal(samples.length,points.length-1);assert.equal(h.c.currentNumericCache.size,1);
});


function timelineSetup(iso){
 const h=setup(),{c,element}=h,RealDate=Date;
 c.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[iso]))}static now(){return RealDate.parse(iso)}};
 c.window={};c.document.body={classList:{toggle(){}}};
 for(const id of ['#timeRange','#timeline','#playTime','#nextTime','#conditionStrip']){element(id).addEventListener=()=>{};element(id).classList.toggle=()=>{}}
 c.refreshConditionStrip=()=>{};c.refreshTimed=()=>{};c.loadTurbidity=()=>{};
 let tick;c.setInterval=fn=>{tick=fn;return 1};c.clearInterval=()=>{tick=null};h.tick=()=>tick?.();
 for(const name of ['initTimeline','stepTimeline','updateTimeline','initTurbidityDates','turbidityDate','stepTurbidity','hourlyQuery','roundedCurrentTime','copernicusTime','officialCurrentWmtsLayer'])vm.runInContext(source.split(/\r?\n/).find(l=>l.startsWith('function '+name+'(')),c);
 c.initTimeline();return h;
}
test('future timeline: real initialization is absolute and DST-safe across calendar boundaries',()=>{
 const old=process.env.TZ;try{for(const zone of ['Europe/Berlin','UTC']){process.env.TZ=zone;for(const iso of ['2026-10-25T01:30:00Z','2026-03-29T00:30:00Z','2026-03-29T01:30:00Z','2026-09-18T23:59:59Z','2026-01-31T23:30:00Z','2026-12-31T23:30:00Z']){
 const {c,element}=timelineSetup(iso),start=Math.floor(Date.parse(iso)/3600000)*3600000;
 assert.equal(+c.timelineHours[0],start,zone+' '+iso);assert.equal(c.timelineHours.length,73);assert.equal(+c.timelineHours[72],start+72*3600000);assert.equal(c.timelineIndex,0);
 for(let i=0;i<73;i++){assert.ok(+c.timelineHours[i]>=start);if(i)assert.equal(c.timelineHours[i]-c.timelineHours[i-1],3600000)}
 assert.equal(element('#timeRange').max,72);assert.equal(element('#timeRange').value,0);
 const q=new URLSearchParams(c.hourlyQuery());assert.equal(q.get('start_hour'),new Date(start).toISOString().slice(0,16));assert.equal(q.get('end_hour'),new Date(start+72*3600000).toISOString().slice(0,16));
 c.timelineHours=[];const fallback=new URLSearchParams(c.hourlyQuery());assert.equal(fallback.get('start_hour'),q.get('start_hour'));assert.equal(fallback.get('end_hour'),q.get('end_hour'));
 }}}finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old}
});
test('future timeline: slider, stepping, playback, CMEMS and separate satellite axis preserve their bounds',()=>{
 const h=timelineSetup('2026-09-18T19:35:00Z'),{c,element}=h;const dates=Array.from(c.turbidityDates);assert.equal(dates.length,21);assert.equal(c.turbidityIndex,18);
 c.stepTimeline(-1);assert.equal(c.timelineIndex,0);element('#timeRange').oninput({target:{value:'71'}});assert.equal(c.timelineIndex,71);
 element('#playTime').onclick();h.tick();assert.equal(c.timelineIndex,72);h.tick();assert.equal(element('#playTime').textContent,'▶');c.stepTimeline(1);assert.equal(c.timelineIndex,72);
 c.active.current=true;c.updateTimeline();assert.equal(element('#timeRange').max,72);assert.equal(element('#timeRange').value,72);
 c.WMTS_ROOT='https://example.test/';c.CURRENT_LAYER='test';c.CURRENT_WMTS_STYLE='test';let url;c.L={tileLayer:u=>{url=u}};c.officialCurrentWmtsLayer();assert.equal(new URL(url).searchParams.get('time'),'2026-09-21T19:00:00Z');
 c.active.turbidity=true;c.updateTimeline();assert.equal(element('#timeRange').max,20);element('#timeRange').oninput({target:{value:'20'}});assert.equal(c.turbidityIndex,20);assert.equal(c.timelineIndex,72);assert.deepEqual(Array.from(c.turbidityDates),dates);
 c.active.turbidity=false;c.updateTimeline();assert.equal(element('#timeRange').max,72);assert.equal(element('#timeRange').value,72);
});

function currentRenderSetup(){
 const h=setup(),{c}=h,tiles=[],bands=[],arrows=[],pending=deferred();
 c.currentLayer.items=[];c.currentLayer.clearLayers=function(){this.items=[]};
 c.L={tileLayer:(url,options)=>({url,options,addTo(layer){layer.items.push(this);tiles.push(this);return this}})};
 for(const prefix of ['const CURRENT_LAYER=','const WMTS_ROOT=','const CURRENT_WMTS_STYLE='])vm.runInContext(source.split(/\r?\n/).find(l=>l.startsWith(prefix)),c);
 for(const name of ['officialCurrentWmtsLayer','copernicusTime','currentContext','idwVector','vdFrom'])vm.runInContext(source.split(/\r?\n/).find(l=>l.startsWith('function '+name+'(')),c);
 c.fetchCurrentSamples=()=>pending.promise;c.drawScalarBands=(...args)=>bands.push(args);c.drawStaticVectors=(...args)=>arrows.push(args);
 return {...h,tiles,bands,arrows,pending};
}
test('current rendering keeps two stable official layers and numeric context after success or failure',async()=>{
 for(const fail of [false,true]){const h=currentRenderSetup(),{c}=h,samples=[{lat:57,lon:18,u:.3,n:.4,v:.5,dir:37}],before=JSON.stringify(samples),run=c.loadVectors('current');
 assert.equal(c.currentLayer.items.length,2);const [surface,vectors]=c.currentLayer.items,q=new URL(surface.url).searchParams,vq=new URL(vectors.url).searchParams;
 assert.equal(q.get('STYLE'),'vectorStyle:solid,cmap:speed,range:0/0.7');assert.equal(vq.get('STYLE'),'vectorStyle:vector,cmap:speed,range:0/0.7');assert.equal(q.get('time'),'2026-09-15T12:00:00Z');assert.equal(vq.get('time'),q.get('time'));assert.equal(vq.get('layer'),q.get('layer'));
 assert.equal(surface.options.pane,'seaDataPane');assert.equal(vectors.options.pane,'currentVectorPane');assert.ok(surface.options.opacity<vectors.options.opacity);
 if(fail)h.pending.reject(Error('missing'));else h.pending.resolve(samples);await run;
 assert.equal(h.tiles.length,2);assert.strictEqual(c.currentLayer.items[0],surface);assert.strictEqual(c.currentLayer.items[1],vectors);assert.equal(h.bands.length,0);assert.equal(h.arrows.length,0);assert.equal(JSON.stringify(samples),before);assert.equal(c.currentContext({lat:57,lon:18},samples).v,.5);assert.match(h.statuses.at(-1),fail?/WMTS-Fallback/:/1 numerische CMEMS-Punkte/);
 }
});
test('old numeric current responses cannot replace current WMTS layers or status',async()=>{
 for(const fail of [false,true]){const h=currentRenderSetup(),{c}=h,old=deferred(),fresh=deferred();let calls=0;c.fetchCurrentSamples=()=>calls++?fresh.promise:old.promise;
 const first=c.loadVectors('current');c.roundedCurrentTime=()=>new Date('2026-09-15T13:00Z');const second=c.loadVectors('current');fresh.resolve([{v:.5}]);await second;const layers=c.currentLayer.items.slice(),status=h.statuses.at(-1),count=h.tiles.length;
 if(fail)old.reject(Error('old'));else old.resolve([{v:.1}]);await first;assert.deepEqual(c.currentLayer.items,layers);assert.equal(h.tiles.length,count);assert.equal(h.statuses.at(-1),status);assert.equal(h.arrows.length,0);for(const tile of layers)assert.equal(new URL(tile.url).searchParams.get('time'),'2026-09-15T13:00:00Z');
 }
});
test('temperature and wind retain their existing numeric scalar rendering',async()=>{
 const h=currentRenderSetup(),samples=[{value:12,v:12}];h.c.fetchTempSamples=async()=>samples;h.c.fetchWindSamples=async()=>samples;
 await h.c.loadTemp();await h.c.loadVectors('wind');assert.equal(h.bands.length,2);assert.strictEqual(h.bands[0][0],samples);assert.strictEqual(h.bands[0][1],h.c.tempLayer);assert.equal(h.bands[0][3],false);assert.equal(h.bands[1][4],'wind');assert.equal(h.tiles.length,0);
});

test('current legend follows the visible official WMTS style through loading, success and fallback',async()=>{
 for(const fail of [false,true]){
 const h=currentRenderSetup(),{c}=h;c.currentLayer.getLayers=()=>c.currentLayer.items;c.syncQuickLayers=()=>{};
 for(const name of ['wmtsLegendUrl','currentLegendUrl'])vm.runInContext(source.split(/\r?\n/).find(l=>l.startsWith('function '+name+'(')),c);
 vm.runInContext(source.slice(source.indexOf('function renderLegends(){'),source.indexOf('function syncQuickLayers(){')),c);
 const check=()=>{const html=h.element('#mapLegends').innerHTML,src=html.match(/src="([^"]+)"/)[1],q=new URL(src).searchParams,tile=new URL(c.currentLayer.items[0].url).searchParams;assert.equal(q.get('request'),'GetLegend');assert.equal(q.get('STYLE'),tile.get('STYLE'));assert.equal(q.get('layer'),tile.get('layer'));assert.ok(html.includes('m/s'));assert.doesNotMatch(html,/currentScaleBar|currentScaleTicks|0,7\+/)};
 const run=c.loadVectors('current');check();if(fail)h.pending.reject(Error('missing'));else h.pending.resolve([{u:.3,n:.4,v:.5,lat:57,lon:18,dir:37}]);await run;check();
 }
});
