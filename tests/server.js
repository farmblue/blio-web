const fs=require('fs'),vm=require('vm');
function Sheet(name,rows){this.name=name;this.d=rows;}
Sheet.prototype.getName=function(){return this.name};
Sheet.prototype.appendRow=function(r){this.d.push(r.slice())};
Sheet.prototype.setFrozenRows=function(){};
Sheet.prototype.getLastRow=function(){return this.d.length};
Sheet.prototype.getLastColumn=function(){return Math.max(0,...this.d.map(r=>r.length))};
Sheet.prototype.getDataRange=function(){return this.getRange(1,1,this.d.length,this.getLastColumn())};
Sheet.prototype.getRange=function(r,c,nr,nc){
  if(typeof r==='string'){const m=r.match(/([A-Z])(\d+)/);c=m[1].charCodeAt(0)-64;r=+m[2];nr=1;nc=1}
  globalThis.CALLS++;nr=nr||1;nc=nc||1;const sh=this;
  const ensure=()=>{while(sh.d.length<r+nr-1)sh.d.push([]);for(let i=0;i<nr;i++){while(sh.d[r-1+i].length<c+nc-1)sh.d[r-1+i].push('')}};
  const rg={getValues(){ensure();return sh.d.slice(r-1,r-1+nr).map(row=>row.slice(c-1,c-1+nc))},
    getDisplayValues(){return rg.getValues().map(x=>x.map(v=>String(v)))},getValue(){return rg.getValues()[0][0]},getDisplayValue(){return String(rg.getValue())},
    setValues(v){ensure();v.forEach((row,i)=>row.forEach((x,j)=>sh.d[r-1+i][c-1+j]=x));return rg},setValue(x){ensure();sh.d[r-1][c-1]=x;return rg},
    setNumberFormat(){return rg},setNumberFormats(){return rg},setFontWeight(){return rg},setBackground(){return rg},setFontColor(){return rg},setDataValidation(){return rg},getRow(){return r}};
  return rg;};
const sheets={
 Products:new Sheet('Products',[['Group','Name','English name','Marathi name','Price per kg','From','Cuts','Available','Kg for this window','Kg ordered','Kg left'],
   ['Fish','Surmai','King fish','सुरमई',1200,'the Konkan coast','Whole | Curry cut','Yes','','',''],
   ['Fish','Bangda','Mackerel','बांगडा',320,'North Goa','Whole','Yes','','',''],
   ['Prawns','Kolambi','Prawns','कोळंबी',600,'','Whole | Cleaned','Yes','','','']]),
 Orders:new Sheet('Orders',[['Order ID','Placed at','Window','Name','Mobile','Address','Area','Items','Subtotal','Delivery','Total','Status','Notes']]),
 'Order lines':new Sheet('Order lines',[['Order ID','Window','Item','Pack','Cut','Qty','Kg','Line total','Status']]),
 Settings:new Sheet('Settings',[['Setting','Value'],['Current window (filled in automatically)',''],['Delivery fee (₹)',40]])
};
let cache={},props={};globalThis.FILES={};globalThis.FN=0;globalThis.CALLS=0;
const ctx={console,__now:Date.UTC(2026,9,28,4,0)};   // 09:30 IST, Wed 28 Oct
class FD extends Date{constructor(...a){if(a.length)super(...a);else super(ctx.__now)} static now(){return ctx.__now}}
const ist=d=>new Date(d.getTime()+330*60000), p2=n=>String(n).padStart(2,'0'), DN=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
Object.assign(ctx,{Date:FD,
 SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:n=>sheets[n],insertSheet:n=>(sheets[n]=new Sheet(n,[])),getUrl:()=>'URL',getSpreadsheetTimeZone:()=>'Asia/Kolkata'}),newDataValidation:()=>({requireValueInList(){return this},setAllowInvalid(){return this},build(){return 1}})},
 Utilities:{base64Encode:a=>Buffer.from(a).toString('base64'),newBlob:(h,t,n)=>(globalThis.LASTHTML=h,{getAs:()=>{const o={name:n,getBytes:()=>[37,80,68,70],setName(x){o.name=x;return o}};return o}}),getUuid:()=>'a1b2c3d4e5f67890abcdef',formatDate:(d,tz,f)=>{const t=ist(d);
   const map={'H':String(t.getUTCHours()),'m':String(t.getUTCMinutes()),'u':String(t.getUTCDay()||7),'yyyy-MM-dd':t.getUTCFullYear()+'-'+p2(t.getUTCMonth()+1)+'-'+p2(t.getUTCDate()),
     'yyyy-MM-dd HH:mm':t.getUTCFullYear()+'-'+p2(t.getUTCMonth()+1)+'-'+p2(t.getUTCDate())+' '+p2(t.getUTCHours())+':'+p2(t.getUTCMinutes()),
     'ddMM':p2(t.getUTCDate())+p2(t.getUTCMonth()+1),'yyyy-MM-dd EEE':t.getUTCFullYear()+'-'+p2(t.getUTCMonth()+1)+'-'+p2(t.getUTCDate())+' '+DN[t.getUTCDay()],
     'dd MMM yyyy, h:mm a':p2(t.getUTCDate())+' '+MN[t.getUTCMonth()]+' '+t.getUTCFullYear()+', '+((t.getUTCHours()%12)||12)+':'+p2(t.getUTCMinutes())+' '+(t.getUTCHours()<12?'AM':'PM')};
   return map[f]!==undefined?map[f]:t.toISOString();}},
 DriveApp:{getFoldersByName:()=>({hasNext:()=>true,next:()=>({createFile:b=>{const id='F'+'x'.repeat(30)+(++globalThis.FN);FILES[id]=b;return {getUrl:()=>'https://drive.google.com/file/d/'+id+'/view',getName:()=>b.name}}})}),getFileById:id=>{const b=FILES[id];if(!b)throw new Error('nf');return {getName:()=>b.name,getBlob:()=>({getBytes:()=>[37,80,68,70]})}}},
 LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
 CacheService:{getScriptCache:()=>({get:k=>cache[k]||null,put:(k,v)=>{cache[k]=v},remove:k=>{delete cache[k]}})},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||null,setProperty:(k,v)=>{props[k]=v}})},
 ContentService:{MimeType:{JSON:1},createTextOutput:t=>({setMimeType(){return JSON.parse(t)}})}});
