import { Hono } from 'hono';
import type { SQL } from 'bun';
import { sql } from 'bun';

// Default settings structure (simplified version of PocketBase settings)
const defaultSettings = {
  meta: {
    appName: 'PocketBase Bun Server',
    appURL: 'http://localhost:8090',
    hideControls: false,
  },
  logs: {
    maxDays: 7,
  },
  smtp: {
    enabled: false,
    host: '',
    port: 587,
    username: '',
    password: '',
    authMethod: '',
    tls: true,
    localName: '',
  },
  s3: {
    enabled: false,
    bucket: '',
    region: '',
    endpoint: '',
    accessKey: '',
    secret: '',
    forcePathStyle: false,
  },
  backups: {
    cron: '0 0 * * *',
    cronMaxKeep: 5,
    s3: {
      enabled: false,
      bucket: '',
      region: '',
      endpoint: '',
      accessKey: '',
      secret: '',
      forcePathStyle: false,
    },
  },
  googleAuth: {
    enabled: false,
    clientId: '',
    clientSecret: '',
    authURL: '',
    tokenURL: '',
    userApiURL: '',
  },
};

export class SettingsAPI {
  private readonly db: SQL;
  private settings: any;

  constructor(db: SQL) {
    this.db = db;
    this.settings = { ...defaultSettings };
    this.initSettingsTable();
  }

  /**
   * Initialize settings table if it doesn't exist
   */
  private async initSettingsTable() {
    try {
      // Create settings table if not exists
      await this.db`
        CREATE TABLE IF NOT EXISTS _settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          created TEXT NOT NULL,
          updated TEXT NOT NULL
        )
      `;

      // Load settings from database
      const results = await this.db`SELECT * FROM _settings WHERE key = 'app'`;
      if (results && results.length > 0) {
        this.settings = JSON.parse(results[0].value);
      } else {
        // Save default settings
        await this.saveSettings();
      }
    } catch (error) {
      console.error('Failed to initialize settings:', error);
    }
  }

  /**
   * Save settings to database
   */
  private async saveSettings() {
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
    const settingsJson = JSON.stringify(this.settings);

    try {
      // Check if settings exist
      const existing = await this.db`SELECT * FROM _settings WHERE key = 'app'`;
      
      if (existing && existing.length > 0) {
        // Update
        await this.db`
          UPDATE _settings 
          SET value = ${settingsJson}, updated = ${now}
          WHERE key = 'app'
        `;
      } else {
        // Insert
        await this.db`
          INSERT INTO _settings (key, value, created, updated)
          VALUES ('app', ${settingsJson}, ${now}, ${now})
        `;
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
      throw error;
    }
  }

  routes() {
    const app = new Hono();

    // GET /api/settings - Get all settings
    app.get('/', async (c) => {
      try {
        // In a real implementation, you'd check for superuser auth here
        return c.json(this.settings);
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

    // PATCH /api/settings - Update settings
    app.patch('/', async (c) => {
      try {
        // In a real implementation, you'd check for superuser auth here
        const body = await c.req.json();

        // Merge with existing settings (deep merge for nested objects)
        this.settings = this.deepMerge(this.settings, body);

        // Save to database
        await this.saveSettings();

        return c.json(this.settings);
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

    // POST /api/settings/test/s3 - Test S3 connection
    app.post('/test/s3', async (c) => {
      try {
        const body = await c.req.json();
        const filesystem = body.filesystem || 'storage';

        // In a real implementation, test the S3 connection
        // For now, just return success if S3 is enabled
        const s3Config = filesystem === 'backups' 
          ? this.settings.backups?.s3 
          : this.settings.s3;

        if (!s3Config?.enabled) {
          return c.json(
            {
              code: 400,
              message: `S3 is not enabled for ${filesystem}.`,
              data: {},
            },
            400
          );
        }

        // Mock success
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

    // POST /api/settings/test/email - Test email sending
    app.post('/test/email', async (c) => {
      try {
        const body = await c.req.json();
        const { email, template, collection } = body;

        if (!email) {
          return c.json(
            {
              code: 400,
              message: 'Email is required.',
              data: {},
            },
            400
          );
        }

        // In a real implementation, send a test email
        // For now, check if SMTP is enabled
        if (!this.settings.smtp?.enabled) {
          return c.json(
            {
              code: 400,
              message: 'SMTP is not enabled.',
              data: {},
            },
            400
          );
        }

        console.log(`📧 Test email would be sent to: ${email} (template: ${template}, collection: ${collection})`);

        // Mock success
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

    // POST /api/settings/apple/generate-client-secret - Generate Apple OAuth2 client secret
    app.post('/apple/generate-client-secret', async (c) => {
      try {
        const body = await c.req.json();
        const { clientId, teamId, keyId, privateKey, duration } = body;

        // In a real implementation, generate proper Apple client secret JWT
        // For now, return a mock secret
        const mockSecret = Buffer.from(
          JSON.stringify({
            clientId,
            teamId,
            keyId,
            exp: Math.floor(Date.now() / 1000) + (duration || 86400),
          })
        ).toString('base64');

        return c.json({
          secret: mockSecret,
        });
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
   * Deep merge two objects
   */
  private deepMerge(target: any, source: any): any {
    const output = { ...target };
    
    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach(key => {
        if (this.isObject(source[key])) {
          if (!(key in target)) {
            Object.assign(output, { [key]: source[key] });
          } else {
            output[key] = this.deepMerge(target[key], source[key]);
          }
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }
    
    return output;
  }

  private isObject(item: any): boolean {
    return item && typeof item === 'object' && !Array.isArray(item);
  }
}
