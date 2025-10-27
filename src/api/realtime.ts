import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import type { SQL } from 'bun';
import { generateId } from '../utils/helpers';

interface ClientConnection {
  controller: ReadableStreamDefaultController;
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
          client.controller.enqueue(': heartbeat\n\n');
          client.lastActive = now;
        } catch {
          // Connection is dead, cleanup
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
          client.controller.enqueue(eventData);
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

  routes() {
    const app = new Hono();

    // GET /api/realtime - Open SSE connection
    app.get('/', (c) => {
      // Generate unique client ID
      const clientId = 'client_' + generateId();

      console.log(`🔗 New realtime connection: ${clientId}`);

      // Set SSE headers before streaming
      c.header('Content-Type', 'text/event-stream');
      c.header('Cache-Control', 'no-cache');
      c.header('Connection', 'keep-alive');
      c.header('X-Accel-Buffering', 'no');

      return stream(c, async (stream) => {
        // Set SSE headers before streaming
        stream.onAbort(() => {
          console.log(`🔌 Client aborted: ${clientId}`);
          this.disconnectClient(clientId);
        });

        // Store client connection with a write function
        const writeToClient = (data: string) => {
          try {
            stream.write(data);
          } catch (error) {
            console.error(`Failed to write to client ${clientId}:`, error);
            this.disconnectClient(clientId);
          }
        };

        this.clients.set(clientId, {
          controller: {
            enqueue: writeToClient,
            close: () => {
              // Stream will be closed automatically
            },
          } as any,
          subscriptions: new Set(),
          lastActive: Date.now(),
        });

        // Send PB_CONNECT event with clientId as lastEventId
        await stream.writeln(`event: PB_CONNECT`);
        await stream.writeln(`id: ${clientId}`);
        await stream.writeln(`data: ${JSON.stringify({ clientId })}`);
        await stream.writeln('');

        console.log(`✅ Client connected: ${clientId} (${this.clients.size} active)`);

        // Keep the connection open indefinitely
        // We don't need to do anything here - the stream stays open until the client disconnects
        // or we explicitly close it via disconnectClient()
        await new Promise(() => {}); // Never resolves, keeps connection open
      });
    });

    // POST /api/realtime - Manage subscriptions
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
