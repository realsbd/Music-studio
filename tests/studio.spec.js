import { test, expect } from '@playwright/test';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createServer } from 'node:http';
import sharp from 'sharp';

const asset = JSON.parse(await readFile(new URL('../assets/studio.json', import.meta.url)));
const ready = async page => {
  await page.bringToFront();
  await page.waitForFunction(() => window.__studio?.loaded, null, { timeout: 60000 });
  await expect(page.locator('#loading-screen')).toBeHidden();
  await page.waitForFunction(() => window.__studio.isSettled(), null, { timeout: 15000 });
};

let cdnServer;
let cdnURL;
test.beforeAll(async () => {
  await mkdir('.artifacts', { recursive: true });
  const body = gzipSync(await readFile('assets/music-studio.glb'), { level: 1 });
  cdnServer = createServer((_request, response) => {
    response.writeHead(200, {
      'Content-Type': 'model/gltf-binary',
      'Content-Encoding': 'gzip',
      'Access-Control-Allow-Origin': 'http://127.0.0.1:4173',
    });
    // A genuine chunked, compressed HTTP response, without Content-Length.
    response.write(body.subarray(0, 32768));
    response.end(body.subarray(32768));
  });
  await new Promise(resolve => cdnServer.listen(0, '127.0.0.1', resolve));
  cdnURL = `http://127.0.0.1:${cdnServer.address().port}/studio.glb`;
});
test.afterAll(async () => {
  if (cdnServer) await new Promise(resolve => cdnServer.close(resolve));
});

test('production output contains the full-detail, fingerprinted model', async () => {
  const files = await readdir('dist/assets');
  const models = files.filter(name => name.endsWith('.glb'));
  expect(models).toHaveLength(1);
  expect(models[0]).toMatch(/^music-studio-[\w-]+\.glb$/);
  expect((await stat(`dist/assets/${models[0]}`)).size).toBe(asset.byteLength);
  expect(asset.byteLength).toBeLessThan(30_000_000);
  expect(asset.byteLength / asset.originalBytes).toBeLessThan(0.3);
  expect(asset.triangles).toBeGreaterThan(asset.originalTriangles * 0.98);
  expect(asset.triangles).toBeLessThanOrEqual(asset.originalTriangles);
  expect(await readdir('dist')).not.toContain('Music_studio.glb');
});