vm.createContext(ctx);vm.runInContext(fs.readFileSync(require('path').join(__dirname,'..','gas','Code.gs'),"utf8"),ctx);
const post=o=>ctx.doPost({postData:{contents:JSON.stringify(o)}});
const get=p=>ctx.doGet({parameter:p||{}});
const setS=(pre,v)=>sheets.Settings.d.forEach(r=>{if(String(r[0]).startsWith(pre))r[1]=v});
ctx.setup_(); setS('Admin password','fish-2026!');
const A=o=>post(Object.assign({action:'admin',pw:'fish-2026!',by:'Vaishnav'},o));
console.log('tabs', Object.keys(sheets).join(','), '| cats', sheets.Categories.d.length-1);
// seed: catch landed today 06:30 IST, entered 09:10
ctx.__now = Date.UTC(2026,9,28,3,40);
A({op:'lot',fish:'Surmai',size:'Small to medium',kg:6,pieces:5,cost:900,price:1100,harbour:'Malvan',live:true});
A({op:'lot',fish:'Surmai',size:'Medium to big',kg:4,pieces:2,cost:1150,price:1400,harbour:'Malvan',live:true});
A({op:'lot',fish:'Bangda',size:'',kg:3,cost:200,price:320,live:true});
A({op:'fish',name:'Surmai',yieldPct:70});
ctx.__now = Date.UTC(2026,9,28,5,0); // 10:30 IST
const http=require('http'),path=require('path'),ROOT=require('path').join(__dirname,'..');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.ico':'image/x-icon','.json':'application/json'};
http.createServer((req,res)=>{
  const u=new URL(req.url,'http://x');
  if(u.pathname==='/__now'){ctx.__now=Date.parse(u.searchParams.get('t'));res.end('ok '+new Date(ctx.__now).toISOString());return;}
  if(u.pathname==='/__set'){setS(u.searchParams.get('k'),u.searchParams.get('v'));res.end('ok');return;}
  if(u.pathname==='/__bill'){res.end(globalThis.LASTHTML||'');return;}
  if(u.pathname==='/__sheet'){res.end(JSON.stringify(sheets[u.searchParams.get('n')].d));return;}
  if(u.pathname==='/exec'){
    let body='';req.on('data',c=>body+=c);req.on('end',()=>{
      let out;try{out=req.method==='POST'?post(JSON.parse(body)):get(Object.fromEntries(u.searchParams));}catch(e){console.error(e);out={ok:false,error:'crash',msg:String(e)}}
      res.setHeader('Content-Type','application/json');res.setHeader('Access-Control-Allow-Origin','*');res.end(JSON.stringify(out));});return;}
  let p=u.pathname; if(p.endsWith('/'))p+='index.html'; const f=path.join(ROOT,p);
  fs.readFile(f,(e,d)=>{if(e){res.statusCode=404;res.end('nf');return;}res.setHeader('Content-Type',types[path.extname(f)]||'application/octet-stream');res.end(d);});
}).listen(8800,()=>console.log('up'));
