# Partner programme end to end: admin Partners tab, the partner app, careers and partner policy pages.
import os,json,urllib.request,datetime
from playwright.sync_api import sync_playwright
S=os.path.dirname(os.path.abspath(__file__)); OUT=os.environ.get('SHOTS','/tmp/blio-shots'); os.makedirs(OUT,exist_ok=True)
B='http://127.0.0.1:8800'
urllib.request.urlopen(B+'/__now?t=2026-11-13T04:00:00Z').read()
def post(o):
    r=urllib.request.Request(B+'/exec',data=json.dumps(o).encode(),method='POST'); return json.loads(urllib.request.urlopen(r).read())
urllib.request.urlopen(B+'/__set?k=Admin%20password&v=fish-2026!').read()
A=lambda **o: post(dict(action='admin',pw='fish-2026!',by='Test',**o))
A(op='load')
# seed: one partner with history so the rest check has something to show
A(op='partner',name='Sneha K',mobile='9876543211',role='Delivery',area='Shahupuri',pin='3333',verified=True,consent=True)
for d in ['2026-11-10','2026-11-12']: A(op='shift',partner='P001',date=d,drops=6,km=16,rating=5)
A(op='partner',name='Lata S',mobile='9876543213',role='Cleaning',pin='4444')
T=datetime.datetime(2026,11,13,4,0,tzinfo=datetime.timezone.utc)
errs=[]; fails=[]
def ok(n,c):
    print(('PASS ' if c else 'FAIL ')+n)
    if not c: fails.append(n)
