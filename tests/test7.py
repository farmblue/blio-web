import os,urllib.request,datetime,json
from playwright.sync_api import sync_playwright
S=__import__('os').path.dirname(__import__('os').path.abspath(__file__)); FD=S+'/fonts/node_modules/@fontsource'
B='http://127.0.0.1:8800'
urllib.request.urlopen(B+'/__now?t=2026-10-28T04:00:00Z').read()  # 09:30 IST
errs=[]; reqs=[]
def api(route):
    reqs.append(route.request.method)
    u=route.request.url.split('/exec',1)[1] if '/exec' in route.request.url else ''
    route.fulfill(response=route.fetch(url=B+'/exec'+u))
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2)
    ctx.route('https://fonts.googleapis.com/**',lambda r:r.fulfill(path=S+'/fonts.css',content_type='text/css'))
    ctx.route('http://fontlocal/**',lambda r:r.fulfill(path=os.path.join(FD,r.request.url.split('fontlocal/')[1]),content_type='font/woff2'))
    ctx.route('https://script.google.com/**',api)
    pg=ctx.new_page(); pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: m.type=='error' and errs.append(m.text))
    pg.clock.set_fixed_time(datetime.datetime(2026,10,28,4,0,tzinfo=datetime.timezone.utc))
    pg.goto(B+'/admin/'); pg.wait_for_timeout(600)
    pg.fill('#a-by','Vaishnav'); pg.fill('#a-pw','fish-2026!'); pg.click('[data-act=login]'); pg.wait_for_timeout(800)
    pg.click('[data-act=tab][data-v=settings]'); pg.wait_for_timeout(200)
    pg.click('[data-act=sw][data-v=autoOn]'); pg.wait_for_timeout(200)
    pg.locator('[data-act=sw][data-v=autoOn]').scroll_into_view_if_needed(); pg.screenshot(path=S+'/b1-settings.png')
    pg.click('[data-act=saves]'); pg.wait_for_timeout(600); print('settings', pg.locator('.box.ok').first.inner_text())
    pg.click('[data-act=tab][data-v=stock]'); pg.wait_for_timeout(200)
    pg.click('[data-act=addopen]'); pg.wait_for_timeout(200)
    pg.select_option('#c-fish','Bangda'); pg.select_option('#c-harbour','Malvan')
    sm=pg.locator('.asize[data-size="Small to medium"]'); bg=pg.locator('.asize[data-size="Medium to big"]')
    sm.locator('[data-f=kg]').fill('5'); sm.locator('[data-f=pieces]').fill('40'); sm.locator('[data-f=cost]').fill('180')
    bg.locator('[data-f=kg]').fill('3'); bg.locator('[data-f=pieces]').fill('15'); bg.locator('[data-f=cost]').fill('240'); bg.locator('[data-f=price]').fill('380')
    print('prefilled small price', sm.locator('[data-f=price]').input_value())
    pg.screenshot(path=S+'/b2-add.png', full_page=False)
    pg.locator('[data-act=savelot]').scroll_into_view_if_needed(); pg.screenshot(path=S+'/b3-add2.png')
    n=len(reqs); pg.click('[data-act=savelot]'); pg.wait_for_timeout(800); print('requests for save', len(reqs)-n)
    print('note', pg.locator('.box.ok').first.inner_text()); print('banner', pg.locator('.box').nth(1).inner_text()[:120])
    pg.screenshot(path=S+'/b4-saved.png')
    # customer before go live
    c=ctx.new_page(); c.clock.set_fixed_time(datetime.datetime(2026,10,28,5,0,tzinfo=datetime.timezone.utc))
    urllib.request.urlopen(B+'/__now?t=2026-10-28T05:00:00Z').read()
    c.goto(B+'/'); c.wait_for_timeout(1200); print('customer before golive:', c.locator('.ticket h1').inner_text().replace('\n',' '))
    pg.click('[data-act=golive]'); pg.wait_for_timeout(800)
    c.click('[data-act=reload]'); c.wait_for_timeout(1200); print('after refresh:', c.locator('.ticket h1').inner_text().replace('\n',' '))
    c.click('[data-act=item][data-id=bangda]'); c.wait_for_timeout(600); c.screenshot(path=S+'/b5-sheet.png'); c.keyboard.press('Escape'); c.wait_for_timeout(300)
    # fish switches off
    pg.click('[data-act=tab][data-v=fish]'); pg.click('[data-act=fishedit][data-v=Bangda]'); pg.wait_for_timeout(200)
    pg.uncheck('#f-left'); pg.uncheck('#f-origin'); pg.screenshot(path=S+'/b6-fish.png'); pg.click('[data-act=savefish]'); pg.wait_for_timeout(600)
    c.click('[data-act=reload]'); c.wait_for_timeout(1200)
    c.click('[data-act=item][data-id=bangda]'); c.wait_for_timeout(600); c.screenshot(path=S+'/b7-sheet-hidden.png')
    print('sheet text:', c.locator('.sheet .body').inner_text()[:260].replace('\n',' | '))
    c.keyboard.press('Escape'); c.goto(B+'/#orders'); c.wait_for_timeout(600); c.screenshot(path=S+'/b8-orders.png')
    b.close()
print('ERRORS',errs)
