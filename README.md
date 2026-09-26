# Reel Local

A small Part B movie manager built with plain JavaScript, PouchDB and your existing CouchDB `schema-a` database. All reads and writes happen locally first. The app supports automatic two-way replication, offline reload and manual conflict resolution.

## Run

Prerequisites: Node.js 22.12+ (Node 24 recommended), npm, a current Chromium browser, and CouchDB at `http://localhost:5984` with the existing `schema-a` database.

1. Run `npm ci`.
2. Run `npm run configure:cors` once. Enter CouchDB administrator credentials in the prompt. This enables CORS for `http://localhost:5173`, preserving other explicit allowed origins. It replaces a wildcard origin if one exists.
3. Run `npm start`.
4. Open **http://localhost:5173**. Keep this exact hostname and port: browser storage belongs to an origin.
5. Choose **Connect database**, enter your CouchDB credentials and let your movies replicate. No credentials are included in this repository.

The app also works before connecting. Passwords are held only in memory; refreshing or disconnecting clears them. After a refresh, connect again to resume replication. A connection loss without refreshing is retried automatically. The port-8000 Fauxton URL is the administration UI, not the replication endpoint.

`npm start` builds and serves the application with offline caching. `npm run dev` provides development hot reload; use the production build for offline-reload testing. If switching to development on the same origin, unregister the service worker in DevTools → Application → Service Workers first. Unregistering the worker does not remove IndexedDB movie data. Stop the active server before starting another on port 5173.

## Use

- Add, search, select, edit and delete movies. Actors and genres are entered one per line. Empty lines and duplicate entries are removed; a title is required.
- Existing document IDs and additional fields are preserved. New movies have UUID-based IDs. Records with titles are displayed; CouchDB design documents are excluded.
- **Ready for offline** confirms that the built application shell is cached. After the first successful visit, it can reload offline. The local movie database persists separately in IndexedDB.
- Local-save messages confirm browser persistence. **Connected · idle** means replication is waiting; it is not proof that every record has reached the server. Use **Last exchange** and CouchDB when checking replication.
- **Needs review** identifies concurrent edits. Select a movie, choose **Review versions**, select a starting version and optionally combine its fields. Saving writes a resolution and removes reviewed losing branches. Unexpected intervening changes or incomplete cleanup remain visible for another review.
- A stale editor keeps your draft and displays the latest stored values. Explicitly choose to retain your draft on that revision before retrying. If the original was deleted, you can save the draft as a new movie.

The local collection remains on this browser profile when you disconnect. Clearing site storage removes local movies, including any unsynchronised edits. First-ever loading needs the static app server. Browser storage limits apply, and live replication runs only while the page is open. No cloud hosting or backend API is included.

## Validation

`npm test` runs focused tests against real in-memory PouchDB databases: input handling, unknown-field/attachment preservation, stale updates, deletion, revision-tree conflicts, concurrent changes and incomplete cleanup. Replication-status tests also cover authentication failures and simultaneous push/pull states.

`npm run test:browser` runs Playwright against the built app in headless Microsoft Edge. Install Edge if it is unavailable. The test server uses port 5173. The full integration suite requires the running CouchDB database, configured CORS and credentials supplied as process environment variables, **not committed to a file**:

```powershell
$testCredential = Get-Credential -Message 'CouchDB test credentials'
$env:COUCHDB_USER = $testCredential.UserName
$env:COUCHDB_PASSWORD = $testCredential.GetNetworkCredential().Password
try { npm run test:browser }
finally {
    Remove-Item Env:COUCHDB_USER, Env:COUCHDB_PASSWORD -ErrorAction SilentlyContinue
    $testCredential = $null
}
```

Integration tests use distinct browser profiles and uniquely labelled `PART-B-TEST` movies. They only delete exact document IDs created by that run; supplied records are not changed. Deleted test records leave normal CouchDB tombstones. With no environment credentials, authenticated integration cases are skipped; local CRUD, layout and failure handling still run. The authentication-failure test expects CouchDB to require authentication and uses a unique nonexistent username so it does not lock out a real account. Server downtime is simulated by blocking database requests in a dedicated browser context.

To check manually, use DevTools → Network → Offline after initial replication, then create, edit and delete labelled test movies. Reconnect to verify propagation in Fauxton. For conflicts, open two different browser profiles, sync the same test movie, take both offline, edit it differently in each and reconnect. Ordinary tabs share IndexedDB and are unsuitable for this test. Offline reload can be checked separately after the **Ready for offline** indicator appears.

## Structure

- `src/movies.js`: document validation, CRUD and conflict resolution; independent of the UI.
- `src/database.js`, `src/sync.js`: local IndexedDB adapter and authenticated HTTP replication lifecycle.
- `src/main.js`, `src/style.css`: accessible native forms/dialogs and responsive library UI.
- `vite.config.js`: local dependency bundling and versioned application-shell service worker generation. Remote database requests and credentials are never cached by the service worker.
- `scripts/configure-cors.ps1`: repeatable local CouchDB CORS configuration with prompted credentials.

Dependency versions are pinned in `package.json` and `package-lock.json`. The `events` package supplies PouchDB's browser event emitter. A `uuid` override pins version 11.1.1, which includes a security fix while retaining the v4 API used by PouchDB; the database and browser tests cover this combination. No report or evaluation is included.