test('desktop loads without a CDN, renders moving smoke, and opens all hotspots', async ({ page }) => {
  const errors = [];
  const external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::\d+)?\/)/, route => {
    external.push(route.request().url());
    return route.abort();
  });
  await page.goto('/');
  await ready(page);
  expect(external).toEqual([]);
  await page.screenshot({ path: '.artifacts/studio-desktop.png' });
  console.log('Desktop render:', await page.evaluate(() => ({
    triangles: __studio.renderer.info.render.triangles,
    drawCalls: __studio.renderer.info.render.calls,
    modelDownloadMs: performance.getEntriesByType('resource').find(entry => entry.name.endsWith('.glb'))?.duration,
    readyMs: performance.now(),
  })));

  // Hold the camera, freeze the RGB glow and hide the pulsing markers so
  // changed pixels can only come from the smoke.
  await page.evaluate(() => {
    __studio.atmosphere.update = () => {};
    __studio.scene.children.filter(child => child.userData.hotspotId).forEach(child => { child.visible = false; });
    __studio.camera.position.set(0, 1.55, 1.2);
    __studio.controls.target.set(0, 1.5, -1.0);
    __studio.controls.update();
  });
  const first = await page.screenshot({ path: '.artifacts/smoke-first.png' });
  const startTime = await page.evaluate(() => __studio.smoke.mesh.material.uniforms.uTime.value);
  await page.waitForFunction(start => __studio.smoke.mesh.material.uniforms.uTime.value > start + 1.5, startTime);
  const second = await page.screenshot({ path: '.artifacts/smoke-second.png' });
  const a = await sharp(first).removeAlpha().raw().toBuffer();
  const b = await sharp(second).removeAlpha().raw().toBuffer();
  let changed = 0;
  for (let i = 0; i < a.length; i += 3) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 8) changed++;
  }
  expect(changed).toBeGreaterThan(100);

  await page.evaluate(() => {
    __studio.scene.children.filter(child => child.userData.hotspotId).forEach(child => { child.visible = true; });
    __studio.reset();
  });
  // Exercise an actual canvas click through the smoke before checking the
  // remaining navigation destinations and their camera transitions.
  const point = await page.evaluate(() => {
    __studio.camera.updateMatrixWorld(true);
    const position = __studio.hotspots.find(hotspot => hotspot.id === 'beatstars').position.clone().project(__studio.camera);
    return { x: (position.x + 1) * innerWidth / 2, y: (1 - position.y) * innerHeight / 2 };
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#overlay.active h2')).toHaveText('Beat Store');
  await expect(page.locator('#overlay.active p').first()).toHaveText(
    'Browse and license exclusive G.LO Beatz directly from the store. Premium instrumentals crafted for artists looking for something different.'
  );
  await page.getByRole('button', { name: 'Back', exact: false }).click();
  await page.waitForFunction(() => __studio.isSettled());
  const panels = [
    ['tv', 'Catalogue & Credits', "Record Producer with a vision, I don't go to work, I put in work I'm the difference. Browse through my catalogue, browse through Toronto history."],
    ['computer', 'Bio & Services', null],
    ['painting', 'Gallery', 'A visual archive of moments, art, and creative milestones.'],
    ['phone', 'Contact', "Ready to lock in? Reach out and let's make it happen."],
  ];
  for (const [id, title, description] of panels) {
    await page.evaluate(id => __studio.clickHotspot(id), id);
    await expect(page.locator('#overlay.active h2')).toHaveText(title);
    if (description) await expect(page.locator('#overlay.active p').first()).toHaveText(description);
    if (id === 'tv') {
      const yearGroups = page.locator('#overlay.active .video-year-group');
      const videoLinks = page.locator('#overlay.active .video-link-card');
      await expect(yearGroups).toHaveCount(6);
      await expect(videoLinks).toHaveCount(74);
      expect(await yearGroups.evaluateAll(groups => groups.map(group => group.querySelectorAll('a').length)))
        .toEqual([9, 10, 30, 12, 9, 4]);
      await expect(videoLinks.first()).toHaveAttribute('href', 'https://www.youtube.com/watch?v=6KfKKQSNewo');
      await expect(videoLinks.last()).toHaveAttribute('href', 'https://www.youtube.com/watch?v=QC-9Ujv4dM8');
      expect(await videoLinks.evaluateAll(links => links.every(link =>
        link.target === '_blank' && link.rel === 'noopener noreferrer'
      ))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('#overlay')).not.toHaveClass('active');
    await page.waitForFunction(() => __studio.isSettled());
  }
  expect(errors).toEqual([]);
});

test('mobile respects reduced motion and resumes smoke when motion is enabled', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await page.goto('http://127.0.0.1:4173/');
    await ready(page);
    await page.screenshot({ path: '.artifacts/studio-mobile.png' });
    const time = await page.evaluate(() => __studio.smoke.mesh.material.uniforms.uTime.value);
    await page.evaluate(() => new Promise(resolve => {
      let frames = 0;
      const next = () => { if (++frames === 12) resolve(); else requestAnimationFrame(next); };
      requestAnimationFrame(next);
    }));
    expect(await page.evaluate(() => __studio.smoke.mesh.material.uniforms.uTime.value)).toBe(time);
    expect(await page.evaluate(() => __studio.renderer.getPixelRatio())).toBeLessThanOrEqual(1.5);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(start => __studio.smoke.mesh.material.uniforms.uTime.value > start + 0.1, time);
    await page.evaluate(() => __studio.clickHotspot('phone'));
    await expect(page.locator('#overlay.active h2')).toHaveText('Contact');
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('a missing model offers retry and loads after the connection recovers', async ({ page }) => {
  let attempts = 0;
  await page.route('**/*.glb', route => {
    attempts++;
    return attempts === 1 ? route.fulfill({ status: 404, body: 'Missing' }) : route.continue();
  });
  await page.goto('/');
  await expect(page.locator('#loading-screen')).toHaveAttribute('data-state', 'error');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.locator('#loading-status')).toContainText('try again');
  await page.getByRole('button', { name: 'Try again' }).click();
  await ready(page);
  expect(attempts).toBe(2);
});

test('compressed CDN responses report finite progress and reach a rendered room', async ({ page }) => {
  await page.route('http://127.0.0.1:4173/assets/*.glb', route => route.fulfill({
    status: 307,
    headers: { Location: cdnURL },
  }));
  await page.addInitScript(() => {
    window.loadingValues = [];
    new MutationObserver(() => {
      const progress = document.getElementById('loading-bar-wrap');
      if (progress) window.loadingValues.push(Number(progress.getAttribute('aria-valuenow')));
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['aria-valuenow'] });
  });
  await page.goto('/');
  await ready(page);
  const values = await page.evaluate(() => window.loadingValues);
  expect(values.length).toBeGreaterThan(2);
  expect(values.every(value => Number.isFinite(value) && value >= 0 && value <= 100)).toBe(true);
  expect(values.at(-1)).toBe(100);
});

test('an HTML asset fallback and unavailable WebGL both show recovery', async ({ page }) => {
  await page.route('**/*.glb', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Missing</title>' }));
  await page.goto('/');
  await expect(page.locator('#loading-screen')).toHaveAttribute('data-state', 'error');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.screenshot({ path: '.artifacts/loading-error.png' });
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return /webgl/.test(type) ? null : getContext.call(this, type, ...args);
    };
  });
  await page.reload();
  await expect(page.locator('#loading-screen')).toHaveAttribute('data-state', 'error');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});
