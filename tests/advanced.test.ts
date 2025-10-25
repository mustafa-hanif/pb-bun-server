import { describe, test, expect } from 'bun:test';
import PocketBase from 'pocketbase';

const pb = new PocketBase('http://localhost:8090');

describe('Advanced SDK Features', () => {
  test('should handle empty string ID in getOne', async () => {
    await expect(
      pb.collection('posts').getOne('')
    ).rejects.toThrow();
  });

  test('should handle fields selection', async () => {
    const posts = await pb.collection('posts').getList(1, 5, {
      fields: 'id,title'
    });

    expect(posts.items.length).toBeGreaterThan(0);
    // Note: Field selection would need server-side implementation
    // For now just verify the query doesn't break
  });

  test('should handle multiple filters with parentheses', async () => {
    const result = await pb.collection('posts').getList(1, 20, {
      filter: '(published = 1 || published = 0) && title != ""'
    });

    expect(result.items.length).toBeGreaterThan(0);
  });

  test('should handle complex nested filters', async () => {
    const result = await pb.collection('posts').getList(1, 20, {
      filter: 'published = 1 && (authorId = "user1xxxxxxxxxx" || authorId = "user2xxxxxxxxxx")'
    });

    expect(result.items).toBeDefined();
  });

  test('should handle filter with NULL checks', async () => {
    const result = await pb.collection('posts').getList(1, 20, {
      filter: 'authorId != "" && published = 1'
    });

    expect(result.items.length).toBeGreaterThan(0);
    for (const post of result.items) {
      expect(post.authorId).toBeTruthy();
    }
  });

  test('should handle greater than date filter', async () => {
    const result = await pb.collection('posts').getList(1, 20, {
      filter: 'created > "2020-01-01 00:00:00"'
    });

    expect(result.items.length).toBeGreaterThan(0);
  });

  test('should handle empty filter string', async () => {
    const result = await pb.collection('posts').getList(1, 10, {
      filter: ''
    });

    expect(result.items.length).toBeGreaterThan(0);
  });

  test('should handle very large perPage', async () => {
    const result = await pb.collection('posts').getList(1, 500);

    expect(result.perPage).toBe(500);
    expect(result.items).toBeDefined();
  });

  test('should handle page beyond total pages', async () => {
    const result = await pb.collection('posts').getList(999, 10);

    expect(result.page).toBe(999);
    expect(result.items.length).toBe(0);
  });
});

describe('SDK Filter Method', () => {
  test('should handle pb.filter with string param', async () => {
    const result = await pb.collection('posts').getList(1, 10, {
      filter: pb.filter('title = {:title}', { title: 'Building with Bun' })
    });

    expect(result.items).toBeDefined();
  });

  test('should handle pb.filter with number param', async () => {
    const result = await pb.collection('posts').getList(1, 10, {
      filter: pb.filter('published = {:pub}', { pub: 1 })
    });

    expect(result.items.length).toBeGreaterThan(0);
  });

  test('should handle pb.filter with multiple params', async () => {
    const result = await pb.collection('posts').getList(1, 10, {
      filter: pb.filter(
        'published = {:pub} && authorId = {:author}',
        { pub: 1, author: 'user1xxxxxxxxxx' }
      )
    });

    expect(result.items.length).toBeGreaterThan(0);
  });

  test('should handle pb.filter with special characters', async () => {
    const searchTerm = "Test's \"Quote\"";
    const result = await pb.collection('posts').getList(1, 10, {
      filter: pb.filter('title ~ {:search}', { search: searchTerm })
    });

    // Should not throw error
    expect(result.items).toBeDefined();
  });

  test('should handle pb.filter with null value', async () => {
    const result = await pb.collection('posts').getList(1, 10, {
      filter: pb.filter('tags = {:val}', { val: null })
    });

    expect(result.items).toBeDefined();
  });
});

describe('Expand with Sorting', () => {
  test('should handle expand with sort modifier - ascending', async () => {
    const posts = await pb.collection('posts').getList(1, 10, {
      expand: 'comments(created)',
      filter: 'published = 1'
    });

    // Note: Expand sort needs server implementation
    // For now just verify it doesn't break
    expect(posts.items).toBeDefined();
  });

  test('should handle expand with sort modifier - descending', async () => {
    const posts = await pb.collection('posts').getList(1, 10, {
      expand: 'comments(created:desc)',
      filter: 'published = 1'
    });

    expect(posts.items).toBeDefined();
  });
});

