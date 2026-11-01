// Leaflet adapter. All data access and pixel work happens in the dedicated worker.
let worker,sequence=0,pending=new Map();
function getWorker(){
 if(!worker){worker=new Worker(new URL('./current-field-worker.js?v=6240',import.meta.url));
  worker.onmessage=({data})=>{const task=pending.get(data.id);if(!task){data.bitmap?.close();return}pending.delete(data.id);if(data.error)task.reject(Error(data.error));else task.resolve(data)};
  worker.onerror=()=>{for(const task of pending.values())task.reject(Error('Strömungs-Worker fehlgeschlagen'));pending.clear();worker.terminate();worker=null};
 }return worker;
}
export function cancel(){const id=++sequence;for(const task of pending.values())task.reject(Error('Veralteter Kartenausschnitt'));pending.clear();worker?.postMessage({id,cancel:true})}
export async function draw(map,layer,time,isCurrent,L){
 cancel();const id=sequence,size=map.getSize(),origin=map.project(map.containerPointToLatLng([0,0]),map.getZoom());
 const result=await new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});try{getWorker().postMessage({id,time,width:size.x,height:size.y,ratio:globalThis.devicePixelRatio||1,zoom:map.getZoom(),origin:{x:origin.x,y:origin.y}})}catch(e){pending.delete(id);reject(e)}});
 if(!isCurrent()){result.bitmap.close();return null}
 const CanvasLayer=L.Layer.extend({getAttribution(){return 'Küstenmaske © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'},onAdd(m){this.canvas=L.DomUtil.create('canvas','currentFieldCanvas');this.canvas.dataset.fieldStats=JSON.stringify(result.stats);this.canvas.width=result.bitmap.width;this.canvas.height=result.bitmap.height;Object.assign(this.canvas.style,{width:size.x+'px',height:size.y+'px',position:'absolute',pointerEvents:'none'});this.canvas.getContext('2d').drawImage(result.bitmap,0,0);result.bitmap.close();L.DomUtil.setPosition(this.canvas,m.containerPointToLayerPoint([0,0]));m.getPane('currentVectorPane').appendChild(this.canvas)},onRemove(){this.canvas?.remove()}});
 new CanvasLayer().addTo(layer);return result.stats;
}
