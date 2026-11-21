import { test, expect } from '@playwright/test';
import JSZip from 'jszip';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=',
  'base64'
);

async function prepareBook(page) {
  await page.goto('/');
  await page.locator('#title').fill('Browser QA Book');
  await page.locator('#subtitle').fill('A Repeatable Test');
  await page.locator('#author').fill('BookForge Test Author');
  await page.locator('#year').fill('2026');
  await page.locator('#usd').fill('9.99');
  await page.locator('#ngn').fill('15000');
  await page.locator('#blurb').fill('A verified test manuscript.');
  await page.locator('#tags').fill('testing, publishing');
  await page.locator('#file').setInputFiles([
    { name: '02-second-chapter.md', mimeType: 'text/markdown', buffer: Buffer.from('# Second Chapter\n\nSecond body with **bold** text.\n\n- item one\n- item two') },
    { name: '01-first-chapter.md', mimeType: 'text/markdown', buffer: Buffer.from('# First Chapter\n\nFirst body with a [link](https://example.com).\n\nA line break  \nnext line.') },
    { name: 'cover.png', mimeType: 'image/png', buffer: png }
  ]);
  await expect(page.locator('#st')).toContainText('Imported 2 chapter(s) and a cover');
  await expect(page.locator('#chs .ch')).toHaveCount(2);
}

async function downloadedBuffer(page, selector) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator(selector).click()
  ]);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function assertXmlWellFormed(xml, label, page) {
  const parsed = await page.evaluate(source => {
    const doc = new DOMParser().parseFromString(source, 'application/xml');
    return {
      root: doc.documentElement?.nodeName || null,
      error: doc.querySelector('parsererror')?.textContent || null
    };
  }, xml);
  expect(parsed.error, label).toBeNull();
  expect(parsed.root, label).not.toBeNull();
}

async function assertEpub(buffer, page) {
  const zip = await JSZip.loadAsync(buffer);
  const required = [
    'mimetype',
    'META-INF/container.xml',
    'OEBPS/content.opf',
    'OEBPS/nav.xhtml',
    'OEBPS/style.css',
    'OEBPS/ch0.xhtml',
    'OEBPS/ch1.xhtml',
    'OEBPS/cover.png'
  ];
  for (const name of required) expect(zip.file(name), `EPUB missing ${name}`).not.toBeNull();
  expect(await zip.file('mimetype').async('string')).toBe('application/epub+zip');
  for (const name of ['META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/nav.xhtml', 'OEBPS/ch0.xhtml', 'OEBPS/ch1.xhtml']) {
    await assertXmlWellFormed(await zip.file(name).async('string'), name, page);
  }
  const opf = await zip.file('OEBPS/content.opf').async('string');
  expect(opf).toContain('Browser QA Book');
  expect(opf).toContain('BookForge Test Author');
  const first = await zip.file('OEBPS/ch0.xhtml').async('string');
  expect(first).toContain('First body');
  expect(first).toContain('https://example.com');
  const second = await zip.file('OEBPS/ch1.xhtml').async('string');
  expect(second).toContain('Second body');
  return zip;
}

test('real import orders chapters, previews cover and restores manuscript after reload', async ({ page }) => {
  await prepareBook(page);
  await expect(page.locator('#chs .ch').nth(0).locator('input')).toHaveValue('First Chapter');
  await expect(page.locator('#chs .ch').nth(1).locator('input')).toHaveValue('Second Chapter');
  await expect(page.locator('#cv')).toBeVisible();
  await page.reload();
  await expect(page.locator('#title')).toHaveValue('Browser QA Book');
  await expect(page.locator('#author')).toHaveValue('BookForge Test Author');
  await expect(page.locator('#chs .ch')).toHaveCount(2);
  await expect(page.locator('#cv')).toBeVisible();
});

test('an unreadable Markdown file produces a visible import error instead of an unhandled rejection', async ({ page }) => {
  await page.addInitScript(() => {
    const original = File.prototype.text;
    File.prototype.text = function () {
      if (this.name === 'unreadable.md') return Promise.reject(new Error('Synthetic file read failure'));
      return original.call(this);
    };
  });
  await page.goto('/');
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.locator('#file').setInputFiles({
    name: 'unreadable.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Cannot Read')
  });
  await expect.poll(() => pageErrors.length).toBe(1);
  expect(pageErrors[0]).toContain('Synthetic file read failure');
  await expect(page.locator('#st')).toContainText(/Import failed/i, { timeout: 2500 });
});

test('EPUB download is a readable archive with required package files and well-formed XHTML/XML', async ({ page }) => {
  await prepareBook(page);
  const buffer = await downloadedBuffer(page, '#bEpub');
  await assertEpub(buffer, page);
});

test('launch-pack ZIP contains the listing, cover asset and a structurally valid embedded EPUB', async ({ page }) => {
  await prepareBook(page);
  const buffer = await downloadedBuffer(page, '#bPack');
  const pack = await JSZip.loadAsync(buffer);
  const epubFile = pack.file('kdp/browser-qa-book.epub');
  expect(epubFile).not.toBeNull();
  expect(pack.file('listing.html')).not.toBeNull();
  expect(pack.file('assets/cover.png')).not.toBeNull();
  const listing = await pack.file('listing.html').async('string');
  expect(listing).toContain('Browser QA Book');
  expect(listing).toContain('BookForge Test Author');
  await assertEpub(await epubFile.async('nodebuffer'), page);
});

test('PDF action opens the real generated print document and invokes its print handoff', async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => { window.__bookforgePrintCalled = true; };
  });
  await page.context().route('**/paged.polyfill.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `class Handler {} window.Paged = { Handler, registerHandlers(H) { setTimeout(() => new H().afterRendered([]), 0); } };`
  }));
  await prepareBook(page);
  const popupPromise = page.waitForEvent('popup');
  await page.locator('#bPdf').click();
  const popup = await popupPromise;
  await expect(popup.locator('body')).toContainText('First Chapter');
  await expect.poll(() => popup.evaluate(() => window.__bookforgePrintCalled === true)).toBe(true);
});
