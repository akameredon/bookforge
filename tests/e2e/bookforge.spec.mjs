import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

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

test('corrupt saved manuscript data is reported instead of silently discarded', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('bf', '{not valid JSON');
    localStorage.setItem('bfc', '{not valid JSON');
  });
  await page.goto('/');
  await expect(page.locator('#st')).toContainText(/could not be restored|saved data is damaged/i, { timeout: 2500 });
});

test('cover storage failure remains visible after the import status is updated', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'bfc') throw new DOMException('Synthetic quota exceeded', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.goto('/');
  await page.locator('#file').setInputFiles({
    name: 'cover.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=', 'base64')
  });
  await expect(page.locator('#cv')).toBeVisible();
  await expect(page.locator('#st')).toContainText(/cover.*could not be saved|cover.*session only/i, { timeout: 2500 });
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
  await expect(page.locator('#st')).toContainText(/Import failed: Synthetic file read failure/i, { timeout: 2500 });
  expect(pageErrors).toEqual([]);
});

test('EPUB download is a readable archive with required package files and well-formed XHTML/XML', async ({ page }) => {
  await prepareBook(page);
  const buffer = await downloadedBuffer(page, '#bEpub');
  await assertEpub(buffer, page);
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/bookforge-sample.epub', buffer);
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

test('mobile viewport supports manuscript import, persistence and EPUB export', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareBook(page);
  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    mainColumns: getComputedStyle(document.querySelector('main')).gridTemplateColumns
  }));
  expect(layout.document, 'mobile layout should not overflow horizontally').toBeLessThanOrEqual(layout.viewport);
  await page.reload();
  await expect(page.locator('#title')).toHaveValue('Browser QA Book');
  await expect(page.locator('#chs .ch')).toHaveCount(2);
  const epub = await downloadedBuffer(page, '#bEpub');
  await assertEpub(epub, page);
});

test('PDF export renders a real paginated PDF with manuscript content', async ({ page }) => {
  await page.context().addInitScript(() => {
    window.print = () => { window.__bookforgePrintInvoked = true; };
  });
  await prepareBook(page);
  const popupPromise = page.waitForEvent('popup');
  await page.locator('#bPdf').click();
  const popup = await popupPromise;
  await expect.poll(() => popup.evaluate(() => window.__bookforgePrintInvoked === true), { timeout: 30000 }).toBe(true);
  await popup.emulateMedia({ media: 'print' });
  mkdirSync('test-results', { recursive: true });
  const pdfPath = 'test-results/bookforge-sample.pdf';
  const pdf = await popup.pdf({ path: pdfPath, printBackground: true, preferCSSPageSize: true });
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  const info = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
  const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
  expect(pages, 'PDF must contain multiple rendered pages').toBeGreaterThanOrEqual(4);
  const extracted = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' });
  expect(extracted).toContain('Browser QA Book');
  expect(extracted).toContain('First Chapter');
  expect(extracted).toContain('Second Chapter');
  expect(extracted).toContain('First body');
  expect(extracted).toContain('Second body');

  // The contents page must report the same printed page number as the chapter itself.
  // This fixture's TOC is physical PDF page 3 and Chapter 2 opens on physical page 7.
  const tocPage = execFileSync('pdftotext', ['-f', '3', '-l', '3', '-layout', pdfPath, '-'], { encoding: 'utf8' });
  const chapterTwoPage = execFileSync('pdftotext', ['-f', '7', '-l', '7', '-layout', pdfPath, '-'], { encoding: 'utf8' });
  expect(chapterTwoPage).toContain('CHAPTER 2');
  expect(chapterTwoPage).toMatch(/\b6\b/);
  expect(tocPage).toMatch(/Second Chapter\s+6/);
  await popup.close();
});
