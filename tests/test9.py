import os,urllib.request,urllib.parse,datetime
from playwright.sync_api import sync_playwright
S=__import__('os').path.dirname(__import__('os').path.abspath(__file__)); FD=S+'/fonts/node_modules/@fontsource'
B='http://127.0.0.1:8800'
def setk(k,v): urllib.request.urlopen(B+'/__set?k='+urllib.parse.quote(k)+'&v='+urllib.parse.quote(v)).read()
urllib.request.urlopen(B+'/__now?t=2026-10-28T05:00:00Z').read()
setk('Delivery PIN','111111'); setk('Packing PIN','222222')
errs=[]
def api(route):
    u=route.request.url.split('/exec',1)[1] if '/exec' in route.request.url else ''
    route.fulfill(response=route.fetch(url=B+'/exec'+u))
T=datetime.datetime(2026,10,28,5,0,tzinfo=datetime.timezone.utc)
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,accept_downloads=True)
    ctx.route('https://fonts.googleapis.com/**',lambda r:r.fulfill(path=S+'/fonts.css',content_type='text/css'))
    ctx.route('http://fontlocal/**',lambda r:r.fulfill(path=os.path.join(FD,r.request.url.split('fontlocal/')[1]),content_type='font/woff2'))
    ctx.route('https://script.google.com/**',api)
    def page():
        pg=ctx.new_page(); pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: m.type=='error' and errs.append(m.text)); pg.clock.set_fixed_time(T); return pg
    a=page(); a.goto(B+'/admin/'); a.wait_for_timeout(500)
    a.fill('#a-by','Malhar'); a.fill('#a-pw','fish-2026!'); a.click('[data-act=login]'); a.wait_for_timeout(800)
    a.click('[data-act=tab][data-v=stock]'); a.click('.aorder-head[data-id="L261028-003"]'); a.wait_for_timeout(200)
    a.fill('.agrid[data-lot="L261028-003"] [data-f=offer]','20'); a.click('[data-act=editlot][data-id="L261028-003"]'); a.wait_for_timeout(600)
    print('offer:', a.locator('.box.ok').first.inner_text()); a.screenshot(path=S+'/e1-offer.png')
    a.click('[data-act=tab][data-v=settings]'); a.wait_for_timeout(200)
    a.fill('#cp-code','welcome50'); a.select_option('#cp-type','Rs'); a.fill('#cp-value','50'); a.fill('#cp-min','300')
    a.click('[data-act=cpsave]'); a.wait_for_timeout(600); print('coupon:', a.locator('.box.ok').first.inner_text())
    a.locator('.aform').last.scroll_into_view_if_needed(); a.screenshot(path=S+'/e2-coupons.png')
    # customer
    c=page(); c.goto(B+'/'); c.wait_for_timeout(1200); c.screenshot(path=S+'/e3-home.png')
    print('offers strip:', c.locator('.offc').count(), c.locator('.offc').first.inner_text().replace('\n',' | '))
    c.click('.offc'); c.wait_for_timeout(500); c.screenshot(path=S+'/e4-sheet.png'); c.click('[data-act=add]'); c.wait_for_timeout(300)
    c.click('#slipbar'); c.wait_for_timeout(300)
    c.fill('#f-name','Malhar'); c.fill('#f-phone','9876543210'); c.fill('#f-addr','Flat 4')
    c.fill('#f-coupon','welcome50'); c.click('[data-act=capply]'); c.wait_for_timeout(600)
    print('coupon err (min 300 on 256):', c.locator('.err').first.inner_text() if c.locator('.err').count() else 'none')
    c.click('[data-act=linc]'); c.wait_for_timeout(200); c.click('[data-act=capply]'); c.wait_for_timeout(600)
    c.locator('.cpon').scroll_into_view_if_needed(); c.screenshot(path=S+'/e5-slip.png')
    print('sums:', c.locator('.sums').inner_text().replace('\n',' | ')[:200])
    c.click('[data-act=send]'); c.wait_for_timeout(1000)
    href=c.locator('a.btn', has_text='Send on WhatsApp').get_attribute('href'); print([l for l in urllib.parse.unquote(href).split('\n') if 'Coupon' in l or 'total' in l])
    # admin confirm + bill
    a.click('[data-act=tab][data-v=orders]'); a.click('[data-act=refresh]'); a.wait_for_timeout(800)
    a.click('.aorder-head[data-id="BL2810-001"]'); a.wait_for_timeout(200)
    a.click('[data-act=stage][data-id="BL2810-001"][data-v=Confirmed]'); a.wait_for_timeout(500)
    a.click('[data-act=bill][data-id="BL2810-001"]'); a.wait_for_timeout(800); print('bill:', a.locator('.box.ok').first.inner_text())
    with a.expect_download() as dl: a.click('[data-act=billshare][data-id="BL2810-001"]')
    print('download name:', dl.value.suggested_filename); a.screenshot(path=S+'/e6-bill.png')
    # packing
    st=page(); st.goto(B+'/delivery/'); st.wait_for_timeout(500); st.screenshot(path=S+'/e7-login.png')
    st.fill('#d-pin','222222'); st.click('[data-act=dlogin]'); st.wait_for_timeout(600)
    st.fill('#p-by','Ravi'); st.click('[data-act=pbyok]'); st.wait_for_timeout(300); st.screenshot(path=S+'/e8-packing.png')
    st.click('[data-act=packed][data-id="BL2810-001"]'); st.wait_for_timeout(100); print('confirm:', st.locator('[data-act=packed]').inner_text())
    st.click('[data-act=packed][data-id="BL2810-001"]'); st.wait_for_timeout(900); st.screenshot(path=S+'/e9-packed.png')
    print('packed section:', st.locator('.dcard').first.inner_text().replace('\n',' | '))
    st.click('[data-act=dlogout]'); st.wait_for_timeout(200); st.fill('#d-pin','111111'); st.click('[data-act=dlogin]'); st.wait_for_timeout(600)
    print('rider sees:', st.locator('.stage').first.inner_text(), '| tabs', st.locator('[data-act=dtab]').count())
    # customer bill
    c.click('[data-act=orders]'); c.wait_for_timeout(900); c.click('[data-act=billget]'); c.wait_for_timeout(700)
    with c.expect_download() as dl2: c.click('[data-act=billopen]')
    print('customer bill:', dl2.value.suggested_filename); c.screenshot(path=S+'/e10-orders.png')
    b.close()
print('ERRORS',errs)
