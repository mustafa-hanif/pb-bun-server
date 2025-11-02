import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { RecordsAPI } from './api/records';
import { FilesAPI } from './api/files';
import { BatchAPI } from './api/batch';
import { AuthAPI } from './api/auth';
import { RealtimeAPI } from './api/realtime';
import { HealthAPI } from './api/health';
import { SettingsAPI } from './api/settings';
import { SQL } from 'bun';

const app = new Hono();

// Use Bun's new unified SQL API - can easily switch between SQLite, PostgreSQL, or MySQL
const db = new SQL('sqlite://data.db');

// Enable CORS for frontend development with proper configuration
app.use('/*', cors({
  origin: '*', // Allow all origins (configure specific origins in production)
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposeHeaders: ['Content-Length', 'Content-Range', 'X-Total-Count'],
  credentials: true,
  maxAge: 86400, // Cache preflight for 24 hours
}));

// Health API
const healthAPI = new HealthAPI(db);
app.route('/api/health', healthAPI.routes());

// Realtime API (created first, no dependencies)
const realtimeAPI = new RealtimeAPI(db);
// Mount POST handler for subscriptions (GET handled natively in fetch)
app.route('/api/realtime', realtimeAPI.routes());

// Records API (with realtime support)
const recordsAPI = new RecordsAPI(db, realtimeAPI);
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

// Settings API
const settingsAPI = new SettingsAPI(db);
app.route('/api/settings', settingsAPI.routes());

console.log('🚀 PocketBase-compatible server running on http://localhost:8090');

// Use Bun's native server with custom fetch handler for realtime
export default {
  port: 8090,
  fetch: async (req: Request) => {
    const url = new URL(req.url);
    
    // Handle realtime endpoint with native Bun response (GET and OPTIONS)
    if (url.pathname === '/api/realtime' && (req.method === 'GET' || req.method === 'OPTIONS')) {
      return realtimeAPI.handleNativeRequest(req);
    }
    
    // Handle realtime POST (subscriptions) with Hono (includes CORS middleware)
    if (url.pathname === '/api/realtime' && req.method === 'POST') {
      return app.fetch(req);
    }
    
    // All other routes through Hono
    return app.fetch(req);
  },
};
