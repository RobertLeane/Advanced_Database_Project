import PouchDB from 'pouchdb-browser';
import { MovieStore } from './movies.js';

export const REMOTE_URL = 'http://localhost:5984/schema-a';
export const localDB = new PouchDB('reel-local-schema-a', { adapter: 'idb' });
export const movies = new MovieStore(localDB);
export { PouchDB };