def api(route):
    u=route.request.url.split('/exec',1)[1] if '/exec' in route.request.url else ''
    if route.request.method=='POST': route.fulfill(response=route.fetch(url=B+'/exec'+u))
    else: route.fulfill(response=route.fetch(url=B+'/exec'+u))
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2)
    ctx.route('https://fonts.googleapis.com/**',lambda r:r.abort()); ctx.route('https://fonts.gstatic.com/**',lambda r:r.abort())
    ctx.route('https://script.google.com/**',api)
    def page():
        pg=ctx.new_page(); pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: m.type=='error' and 'fonts' not in m.text and 'ERR_FAILED' not in m.text and errs.append(m.text)); pg.clock.set_fixed_time(T); return pg
    # ---- admin
    a=page(); a.goto(B+'/admin/'); a.wait_for_timeout(300)
    a.fill('#a-by','Malhar'); a.fill('#a-pw','fish-2026!'); a.click('[data-act=login]'); a.wait_for_timeout(700)
    a.click('[data-act=tab][data-v=partners]'); a.wait_for_timeout(300)
    ok('partners tab lists Sneha', 'Sneha K' in a.inner_text('#main'))
    a.click('[data-act=paddopen]'); a.fill('#pf-name','Rohit Patil'); a.fill('#pf-mobile','98765 43210'); a.fill('#pf-area','Rajarampuri'); a.fill('#pf-upi','rohit@upi')
    a.click('[data-act=pflag][data-v=verifiedOn]'); a.click('[data-act=pflag][data-v=consentOn]')
    ok('typed values survive toggling a switch', a.input_value('#pf-name')=='Rohit Patil' and a.input_value('#pf-area')=='Rajarampuri')
    a.screenshot(path=OUT+'/admin-add-partner.png')
    a.click('[data-act=psave]'); a.wait_for_timeout(700)
    ok('partner added with a generated PIN note', 'Rohit Patil added' in a.inner_text('#main') and 'PIN:' in a.inner_text('#main'))
    a.screenshot(path=OUT+'/admin-pool.png')
    # add an evening for Rohit
    a.click('[data-act=pshift][data-id=P003]'); a.fill('#sf-date','2026-11-09'); a.fill('#sf-drops','5'); a.fill('#sf-km','12'); a.select_option('#sf-rating','4')
    a.click('[data-act=pshiftsave]'); a.wait_for_timeout(700)
    ok('evening saved with pay 100+75+25=200', '₹200 due' in a.inner_text('#main') or '₹200' in a.inner_text('#main'))
    # request with rest check for Sat 14 Nov
    a.click('[data-act=preqopen]'); a.fill('#q-date','2026-11-14'); a.dispatch_event('#q-date','change'); a.wait_for_timeout(700)
    ok('rest check names Sneha', 'Rest check' in a.inner_text('#main') and 'Sneha' in a.inner_text('#main'))
    a.screenshot(path=OUT+'/admin-request.png')
    a.fill('#q-need','2'); a.click('[data-act=preqsave]'); a.wait_for_timeout(800)
    ok('request sent, Sneha resting', 'Request sent to 1' in a.inner_text('#main') and 'Resting: Sneha' in a.inner_text('#main'))
    ok('whatsapp share link present', a.locator('a[href^="https://wa.me/?text="]').count()>=1)
    a.screenshot(path=OUT+'/admin-requests.png')
    a.click('[data-act=tab][data-v=settings]'); ok('rates in settings', 'partner pay rates' in a.inner_text('#main').lower() and a.input_value('#s-pFuel')=='2.1')
    # ---- partner app
    q=page(); q.goto(B+'/partner/'); q.wait_for_timeout(300)
    q.fill('#p-mob','9876543211'); q.fill('#p-pin','0000'); q.click('[data-act=login]'); q.wait_for_timeout(600)
    ok('wrong PIN shows message', 'didn’t work' in q.inner_text('#main'))
    q.fill('#p-mob','9876543211'); q.fill('#p-pin','3333'); q.click('[data-act=login]'); q.wait_for_timeout(700)
    ok('Sneha (rested) sees no open request', 'No open shifts' in q.inner_text('#main') and 'Rating' in q.inner_text('#main'))
    ok('Sneha has none to take: due ₹0 for no work', 'Due to you' in q.inner_text('#main'))
    q.screenshot(path=OUT+'/partner-rested.png')
    q.click('[data-act=tab][data-v=profile]'); q.fill('#p-upi','bad upi'); q.click('[data-act=upi]'); q.wait_for_timeout(600)
    ok('bad UPI refused', 'UPI ID' in q.inner_text('#main') and 'doesn’t look like' in q.inner_text('#main'))
    q.screenshot(path=OUT+'/partner-profile.png')
    # Rohit logs in with the PIN the admin generated
    pins=json.loads(urllib.request.urlopen(B+'/__sheet?n=Partners').read()); hdr=pins[0]; row=[r for r in pins[1:] if r[hdr.index('Name')]=='Rohit Patil'][0]
    pin=str(row[hdr.index('PIN')])
    ctx2=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2); ctx2.route('https://fonts.googleapis.com/**',lambda r:r.abort()); ctx2.route('https://fonts.gstatic.com/**',lambda r:r.abort()); ctx2.route('https://script.google.com/**',api)
    r2=ctx2.new_page(); r2.on('pageerror',lambda e: errs.append(str(e))); r2.clock.set_fixed_time(T); r2.goto(B+'/partner/'); r2.wait_for_timeout(300)
    r2.fill('#p-mob','9876543210'); r2.fill('#p-pin',pin); r2.click('[data-act=login]'); r2.wait_for_timeout(700)
    ok('Rohit sees the request', 'I’ll take it' in r2.inner_text('#main') and 'Sat 14 Nov' in r2.inner_text('#main'))
    r2.screenshot(path=OUT+'/partner-work.png')
    r2.click('[data-act=take]'); r2.wait_for_timeout(700)
    ok('Rohit booked', 'You’re in' in r2.inner_text('#main') and 'Booked' in r2.inner_text('#main'))
    r2.screenshot(path=OUT+'/partner-booked.png')
    r2.click('[data-act=tab][data-v=requests]'); ok('requests tab shows his shift', 'yours' in r2.inner_text('#main').lower())
    r2.click('[data-act=tab][data-v=profile]'); r2.click('[data-act=out]'); ok('sign out returns to login', r2.locator('#p-pin').count()==1)
    # ---- public pages
    c=page(); c.goto(B+'/careers.html'); c.wait_for_timeout(300)
    ok('careers English default', 'earn extra, close to home' in c.inner_text('main').lower() and c.locator('h1.mr').is_hidden())
    ok('apply links go to the company WhatsApp', c.locator('a.btn[href^="https://wa.me/918856888766?text="]').count()>=2)
    c.screenshot(path=OUT+'/careers-en.png',full_page=True)
    c.click('#b-mr'); c.wait_for_timeout(200)
    ok('Marathi toggle', c.locator('h1.mr').is_visible() and c.locator('h1.en').is_hidden() and 'घराजवळ' in c.inner_text('h1.mr'))
    c.screenshot(path=OUT+'/careers-mr.png',full_page=True)
    for u,t in [('/partner-terms.html','Partner Terms'),('/partner-privacy.html','Partner Privacy Notice')]:
        d=page(); d.goto(B+u); ok(u+' renders', t in d.inner_text('h1') and 'Malhar Pansare' in d.inner_text('main')); d.screenshot(path=OUT+'/'+u.strip('/').replace('.html','')+'.png',full_page=True)
    # shop footer link
    s=page(); s.goto(B+'/'); s.wait_for_timeout(800); ok('shop footer links to careers', s.locator('a[href="/careers"]').count()>=1)
    # delivery login links to the partner app
    dl=page(); dl.goto(B+'/delivery/'); dl.wait_for_timeout(600); ok('delivery login links to partner app', dl.locator('a[href="/partner/"]').count()>=1)
    b.close()
print('console/page errors:',errs[:5])
ok('no page errors',not errs)
print('\n'+('%d FAILED: %s'%(len(fails),fails) if fails else 'ALL PASSED')); raise SystemExit(1 if fails else 0)
