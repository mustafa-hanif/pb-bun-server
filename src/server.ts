import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { RecordsAPI } from './api/records';
import { FilesAPI } from './api/files';
import { BatchAPI } from './api/batch';
import { AuthAPI } from './api/auth';
import { SQL } from 'bun';

const app = new Hono();

// Use Bun's new unified SQL API - can easily switch between SQLite, PostgreSQL, or MySQL
const db = new SQL('sqlite://data.db');

// Enable CORS for frontend development
app.use('/*', cors());

// Health check
app.get('/api/health', (c) => {
  return c.json({ code: 200, message: 'OK' });
});

// Records API
const recordsAPI = new RecordsAPI(db);
app.route('/api/collections', recordsAPI.routes());

// Files API
const filesAPI = new FilesAPI(db);
app.route('/api/files', filesAPI.routes());

// Batch API
const batchAPI = new BatchAPI(db);
app.route('/api/batch', batchAPI.routes());

// Auth API (mounted on collections for auth endpoints)
const authAPI = new AuthAPI(db);
app.route('/api/collections', authAPI.routes());

console.log('🚀 PocketBase-compatible server running on http://localhost:8090');

export default {
  port: 8090,
  fetch: app.fetch,
};
