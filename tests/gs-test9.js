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
// ---------- partner programme ----------
let fails=0; const ok=(name,cond,extra)=>{ if(!cond){fails++;} console.log((cond?'PASS ':'FAIL ')+name+(cond?'':' '+JSON.stringify(extra))); };
const P=o=>post(Object.assign({action:'partner'},o));
const day=(n)=>{const d=new Date(ctx.__now+330*60000+n*86400000);return d.toISOString().slice(0,10);};
ctx.__now = Date.UTC(2026,10,13,4,0);   // Fri 13 Nov 2026, 09:30 IST
let L=A({op:'load'}); ok('load has partners block', L.partners&&Array.isArray(L.partners.list)&&L.partners.rates.evening===100&&L.partners.rates.fuel===2.1, L.partners);
ok('tabs created', ['Partners','Partner requests','Partner ledger'].every(n=>sheets[n]));
// add partners
let r1=A({op:'partner',name:'Rohit Patil',mobile:'98765 43210',role:'Delivery',area:'Rajarampuri',upi:'rohit@upi',pin:'4821',verified:true,consent:true});
let r2=A({op:'partner',name:'Sneha K',mobile:'9876543211',role:'Delivery',area:'Shahupuri'});
let r3=A({op:'partner',name:'Amit J',mobile:'9876543212',role:'Delivery',pin:'1357'});
let r4=A({op:'partner',name:'Lata S',mobile:'9876543213',role:'Cleaning',pin:'2468'});
ok('partner ids', r1.id==='P001'&&r2.id==='P002'&&r4.id==='P004', [r1,r2,r3,r4]);
ok('generated PIN when blank', /^[0-9]{4}$/.test(r2.newPin)&&r1.newPin==='', r2);
ok('dup mobile refused', A({op:'partner',name:'X',mobile:'9876543210',role:'Delivery'}).error==='dup');
ok('bad mobile refused', A({op:'partner',name:'X',mobile:'12345',role:'Delivery'}).error==='mobile');
ok('bad role refused', A({op:'partner',name:'X',mobile:'9000000001',role:'Pilot'}).error==='bad');
ok('bad pin refused', A({op:'partner',name:'X',mobile:'9000000001',role:'Delivery',pin:'12'}).error==='pin');
L=A({op:'load'}); ok('admin list hides PINs', L.partners.list.length===4&&L.partners.list.every(p=>p.pin===undefined&&p.hasPin), L.partners.list[0]);
ok('verified and consent recorded', /^Yes, 2026-11-13, by Vaishnav/.test(L.partners.list[0].verified)&&/^Recorded 2026-11-13/.test(L.partners.list[0].consent), L.partners.list[0]);
// shifts: pay maths from the mockup
let s1=A({op:'shift',partner:'P001',date:'2026-11-12',drops:6,km:16});
ok('delivery pay 6 drops 16 km = 224', s1.ok&&s1.pay===224, s1);
ok('delivery pay 5 drops 18 km = 213', A({op:'shift',partner:'P002',date:'2026-11-10',drops:5,km:18}).pay===213);
ok('cleaning pay 20 kg fish + 6 kg prawns = 450', A({op:'shift',partner:'P004',date:'2026-11-12',fishKg:20,prawnKg:6}).pay===450);
ok('same partner same day refused', A({op:'shift',partner:'P001',date:'2026-11-12',drops:1,km:1}).error==='dup');
ok('future date refused', A({op:'shift',partner:'P001',date:'2026-11-20',drops:1}).error==='date');
ok('absurd km refused', A({op:'shift',partner:'P003',date:'2026-11-11',drops:1,km:900}).error==='bad');
// rotation: Rohit and Sneha both worked 10 Nov and... make Rohit work 10 and 12, Sneha 10 only
A({op:'shift',partner:'P001',date:'2026-11-10',drops:4,km:10,rating:5});
A({op:'shift',partner:'P001',date:'2026-11-07',drops:6,km:17,rating:4});
let rot=A({op:'rotcheck',role:'Delivery',date:'2026-11-14'});
ok('rotation flags Rohit only', rot.flagged.length===1&&rot.flagged[0].id==='P001'&&rot.flagged[0].days.join()==='2026-11-10,2026-11-12', rot);
ok('rotation not for cleaning', A({op:'rotcheck',role:'Cleaning',date:'2026-11-14'}).flagged.length===0);
// requests
let q=A({op:'prequest',role:'Delivery',date:'2026-11-14',time:'5 to 8 PM',needed:2});
ok('request created, sent to 2 of 3', q.ok&&q.id==='R001'&&q.sentTo===2&&q.rest.length===1, q);
ok('past date refused', A({op:'prequest',role:'Delivery',date:'2026-11-01',needed:1}).error==='bad');
// partner login
ok('wrong pin', P({mobile:'9876543210',pin:'0000'}).error==='wrong');
ok('unknown mobile', P({mobile:'9000000099',pin:'4821'}).error==='wrong');
let me=P({mobile:'98765 43210',pin:'4821'});
ok('Rohit sees his month and due', me.ok&&me.me.name==='Rohit Patil'&&me.month.shifts===3&&me.month.drops===16&&me.due===631, [me.month,me.due]);
ok('Rohit is rested: no open request', me.open.length===0&&me.taken.length===0, me.open);
ok('Rohit cannot take a rest shift', P({mobile:'9876543210',pin:'4821',op:'take',id:'R001'}).error==='rest');
let sn=P({mobile:'9876543211',pin:'1000'}); ok('wrong pin for Sneha refused (her PIN is generated)', sn.error==='wrong');
let snPin=sheets.Partners.d[2][sheets.Partners.d[0].indexOf('PIN')];
sn=P({mobile:'9876543211',pin:snPin}); ok('Sneha sees the open request', sn.ok&&sn.open.length===1&&sn.open[0].id==='R001'&&sn.open[0].needed===2&&sn.open[0].filled===0, sn.open);
ok('cleaner does not see delivery request', P({mobile:'9876543213',pin:'2468'}).open.length===0);
let t=P({mobile:'9876543211',pin:snPin,op:'take',id:'R001'}); ok('Sneha takes it', t.ok&&t.taken.length===1&&t.open.length===0, t);
ok('taking twice is harmless', P({mobile:'9876543211',pin:snPin,op:'take',id:'R001'}).taken.length===1);
let a3=P({mobile:'9876543212',pin:'1357',op:'take',id:'R001'}); ok('Amit takes the second place', a3.ok&&a3.taken[0].filled===2, a3);
let reqs=A({op:'load'}).partners.requests; ok('request is Filled with both', reqs[0].status==='Filled'&&reqs[0].accepted.join()==='P002,P003', reqs[0]);
ok('late: filled request refused for others', P({mobile:'9876543210',pin:'4821',op:'take',id:'R001'}).error!=='ok');
let lv=P({mobile:'9876543212',pin:'1357',op:'leave',id:'R001'}); ok('Amit leaves; request reopens', lv.ok&&lv.taken.length===0&&A({op:'load'}).partners.requests[0].status==='Open', lv);
// override rotation lets Rohit take another request
let q2=A({op:'prequest',role:'Delivery',date:'2026-11-15',time:'5 to 8 PM',needed:1,override:true});
ok('override request offered to Rohit', P({mobile:'9876543210',pin:'4821'}).open.some(x=>x.id===q2.id));
// cancel
ok('cancel request', A({op:'prequest',cancel:true,id:q2.id}).ok&&!P({mobile:'9876543210',pin:'4821'}).open.some(x=>x.id===q2.id));
// pay
let before=A({op:'load'}).partners.list.find(p=>p.id==='P001'); ok('Rohit due matches shifts', before.due===224+(100+4*15+21)+(100+6*15+36), before);
let pay=A({op:'paypartner',partner:'P001'}); ok('mark paid', pay.ok&&pay.paid===before.due&&pay.count===3, pay);
ok('nothing left to pay', A({op:'paypartner',partner:'P001'}).error==='nothing');
ok('partner view shows Paid and due 0', P({mobile:'9876543210',pin:'4821'}).due===0&&P({mobile:'9876543210',pin:'4821'}).recent[0].status==='Paid');
ok('cannot void a paid shift', A({op:'voidshift',id:'E0001'}).error==='paid');
let e=A({op:'shift',partner:'P003',date:'2026-11-12',drops:2,km:5}); ok('void a due shift', A({op:'voidshift',id:e.id}).ok&&A({op:'shift',partner:'P003',date:'2026-11-12',drops:2,km:5}).ok);
// rating
ok('rating average', A({op:'load'}).partners.list.find(p=>p.id==='P001').rating===4.5, A({op:'load'}).partners.list.find(p=>p.id==='P001'));
// pause
A({op:'partner',id:'P002',status:'Paused'}); ok('paused partner cannot sign in', P({mobile:'9876543211',pin:snPin}).error==='paused');
// UPI
ok('bad upi refused', P({mobile:'9876543210',pin:'4821',op:'upi',upi:'not a upi'}).error==='upi');
ok('upi saved', P({mobile:'9876543210',pin:'4821',op:'upi',upi:'rohit.p@okaxis'}).me.upi==='rohit.p@okaxis');
// lockout
for(let i=0;i<8;i++) P({mobile:'9876543212',pin:'0000'});
ok('lockout after 8 wrong', P({mobile:'9876543212',pin:'1357'}).error==='locked');
// admin password still required
ok('admin op needs password', post({action:'admin',pw:'bad',op:'partner',name:'Z',mobile:'9000000002',role:'Delivery'}).ok===false);
// rates from Settings
setS('Partner delivery: per delivery','20'); ok('rate change used', A({op:'shift',partner:'P004',date:'2026-11-09',fishKg:10}).pay===200, 0);
let sv=A({op:'settings',pDrop:'18',pFuel:'2.5',pFish:'abc'}); ok('rates saved via settings, bad value ignored', sv.ok&&sv.settings.pDrop===18&&sv.settings.pFuel===2.5&&sv.settings.pFish===10, sv.settings);
console.log(fails? ('\n'+fails+' FAILED') : '\nALL PASSED'); process.exit(fails?1:0);
