import './style.css';
import { localDB, movies, PouchDB, REMOTE_URL } from './database.js';
import { StaleDocumentError } from './movies.js';
import { SyncController } from './sync.js';

const $ = (selector) => document.querySelector(selector);
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const strings = (value) => Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
const icon = (name) => {
  const paths = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    library: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 3v18M16 3v18M4 8h4m8 0h4M4 16h4m8 0h4"/>',
    cloud: '<path d="M7 18H6a4 4 0 0 1-.6-8A7 7 0 0 1 19 9a4.5 4.5 0 0 1-.5 9H17M12 20V11m-3 3 3-3 3 3"/>',
    edit: '<path d="m15 4 5 5M4 20l5-1L20 8a3.5 3.5 0 0 0-5-5L4 14z"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    alert: '<path d="m12 3 10 18H2zM12 9v4m0 3v1"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>'
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.library}</svg>`;
};

$('#app').innerHTML = `
  <aside class="sidebar">
    <a class="brand" href="/" aria-label="Reel Local home"><img src="/favicon.svg" alt=""/><span>reel<span class="brand-light">local</span><small>YOUR PERSONAL MOVIE LIBRARY</small></span></a>
    <div class="nav-label">WORKSPACE</div>
    <nav aria-label="Library filters">
      <button id="all-filter" class="nav-item active" aria-pressed="true">${icon('library')}<span>All movies</span><span id="nav-total" class="nav-count">0</span></button>
      <button id="conflict-filter" class="nav-item" aria-pressed="false">${icon('alert')}<span>Needs review</span><span id="nav-conflicts" class="nav-count">0</span></button>
    </nav>
    <div class="sidebar-note"><span class="eyebrow">A LITTLE MORE FREEDOM</span><h2>Good movies.<br>Any connection.</h2><p>Your collection lives here, in your browser. Keep adding, even when you go offline.</p><div class="note-art" aria-hidden="true"><span>R</span><i></i><i></i><i></i></div></div>
    <div class="sidebar-bottom"><span class="status-dot"></span> Saved on this device <span class="version">v1.0</span></div>
  </aside>
  <main>
    <header class="topbar"><span class="breadcrumb">Workspace <span>/</span> Movie library</span><span id="offline-ready" class="pill">Preparing offline access</span></header>
    <section class="page-heading"><div><p class="eyebrow">YOUR COLLECTION, CONNECTED</p><h1>Every movie.<br><em>Always with you.</em></h1><p class="subtitle">A home for your favourites. Ready online and off.</p></div><button id="add-movie" class="button primary">${icon('plus')} Add movie</button></section>
    <section class="sync-strip" aria-label="Database connection">
      <span class="sync-icon">${icon('cloud')}</span><div class="sync-copy"><div class="sync-title"><span id="sync-dot" class="status-dot local"></span><strong id="sync-status" role="status">Local only</strong><span id="network-label" class="quiet"></span></div><p id="sync-detail">Your movies are saved in this browser. Connect to sync with CouchDB.</p><small id="sync-time">No changes exchanged this session</small></div>
      <button id="disconnect" class="text-button" hidden>Disconnect</button><button id="connect" class="button secondary">Connect database ${icon('arrow')}</button>
    </section>
    <div id="notice" class="notice" role="status" hidden></div>
    <section class="collection-heading"><div><h2 id="collection-title">The collection <span id="movie-count">0</span></h2><p id="collection-caption">Made for the movies you want to remember.</p></div><label class="search">${icon('search')}<input id="search" type="search" placeholder="Search movie titles…" aria-label="Search movie titles" /></label></section>
    <div class="collection-layout"><section class="library" aria-label="Movie list"><div class="list-header"><span>MOVIE</span><span>GENRES</span></div><div id="movie-list" role="list"></div><footer class="pagination"><span id="page-info"></span><div><button id="previous" class="icon-button" aria-label="Previous page">←</button><button id="next" class="icon-button" aria-label="Next page">→</button></div></footer></section><aside id="movie-detail" class="detail" aria-label="Movie details"></aside></div>
    <footer class="page-footer"><span>Local first. Ready when you are.</span><span>PouchDB + CouchDB</span></footer>
  </main>
  <dialog id="connection-dialog"><form id="connection-form"><div class="dialog-heading"><div><p class="eyebrow">STAY CONNECTED</p><h2>Connect your database</h2></div><button type="button" class="icon-button" data-close="connection-dialog" aria-label="Close connection dialog">${icon('close')}</button></div><p class="dialog-description">Changes sync automatically while this page is open. Your password stays in memory and is cleared on refresh or disconnect.</p><label>Database<input value="${REMOTE_URL}" readonly /></label><label>Username<input id="username" autocomplete="username" required /></label><label>Password<input id="password" type="password" autocomplete="off" required /></label><div class="dialog-actions"><button type="button" class="button secondary" data-close="connection-dialog">Cancel</button><button class="button primary" type="submit">Connect & sync</button></div></form></dialog>
  <dialog id="editor-dialog"><form id="movie-form"><div class="dialog-heading"><div><p class="eyebrow">MAKE IT PART OF THE COLLECTION</p><h2 id="editor-title">Add a movie</h2></div><button type="button" class="icon-button" data-close="editor-dialog" aria-label="Close movie editor">${icon('close')}</button></div><p class="dialog-description">Saved to this browser first. Shared with CouchDB when connected.</p><label>Movie title<input id="title" required maxlength="500" placeholder="Something worth watching" /></label><div class="form-columns"><label>Actors <span class="label-hint">One per line</span><textarea id="actors" rows="5" placeholder="Actor name"></textarea></label><label>Genres <span class="label-hint">One per line</span><textarea id="genres" rows="5" placeholder="Drama&#10;Adventure"></textarea></label></div><div id="editor-error" class="form-error" role="alert" hidden></div><div id="stale-review" class="stale-review" hidden><strong>Latest saved version</strong><pre id="latest-document"></pre><button type="button" id="rebase" class="button secondary">Keep my draft on this revision</button></div><div class="dialog-actions"><button type="button" class="button secondary" data-close="editor-dialog">Cancel</button><button id="save-movie" class="button primary" type="submit">Save movie</button></div></form></dialog>
  <dialog id="delete-dialog"><form id="delete-form"><p class="eyebrow">REMOVE FROM COLLECTION</p><h2>Delete this movie?</h2><p id="delete-description" class="dialog-description"></p><div id="delete-error" class="form-error" role="alert" hidden></div><div class="dialog-actions"><button type="button" class="button secondary" data-close="delete-dialog">Keep movie</button><button id="confirm-delete" type="submit" class="button danger">Delete movie</button></div></form></dialog>
  <dialog id="conflict-dialog" class="wide-dialog"><form id="conflict-form"><div class="dialog-heading"><div><p class="eyebrow">BRING YOUR CHANGES TOGETHER</p><h2>Review conflicting versions</h2></div><button type="button" class="icon-button" data-close="conflict-dialog" aria-label="Close conflict review">${icon('close')}</button></div><p class="dialog-description">This movie was edited independently. Choose a version, then adjust the fields below to keep the changes you want.</p><div id="conflict-versions" class="conflict-versions"></div><label>Resolved movie title<input id="resolved-title" required maxlength="500" /></label><div class="form-columns"><label>Resolved actors <span class="label-hint">One per line</span><textarea id="resolved-actors" rows="5"></textarea></label><label>Resolved genres <span class="label-hint">One per line</span><textarea id="resolved-genres" rows="5"></textarea></label></div><div id="conflict-error" class="form-error" role="alert" hidden></div><div class="dialog-actions"><button id="reload-conflicts" type="button" class="button secondary">Reload versions</button><button id="resolve-movie" type="submit" class="button primary">Save resolution</button></div></form></dialog>
