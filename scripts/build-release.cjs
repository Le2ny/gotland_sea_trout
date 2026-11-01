// Deterministic local release manifest. --check never writes or uses the network.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.join(__dirname,'..'),check=process.argv.includes('--check');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const sri=b=>'sha256-'+crypto.createHash('sha256').update(b).digest('base64');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const write=(p,text)=>{if(check){if(fs.readFileSync(path.join(root,p),'utf8')!==text)throw Error('Release manifest or LF bytes out of date: '+p)}else if(fs.readFileSync(path.join(root,p),'utf8')!==text)fs.writeFileSync(path.join(root,p),text)};
const sw=read('sw.js'),release=sw.match(/const RELEASE='([^']+)'/)[1],dependencies=JSON.parse(read('scripts/release-dependencies.json'));
const local=['index.html','app.js','styles.css','current-field.js','current-field-worker.js','data/gotland-coast-mask.json','manifest.webmanifest','icon.svg','release.js'];
const scripts=dependencies.filter(d=>d.url.endsWith('.js')).map(d=>[d.url,d.integrity]);scripts.push(['app.js?v='+release,sri(read('app.js'))]);
let boot=read('release.js');if(!boot.includes("APP_RELEASE='"+release+"'"))throw Error('Bootstrap release mismatch');
boot=boot.replace(/const RELEASE_SCRIPTS=\[[\s\S]*?\];/,'const RELEASE_SCRIPTS='+JSON.stringify(scripts,null,2)+';');write('release.js',boot);
let html=read('index.html').replace(/(<script src="release.js\?v=[^"]+" integrity=")[^"]+/,(_,p)=>p+sri(boot));
for(const d of dependencies.filter(d=>d.url.endsWith('.css')))html=html.replace(new RegExp('<link rel="stylesheet" href="'+d.url.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'"[^>]*>'),'<link rel="stylesheet" href="'+d.url+'" integrity="'+d.integrity+'" crossorigin="anonymous">');
write('index.html',html);
const files=local.map(p=>{const body=read(p);write(p,body);return[p==='index.html'?p:p+'?v='+release,hash(body)]});
for(const d of dependencies)files.push([d.url,d.sha256]);
write('sw.js',sw.replace(/const RELEASE_FILES=\[[\s\S]*?\];/,'const RELEASE_FILES='+JSON.stringify(files,null,2)+';'));
console.log((check?'Verified':'Generated')+' release '+release+': '+files.length+' pinned files');
