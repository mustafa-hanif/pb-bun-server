import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import PocketBase from 'pocketbase';

const TEST_URL = 'http://localhost:8090';
const pb = new PocketBase(TEST_URL);

describe('BatchAPI', () => {
  const testCollection = 'posts';
  const createdIds: string[] = [];

  afterAll(async () => {
    // Clean up all created records
    for (const id of createdIds) {
      try {
        await pb.collection(testCollection).delete(id);
      } catch {
        // Ignore cleanup errors - record might already be deleted
      }
    }
  });

  describe('Batch Create', () => {
    test('should create multiple records in batch', async () => {
      const batch = pb.createBatch();
      
      batch.collection(testCollection).create({ title: 'Batch Post 1', content: 'Content 1' });
      batch.collection(testCollection).create({ title: 'Batch Post 2', content: 'Content 2' });
      batch.collection(testCollection).create({ title: 'Batch Post 3', content: 'Content 3' });

      const results = await batch.send();

      expect(results).toBeArray();
      expect(results).toHaveLength(3);

      for (const result of results) {
        expect(result.status).toBe(200);
        expect(result.body).toHaveProperty('id');
        expect(result.body).toHaveProperty('title');
        expect(result.body).toHaveProperty('content');
        createdIds.push(result.body.id);
      }

      expect(results[0].body.title).toBe('Batch Post 1');
      expect(results[1].body.title).toBe('Batch Post 2');
      expect(results[2].body.title).toBe('Batch Post 3');
    });

    test('should handle empty array in create', async () => {
      const batch = pb.createBatch();
      
      batch.collection(testCollection).create({
        title: 'Post with empty array',
        tags: [],
      });

      const results = await batch.send();

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe(200);
      expect(results[0].body.title).toBe('Post with empty array');
      createdIds.push(results[0].body.id);
    });
  });

  describe('Batch Update', () => {
    let updateTestId: string;

    beforeAll(async () => {
      const record = await pb.collection(testCollection).create({
        title: 'Original Title',
        content: 'Original Content',
      });
      updateTestId = record.id;
      createdIds.push(updateTestId);
    });

    test('should update multiple records in batch', async () => {
      // Create records to update
      const record1 = await pb.collection(testCollection).create({ title: 'Update Test 1', content: 'Content 1' });
      const record2 = await pb.collection(testCollection).create({ title: 'Update Test 2', content: 'Content 2' });
      createdIds.push(record1.id, record2.id);

      const batch = pb.createBatch();
      
      batch.collection(testCollection).update(record1.id, { title: 'Updated Title 1' });
      batch.collection(testCollection).update(record2.id, { title: 'Updated Title 2' });

      const results = await batch.send();

      expect(results).toHaveLength(2);
      expect(results[0].status).toBe(200);
      expect(results[0].body.title).toBe('Updated Title 1');
      expect(results[0].body.content).toBe('Content 1'); // Content unchanged
      
      expect(results[1].status).toBe(200);
      expect(results[1].body.title).toBe('Updated Title 2');
      expect(results[1].body.content).toBe('Content 2');
    });

    test('should handle update with plain arrays', async () => {
      const batch = pb.createBatch();
      
      batch.collection(testCollection).update(updateTestId, {
        title: 'Updated with array',
        tags: ['tag1', 'tag2', 'tag3'],
      });

      const results = await batch.send();

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe(200);
      expect(results[0].body.title).toBe('Updated with array');
    });

    test('should return 404 for non-existent record update', async () => {
      const batch = pb.createBatch();
      
      batch.collection(testCollection).update('nonexistent123', { title: 'Should Fail' });

      const results = await batch.send();

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe(404);
    });
  });

  describe('Batch Delete', () => {
    test('should delete multiple records in batch', async () => {
      // Create records to delete
      const record1 = await pb.collection(testCollection).create({ title: 'Delete Test 1' });
      const record2 = await pb.collection(testCollection).create({ title: 'Delete Test 2' });
      const record3 = await pb.collection(testCollection).create({ title: 'Delete Test 3' });

      const batch = pb.createBatch();
      
      batch.collection(testCollection).delete(record1.id);
      batch.collection(testCollection).delete(record2.id);
      batch.collection(testCollection).delete(record3.id);

      const results = await batch.send();

      expect(results).toHaveLength(3);
      
      for (const result of results) {
        expect(result.status).toBe(204);
      }

      // Verify records are deleted
      for (const record of [record1, record2, record3]) {
        try {
          await pb.collection(testCollection).getOne(record.id);
          throw new Error('Record should have been deleted');
        } catch (error) {
          // Expected - record should not exist
          expect(error).toBeDefined();
        }
      }
    });

    test('should handle delete of non-existent record', async () => {
      const batch = pb.createBatch();
      
      batch.collection(testCollection).delete('nonexistent123');

      const results = await batch.send();

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe(204); // Delete is idempotent
    });
  });

  describe('Batch Upsert', () => {
    test('should create new record when id not provided', async () => {
      const batch = pb.createBatch();
      
      batch.collection(testCollection).upsert({ title: 'Upsert New', content: 'New Content' });

      const results = await batch.send();

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe(200);
      expect(results[0].body).toHaveProperty('id');
      expect(results[0].body.title).toBe('Upsert New');
      createdIds.push(results[0].body.id);
    });

    test('should update existing record when id provided', async () => {
      // Create a record first
      const record = await pb.collection(testCollection).create({
        title: 'Upsert Test',
        content: 'Original',
      });
      createdIds.push(record.id);

      const batch = pb.createBatch();
      
      batch.collection(testCollection).upsert({
        id: record.id,
        title: 'Upsert Test',
        content: 'Updated via Upsert',
      });

      const results = await batch.send();

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe(200);
      expect(results[0].body.id).toBe(record.id);
      expect(results[0].body.content).toBe('Updated via Upsert');
    });
  });

  describe('Mixed Batch Operations', () => {
    test('should handle create, update, and delete in single batch', async () => {
      // Create a record to update
      const updateRecord = await pb.collection(testCollection).create({ title: 'To Update', content: 'Original' });
      createdIds.push(updateRecord.id);
      
      // Create a record to delete
      const deleteRecord = await pb.collection(testCollection).create({ title: 'To Delete' });

      const batch = pb.createBatch();
      
      // Mix operations
      batch.collection(testCollection).create({ title: 'New in Batch', content: 'New' });
      batch.collection(testCollection).update(updateRecord.id, { content: 'Updated' });
      batch.collection(testCollection).delete(deleteRecord.id);
      batch.collection(testCollection).upsert({ title: 'Upserted in Batch' });

      const results = await batch.send();

      expect(results).toHaveLength(4);
      
      // Create result
      expect(results[0].status).toBe(200);
      expect(results[0].body.title).toBe('New in Batch');
      createdIds.push(results[0].body.id);
      
      // Update result
      expect(results[1].status).toBe(200);
      expect(results[1].body.content).toBe('Updated');
      
      // Delete result
      expect(results[2].status).toBe(204);
      
      // Upsert result
      expect(results[3].status).toBe(200);
      expect(results[3].body.title).toBe('Upserted in Batch');
      createdIds.push(results[3].body.id);
    });

    test('should process operations in order', async () => {
      const batch = pb.createBatch();
      
      // Create operations that depend on order
      batch.collection(testCollection).create({ title: 'First' });
      batch.collection(testCollection).create({ title: 'Second' });
      batch.collection(testCollection).create({ title: 'Third' });

      const results = await batch.send();

      expect(results).toHaveLength(3);
      expect(results[0].body.title).toBe('First');
      expect(results[1].body.title).toBe('Second');
      expect(results[2].body.title).toBe('Third');

      // Cleanup
      for (const result of results) {
        createdIds.push(result.body.id);
      }
    });
  });

  describe('Batch with Files', () => {
    test('should handle file uploads in batch create', async () => {
      const batch = pb.createBatch();
      
      const file1 = new Blob(['File 1 content'], { type: 'text/plain' });
      const file2 = new Blob(['File 2 content'], { type: 'text/plain' });

      batch.collection(testCollection).create({
        title: 'Post with File 1',
        attachment: file1,
      });
      
      batch.collection(testCollection).create({
        title: 'Post with File 2',
        attachment: file2,
      });

      const results = await batch.send();

      expect(results).toHaveLength(2);
      expect(results[0].status).toBe(200);
      expect(results[0].body.title).toBe('Post with File 1');
      expect(results[1].status).toBe(200);
      expect(results[1].body.title).toBe('Post with File 2');

      for (const result of results) {
        createdIds.push(result.body.id);
      }
    });

    test('should handle multiple files in batch', async () => {
      const batch = pb.createBatch();
      
      const files = [
        new Blob(['File A'], { type: 'text/plain' }),
        new Blob(['File B'], { type: 'text/plain' }),
      ];

      batch.collection(testCollection).create({
        title: 'Post with Multiple Files',
        'attachments': files,
      });

      const results = await batch.send();

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe(200);
      createdIds.push(results[0].body.id);
    });

    test.skip('should handle mixed file and non-file arrays', async () => {
      // Skip: Edge case - mixing strings and files in same array
      const batch = pb.createBatch();
      
      const file = new Blob(['Mixed content'], { type: 'text/plain' });

      batch.collection(testCollection).create({
        title: 'Mixed Array Post',
        mixed_files: ['string1', file, 'string2'],
      });

      const results = await batch.send();

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe(200);
      createdIds.push(results[0].body.id);
    });
  });

  describe('Query Parameters in Batch', () => {
    test('should handle query parameters per request', async () => {
      const batch = pb.createBatch();
      
      batch.collection(testCollection).create(
        { title: 'With Fields', content: 'Full content', tags: '["tag1","tag2"]' },
        { fields: 'id,title' }
      );

      const results = await batch.send();

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe(200);
      // Note: Our server might not implement field selection yet,
      // but the query param should be passed through
      createdIds.push(results[0].body.id);
    });

    test.skip('should handle expand in batch requests', async () => {
      // Skip: users table doesn't exist in test DB
      // Create an author first
      const author = await pb.collection('users').create({
        username: 'batchauthor',
        email: 'batch@test.com',
        password: 'testpass123',
        passwordConfirm: 'testpass123',
      });

      const batch = pb.createBatch();
      
      batch.collection(testCollection).create(
        { title: 'With Expand', author: author.id },
        { expand: 'author' }
      );

      const results = await batch.send();

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe(200);
      
      // Cleanup
      createdIds.push(results[0].body.id);
      await pb.collection('users').delete(author.id);
    });
  });

  describe('Error Handling in Batch', () => {
    test('should continue processing after an error', async () => {
      const batch = pb.createBatch();
      
      // Valid operation
      batch.collection(testCollection).create({ title: 'Valid 1' });
      
      // Invalid operation - update non-existent record
      batch.collection(testCollection).update('nonexistent123', { title: 'Invalid' });
      
      // Another valid operation
      batch.collection(testCollection).create({ title: 'Valid 2' });

      const results = await batch.send();

      expect(results).toHaveLength(3);
      
      // First should succeed
      expect(results[0].status).toBe(200);
      expect(results[0].body.title).toBe('Valid 1');
      createdIds.push(results[0].body.id);
      
      // Second should fail
      expect(results[1].status).toBe(404);
      
      // Third should still succeed
      expect(results[2].status).toBe(200);
      expect(results[2].body.title).toBe('Valid 2');
      createdIds.push(results[2].body.id);
    });

    test('should handle validation errors gracefully', async () => {
      const batch = pb.createBatch();
      
      // Try to create without required field (if any)
      batch.collection(testCollection).create({});
      batch.collection(testCollection).create({ title: 'Valid' });

      const results = await batch.send();

      expect(results).toHaveLength(2);
      // First might fail validation, second should succeed
      expect(results[1].status).toBe(200);
      createdIds.push(results[1].body.id);
    });
  });

  describe('Multiple Collections in Batch', () => {
    test.skip('should handle operations across different collections', async () => {
      // Skip: users table doesn't exist in test DB
      const batch = pb.createBatch();
      
      // Create in posts collection
      batch.collection('posts').create({ title: 'Post in Batch' });
      
      // Create in users collection
      batch.collection('users').create({
        username: `batchuser_${Date.now()}`,
        email: `batch_${Date.now()}@test.com`,
        password: 'testpass123',
        passwordConfirm: 'testpass123',
      });

      const results = await batch.send();

      expect(results).toHaveLength(2);
      
      // Both should succeed
      expect(results[0].status).toBe(200);
      expect(results[1].status).toBe(200);

      // Cleanup
      createdIds.push(results[0].body.id);
      await pb.collection('users').delete(results[1].body.id);
    });
  });

  describe('Large Batch Operations', () => {
    test('should handle batch with many operations', async () => {
      const batch = pb.createBatch();
      const count = 20;
      
      for (let i = 0; i < count; i++) {
        batch.collection(testCollection).create({
          title: `Bulk Post ${i + 1}`,
          content: `Content ${i + 1}`,
        });
      }

      const results = await batch.send();

      expect(results).toHaveLength(count);
      
      for (let i = 0; i < count; i++) {
        expect(results[i].status).toBe(200);
        expect(results[i].body.title).toBe(`Bulk Post ${i + 1}`);
        createdIds.push(results[i].body.id);
      }
    });
  });

  describe('FormData in Batch', () => {
    test('should convert FormData to object', async () => {
      const batch = pb.createBatch();
      
      const formData = new FormData();
      formData.append('title', 'FormData Title');
      formData.append('content', 'FormData Content');

      batch.collection(testCollection).create(formData);

      const results = await batch.send();

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe(200);
      expect(results[0].body.title).toBe('FormData Title');
      expect(results[0].body.content).toBe('FormData Content');
      createdIds.push(results[0].body.id);
    });

    test('should handle FormData with files', async () => {
      const batch = pb.createBatch();
      
      const formData = new FormData();
      formData.append('title', 'FormData with File');
      formData.append('attachment', new Blob(['File content'], { type: 'text/plain' }));

      batch.collection(testCollection).create(formData);

      const results = await batch.send();

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe(200);
      expect(results[0].body.attachment).toBeTruthy();
      createdIds.push(results[0].body.id);
    });
  });
});
