import { Hono } from 'hono';
import type { SQL } from 'bun';
import { sql } from 'bun';
import { generateId, getCurrentTimestamp } from '../utils/helpers';

interface AuthResponse {
  token: string;
  record: any;
}

export class AuthAPI {
  private readonly db: SQL;

  constructor(db: SQL) {
    this.db = db;
  }

  routes() {
    const app = new Hono();

    // List auth methods
    app.get('/:collection/auth-methods', async (c) => {
      const collection = c.req.param('collection');

      try {
        return c.json({
          mfa: {
            enabled: false,
          },
          otp: {
            enabled: true,
            emailTemplate: true,
          },
          password: {
            enabled: true,
            identityFields: ['email', 'username'],
          },
          oauth2: {
            enabled: false,
            providers: [],
          },
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

    // Auth with password
    app.post('/:collection/auth-with-password', async (c) => {
      const collection = c.req.param('collection');

      try {
        const body = await c.req.json();
        const { identity, password } = body;

        if (!identity || !password) {
          return c.json(
            {
              code: 400,
              message: 'Missing identity or password.',
              data: {},
            },
            400
          );
        }

        // Query for user by email or username
        const results = await this.db`
          SELECT * FROM ${sql(collection)} 
          WHERE (email = ${identity} OR username = ${identity})
          LIMIT 1
        `;

        if (!results || results.length === 0) {
          return c.json(
            {
              code: 400,
              message: 'Invalid credentials.',
              data: {},
            },
            400
          );
        }

        const record = results[0];

        // In a real implementation, you would verify the password hash here
        // For now, we'll just check if the password field matches (NOT SECURE - demo only!)
        if (record.password !== password && !this.verifyPassword(password, record.password)) {
          return c.json(
            {
              code: 400,
              message: 'Invalid credentials.',
              data: {},
            },
            400
          );
        }

        // Generate auth token (JWT in real implementation)
        const token = this.generateToken(record.id, collection);

        // Remove password from response
        delete record.password;
        delete record.passwordHash;
        delete record.tokenKey;

        // Add collectionName for consistency
        record.collectionName = collection;

        return c.json({
          token,
          record,
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

    // Auth refresh
    app.post('/:collection/auth-refresh', async (c) => {
      const collection = c.req.param('collection');

      try {
        // Get token from Authorization header
        const authHeader = c.req.header('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return c.json(
            {
              code: 401,
              message: 'Missing or invalid authorization token.',
              data: {},
            },
            401
          );
        }

        const token = authHeader.substring(7);
        const payload = this.verifyToken(token);

        if (!payload) {
          return c.json(
            {
              code: 401,
              message: 'Invalid or expired token.',
              data: {},
            },
            401
          );
        }

        // Fetch the record
        const results = await this.db`
          SELECT * FROM ${sql(collection)} 
          WHERE id = ${payload.id}
          LIMIT 1
        `;

        if (!results || results.length === 0) {
          return c.json(
            {
              code: 404,
              message: 'Record not found.',
              data: {},
            },
            404
          );
        }

        const record = results[0];

        // Generate new token
        const newToken = this.generateToken(record.id, collection);

        // Remove sensitive fields
        delete record.password;
        delete record.passwordHash;
        delete record.tokenKey;

        // Add collectionName
        record.collectionName = collection;

        return c.json({
          token: newToken,
          record,
        });
      } catch (error: any) {
        return c.json(
          {
            code: 401,
            message: error.message,
            data: {},
          },
          401
        );
      }
    });

    // Request OTP
    app.post('/:collection/request-otp', async (c) => {
      const collection = c.req.param('collection');

      try {
        const body = await c.req.json();
        const { email } = body;

        if (!email) {
          return c.json(
            {
              code: 400,
              message: 'Missing email.',
              data: {},
            },
            400
          );
        }

        // Check if user exists
        const results = await this.db`
          SELECT id FROM ${sql(collection)} 
          WHERE email = ${email}
          LIMIT 1
        `;

        if (!results || results.length === 0) {
          // For security, don't reveal if email exists or not
          return c.json({
            otpId: generateId(),
          });
        }

        // Generate OTP
        const otpId = generateId();
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

        // Store OTP in database (you'd need an OTP table in production)
        // For now, we'll just return the otpId
        console.log(`OTP for ${email}: ${otpCode} (ID: ${otpId})`);

        return c.json({
          otpId,
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

    // Auth with OTP
    app.post('/:collection/auth-with-otp', async (c) => {
      const collection = c.req.param('collection');

      try {
        const body = await c.req.json();
        const { otpId, password } = body;

        if (!otpId || !password) {
          return c.json(
            {
              code: 400,
              message: 'Missing otpId or password (OTP code).',
              data: {},
            },
            400
          );
        }

        // In production, verify OTP from database
        // For demo, we'll just reject it
        return c.json(
          {
            code: 400,
            message: 'Invalid or expired OTP.',
            data: {},
          },
          400
        );
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
   * Generate a simple auth token (JWT in production)
   */
  private generateToken(userId: string, collection: string): string {
    // In production, use proper JWT with signing
    const payload = {
      id: userId,
      collection,
      type: 'auth',
      exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60), // 7 days
    };

    // Simple base64 encoding for demo (NOT SECURE!)
    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }

  /**
   * Verify and decode token
   */
  private verifyToken(token: string): any {
    try {
      // In production, verify JWT signature
      const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
      
      // Check expiration
      if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
        return null;
      }

      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Verify password (in production, use bcrypt)
   */
  private verifyPassword(plaintext: string, hash: string): boolean {
    // In production, use bcrypt.compare()
    // For demo, just do string comparison
    return plaintext === hash;
  }
}
