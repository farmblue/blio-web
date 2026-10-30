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
ctx.__now = Date.UTC(2026,9,28,3,40);
setS('Delivery PIN','111111'); setS('Packing PIN','222222');
A({op:'lots',fish:'Bangda',harbour:'Malvan',live:true,rows:[{size:'Small to medium',kg:5,price:300},{size:'Medium to big',kg:3,price:380}]});
A({op:'lots',fish:'Surmai',harbour:'Devgad',live:true,rows:[{size:'',kg:4,price:1200}]});
let g=get(); const opt=(n,s)=>g.products.find(p=>p.name===n).options.find(o=>o.size===s);
// offer 25% on small bangda
let L=A({op:'load'}); const lot=L.lots.find(l=>l.size==='Small to medium');
console.log('offer save', A({op:'lotedit',lot:lot.lot,offer:25}).ok);
g=get(); console.log('offer option', JSON.stringify(opt('Bangda','Small to medium')), 'surmai', JSON.stringify(opt('Surmai','')));
// coupon
console.log('coupon save', A({op:'coupon',code:'welcome50',type:'Rs',value:50,min:300,perPhone:1,max:100}).ok, A({op:'coupon',code:'FISH10',type:'%',value:10,till:'2026-10-27'}).ok);
console.log('check ok', JSON.stringify(get({action:'coupon',code:'Welcome50',phone:'9876543210',sub:'500'})));
console.log('check min', JSON.stringify(get({action:'coupon',code:'WELCOME50',sub:'200'})), 'expired', JSON.stringify(get({action:'coupon',code:'FISH10',sub:'900'})), 'bad', JSON.stringify(get({action:'coupon',code:'XYZ',sub:'900'})));
let r=post({name:'A',phone:'9876543210',address:'x',coupon:'welcome50',items:[{name:'Bangda',key:opt('Bangda','Small to medium').key,pack:'1 kg',cut:'Whole',qty:2},{name:'Surmai',key:opt('Surmai','').key,pack:'500 g',cut:'Whole',qty:1}]});
console.log('order', r.ok, r.subtotal, r.discount, r.fee, r.total, r.coupon);
r=post({name:'A',phone:'9876543210',address:'x',coupon:'WELCOME50',items:[{name:'Surmai',key:opt('Surmai','').key,pack:'500 g',cut:'Whole',qty:1}]});
console.log('second use', JSON.stringify(r));
r=post({name:'B',phone:'9876543211',address:'y',items:[{name:'Bangda',key:opt('Bangda','Medium to big').key,pack:'500 g',cut:'Curry cut',qty:2}]}); console.log('order2', r.ok, r.id);
// confirm both
L=A({op:'load'}); L.orders.forEach(o=>A({op:'order',id:o.id,status:'Confirmed'}));
// staff roles
let d=get({action:'deliveries',pin:'222222'}); console.log('packer roles', JSON.stringify(d.roles), 'orders?', !!d.orders, 'cut list', JSON.stringify(d.pack.cutList), 'first', JSON.stringify(d.pack.orders[0]));
console.log('rider start with packer pin', JSON.stringify(post({action:'start',pin:'222222',ids:['BL2810-001']})));
console.log('packed', JSON.stringify(post({action:'packed',pin:'222222',by:'Ravi',id:'BL2810-001'})), 'packed by rider pin', JSON.stringify(post({action:'packed',pin:'111111',id:'BL2810-002'})));
d=get({action:'deliveries',pin:'222222'}); console.log('after pack statuses', d.pack.orders.map(o=>o.id+':'+o.status+':'+o.packedBy).join(' '), 'cut list now', JSON.stringify(d.pack.cutList));
console.log('unpack', post({action:'unpack',pin:'222222',id:'BL2810-001'}).ok);
d=get({action:'deliveries',pin:'111111'}); console.log('rider roles', JSON.stringify(d.roles), d.orders.length, !!d.pack);
// bills
let b=A({op:'bill',id:'BL2810-001'}); console.log('bill', b.ok, b.name, b.b64, b.msg.split('\n')[2]);
let tok=sheets.Orders.d[1][sheets.Orders.d[0].indexOf('Token')];
console.log('cust bill', JSON.stringify(get({action:'bill',id:'BL2810-001',t:tok})), 'wrong token', JSON.stringify(get({action:'bill',id:'BL2810-001',t:'zzzzzzzzzzzzzzzz'})));
console.log('myorders bill flag', JSON.stringify(get({action:'myorders',ids:'BL2810-001:'+tok}).orders[0].bill));
console.log('admin billpdf', JSON.stringify(A({op:'billpdf',id:'BL2810-001'})));
L=A({op:'load'}); console.log('coupons', JSON.stringify(L.coupons.map(c=>[c.code,c.used,c.expired])), 'order coupon', L.orders.find(o=>o.id==='BL2810-001').coupon, L.orders.find(o=>o.id==='BL2810-001').discount);
