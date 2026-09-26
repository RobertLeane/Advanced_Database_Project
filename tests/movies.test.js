import { test } from 'node:test';
import assert from 'node:assert/strict';
import PouchDB from 'pouchdb-core';
import memory from 'pouchdb-adapter-memory';
import { MovieStore, buildMovie, parseLines, StaleDocumentError } from '../src/movies.js';

PouchDB.plugin(memory);

function fixture(t) {
  const db = new PouchDB(`test-${crypto.randomUUID()}`, { adapter: 'memory' });
  t.after(() => db.destroy());
  return { db, store: new MovieStore(db) };
}

const fields = (title = 'Part B test movie') => ({ title, actors: 'Actor One\nActor Two', genres: 'Drama' });

async function createConflict(db, id = 'test:conflict') {
  // Import two genuine leaf branches with shared ancestry, as replication does.
  await db.bulkDocs([
    { _id: id, _rev: '2-aaaa', _revisions: { start: 2, ids: ['aaaa', 'root'] }, title: 'Version A', actors: ['Actor A'], genres: ['Drama'], extra: { source: 'A' } },
    { _id: id, _rev: '2-bbbb', _revisions: { start: 2, ids: ['bbbb', 'root'] }, title: 'Version B', actors: ['Actor B'], genres: ['Comedy'], extra: { source: 'B' } }
  ], { new_edits: false });
  return id;
}

test('input trims title and lines, removes blanks and duplicates, and rejects empty titles', () => {
  assert.deepEqual(parseLines(' Actor A \r\n\nActor B\nActor A'), ['Actor A', 'Actor B']);
  assert.deepEqual(buildMovie(null, { title: ' Test ', actors: ' A \n', genres: '' }, 'movie:test'), { _id: 'movie:test', title: 'Test', actors: ['A'], genres: [] });
  assert.throws(() => buildMovie(null, fields('  ')), /title/);
});

test('editing preserves IDs, revisions, unknown fields and attachments without mutating input', async (t) => {
  const { db, store } = fixture(t);
  const original = { _id: '123', title: 'Original', actors: [], genres: [], year: 1997, metadata: { rating: 4 }, _attachments: { 'note.txt': { content_type: 'text/plain', data: Buffer.from('keep this').toString('base64') } } };
  await db.put(original);
  const base = await store.get('123');
  const saved = await store.save(base, fields());
  assert.equal(saved._id, '123');
  assert.notEqual(saved._rev, base._rev);
  assert.equal(base.title, 'Original');
  assert.equal(saved.year, 1997);
  assert.deepEqual(saved.metadata, { rating: 4 });
  assert.equal((await db.getAttachment('123', 'note.txt')).toString(), 'keep this');
});

test('new movies use distinct UUID IDs; listing ignores design documents and deleted records', async (t) => {
  const { db, store } = fixture(t);
  const one = await store.save(null, fields('A'));
  const two = await store.save(null, fields('B'));
  assert.match(one._id, /^movie:[0-9a-f-]{36}$/);
  assert.notEqual(one._id, two._id);
  await db.put({ _id: '_design/test', title: 'Not a movie' });
  await store.remove(one);
  assert.deepEqual((await store.list()).map((doc) => doc._id), [two._id]);
  assert.equal(await store.get(one._id), null);
});

test('stale edits and deletes reject without overwriting a newer version or input draft', async (t) => {
  const { store } = fixture(t);
  const base = await store.save(null, fields());
  await store.save(base, fields('Newer version'));
  const draft = fields('My unsaved draft');
  await assert.rejects(store.save(base, draft), (error) => error instanceof StaleDocumentError && error.latest.title === 'Newer version');
  await assert.rejects(store.remove(base), StaleDocumentError);
  assert.equal(draft.title, 'My unsaved draft');
  assert.equal((await store.get(base._id)).title, 'Newer version');
});

test('a stale draft cannot silently resurrect a deleted movie', async (t) => {
  const { store } = fixture(t);
  const base = await store.save(null, fields());
  await store.remove(base);
  await assert.rejects(store.save(base, fields('Resurrect')), (error) => error instanceof StaleDocumentError && error.latest === null);
});

test('resolves a real revision tree, preserves chosen extra fields and removes losing leaves', async (t) => {
  const { db, store } = fixture(t);
  const id = await createConflict(db);
  const snapshot = await store.conflictSnapshot(id);
  assert.equal(snapshot.versions.length, 2);
  await assert.rejects(store.remove(snapshot.winner), StaleDocumentError);
  await assert.rejects(store.save(snapshot.winner, fields()), StaleDocumentError);
  const selected = snapshot.versions.find((doc) => doc.title === 'Version A');
  const result = await store.resolve(snapshot, selected, { title: 'Combined', actors: 'Actor A\nActor B', genres: 'Drama\nComedy' });
  assert.equal(result.title, 'Combined');
  assert.deepEqual(result.actors, ['Actor A', 'Actor B']);
  assert.deepEqual(result.extra, { source: 'A' });
  assert.equal(result._conflicts, undefined);
  const leaves = await db.get(id, { open_revs: 'all' });
  assert.equal(leaves.filter((leaf) => !leaf.ok._deleted).length, 1);
});

test('a new conflicting branch invalidates the reviewed snapshot without deleting anything', async (t) => {
  const { db, store } = fixture(t);
  const id = await createConflict(db);
  const snapshot = await store.conflictSnapshot(id);
  await db.bulkDocs([{ _id: id, _rev: '2-cccc', _revisions: { start: 2, ids: ['cccc', 'root'] }, title: 'Version C', actors: [], genres: [] }], { new_edits: false });
  await assert.rejects(store.resolve(snapshot, snapshot.versions[0], fields('Merge')), StaleDocumentError);
  assert.equal((await store.conflictSnapshot(id)).versions.length, 3);
});

test('partial conflict cleanup is surfaced and its unresolved leaf remains recoverable', async (t) => {
  const { db, store } = fixture(t);
  const id = await createConflict(db);
  const snapshot = await store.conflictSnapshot(id);
  const bulkDocs = db.bulkDocs.bind(db);
  db.bulkDocs = async (docs, ...rest) => Array.isArray(docs) && docs.every((doc) => doc._deleted) ? docs.map(() => ({ error: 'conflict', status: 409 })) : bulkDocs(docs, ...rest);
  await assert.rejects(store.resolve(snapshot, snapshot.versions[0], fields('My saved merge')), /cleanup was incomplete/);
  const remaining = await store.get(id);
  assert.equal(remaining.title, 'My saved merge');
  assert.equal(remaining._conflicts.length, 1);
});

test('a branch arriving during resolution is retained for another review', async (t) => {
  const { db, store } = fixture(t);
  const id = await createConflict(db);
  const snapshot = await store.conflictSnapshot(id);
  const put = db.put.bind(db);
  db.put = async (doc) => {
    const result = await put(doc);
    await db.bulkDocs([{ _id: id, _rev: '2-cccc', _revisions: { start: 2, ids: ['cccc', 'root'] }, title: 'Arrived during resolution', actors: [], genres: [] }], { new_edits: false });
    return result;
  };
  await assert.rejects(store.resolve(snapshot, snapshot.versions[0], fields('Merged')), /another edit arrived/);
  assert.equal((await store.conflictSnapshot(id)).versions.length, 3);
});