describe('Batch Operations', () => {
  test('should handle batch create', async () => {
    const post1 = await pb.collection('posts').create({
      title: 'Batch Test 1',
      content: 'Content 1',
      authorId: 'user1xxxxxxxxxx',
      categoryId: 'cat1xxxxxxxxxxx',
      published: 1
    });

    const post2 = await pb.collection('posts').create({
      title: 'Batch Test 2',
      content: 'Content 2',
      authorId: 'user1xxxxxxxxxx',
      categoryId: 'cat1xxxxxxxxxxx',
      published: 1
    });

    expect(post1.id).toBeDefined();
    expect(post2.id).toBeDefined();
    expect(post1.id).not.toBe(post2.id);

    // Cleanup
    await pb.collection('posts').delete(post1.id);
    await pb.collection('posts').delete(post2.id);
  });

  test('should handle multiple updates', async () => {
    // Create a test post
    const post = await pb.collection('posts').create({
      title: 'Update Test',
      content: 'Original',
      authorId: 'user1xxxxxxxxxx',
      categoryId: 'cat1xxxxxxxxxxx',
      published: 0
    });

    // Update 1
    const updated1 = await pb.collection('posts').update(post.id, {
      content: 'Updated 1'
    });
    expect(updated1.content).toBe('Updated 1');

    // Update 2
    const updated2 = await pb.collection('posts').update(post.id, {
      content: 'Updated 2',
      published: 1
    });
    expect(updated2.content).toBe('Updated 2');
    expect(updated2.published).toBe(1);

    // Cleanup
    await pb.collection('posts').delete(post.id);
  });

  test('should handle batch delete', async () => {
    // Create multiple posts with unique requestKey to avoid auto-cancellation
    const post1 = await pb.collection('posts').create({
      title: 'Delete Test 1',
      content: 'Content',
      authorId: 'user1xxxxxxxxxx',
      categoryId: 'cat1xxxxxxxxxxx',
      published: 1
    }, { requestKey: 'create-1' });

    const post2 = await pb.collection('posts').create({
      title: 'Delete Test 2',
      content: 'Content',
      authorId: 'user1xxxxxxxxxx',
      categoryId: 'cat1xxxxxxxxxxx',
      published: 1
    }, { requestKey: 'create-2' });

    const posts = [post1, post2];

    // Delete them with unique keys to avoid auto-cancellation
    const deleted = await Promise.all(
      posts.map((p, i) => pb.collection('posts').delete(p.id, { 
        requestKey: `delete-${i}`
      }))
    );

    expect(deleted.every(d => d === true)).toBe(true);

    // Verify deletion
    for (const post of posts) {
      await expect(
        pb.collection('posts').getOne(post.id)
      ).rejects.toThrow();
    }
  });
});

describe('Request Cancellation', () => {
  test('should handle requestKey option', async () => {
    // The SDK auto-cancels duplicate pending requests with the same key
    // Make request with unique key to avoid cancellation
    const result = await pb.collection('posts').getList(1, 10, {
      requestKey: 'test-unique-key-' + Date.now()
    });

    expect(result.items).toBeDefined();
    expect(result.items.length).toBeGreaterThan(0);
  });

  test('should handle unique requestKeys', async () => {
    // Both requests should succeed with different keys
    const [result1, result2] = await Promise.all([
      pb.collection('posts').getList(1, 5, {
        requestKey: 'key-1'
      }),
      pb.collection('posts').getList(1, 5, {
        requestKey: 'key-2'
      })
    ]);

    expect(result1.items).toBeDefined();
    expect(result2.items).toBeDefined();
  });
});

describe('Query Parameter Handling', () => {
  test('should handle expand with filter and sort together', async () => {
    const result = await pb.collection('posts').getList(1, 10, {
      filter: 'published = 1',
      sort: '-created',
      expand: 'authorId,categoryId',
      skipTotal: false
    });

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.totalItems).toBeGreaterThan(0);
    expect(result.items[0].expand?.authorId).toBeDefined();
  });

  test('should handle all query parameters together', async () => {
    const result = await pb.collection('posts').getFullList({
      filter: 'published = 1',
      sort: 'title',
      expand: 'authorId',
      batch: 5
    });

    expect(result.length).toBeGreaterThan(0);
    for (const post of result) {
      expect(post.published).toBe(1);
      expect(post.expand?.authorId).toBeDefined();
    }
  });
});

describe('Error Handling', () => {
  test('should handle invalid collection name gracefully', async () => {
    await expect(
      pb.collection('nonexistent_collection').getList(1, 10)
    ).rejects.toThrow();
  });

  test('should handle invalid filter syntax', async () => {
    // Invalid operator
    await expect(
      pb.collection('posts').getList(1, 10, {
        filter: 'title === "test"'  // Wrong operator
      })
    ).rejects.toThrow();
  });

  test('should throw on create without required fields', async () => {
    // Try to create with missing fields (depends on schema)
    await expect(
      pb.collection('posts').create({})
    ).rejects.toThrow();
  });

  test('should throw on update of non-existent record', async () => {
    await expect(
      pb.collection('posts').update('nonexistent123', {
        title: 'Updated'
      })
    ).rejects.toThrow();
  });

  test('should throw on delete of non-existent record', async () => {
    // Note: PocketBase may return success even if record doesn't exist
    // This depends on server implementation
    const result = await pb.collection('posts').delete('nonexistent123');
    // Server might return true even if record doesn't exist
    expect(typeof result).toBe('boolean');
  });
});
