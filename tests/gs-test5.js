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
 Utilities:{base64Encode:a=>Buffer.from(a).toString('base64'),newBlob:(h,t,n)=>({getAs:()=>{const o={name:n,getBytes:()=>[37,80,68,70],setName(x){o.name=x;return o}};return o}}),getUuid:()=>'a1b2c3d4e5f67890abcdef',formatDate:(d,tz,f)=>{const t=ist(d);
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
vm.createContext(ctx);vm.runInContext(fs.readFileSync(process.argv[2],'utf8'),ctx);
const post=o=>ctx.doPost({postData:{contents:JSON.stringify(o)}});
const get=p=>ctx.doGet({parameter:p||{}});
const setS=(pre,v)=>sheets.Settings.d.forEach(r=>{if(String(r[0]).startsWith(pre))r[1]=v});
ctx.setup_(); setS('Admin password','fish-2026!');
const A=o=>post(Object.assign({action:'admin',pw:'fish-2026!',by:'Vaishnav'},o));
const N=f=>{const c0=globalThis.CALLS;const r=f();return [r,globalThis.CALLS-c0];};
ctx.__now = Date.UTC(2026,9,28,3,40);
let [r,c]=N(()=>A({op:'lots',fish:'Bangda',harbour:'Malvan',landed:'2026-10-28',live:false,rows:[{size:'Small to medium',kg:5,pieces:40,cost:180,price:300},{size:'Medium to big',kg:3,pieces:15,cost:240,price:380},{size:'',kg:''}]}));
console.log('lots', r.ok, JSON.stringify(r.lots), 'has data', !!r.data, 'calls', c);
[r,c]=N(()=>A({op:'lots',fish:'Bangda',rows:[{size:'Small to medium',kg:2,price:300},{size:'Small to medium',kg:1,price:300}]})); console.log('dup sizes rejected', r.ok, r.error);
[r,c]=N(()=>A({op:'load'})); console.log('admin load calls', c, 'harbours', JSON.stringify(r.settings.harbours), 'autoOn', r.settings.autoOn);
[r,c]=N(()=>get()); console.log('shop calls', c, 'pending', r.pending, r.products.length);
[r,c]=N(()=>get()); console.log('shop cached calls', c);
A({op:'settings',autoOn:false}); ctx.__now += 40*60000;
r=get(); console.log('manual mode after 40 min: products', r.products.length, 'pending', r.pending);
A({op:'golive'}); r=get(); const b=r.products[0]; console.log('after golive', b.name, b.origin, JSON.stringify(b.options.map(o=>[o.size,o.price,o.left,o.harbour,o.landed])), 'showLeft', b.showLeft);
A({op:'fish',name:'Bangda',showLeft:false,showOrigin:false}); r=get(); const b2=r.products[0]; console.log('switches off', JSON.stringify([b2.origin,b2.showLeft,b2.options[0].harbour,b2.options[0].key]));
const k=b2.options[0].key; let o=post({name:'A',phone:'9876543210',address:'x',items:[{name:'Bangda',key:k,pack:'1 kg',cut:'Whole',qty:2}]}); console.log('order', o.ok);
r=get(); console.log('cache dropped after order, left', r.products[0].options[0].left);
A({op:'settings',harbours:' Goa,Vengurla , ,Malvan,Devgad,Ratnagiri,Malpe'}); console.log('harbours', JSON.stringify(A({op:'load'}).settings.harbours));