`;

let documents = [];
let selectedId = null;
let query = '';
let onlyConflicts = false;
let page = 0;
const pageSize = 25;
let editBase = null;
let latestForReview = undefined;
let deleteBase = null;
let conflictSnapshot = null;
let chosenVersion = null;
let latestExchange = null;
let refreshSerial = 0;

function notify(message, error = false) {
  const notice = $('#notice');
  notice.hidden = false;
  notice.classList.toggle('is-error', error);
  notice.textContent = message;
}

function formError(id, message = '') {
  $(id).textContent = message;
  $(id).hidden = !message;
}

function poster(doc, large = false) {
  const hash = [...doc._id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const initials = doc.title.trim().split(/\s+/).slice(0, 2).map((word) => [...word][0] || '').join('').toUpperCase();
  return `<span class="poster ${large ? 'poster-large' : ''} tone-${hash % 5}" aria-hidden="true"><span>${escape(initials || 'M')}</span>${large ? '<small>THE REEL LOCAL COLLECTION</small>' : ''}</span>`;
}

function badges(genres) {
  return strings(genres).map((genre) => `<span class="tag">${escape(genre)}</span>`).join('') || '<span class="quiet">No genres yet</span>';
}

function renderLibrary() {
  const conflicts = documents.filter((doc) => doc._conflicts?.length).length;
  $('#nav-total').textContent = documents.length.toLocaleString();
  $('#nav-conflicts').textContent = conflicts;
  const filtered = documents.filter((doc) => (!onlyConflicts || doc._conflicts?.length) && doc.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  page = Math.min(page, Math.max(0, Math.ceil(filtered.length / pageSize) - 1));
  $('#movie-count').textContent = filtered.length.toLocaleString();
  $('#collection-title').firstChild.textContent = onlyConflicts ? 'Needs review ' : 'The collection ';
  $('#collection-caption').textContent = onlyConflicts ? 'Review edits made independently on different devices.' : 'Made for the movies you want to remember.';
  const visible = filtered.slice(page * pageSize, (page + 1) * pageSize);
  $('#movie-list').innerHTML = visible.length ? visible.map((doc) => `<div role="listitem"><button class="movie-row ${selectedId === doc._id ? 'selected' : ''}" data-movie="${escape(doc._id)}" aria-pressed="${selectedId === doc._id}">${poster(doc)}<span class="movie-name"><strong>${escape(doc.title)}</strong><small>${strings(doc.actors).length} actors${doc._conflicts?.length ? ' <span class="conflict-label">· Needs review</span>' : ''}</small></span><span class="row-genres">${badges(strings(doc.genres).slice(0, 2))}</span><span class="row-arrow">↗</span></button></div>`).join('') : `<div class="empty-state">${icon(onlyConflicts ? 'check' : 'library')}<h3>${query ? 'No matching movies' : onlyConflicts ? 'All clear' : 'Your next favourite starts here'}</h3><p>${query ? 'Try another title.' : onlyConflicts ? 'There are no conflicts to review.' : 'Add your first movie or connect your database to bring your collection here.'}</p></div>`;
  $('#page-info').textContent = filtered.length ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, filtered.length)} of ${filtered.length.toLocaleString()}` : '0 movies';
  $('#previous').disabled = page === 0;
  $('#next').disabled = (page + 1) * pageSize >= filtered.length;
  renderDetail();
}

