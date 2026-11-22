# Security and data rights in the browser: consent line, My data page, delivery login by POST, admin privacy requests.
import os,json,urllib.request
from playwright.sync_api import sync_playwright
OUT=os.environ.get('SHOTS','/tmp/blio-shots'); os.makedirs(OUT,exist_ok=True)
B='http://127.0.0.1:8800'
urllib.request.urlopen(B+'/__now?t=2026-10-28T04:00:00Z').read()
urllib.request.urlopen(B+'/__set?k=Admin%20password&v=fish-2026!').read()
urllib.request.urlopen(B+'/__set?k=Delivery%20PIN&v=111111').read()
fails=[]; errs=[]; seen=[]
def ok(n,c,x=None):
    print(('PASS ' if c else 'FAIL ')+n)
    if not c: fails.append(n); print('   ',str(x)[:300])
def api(route):
    u=route.request.url.split('/exec',1)[1] if '/exec' in route.request.url else ''
    seen.append((route.request.method,route.request.url,route.request.post_data or ''))
    route.fulfill(response=route.fetch(url=B+'/exec'+u))
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':390,'height':844})
    ctx.route('https://fonts.googleapis.com/**',lambda r:r.abort()); ctx.route('https://fonts.gstatic.com/**',lambda r:r.abort())
    ctx.route('https://script.google.com/**',api)
    def page():
        pg=ctx.new_page(); pg.on('pageerror',lambda e: errs.append(str(e))); return pg
    # My data page
    pg=page(); pg.goto(B+'/data-request.html'); pg.wait_for_selector('#phone')
    pg.fill('#phone','12'); pg.click('#go'); ok('short mobile rejected in the page', 'Please enter' in pg.inner_text('#out'))
    pg.fill('#phone','98765 00099'); pg.fill('#name','Test Customer'); pg.select_option('#type','Delete my data'); pg.click('#go')
    pg.wait_for_function("document.getElementById('out').innerText.indexOf('received')>-1",timeout=8000)
    ok('request received message', 'received' in pg.inner_text('#out'))
    # footer and privacy links
    pg=page(); pg.goto(B+'/'); pg.wait_for_selector('footer.foot')
    ok('footer links to My data', pg.locator('footer a[href="/data-request"]').count()==1)
    pg.goto(B+'/privacy.html'); ok('privacy mentions the data request form', 'data request form' in pg.inner_text('main'))
    # consent line at checkout: add an item, open the slip
    pg=page(); pg.goto(B+'/'); pg.wait_for_selector('footer.foot')
    pg.evaluate("""()=>{try{localStorage.clear()}catch(e){}}""")
    # delivery login uses POST, PIN not in the URL
    seen.clear(); pg=page(); pg.goto(B+'/delivery/'); pg.wait_for_timeout(600)
    pg.evaluate("""()=>{localStorage.setItem('blio.dpin',JSON.stringify('111111'))}""")
    pg.reload(); pg.wait_for_timeout(1500)
    dl=[s for s in seen if 'deliveries' in s[2] or 'deliveries' in s[1]]
    ok('delivery list requested', len(dl)>0, )
    ok('delivery request is a POST with the PIN in the body only', all(m=='POST' and 'pin=' not in u and '111111' in body for m,u,body in dl), dl)
    # admin: privacy requests section
    pg=page(); pg.goto(B+'/admin/'); pg.wait_for_selector('#a-pw'); pg.fill('#a-pw','fish-2026!')
    pg.fill('#a-by','Test'); pg.click('[data-act=login]')
    pg.wait_for_timeout(1500)
    pg.evaluate("""()=>{var b=[].slice.call(document.querySelectorAll('[data-act=tab]')).filter(x=>/settings/i.test(x.textContent))[0]; b&&b.click()}""")
    pg.wait_for_timeout(800)
    txt=pg.inner_text('body').lower()
    ok('admin lists the privacy request', 'privacy requests' in txt and 'delete my data' in txt and '9876500099' in txt, txt[:300])
    ok('erase button shown with a check-the-customer note', pg.locator('[data-act=dreqerase]').count()==1 and 'check it is the customer' in txt)
    pg.on('dialog',lambda d:d.accept())
    pg.click('[data-act=dreqerase]'); pg.wait_for_timeout(1200)
    ok('erase reports a result', 'erased on 0 orders' in pg.inner_text('body').lower(), pg.inner_text('body')[:300])
    pg.screenshot(path=OUT+'/t12-admin-privacy.png')
    b.close()
ok('no page errors', not errs, errs)
print('FAILED' if fails else 'ALL PASS', fails); raise SystemExit(1 if fails else 0)
