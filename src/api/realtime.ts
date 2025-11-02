import { Hono } from 'hono';
import type { SQL } from 'bun';
import { generateId } from '../utils/helpers';

interface ClientConnection {
  controller: ReadableStreamDefaultController<Uint8Array>;
  subscriptions: Set<string>;
  lastActive: number;
}

interface RecordEvent {
  action: 'create' | 'update' | 'delete';
  record: any;
}

export class RealtimeAPI {
  private readonly db: SQL;
  private readonly clients: Map<string, ClientConnection>;
  private heartbeatInterval: Timer | null = null;

  constructor(db: SQL) {
    this.db = db;
    this.clients = new Map();
    this.startHeartbeat();
  }

  /**
   * Start heartbeat to keep connections alive and cleanup dead ones
   */
  private startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const timeout = 60000; // 60 seconds

      for (const [clientId, client] of this.clients.entries()) {
        // Check if client is still active
        if (now - client.lastActive > timeout) {
          // Client timed out, cleanup
          this.disconnectClient(clientId);
          continue;
        }

        // Send heartbeat comment to keep connection alive
        try {
          const heartbeat = ': heartbeat\n\n';
          const encoded = new TextEncoder().encode(heartbeat);
          client.controller.enqueue(encoded);
        } catch (error) {
          // Connection is dead, cleanup
          console.log(`💔 Failed to send heartbeat to ${clientId}, disconnecting`);
          this.disconnectClient(clientId);
        }
      }
    }, 30000); // Send heartbeat every 30 seconds
  }

  /**
   * Cleanup client connection
   */
  private disconnectClient(clientId: string) {
    const client = this.clients.get(clientId);
    if (client) {
      try {
        client.controller.close();
      } catch {
        // Already closed, ignore
      }
      this.clients.delete(clientId);
      console.log(`🔌 Client disconnected: ${clientId} (${this.clients.size} active)`);
    }
  }

  /**
   * Broadcast event to subscribed clients
   */
  broadcastEvent(collection: string, action: 'create' | 'update' | 'delete', record: any) {
    const recordId = record.id;
    let broadcastCount = 0;

    for (const [clientId, client] of this.clients.entries()) {
      // Check if client is subscribed to this event
      const wildcardTopic = `${collection}/*`;
      const specificTopic = `${collection}/${recordId}`;

      let shouldSend = false;
      let eventName = '';

      // Check for wildcard subscription
      if (this.hasMatchingSubscription(client.subscriptions, wildcardTopic)) {
        shouldSend = true;
        eventName = wildcardTopic;
      }
      // Check for specific record subscription
      else if (this.hasMatchingSubscription(client.subscriptions, specificTopic)) {
        shouldSend = true;
        eventName = specificTopic;
      }

      if (shouldSend) {
        try {
          const event: RecordEvent = { action, record };
          const eventData = `event: ${eventName}\ndata: ${JSON.stringify(event)}\n\n`;
          const encoded = new TextEncoder().encode(eventData);
          client.controller.enqueue(encoded);
          client.lastActive = Date.now();
          broadcastCount++;
        } catch (error) {
          console.error(`Failed to send event to client ${clientId}:`, error);
          this.disconnectClient(clientId);
        }
      }
    }

    if (broadcastCount > 0) {
      console.log(`📡 Broadcasted ${action} event for ${collection}/${recordId} to ${broadcastCount} client(s)`);
    }
  }

  /**
   * Check if client has a matching subscription (with or without options)
   */
  private hasMatchingSubscription(subscriptions: Set<string>, topic: string): boolean {
    // Check exact match
    if (subscriptions.has(topic)) {
      return true;
    }

    // Check if any subscription starts with the topic (handles topic with options)
    for (const sub of subscriptions) {
      if (sub.startsWith(topic + '?') || sub === topic) {
        return true;
      }
    }

    return false;
  }

  /**
   * Handle realtime connection using native Bun HTTP primitives
   */
  handleNativeRequest(req: Request): Response {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Only handle GET requests for SSE
    if (req.method !== 'GET') {
      return new Response('Method not allowed', { 
        status: 405,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const clientId = 'client_' + generateId();
    console.log(`🔗 New realtime connection: ${clientId}`);

    // Create a readable stream for SSE
    const stream = new ReadableStream({
      start: async (controller) => {
        // Store client connection
        this.clients.set(clientId, {
          controller,
          subscriptions: new Set(),
          lastActive: Date.now(),
        });

        // Send PB_CONNECT event
        const connectEvent = `event: PB_CONNECT\nid: ${clientId}\ndata: ${JSON.stringify({ clientId })}\n\n`;
        controller.enqueue(new TextEncoder().encode(connectEvent));

        console.log(`✅ Client connected: ${clientId} (${this.clients.size} active)`);
      },
      cancel: () => {
        console.log(`🔌 Client cancelled: ${clientId}`);
        this.disconnectClient(clientId);
      },
    });

    // Return SSE response with proper headers including CORS
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
      },
    });
  }

  routes() {
    const app = new Hono();

    // POST /api/realtime - Manage subscriptions
    // (GET is handled by handleNativeRequest in server.ts)
    app.post('/', async (c) => {
      try {
        const body = await c.req.json();
        const { clientId, subscriptions } = body;

        if (!clientId) {
          return c.json(
            {
              code: 400,
              message: 'Missing clientId.',
              data: {},
            },
            400
          );
        }

        if (!Array.isArray(subscriptions)) {
          return c.json(
            {
              code: 400,
              message: 'Invalid subscriptions format.',
              data: {},
            },
            400
          );
        }

        // Check if client exists
        const client = this.clients.get(clientId);
        if (!client) {
          return c.json(
            {
              code: 404,
              message: 'Client not found.',
              data: {},
            },
            404
          );
        }

        // Update client subscriptions
        client.subscriptions = new Set(subscriptions);
        client.lastActive = Date.now();

        console.log(`📝 Updated subscriptions for ${clientId}:`, Array.from(client.subscriptions));

        // Return 204 No Content (PocketBase standard)
        return c.body(null, 204);
      } catch (error: any) {
        return c.json(
          {
            code: 400,
            message: error.message,
            data: {},
          },
          400
        );
      }
    });

    return app;
  }

  /**
   * Cleanup on shutdown
   */
  destroy() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Close all client connections
    for (const clientId of this.clients.keys()) {
      this.disconnectClient(clientId);
    }

    console.log('🛑 Realtime service destroyed');
  }
}
