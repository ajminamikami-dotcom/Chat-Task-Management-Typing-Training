const { chromium } = require('playwright');
(async () => {
  const [src, out] = process.argv.slice(2);
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + src, { waitUntil: 'load' });
  await p.pdf({ path: out, format: 'A4', printBackground: true, margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' } });
  await b.close(); console.log('pdf written', out);
})().catch((e) => { console.error(e); process.exit(1); });
