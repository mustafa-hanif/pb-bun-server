import { describe, expect, test } from 'bun:test';
import PocketBase from 'pocketbase';

const TEST_URL = 'http://localhost:8090';
const pb = new PocketBase(TEST_URL);

describe('Debug Batch', () => {
  test('should see actual error from batch with array', async () => {
    const batch = pb.createBatch();
    
    batch.collection('posts').create({
      title: 'Post with empty array',
      tags: [],
    });

    try {
      const results = await batch.send();
      console.log('Results:', JSON.stringify(results, null, 2));
    } catch (error) {
      console.log('Error:', error);
    }
  });

  test('should see actual error from batch with files', async () => {
    const batch = pb.createBatch();
    
    const file1 = new Blob(['File 1 content'], { type: 'text/plain' });

    batch.collection('posts').create({
      title: 'Post with File 1',
      attachment: file1,
    });

    try {
      const results = await batch.send();
      console.log('Results:', JSON.stringify(results, null, 2));
    } catch (error) {
      console.log('Error:', error);
    }
  });

  test('should see actual error from FormData in batch', async () => {
    const batch = pb.createBatch();
    
    const formData = new FormData();
    formData.append('title', 'FormData Title');
    formData.append('content', 'FormData Content');

    batch.collection('posts').create(formData);

    try {
      const results = await batch.send();
      console.log('FormData Results:', JSON.stringify(results, null, 2));
    } catch (error) {
      console.log('FormData Error:', error);
    }
  });
});
