import { test, expect } from '@playwright/test';

const username = process.env.COUCHDB_USER;
const password = process.env.COUCHDB_PASSWORD;
const baseUrl = 'http://localhost:5984/schema-a';
const authorization = `Basic ${Buffer.from(`${username || ''}:${password || ''}`).toString('base64')}`;
const run = `PART-B-TEST-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const createdIds = new Set();

async function remote(path = '', method = 'GET', body) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { Authorization: authorization, Accept: 'application/json', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error(`CouchDB ${method} failed (${response.status})`);
  return response.json();
}

async function seed(suffix, extra = {}) {
  const id = `part-b-test:${run}:${suffix}`;
  createdIds.add(id);
  await remote(`/${encodeURIComponent(id)}`, 'PUT', { _id: id, title: `${run} ${suffix}`, actors: ['Test Actor'], genres: ['Test'], ...extra });
  return id;
}

async function connect(page, suppliedPassword = password, suppliedUsername = username || 'admin') {
  await page.locator('#connect').click();
  await page.getByLabel('Username', { exact: true }).fill(suppliedUsername);
  await page.getByLabel('Password', { exact: true }).fill(suppliedPassword);
  await page.getByRole('button', { name: 'Connect & sync', exact: true }).click();
}

async function selectMovie(page, title) {
  await page.getByRole('searchbox').fill(title);
  await page.locator('.movie-row').filter({ hasText: title }).first().click();
  await expect(page.locator('#movie-detail h2')).toHaveText(title);
}

async function addMovie(page, title) {
  await page.getByRole('button', { name: 'Add movie', exact: true }).click();
  await page.getByLabel('Movie title', { exact: true }).fill(title);
  await page.locator('#actors').fill('Actor A\nActor B');
  await page.locator('#genres').fill('Drama\nAdventure');
  await page.getByRole('button', { name: 'Save movie', exact: true }).click();
  await expect(page.locator('#editor-dialog')).not.toBeVisible();
  await expect(page.locator('#movie-detail h2')).toHaveText(title);
  await page.locator('.record-details summary').click();
  const id = await page.locator('#document-id').textContent();
  createdIds.add(id);
  return id;
}

async function editTitle(page, currentTitle, nextTitle) {
  await selectMovie(page, currentTitle);
  await page.getByRole('button', { name: 'Edit movie', exact: true }).click();
  await page.getByLabel('Movie title', { exact: true }).fill(nextTitle);
  await page.getByRole('button', { name: 'Save movie', exact: true }).click();
  await expect(page.locator('#editor-dialog')).not.toBeVisible();
}

test.afterAll(async () => {
  if (!username || !password) return;
  // Delete only the exact documents this run created. Never scan or edit supplied movies.
  for (const id of createdIds) {
    const response = await fetch(`${baseUrl}/${encodeURIComponent(id)}?open_revs=all`, { headers: { Authorization: authorization, Accept: 'application/json' } });
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`Test cleanup could not read ${id}`);
    const leaves = await response.json();
    const deletions = leaves.filter((leaf) => leaf.ok && !leaf.ok._deleted).map((leaf) => ({ _id: id, _rev: leaf.ok._rev, _deleted: true }));
    if (deletions.length) {
      const results = await remote('/_bulk_docs', 'POST', { docs: deletions });
      if (results.some((result) => result.error)) throw new Error(`Test cleanup failed for ${id}`);
    }
  }
});

test('local CRUD survives offline reload and accepts safely rendered text', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.locator('#offline-ready')).toHaveText('Ready for offline');
  const title = `${run} local <script>alert(1)</script>`;
  await addMovie(page, title);
  await context.setOffline(true);
  await page.reload();
  await selectMovie(page, title);
  await editTitle(page, title, `${run} local updated`);
  await page.reload();
  await selectMovie(page, `${run} local updated`);
  await page.getByRole('button', { name: 'Delete selected movie', exact: true }).click();
  await page.getByRole('button', { name: 'Delete movie', exact: true }).click();
  await page.reload();
  await page.getByRole('searchbox').fill(run);
  await expect(page.locator('.movie-row')).toHaveCount(0);
});

test('offline create, update and delete automatically replicate after reconnection', async ({ page, context }) => {
  test.skip(!username || !password, 'Set COUCHDB_USER and COUCHDB_PASSWORD to enable CouchDB integration tests.');
  const updateId = await seed('update', { extra: { keep: true } });
  const deleteId = await seed('delete');
  await page.goto('/');
  await connect(page);
  await selectMovie(page, `${run} update`);
  await selectMovie(page, `${run} delete`);
  await context.setOffline(true);
  const createId = await addMovie(page, `${run} offline-created`);
  await editTitle(page, `${run} update`, `${run} offline-updated`);
  await selectMovie(page, `${run} delete`);
  await page.getByRole('button', { name: 'Delete selected movie', exact: true }).click();
  await page.getByRole('button', { name: 'Delete movie', exact: true }).click();
  await expect(page.locator('#delete-dialog')).not.toBeVisible();
  expect((await remote(`/${encodeURIComponent(updateId)}`)).title).toBe(`${run} update`);
  expect((await remote(`/${encodeURIComponent(deleteId)}`)).title).toBe(`${run} delete`);
  expect((await fetch(`${baseUrl}/${encodeURIComponent(createId)}`, { headers: { Authorization: authorization } })).status).toBe(404);
  await context.setOffline(false);
  await expect.poll(async () => (await remote(`/${encodeURIComponent(updateId)}`)).title, { timeout: 45000 }).toBe(`${run} offline-updated`);
  await expect.poll(async () => (await fetch(`${baseUrl}/${encodeURIComponent(createId)}`, { headers: { Authorization: authorization } })).status).toBe(200);
  await expect.poll(async () => (await fetch(`${baseUrl}/${encodeURIComponent(deleteId)}`, { headers: { Authorization: authorization } })).status).toBe(404);
  expect((await remote(`/${encodeURIComponent(updateId)}`)).extra).toEqual({ keep: true });
  await page.reload();
  await selectMovie(page, `${run} offline-created`);
  await expect(page.locator('#sync-status')).toHaveText('Local only');
  expect(await page.evaluate(() => Object.values(localStorage).some((value) => /password|authorization/i.test(value)))).toBe(false);
});

test('two browser profiles conflict, expose versions, resolve and converge', async ({ browser }) => {
  test.skip(!username || !password, 'CouchDB credentials required.');
  const id = await seed('conflict', { extra: 'preserve this' });
  const first = await browser.newContext();
  const second = await browser.newContext();
  try {
    const a = await first.newPage();
    const b = await second.newPage();
    for (const page of [a, b]) {
      await page.goto('http://localhost:5173');
      await connect(page);
      await selectMovie(page, `${run} conflict`);
    }
    await first.setOffline(true);
    await second.setOffline(true);
    await editTitle(a, `${run} conflict`, `${run} profile A`);
    await editTitle(b, `${run} conflict`, `${run} profile B`);
    await first.setOffline(false);
    await second.setOffline(false);
    await expect.poll(async () => (await remote(`/${encodeURIComponent(id)}?conflicts=true`))._conflicts?.length || 0, { timeout: 45000 }).toBe(1);
    await expect(a.locator('#review-conflicts')).toBeVisible();
    await a.locator('#review-conflicts').click();
    await expect(a.locator('.version-card')).toHaveCount(2);
    await a.locator('#resolved-title').fill(`${run} resolved`);
    await a.locator('#resolved-actors').fill('Actor from A\nActor from B');
    await a.getByRole('button', { name: 'Save resolution', exact: true }).click();
    await expect(a.locator('#conflict-dialog')).not.toBeVisible();
    await expect.poll(async () => (await remote(`/${encodeURIComponent(id)}?conflicts=true`))._conflicts || []).toEqual([]);
    await selectMovie(b, `${run} resolved`);
    await expect(b.locator('#review-conflicts')).not.toBeVisible();
    const result = await remote(`/${encodeURIComponent(id)}`);
    expect(result.actors).toEqual(['Actor from A', 'Actor from B']);
    expect(result.extra).toBe('preserve this');
  } finally { await first.close(); await second.close(); }
});

test('authentication failure and unavailable server retain local CRUD', async ({ browser }) => {
  // Block service workers here so Playwright can intercept every database request.
  // The offline-reload tests separately exercise the real service worker.
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    await page.goto('http://localhost:5173');
    // A unique nonexistent account avoids triggering the real administrator's lockout.
    await connect(page, 'deliberately-invalid-part-b-test-password', `part-b-invalid-${run}`);
    await expect(page.locator('#sync-status')).toHaveText('Sign-in required');
    await addMovie(page, `${run} invalid-auth-local`);
    await context.route('http://localhost:5984/**', (route) => route.abort('connectionrefused'));
    await connect(page, password || 'server-unavailable-test', username || `part-b-offline-${run}`);
    await expect(page.locator('#sync-status')).toHaveText('Waiting for connection');
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    await addMovie(page, `${run} unavailable-local`);
  } finally { await context.close(); }
});

test('a replicated update preserves an open draft and requires explicit review', async ({ page }) => {
  test.skip(!username || !password, 'CouchDB credentials required.');
  const id = await seed('stale');
  await page.goto('/');
  await connect(page);
  await selectMovie(page, `${run} stale`);
  await page.getByRole('button', { name: 'Edit movie', exact: true }).click();
  await page.getByLabel('Movie title', { exact: true }).fill(`${run} my draft`);
  const current = await remote(`/${encodeURIComponent(id)}`);
  await remote(`/${encodeURIComponent(id)}`, 'PUT', { ...current, title: `${run} remote update`, addedRemotely: 'preserve' });
  await expect(page.locator('#movie-detail h2')).toHaveText(`${run} remote update`);
  await page.getByRole('button', { name: 'Save movie', exact: true }).click();
  await expect(page.locator('#editor-error')).toContainText('Your draft is still here');
  await expect(page.getByLabel('Movie title', { exact: true })).toHaveValue(`${run} my draft`);
  await page.getByRole('button', { name: 'Keep my draft on this revision', exact: true }).click();
  await page.getByRole('button', { name: 'Save movie', exact: true }).click();
  await expect.poll(async () => (await remote(`/${encodeURIComponent(id)}`)).title).toBe(`${run} my draft`);
  expect((await remote(`/${encodeURIComponent(id)}`)).addedRemotely).toBe('preserve');
});

test('mobile layout fits a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await addMovie(page, `${run} mobile`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
