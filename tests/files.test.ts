import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import PocketBase from 'pocketbase';

const TEST_URL = 'http://localhost:8090';
const pb = new PocketBase(TEST_URL);

describe('FilesAPI via SDK', () => {
  let testRecord: any;
  const testCollection = 'posts';

  beforeAll(async () => {
    // Create a test record to attach files to
    testRecord = await pb.collection(testCollection).create({
      title: 'Test Post for Files',
      content: 'Testing file operations',
    });
  });

  afterAll(async () => {
    // Clean up test record
    try {
      await pb.collection(testCollection).delete(testRecord.id);
    } catch {
      // Ignore cleanup errors - record might not exist
    }
  });

  describe('File Upload via SDK', () => {
    test('should upload a file when updating a record', async () => {
      const testFile = new Blob(['Hello, this is a test file!'], { type: 'text/plain' });
      
      const updated = await pb.collection(testCollection).update(testRecord.id, {
        attachment: testFile,
      });

      expect(updated).toHaveProperty('id');
      expect(updated).toHaveProperty('attachment');
      expect(updated.attachment).toBeTruthy();
    });

    test('should upload a file when creating a record', async () => {
      const testFile = new Blob(['New record file'], { type: 'text/plain' });
      
      const created = await pb.collection(testCollection).create({
        title: 'Post with file',
        content: 'Content',
        attachment: testFile,
      });

      expect(created).toHaveProperty('id');
      expect(created).toHaveProperty('attachment');
      expect(created.attachment).toBeTruthy();

      // Cleanup
      await pb.collection(testCollection).delete(created.id);
    });

    test('should upload multiple files in array field', async () => {
      const file1 = new Blob(['File 1'], { type: 'text/plain' });
      const file2 = new Blob(['File 2'], { type: 'text/plain' });
      
      const created = await pb.collection(testCollection).create({
        title: 'Post with multiple files',
        content: 'Content',
        attachments: [file1, file2],
      });

      expect(created).toHaveProperty('id');
      expect(created.attachments).toBeArray();

      // Cleanup
      await pb.collection(testCollection).delete(created.id);
    });

    test('should handle mixed file and string arrays', async () => {
      const file = new Blob(['Mixed file'], { type: 'text/plain' });
      
      const created = await pb.collection(testCollection).create({
        title: 'Post with mixed array',
        'attachments+': [file], // + means append
      });

      expect(created).toHaveProperty('id');

      // Cleanup
      await pb.collection(testCollection).delete(created.id);
    });
  });

  describe('File Token', () => {
    test('should generate a file access token', async () => {
      const token = await pb.files.getToken();
      
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });
  });

  describe('File URL Building (SDK helper)', () => {
    test('should return empty string for missing record id', () => {
      const record = { id: '', collectionId: '123', collectionName: 'posts' };
      const url = pb.files.getURL(record, 'demo.png');
      expect(url).toBe('');
    });

    test('should return empty string for missing filename', () => {
      const record = { id: '456', collectionId: '123', collectionName: 'posts' };
      const url = pb.files.getURL(record, '');
      expect(url).toBe('');
    });

    test('should return formatted url', () => {
      const record = { id: '456', collectionId: '123', collectionName: 'posts' };
      const url = pb.files.getURL(record, 'demo.png');
      expect(url).toBe(`${TEST_URL}/api/files/123/456/demo.png`);
    });

    test('should return formatted url with query params', () => {
      const record = { id: '456', collectionId: '123', collectionName: 'posts' };
      const url = pb.files.getURL(record, 'demo=', { test: 'abc' });
      expect(url).toBe(`${TEST_URL}/api/files/123/456/demo%3D?test=abc`);
    });

    test('should handle download query param', () => {
      const record = { id: '456', collectionId: '123', collectionName: 'posts' };
      const url = pb.files.getURL(record, 'demo.png', { download: true });
      expect(url).toContain('download=true');
    });

    test('should use collectionName if collectionId not available', () => {
      const record = { id: '456', collectionName: 'posts' };
      const url = pb.files.getURL(record, 'demo.png');
      expect(url).toBe(`${TEST_URL}/api/files/posts/456/demo.png`);
    });
  });

  describe('File Retrieval', () => {
    test('should retrieve record with file field', async () => {
      // Create record with file
      const testFile = new Blob(['File content'], { type: 'text/plain' });
      const created = await pb.collection(testCollection).create({
        title: 'Record with file',
        attachment: testFile,
      });

      // Retrieve it
      const fetched = await pb.collection(testCollection).getOne(created.id);
      
      expect(fetched).toHaveProperty('attachment');
      expect(fetched.attachment).toBeTruthy();

      // Build file URL using SDK helper
      const fileUrl = pb.files.getURL(fetched, fetched.attachment);
      expect(fileUrl).toContain('/api/files/');
      expect(fileUrl).toContain(created.id);

      // Cleanup
      await pb.collection(testCollection).delete(created.id);
    });

    test('should handle records with multiple files', async () => {
      const files = [
        new Blob(['File 1'], { type: 'text/plain' }),
        new Blob(['File 2'], { type: 'text/plain' }),
        new Blob(['File 3'], { type: 'text/plain' }),
      ];

      const created = await pb.collection(testCollection).create({
        title: 'Multi-file record',
        attachments: files,
      });

      const fetched = await pb.collection(testCollection).getOne(created.id);
      
      expect(fetched.attachments).toBeArray();
      expect(fetched.attachments.length).toBeGreaterThan(0);

      // Cleanup
      await pb.collection(testCollection).delete(created.id);
    });
  });

  describe('FormData with Files', () => {
    test('should handle FormData with file', async () => {
      const formData = new FormData();
      formData.append('title', 'FormData Post');
      formData.append('content', 'Content');
      formData.append('attachment', new Blob(['FormData file'], { type: 'text/plain' }));

      const created = await pb.collection(testCollection).create(formData);

      expect(created).toHaveProperty('id');
      expect(created.title).toBe('FormData Post');
      expect(created).toHaveProperty('attachment');

      // Cleanup
      await pb.collection(testCollection).delete(created.id);
    });

    test('should handle FormData with multiple files', async () => {
      const formData = new FormData();
      formData.append('title', 'Multi-file FormData');
      formData.append('attachments', new Blob(['File A'], { type: 'text/plain' }));
      formData.append('attachments', new Blob(['File B'], { type: 'text/plain' }));

      const created = await pb.collection(testCollection).create(formData);

      expect(created).toHaveProperty('id');
      expect(created.attachments).toBeArray();

      // Cleanup
      await pb.collection(testCollection).delete(created.id);
    });
  });

  describe('File Update Operations', () => {
    test('should replace file on update', async () => {
      // Create with initial file
      const file1 = new Blob(['Original file'], { type: 'text/plain' });
      const created = await pb.collection(testCollection).create({
        title: 'File replacement test',
        attachment: file1,
      });

      // Update with new file
      const file2 = new Blob(['Replacement file'], { type: 'text/plain' });
      const updated = await pb.collection(testCollection).update(created.id, {
        attachment: file2,
      });

      expect(updated.attachment).toBeTruthy();
      expect(updated.attachment).not.toBe(created.attachment);

      // Cleanup
      await pb.collection(testCollection).delete(created.id);
    });

    test('should handle file deletion by setting to null', async () => {
      // Create with file
      const file = new Blob(['To be removed'], { type: 'text/plain' });
      const created = await pb.collection(testCollection).create({
        title: 'File deletion test',
        attachment: file,
      });

      // Remove file by setting to null
      const updated = await pb.collection(testCollection).update(created.id, {
        attachment: null,
      });

      expect(updated.attachment).toBe('');

      // Cleanup
      await pb.collection(testCollection).delete(created.id);
    });
  });

  describe('Different File Types', () => {
    test('should handle text files', async () => {
      const textFile = new Blob(['Plain text content'], { type: 'text/plain' });
      const created = await pb.collection(testCollection).create({
        title: 'Text file test',
        attachment: textFile,
      });

      expect(created.attachment).toBeTruthy();
      await pb.collection(testCollection).delete(created.id);
    });

    test('should handle JSON files', async () => {
      const jsonFile = new Blob(['{"key":"value"}'], { type: 'application/json' });
      const created = await pb.collection(testCollection).create({
        title: 'JSON file test',
        attachment: jsonFile,
      });

      expect(created.attachment).toBeTruthy();
      await pb.collection(testCollection).delete(created.id);
    });

    test('should handle binary files', async () => {
      const binaryFile = new Blob([new Uint8Array([0, 1, 2, 3, 4])], { 
        type: 'application/octet-stream' 
      });
      const created = await pb.collection(testCollection).create({
        title: 'Binary file test',
        attachment: binaryFile,
      });

      expect(created.attachment).toBeTruthy();
      await pb.collection(testCollection).delete(created.id);
    });
  });
});

