export class SyncController {
  constructor(localDB, PouchDB, remoteUrl, onStatus) {
    Object.assign(this, { localDB, PouchDB, remoteUrl, onStatus });
    this.generation = 0;
    this.handlers = null;
    this.remote = null;
  }

  disconnect(notify = true) {
    this.generation += 1;
    this.handlers?.cancel();
    this.handlers = null;
    this.remote?.close().catch(() => {});
    this.remote = null;
    if (notify) this.onStatus({ state: 'local', message: 'Local only', detail: 'Your movies are saved in this browser. Connect to sync with CouchDB.' });
  }

  connect(username, password) {
    this.disconnect(false);
    const generation = this.generation;
    const publish = (status) => { if (generation === this.generation) this.onStatus(status); };
    const directions = { push: 'connecting', pull: 'connecting' };
    const updateStatus = (extra = {}) => {
      const states = Object.values(directions);
      if (states.includes('retrying')) {
        publish({ state: 'retrying', message: 'Waiting for connection', detail: 'CouchDB is unavailable. Replication will retry automatically; local editing is still available.', ...extra });
      } else if (states.includes('active')) {
        publish({ state: 'active', message: 'Synchronising', detail: 'Exchanging changes with CouchDB.', ...extra });
      } else if (states.includes('connecting')) {
        publish({ state: 'connecting', message: 'Connecting', detail: 'Opening a connection to your movie database…', ...extra });
      } else {
        publish({ state: 'idle', message: 'Connected · idle', detail: 'Replication is listening for changes. Last exchange is shown below.', ...extra });
      }
    };
    const failure = (direction, error) => {
      if (generation !== this.generation) return;
      if ([401, 403].includes(error?.status)) {
        this.disconnect(false);
        this.onStatus({ state: 'error', message: 'Sign-in required', detail: 'CouchDB refused access. Check your credentials and database permissions. Local editing is still available.' });
      } else {
        directions[direction] = 'retrying';
        updateStatus();
      }
    };
    publish({ state: 'connecting', message: 'Connecting', detail: 'Opening a connection to your movie database…' });
    // Authentication is held only by this in-memory remote instance.
    this.remote = new this.PouchDB(this.remoteUrl, {
      auth: { username, password }, skip_setup: true,
      fetch: (url, options) => this.PouchDB.fetch(url, { ...options, credentials: 'omit' })
    });
    this.handlers = this.localDB.sync(this.remote, { live: true, retry: true, heartbeat: 10000, timeout: 20000 });
    // PouchDB 9's combined sync "paused" event drops the error argument.
    // Observe each replication direction so a network/auth error cannot look like idle.
    for (const direction of ['push', 'pull']) {
      const replication = this.handlers[direction];
      replication.on('requestError', (error) => failure(direction, error));
      replication.on('paused', (error) => {
        if (error) failure(direction, error);
        else { directions[direction] = 'idle'; updateStatus(); }
      });
      replication.on('active', () => { directions[direction] = 'active'; updateStatus(); });
      replication.on('change', (change) => {
        directions[direction] = 'active';
        updateStatus({ detail: `${direction === 'push' ? 'Sent' : 'Received'} ${change.docs?.length || 0} movie change(s).`, exchangedAt: Date.now() });
      });
    }
    this.handlers.on('denied', (error) => {
      if (generation !== this.generation) return;
      this.disconnect(false);
      this.onStatus({ state: 'error', message: 'Change rejected', detail: 'CouchDB rejected a document. Local changes are retained. Check database permissions or validation rules, then reconnect.' });
    });
    this.handlers.on('error', (error) => {
      if (generation !== this.generation) return;
      this.disconnect(false);
      const refused = [401, 403].includes(error?.status);
      this.onStatus({ state: 'error', message: refused ? 'Sign-in required' : 'Sync stopped', detail: refused ? 'CouchDB refused access. Check your credentials and reconnect.' : 'Replication stopped unexpectedly. Your local data is retained; reconnect to try again.' });
    });
  }
}
