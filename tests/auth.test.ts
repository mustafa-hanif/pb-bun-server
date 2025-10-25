import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import PocketBase from 'pocketbase';

const TEST_URL = 'http://localhost:8090';
const pb = new PocketBase(TEST_URL);

describe('Authentication API', () => {
  const testCollection = 'users';
  let testUser: any;
  const testEmail = `test_${Date.now()}@example.com`;
  const testPassword = 'test123456';

  beforeAll(async () => {
    // Create a test user for authentication
    try {
      testUser = await pb.collection(testCollection).create({
        name: 'Test User',
        email: testEmail,
        password: testPassword,
      });
    } catch (error) {
      console.log('Note: users table might not exist, some tests will be skipped');
    }
  });

  afterAll(async () => {
    // Clean up test user
    if (testUser?.id) {
      try {
        await pb.collection(testCollection).delete(testUser.id);
      } catch {
        // Ignore cleanup errors
      }
    }
    // Clear auth store
    pb.authStore.clear();
  });

  describe('List Auth Methods', () => {
    test('should list available authentication methods', async () => {
      const methods = await pb.collection(testCollection).listAuthMethods();

      expect(methods).toHaveProperty('password');
      expect(methods).toHaveProperty('oauth2');
      expect(methods).toHaveProperty('otp');
      expect(methods.password.enabled).toBe(true);
    });
  });

  describe('Auth with Password', () => {
    test.skipIf(!testUser)('should authenticate with valid credentials', async () => {
      const authData = await pb.collection(testCollection).authWithPassword(
        testEmail,
        testPassword
      );

      expect(authData).toHaveProperty('token');
      expect(authData).toHaveProperty('record');
      expect(authData.token).toBeTruthy();
      expect(authData.record.email).toBe(testEmail);
      expect(authData.record).not.toHaveProperty('password');
      
      // Check that auth store was updated
      expect(pb.authStore.isValid).toBe(true);
      expect(pb.authStore.token).toBe(authData.token);
      expect(pb.authStore.record?.id).toBe(authData.record.id);
    });

    test.skipIf(!testUser)('should reject invalid credentials', async () => {
      try {
        await pb.collection(testCollection).authWithPassword(
          testEmail,
          'wrongpassword'
        );
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error.status).toBe(400);
        expect(error.message).toContain('credentials');
      }
    });

    test.skipIf(!testUser)('should reject non-existent user', async () => {
      try {
        await pb.collection(testCollection).authWithPassword(
          'nonexistent@example.com',
          'password123'
        );
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error.status).toBe(400);
      }
    });

    test.skipIf(!testUser)('should require both identity and password', async () => {
      try {
        await pb.collection(testCollection).authWithPassword('', 'password');
        expect(true).toBe(false);
      } catch (error: any) {
        expect(error.status).toBe(400);
      }
    });
  });

  describe('Auth Refresh', () => {
    test.skipIf(!testUser)('should refresh authentication token', async () => {
      // First authenticate
      const authData = await pb.collection(testCollection).authWithPassword(
        testEmail,
        testPassword
      );
      const originalToken = authData.token;

      // Wait a bit to ensure new token will be different (if timestamp-based)
      await new Promise(resolve => setTimeout(resolve, 10));

      // Refresh
      const refreshData = await pb.collection(testCollection).authRefresh();

      expect(refreshData).toHaveProperty('token');
      expect(refreshData).toHaveProperty('record');
      expect(refreshData.token).toBeTruthy();
      expect(refreshData.record.email).toBe(testEmail);
      
      // Token should be refreshed
      expect(pb.authStore.token).toBe(refreshData.token);
    });

    test('should reject refresh without valid token', async () => {
      // Clear auth store
      pb.authStore.clear();

      try {
        await pb.collection(testCollection).authRefresh();
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error.status).toBe(401);
      }
    });

    test.skipIf(!testUser)('should reject refresh with invalid token', async () => {
      // Set an invalid token
      pb.authStore.save('invalid_token_123', null);

      try {
        await pb.collection(testCollection).authRefresh();
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error.status).toBe(401);
      }
    });
  });

  describe('Request OTP', () => {
    test.skipIf(!testUser)('should request OTP for valid email', async () => {
      const result = await pb.collection(testCollection).requestOTP(testEmail);

      expect(result).toHaveProperty('otpId');
      expect(typeof result.otpId).toBe('string');
      expect(result.otpId.length).toBeGreaterThan(0);
    });

    test('should handle OTP request for non-existent email', async () => {
      // For security, should still return otpId even if email doesn't exist
      const result = await pb.collection(testCollection).requestOTP('nonexistent@example.com');

      expect(result).toHaveProperty('otpId');
    });

    test('should require email parameter', async () => {
      try {
        await pb.collection(testCollection).requestOTP('');
        expect(true).toBe(false);
      } catch (error: any) {
        expect(error.status).toBe(400);
      }
    });
  });

  describe('Auth with OTP', () => {
    test('should reject auth with invalid OTP', async () => {
      try {
        await pb.collection(testCollection).authWithOTP('fake_otp_id', '123456');
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error.status).toBe(400);
        expect(error.message).toContain('OTP');
      }
    });

    test('should require both otpId and password', async () => {
      try {
        await pb.collection(testCollection).authWithOTP('', '');
        expect(true).toBe(false);
      } catch (error: any) {
        expect(error.status).toBe(400);
      }
    });
  });

  describe('Auth Store Integration', () => {
    test.skipIf(!testUser)('should automatically update auth store on successful auth', async () => {
      // Clear first
      pb.authStore.clear();
      expect(pb.authStore.isValid).toBe(false);

      // Authenticate
      const authData = await pb.collection(testCollection).authWithPassword(
        testEmail,
        testPassword
      );

      // Check auth store was updated
      expect(pb.authStore.isValid).toBe(true);
      expect(pb.authStore.token).toBe(authData.token);
      expect(pb.authStore.record?.id).toBe(authData.record.id);
      expect(pb.authStore.record?.email).toBe(testEmail);
    });

    test.skipIf(!testUser)('should clear auth store on logout', () => {
      // Ensure we're authenticated first
      expect(pb.authStore.isValid).toBe(true);

      // Clear/logout
      pb.authStore.clear();

      expect(pb.authStore.isValid).toBe(false);
      expect(pb.authStore.token).toBe('');
      expect(pb.authStore.record).toBeNull();
    });
  });
});