function renderDetail() {
  const doc = documents.find((item) => item._id === selectedId);
  if (!doc) {
    $('#movie-detail').innerHTML = `<div class="detail-empty">${icon('library')}<p class="eyebrow">IN THE SPOTLIGHT</p><h3>A closer look</h3><p>Select a movie to see its cast, genres and details.</p></div>`;
    return;
  }
  $('#movie-detail').innerHTML = `${poster(doc, true)}<div class="detail-body"><p class="eyebrow">IN THE SPOTLIGHT</p><h2>${escape(doc.title)}</h2><div class="tags">${badges(doc.genres)}</div><h3>THE CAST</h3><ul class="cast-list">${strings(doc.actors).map((actor) => `<li><span class="avatar" aria-hidden="true">${escape([...actor][0] || '?')}</span>${escape(actor)}</li>`).join('') || '<li class="quiet">No actors added yet</li>'}</ul>${doc._conflicts?.length ? `<div class="conflict-callout">${icon('alert')}<p>Independent edits need your review.</p><button id="review-conflicts" class="button secondary">Review versions</button></div>` : ''}<div class="detail-actions"><button id="edit-movie" class="button secondary" ${doc._conflicts?.length ? 'disabled' : ''}>${icon('edit')} Edit movie</button><button id="delete-movie" class="icon-button delete-button" aria-label="Delete selected movie" ${doc._conflicts?.length ? 'disabled' : ''}>${icon('trash')}</button></div><details class="record-details"><summary>Record details</summary><dl><dt>Document ID</dt><dd id="document-id">${escape(doc._id)}</dd><dt>Local revision</dt><dd>${escape(doc._rev)}</dd></dl></details></div>`;
  $('#edit-movie')?.addEventListener('click', () => openEditor(doc));
  $('#delete-movie')?.addEventListener('click', () => {
    deleteBase = doc;
    $('#delete-description').textContent = `“${doc.title}” will be removed locally. This deletion will be shared with CouchDB when connected.`;
    formError('#delete-error');
    $('#delete-dialog').showModal();
  });
  $('#review-conflicts')?.addEventListener('click', () => openConflicts(doc._id));
}

