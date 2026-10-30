import time,sys,os,urllib.parse,urllib.request,json,datetime
from playwright.sync_api import sync_playwright
S=__import__('os').path.dirname(__import__('os').path.abspath(__file__)); FD=S+'/fonts/node_modules/@fontsource'
B='http://127.0.0.1:8800'
def setnow(iso): urllib.request.urlopen(B+'/__now?t='+iso).read()
errs=[]
def api(route):
    u=route.request.url.split('/exec',1)[1] if '/exec' in route.request.url else ''
    route.fulfill(response=route.fetch(url=B+'/exec'+u))
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2)
    ctx.route('https://fonts.googleapis.com/**',lambda r:r.fulfill(path=S+'/fonts.css',content_type='text/css'))
    ctx.route('http://fontlocal/**',lambda r:r.fulfill(path=os.path.join(FD,r.request.url.split('fontlocal/')[1]),content_type='font/woff2'))
    ctx.route('https://script.google.com/**',api)
    pg=ctx.new_page(); pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: m.type=='error' and errs.append(m.text))
    pg.clock.set_fixed_time(datetime.datetime(2026,10,28,5,0,tzinfo=datetime.timezone.utc))
    pg.goto(B+'/'); pg.wait_for_timeout(1500)
    pg.screenshot(path=S+'/n1-home.png')
    pg.locator('#catch').scroll_into_view_if_needed(); pg.wait_for_timeout(300); pg.screenshot(path=S+'/n2-catch.png')
    pg.click('[data-act=item][data-id=surmai]'); pg.wait_for_timeout(600); pg.screenshot(path=S+'/n3-sheet.png')
    pg.click('[data-act=opt][data-v^="Medium to big"]'); pg.wait_for_timeout(200)
    pg.click('[data-act=qinc]'); pg.click('[data-act=qinc]'); pg.click('[data-act=qinc]'); pg.click('[data-act=qinc]'); pg.wait_for_timeout(200)
    print('5x1kg big btn:', pg.locator('.addrow .btn').inner_text())
    pg.click('[data-act=qdec]'); pg.click('[data-act=qdec]'); pg.click('[data-act=qdec]'); pg.click('[data-act=qdec]')
    pg.click('[data-act=add]'); pg.wait_for_timeout(400)
    pg.click('[data-act=item][data-id=bangda]'); pg.wait_for_timeout(500); pg.screenshot(path=S+'/n4-sheet1.png'); pg.click('[data-act=add]'); pg.wait_for_timeout(400)
    pg.click('#slipbar'); pg.wait_for_timeout(400); pg.screenshot(path=S+'/n5-slip.png')
    pg.fill('#f-name','Malhar'); pg.fill('#f-phone','9876543210'); pg.fill('#f-addr','Flat 4')
    pg.click('[data-act=send]'); pg.wait_for_timeout(1000)
    pg.screenshot(path=S+'/n6-done.png')
    href=pg.locator('a.btn', has_text='Send on WhatsApp').get_attribute('href'); print(urllib.parse.unquote(href).split('text=')[1][:400])
    print('lines', urllib.request.urlopen(B+'/__sheet?n=Order%20lines').read().decode()[:600])
    pg.click('[data-act=orders]'); pg.wait_for_timeout(1000); pg.screenshot(path=S+'/n7-orders.png')
    # after cutoff with day-2 discount, next day
    urllib.request.urlopen(B+'/__set?k=Day-2%20discount%20on&v=Yes').read()
    setnow('2026-10-28T10:00:00Z')
    pg.clock.set_fixed_time(datetime.datetime(2026,10,28,10,0,tzinfo=datetime.timezone.utc))
    pg.goto(B+'/'); pg.wait_for_timeout(1500); pg.screenshot(path=S+'/n8-after.png')
    pg.locator('#catch').scroll_into_view_if_needed(); pg.wait_for_timeout(300); pg.screenshot(path=S+'/n9-after-catch.png')
    pg.click('[data-act=item][data-id=surmai]'); pg.wait_for_timeout(600); pg.screenshot(path=S+'/n10-sheet-disc.png'); pg.keyboard.press('Escape')
    # no catch: day 3
    setnow('2026-10-30T04:00:00Z'); pg.clock.set_fixed_time(datetime.datetime(2026,10,30,4,0,tzinfo=datetime.timezone.utc))
    pg.evaluate("localStorage.removeItem('blio.api')"); pg.goto(B+'/'); pg.wait_for_timeout(1500); pg.screenshot(path=S+'/n11-empty.png')
    print('slip after empty', pg.evaluate("localStorage.getItem('blio.cart')"))
    print('ov', pg.evaluate("document.getElementById('main').scrollWidth>document.getElementById('main').clientWidth"))
    b.close()
print('ERRORS',errs)
