import os,urllib.request,urllib.parse,datetime,re
from playwright.sync_api import sync_playwright
S=__import__('os').path.dirname(__import__('os').path.abspath(__file__)); FD=S+'/fonts/node_modules/@fontsource'
B='http://127.0.0.1:8800'
def setk(k,v): urllib.request.urlopen(B+'/__set?k='+urllib.parse.quote(k)+'&v='+urllib.parse.quote(v)).read()
urllib.request.urlopen(B+'/__now?t=2026-10-28T05:00:00Z').read()
setk('Delivery PIN','111111'); setk('Packing PIN','222222'); setk('UPI ID','farmblue@okaxis')
errs=[]
def api(route):
    u=route.request.url.split('/exec',1)[1] if '/exec' in route.request.url else ''
    route.fulfill(response=route.fetch(url=B+'/exec'+u))
T=datetime.datetime(2026,10,28,5,0,tzinfo=datetime.timezone.utc)
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2)
    ctx.route('https://fonts.googleapis.com/**',lambda r:r.fulfill(path=S+'/fonts.css',content_type='text/css'))
    ctx.route('http://fontlocal/**',lambda r:r.fulfill(path=os.path.join(FD,r.request.url.split('fontlocal/')[1]),content_type='font/woff2'))
    ctx.route('https://script.google.com/**',api)
    def page():
        pg=ctx.new_page(); pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: m.type=='error' and errs.append(m.text)); pg.clock.set_fixed_time(T); return pg
    a=page(); a.goto(B+'/admin/'); a.wait_for_timeout(400)
    a.fill('#a-by','Malhar'); a.fill('#a-pw','fish-2026!'); a.click('[data-act=login]'); a.wait_for_timeout(800)
    a.click('[data-act=tab][data-v=stock]'); a.click('.aorder-head[data-id="L261028-003"]'); a.wait_for_timeout(200)
    a.fill('.agrid[data-lot="L261028-003"] [data-f=offer]','15'); a.click('[data-act=editlot][data-id="L261028-003"]'); a.wait_for_timeout(600)
    print('stock head:', a.locator('.aorder-head[data-id="L261028-003"] .ah1').inner_text().replace('\n',' '), '|', a.locator('.aorder-head[data-id="L261028-003"] .ah3').inner_text().replace('\n',' '))
    a.screenshot(path=S+'/f1-stock.png')
    a.click('[data-act=tab][data-v=settings]'); a.fill('#cp-code','welcome20'); a.fill('#cp-value','20'); a.click('[data-act=cpsave]'); a.wait_for_timeout(500)
    c=page(); c.goto(B+'/'); c.wait_for_timeout(1200)
    c.locator('.why').scroll_into_view_if_needed(); c.screenshot(path=S+'/f2-why.png')
    c.click('[data-act=item][data-id=bangda]'); c.wait_for_timeout(400); c.click('[data-act=add]'); c.wait_for_timeout(300)
    c.click('[data-act=item][data-id=surmai]'); c.wait_for_timeout(400); c.click('[data-act=add]'); c.wait_for_timeout(300)
    c.click('#slipbar'); c.wait_for_timeout(300)
    c.fill('#f-name','Asha Patil'); c.fill('#f-phone','9876543210'); c.fill('#f-addr','Flat 4, Shahupuri')
    c.fill('#f-coupon','welcome20'); c.click('[data-act=capply]'); c.wait_for_timeout(600)
    c.screenshot(path=S+'/f3-slip.png')
    c.locator('.cpon').scroll_into_view_if_needed(); c.screenshot(path=S+'/f4-slip2.png')
    print('sums:', c.locator('.sums').inner_text().replace('\n',' | ')[:160]); print('lines:', c.locator('.lines').inner_text().replace('\n',' | ')[:200])
    c.click('[data-act=send]'); c.wait_for_timeout(1000)
    href=c.locator('a.btn', has_text='Send on WhatsApp').get_attribute('href'); print([l for l in urllib.parse.unquote(href).split('\n') if 'offer' in l or 'Coupon' in l or 'Payment' in l])
    # second order: pay now
    c.goto(B+'/'); c.wait_for_timeout(800); c.click('[data-act=item][data-id=surmai]'); c.wait_for_timeout(300); c.click('[data-act=add]'); c.click('#slipbar'); c.wait_for_timeout(300)
    c.click('[data-act=payby][data-v=now]'); c.wait_for_timeout(200); c.click('[data-act=send]'); c.wait_for_timeout(900); c.screenshot(path=S+'/f5-done-paynow.png')
    print('done pay button:', c.locator('a.btn', has_text='by UPI').count())
    # admin confirm both + bill 1
    a.click('[data-act=tab][data-v=orders]'); a.click('[data-act=refresh]'); a.wait_for_timeout(800)
    for oid in ['BL2810-001','BL2810-002']:
        a.click('.aorder-head[data-id="%s"]'%oid); a.wait_for_timeout(150); a.click('[data-act=stage][data-id="%s"][data-v=Confirmed]'%oid); a.wait_for_timeout(400)
    a.click('.aorder-head[data-id="BL2810-001"]'); a.wait_for_timeout(150); a.click('[data-act=bill][data-id="BL2810-001"]'); a.wait_for_timeout(700)
    html=urllib.request.urlopen(B+'/__bill').read().decode()
    print('bill bits:', re.findall(r'15% offer[^<]*|Coupon [^<]*|Pay on delivery[^<]*|Coupons don[^<]*', html))
    # packing
    st=page(); st.goto(B+'/delivery/'); st.wait_for_timeout(400); st.click('[data-act=lrole][data-v=packing]'); st.fill('#d-pin','222222'); st.click('[data-act=dlogin]'); st.wait_for_timeout(500)
    st.fill('#p-by','Ravi'); st.click('[data-act=pbyok]'); st.wait_for_timeout(200)
    print('packing shows name?', 'Asha' in st.locator('#main').inner_text(), 'Shahupuri' in st.locator('#main').inner_text())
    for oid in ['BL2810-001','BL2810-002']:
        st.click('[data-act=packed][data-id="%s"]'%oid); st.click('[data-act=packed][data-id="%s"]'%oid); st.wait_for_timeout(700)
    st.screenshot(path=S+'/f6-packing.png')
    # rider
    st.click('[data-act=dlogout]'); st.click('[data-act=lrole][data-v=delivery]'); st.fill('#d-pin','111111'); st.click('[data-act=dlogin]'); st.wait_for_timeout(600)
    st.screenshot(path=S+'/f7-rider.png')
    st.click('[data-act=dcollect][data-id="BL2810-001"]'); st.wait_for_timeout(600)
    print('warn:', st.locator('.box.warn').first.inner_text() if st.locator('.box.warn').count() else 'none', '| start:', st.locator('[data-act=dstart]').inner_text())
    st.click('[data-act=dstart]'); st.click('[data-act=dstart]'); st.wait_for_timeout(700)
    st.screenshot(path=S+'/f8-out.png')
    st.click('[data-act=ddone][data-id="BL2810-001"][data-v=Cash]'); st.click('[data-act=ddone][data-id="BL2810-001"][data-v=Cash]'); st.wait_for_timeout(700)
    print('remaining rider orders:', st.locator('.dcard').count())
    a.click('[data-act=refresh]'); a.wait_for_timeout(800); a.screenshot(path=S+'/f9-admin.png')
    print('cash box:', a.locator('.box', has_text='Collected at the door').inner_text())
    print('statuses:', [x[11] for x in eval(urllib.request.urlopen(B+'/__sheet?n=Orders').read().decode().replace('null','None').replace('true','True').replace('false','False'))[1:]])
    b.close()
print('ERRORS',errs)
