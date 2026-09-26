import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { SyncController } from '../src/sync.js';

function fixture() {
  const statuses = [];
  const handles = [];
  class Remote {
    close() { return Promise.resolve(); }
  }
  const local = {
    sync() {
      const handle = new EventEmitter();
      handle.push = new EventEmitter();
      handle.pull = new EventEmitter();
      handle.cancel = () => { handle.cancelled = true; };
      handles.push(handle);
      return handle;
    }
  };
  const sync = new SyncController(local, Remote, 'http://localhost:5984/schema-a', (status) => statuses.push(status));
  sync.connect('test-user', 'test-password');
  return { sync, statuses, handles };
}

test('one failed replication direction cannot be hidden by the other becoming idle', () => {
  const { handles, statuses } = fixture();
  handles[0].push.emit('paused', { status: 0 });
  handles[0].pull.emit('paused');
  assert.equal(statuses.at(-1).state, 'retrying');
  handles[0].push.emit('active');
  assert.equal(statuses.at(-1).state, 'active');
  handles[0].push.emit('paused');
  assert.equal(statuses.at(-1).state, 'idle');
});

test('authentication failures cancel replication immediately and release remote credentials', () => {
  const { sync, handles, statuses } = fixture();
  handles[0].push.emit('requestError', { status: 401 });
  assert.equal(handles[0].cancelled, true);
  assert.equal(sync.remote, null);
  assert.equal(statuses.at(-1).message, 'Sign-in required');
  handles[0].pull.emit('paused');
  assert.equal(statuses.at(-1).message, 'Sign-in required');
});

test('events from cancelled connections cannot overwrite the current connection state', () => {
  const { sync, handles, statuses } = fixture();
  sync.connect('different-user', 'different-password');
  handles[0].pull.emit('requestError', { status: 401 });
  assert.equal(statuses.at(-1).state, 'connecting');
  assert.equal(handles[1].cancelled, undefined);
  sync.disconnect();
  handles[1].pull.emit('active');
  assert.equal(statuses.at(-1).state, 'local');
});

test('terminal authentication errors also produce sign-in feedback', () => {
  const { handles, statuses } = fixture();
  handles[0].emit('error', { status: 403 });
  assert.equal(statuses.at(-1).message, 'Sign-in required');
  assert.equal(handles[0].cancelled, true);
});