async function refresh() {
  const serial = ++refreshSerial;
  try {
    const next = await movies.list();
    if (serial !== refreshSerial) return;
    documents = next;
    if (!selectedId || !documents.some((doc) => doc._id === selectedId)) selectedId = documents[0]?._id || null;
    renderLibrary();
  } catch (error) { notify(`Could not read local movies: ${error.message}`, true); }
}

function setFilter(conflicts) {
  onlyConflicts = conflicts;
  page = 0;
  for (const [id, active] of [['#all-filter', !conflicts], ['#conflict-filter', conflicts]]) {
    $(id).classList.toggle('active', active);
    $(id).setAttribute('aria-pressed', String(active));
  }
  renderLibrary();
}

function openEditor(doc = null) {
  editBase = doc ? structuredClone(doc) : null;
  latestForReview = undefined;
  $('#editor-title').textContent = doc ? 'Edit movie' : 'Add a movie';
  $('#title').value = doc?.title || '';
  $('#actors').value = strings(doc?.actors).join('\n');
  $('#genres').value = strings(doc?.genres).join('\n');
  $('#stale-review').hidden = true;
  formError('#editor-error');
  $('#editor-dialog').showModal();
  $('#title').focus();
}

function inputFields(prefix = '') {
  return { title: $(`#${prefix}title`).value, actors: $(`#${prefix}actors`).value, genres: $(`#${prefix}genres`).value };
}

function showStaleReview(latest) {
  latestForReview = latest;
  $('#stale-review').hidden = false;
  $('#latest-document').textContent = latest ? JSON.stringify({ title: latest.title, actors: latest.actors, genres: latest.genres }, null, 2) : 'The original movie has been deleted.';
  $('#rebase').disabled = Boolean(latest?._conflicts?.length);
  $('#rebase').textContent = latest?._conflicts?.length ? 'Resolve the movie conflict before editing' : latest ? 'Keep my draft on this revision' : 'Save my draft as a new movie';
}

$('#movie-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#save-movie');
  button.disabled = true;
  try {
    const saved = await movies.save(editBase, inputFields());
    selectedId = saved._id;
    $('#editor-dialog').close();
    notify('Movie saved on this device. Replication will share it when connected.');
    await refresh();
  } catch (error) {
    formError('#editor-error', error.message);
    if (error instanceof StaleDocumentError) showStaleReview(error.latest);
  } finally { button.disabled = false; }
});

$('#rebase').addEventListener('click', () => {
  editBase = latestForReview ? structuredClone(latestForReview) : null;
  $('#stale-review').hidden = true;
  formError('#editor-error');
});

$('#delete-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#confirm-delete').disabled = true;
  try {
    await movies.remove(deleteBase);
    $('#delete-dialog').close();
    notify('Movie deleted on this device. The deletion will replicate when connected.');
    await refresh();
  } catch (error) { formError('#delete-error', error instanceof StaleDocumentError ? 'This movie changed or was deleted. Close this dialog and review its latest details before deleting.' : error.message); }
  finally { $('#confirm-delete').disabled = false; }
});

function chooseConflictVersion(index) {
  chosenVersion = conflictSnapshot.versions[index];
  $('#resolved-title').value = chosenVersion.title;
  $('#resolved-actors').value = strings(chosenVersion.actors).join('\n');
  $('#resolved-genres').value = strings(chosenVersion.genres).join('\n');
}

