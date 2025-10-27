import { Hono } from 'hono';
import type { SQL } from 'bun';

interface HealthCheckResponse {
  code: number;
  message: string;
  data: Record<string, any>;
}

export class HealthAPI {
  private readonly db: SQL;

  constructor(db: SQL) {
    this.db = db;
  }

  routes() {
    const app = new Hono();

    // Health check endpoint
    app.get('/', async (c) => {
      try {
        // Test database connection
        await this.db`SELECT 1`;

        const response: HealthCheckResponse = {
          code: 200,
          message: 'API is healthy.',
          data: {
            canBackup: true, // Basic implementation always returns true
          },
        };

        return c.json(response);
      } catch (error: any) {
        const response: HealthCheckResponse = {
          code: 500,
          message: 'Database connection failed.',
          data: {
            error: error.message,
          },
        };

        return c.json(response, 500);
      }
    });

    return app;
  }
}
