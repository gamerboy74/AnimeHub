const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const requests = [];
  page.on('request', req => {
    const url = req.url();
    requests.push({ method: req.method(), url: url, type: req.resourceType() });
  });
  
  const responses = [];
  page.on('response', res => {
    const url = res.url();
    if (url.includes('/api/') || url.includes('.m3u8') || url.includes('.mp4') || url.includes('stream') || url.includes('video') || url.includes('embed')) {
      responses.push({ url: url, status: res.status(), contentType: res.headers()['content-type'] });
    }
  });
  
  console.log('Navigating to f75s.com embed URL...');
  await page.goto('https://f75s.com/aool/alqfr9k3x2kp', { 
    waitUntil: 'domcontentloaded',
    timeout: 30000 
  });
  
  // Wait extra time for SPA to render and make API calls
  console.log('Waiting 10s for SPA to load...');
  await page.waitForTimeout(10000);
  
  console.log('\n=== ALL NETWORK REQUESTS ===');
  requests.filter(r => !r.url.includes('.js') && !r.url.includes('.css') && !r.url.includes('.svg') && !r.url.includes('.png') && !r.url.includes('beacon') && !r.url.includes('polyfill'))
    .forEach(r => console.log(r.method, r.type, r.url));
  
  console.log('\n=== INTERESTING RESPONSES ===');
  responses.forEach(r => console.log(r.status, r.contentType, r.url));
  
  console.log('\n=== PAGE TITLE ===');
  console.log(await page.title());
  
  console.log('\n=== ROOT DIV ===');
  const rootHtml = await page.$eval('#root', el => el.innerHTML);
  console.log(rootHtml.substring(0, 3000));
  
  console.log('\n=== VIDEO / IFRAME / SOURCE ELEMENTS ===');
  const elements = await page.evaluate(() => {
    const result = [];
    document.querySelectorAll('video, iframe, source, [data-src]').forEach(el => {
      result.push({ tag: el.tagName, src: el.src || el.getAttribute('src'), dataSrc: el.getAttribute('data-src'), outerHtml: el.outerHTML.substring(0, 500) });
    });
    return result;
  });
  elements.forEach(e => console.log(JSON.stringify(e)));
  
  await browser.close();
  console.log('\nDone!');
})().catch(e => { console.log('ERROR:', e.message); process.exit(1); });