async function openConflicts(id) {
  try {
    conflictSnapshot = await movies.conflictSnapshot(id);
    $('#conflict-versions').innerHTML = conflictSnapshot.versions.map((doc, index) => `<label class="version-card"><span><input type="radio" name="conflict-version" value="${index}" ${index === 0 ? 'checked' : ''}/> ${index === 0 ? 'Current displayed version' : `Alternative ${index}`}</span><strong>${escape(doc.title)}</strong><small>Actors: ${escape(strings(doc.actors).join(', ') || 'None')}</small><small>Genres: ${escape(strings(doc.genres).join(', ') || 'None')}</small><code>${escape(doc._rev)}</code></label>`).join('');
    chooseConflictVersion(0);
    formError('#conflict-error');
    if (!$('#conflict-dialog').open) $('#conflict-dialog').showModal();
  } catch (error) {
    if ($('#conflict-dialog').open) formError('#conflict-error', error.message);
    else notify(error.message, true);
  }
}

$('#conflict-versions').addEventListener('change', (event) => {
  if (event.target.name === 'conflict-version') chooseConflictVersion(Number(event.target.value));
});
$('#reload-conflicts').addEventListener('click', () => {
  if (window.confirm('Reload the latest versions? This replaces the resolution fields currently shown.')) openConflicts(conflictSnapshot.winner._id);
});
$('#conflict-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#resolve-movie').disabled = true;
  try {
    const doc = await movies.resolve(conflictSnapshot, chosenVersion, inputFields('resolved-'));
    selectedId = doc._id;
    $('#conflict-dialog').close();
    notify('Conflict resolved on this device. The resolution will replicate when connected.');
    await refresh();
  } catch (error) { formError('#conflict-error', `${error.message} Your resolution fields are preserved.`); }
  finally { $('#resolve-movie').disabled = false; }
});

const sync = new SyncController(localDB, PouchDB, REMOTE_URL, (status) => {
  $('#sync-status').textContent = status.message;
  $('#sync-detail').textContent = status.detail;
  $('#sync-dot').className = `status-dot ${status.state}`;
  $('#disconnect').hidden = ['local', 'error'].includes(status.state);
  $('#connect').innerHTML = `${icon('cloud')} ${['local', 'error'].includes(status.state) ? 'Connect database' : 'Connection settings'}`;
  if (status.exchangedAt) latestExchange = status.exchangedAt;
  if (latestExchange) $('#sync-time').textContent = `Last exchange: ${new Date(latestExchange).toLocaleTimeString()}`;
});

$('#connect').addEventListener('click', () => $('#connection-dialog').showModal());
$('#disconnect').addEventListener('click', () => sync.disconnect());
$('#connection-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const username = $('#username').value.trim();
  const password = $('#password').value;
  if (!username || !password) return;
  sync.connect(username, password);
  $('#connection-form').reset();
  $('#connection-dialog').close();
});
$('#connection-dialog').addEventListener('close', () => $('#connection-form').reset());

document.addEventListener('click', (event) => {
  const close = event.target.closest('[data-close]');
  if (close) $(`#${close.dataset.close}`).close();
  const row = event.target.closest('[data-movie]');
  if (row) { selectedId = row.dataset.movie; renderLibrary(); }
});
$('#add-movie').addEventListener('click', () => openEditor());
$('#all-filter').addEventListener('click', () => setFilter(false));
$('#conflict-filter').addEventListener('click', () => setFilter(true));
$('#search').addEventListener('input', (event) => { query = event.target.value.trim(); page = 0; renderLibrary(); });
$('#previous').addEventListener('click', () => { page -= 1; renderLibrary(); });
$('#next').addEventListener('click', () => { page += 1; renderLibrary(); });

function networkStatus() {
  $('#network-label').textContent = navigator.onLine ? '' : 'Browser offline';
}
window.addEventListener('online', networkStatus);
window.addEventListener('offline', networkStatus);
networkStatus();

let refreshTimer;
localDB.changes({ since: 'now', live: true, include_docs: false, style: 'all_docs' })
  .on('change', () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 100); })
  .on('error', (error) => notify(`Local database updates could not be monitored: ${error.message}`, true));
await refresh();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  try {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    $('#offline-ready').innerHTML = `${icon('check')} Ready for offline`;
    $('#offline-ready').classList.add('ready');
  } catch { $('#offline-ready').textContent = 'Offline reload unavailable'; }
} else {
  $('#offline-ready').textContent = 'Dev mode · use npm start for offline reload';
}
