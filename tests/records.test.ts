import { describe, test, expect, beforeAll } from 'bun:test';
import PocketBase from 'pocketbase';

const pb = new PocketBase('http://localhost:8090');

describe('PocketBase Records API', () => {
  let testPostId: string;

  test('should list posts without expand', async () => {
    const posts = await pb.collection('posts').getList(1, 10, {
      filter: 'published = 1',
      sort: '-created'
    });

    expect(posts.totalItems).toBeGreaterThan(0);
    expect(posts.items.length).toBeGreaterThan(0);
    expect(posts.items[0].title).toBeDefined();
    expect(posts.items[0].authorId).toBeDefined();
  });

  test('should list posts with single expand', async () => {
    const posts = await pb.collection('posts').getList(1, 10, {
      filter: 'published = 1',
      expand: 'authorId'
    });

    expect(posts.items.length).toBeGreaterThan(0);
    expect(posts.items[0].expand?.authorId).toBeDefined();
    expect(posts.items[0].expand?.authorId?.name).toBeDefined();
    expect(posts.items[0].expand?.authorId?.email).toBeDefined();
  });

  test('should list posts with multiple expands', async () => {
    const posts = await pb.collection('posts').getList(1, 10, {
      expand: 'authorId,categoryId'
    });

    expect(posts.items.length).toBeGreaterThan(0);
    expect(posts.items[0].expand?.authorId).toBeDefined();
    expect(posts.items[0].expand?.categoryId).toBeDefined();
    expect(posts.items[0].expand?.authorId?.name).toBeDefined();
    expect(posts.items[0].expand?.categoryId?.name).toBeDefined();
  });

  test('should get single post by ID with expand', async () => {
    const post = await pb.collection('posts').getOne('post1xxxxxxxxxx', {
      expand: 'authorId,categoryId'
    });

    expect(post.id).toBe('post1xxxxxxxxxx');
    expect(post.title).toBeDefined();
    expect(post.expand?.authorId).toBeDefined();
    expect(post.expand?.categoryId).toBeDefined();
  });

  test('should support nested expand', async () => {
    const comments = await pb.collection('comments').getList(1, 10, {
      expand: 'postId.authorId,authorId'
    });

    expect(comments.items.length).toBeGreaterThan(0);
    expect(comments.items[0].expand?.authorId).toBeDefined();
    expect(comments.items[0].expand?.postId).toBeDefined();
    expect(comments.items[0].expand?.postId?.expand?.authorId).toBeDefined();
    expect(comments.items[0].expand?.postId?.expand?.authorId?.name).toBeDefined();
  });

  test('should create new post', async () => {
    const newPost = await pb.collection('posts').create({
      title: 'Test Post from SDK',
      content: 'This was created via the PocketBase SDK!',
      authorId: 'user1xxxxxxxxxx',
      categoryId: 'cat1xxxxxxxxxxx',
      published: 1,
      tags: '["test","sdk"]'
    });

    expect(newPost.id).toBeDefined();
    expect(newPost.title).toBe('Test Post from SDK');
    expect(newPost.content).toBe('This was created via the PocketBase SDK!');
    expect(newPost.created).toBeDefined();
    expect(newPost.updated).toBeDefined();

    testPostId = newPost.id;
  });

  test('should update post', async () => {
    expect(testPostId).toBeDefined();

    const updatedPost = await pb.collection('posts').update(testPostId, {
      title: 'Updated Test Post',
      content: 'Content updated!'
    });

    expect(updatedPost.id).toBe(testPostId);
    expect(updatedPost.title).toBe('Updated Test Post');
    expect(updatedPost.content).toBe('Content updated!');
  });

  test('should search posts by title using filter', async () => {
    const searchResults = await pb.collection('posts').getList(1, 10, {
      filter: pb.filter('title ~ {:search}', { search: 'Bun' })
    });

    expect(searchResults.totalItems).toBeGreaterThan(0);
    expect(searchResults.items.length).toBeGreaterThan(0);
    expect(searchResults.items[0].title).toContain('Bun');
  });

  test('should delete post', async () => {
    expect(testPostId).toBeDefined();

    await pb.collection('posts').delete(testPostId);

    // Verify it's deleted by trying to get it (should throw 404)
    await expect(
      pb.collection('posts').getOne(testPostId)
    ).rejects.toThrow();
  });

  test('should handle 404 for non-existent record', async () => {
    await expect(
      pb.collection('posts').getOne('nonexistent_id')
    ).rejects.toThrow();
  });

  test('should support pagination', async () => {
    const page1 = await pb.collection('posts').getList(1, 2);
    const page2 = await pb.collection('posts').getList(2, 2);

    expect(page1.page).toBe(1);
    expect(page1.perPage).toBe(2);
    expect(page1.items.length).toBeLessThanOrEqual(2);

    expect(page2.page).toBe(2);
    expect(page2.perPage).toBe(2);

    // Pages should have different items (if there are enough records)
    if (page1.totalItems > 2) {
      expect(page1.items[0].id).not.toBe(page2.items[0]?.id);
    }
  });

  test('should support skipTotal option', async () => {
    const result = await pb.collection('posts').getList(1, 10, {
      skipTotal: true
    });

    expect(result.totalItems).toBe(-1);
    expect(result.totalPages).toBe(-1);
    expect(result.items).toBeDefined();
  });

  test('should support complex filters', async () => {
    const result = await pb.collection('posts').getList(1, 10, {
      filter: 'published = 1 && authorId != ""'
    });

    expect(result.items.length).toBeGreaterThan(0);
    result.items.forEach(post => {
      expect(post.published).toBe(1);
      expect(post.authorId).toBeTruthy();
    });
  });

  test('should support sorting', async () => {
    const ascending = await pb.collection('posts').getList(1, 10, {
      sort: 'title'
    });

    const descending = await pb.collection('posts').getList(1, 10, {
      sort: '-title'
    });

    expect(ascending.items.length).toBeGreaterThan(0);
    expect(descending.items.length).toBeGreaterThan(0);

    // Verify order is reversed
    if (ascending.items.length > 1) {
      expect(ascending.items[0].id).not.toBe(descending.items[0].id);
    }
  });
});

describe('PocketBase Sorting Tests', () => {
  test('should sort by title ascending', async () => {
    const result = await pb.collection('posts').getList(1, 10, {
      sort: 'title'
    });

    expect(result.items.length).toBeGreaterThan(1);
    
    // Verify ascending order
    for (let i = 0; i < result.items.length - 1; i++) {
      expect(result.items[i].title.localeCompare(result.items[i + 1].title)).toBeLessThanOrEqual(0);
    }
  });

  test('should sort by title descending', async () => {
    const result = await pb.collection('posts').getList(1, 10, {
      sort: '-title'
    });

    expect(result.items.length).toBeGreaterThan(1);
    
    // Verify descending order
    for (let i = 0; i < result.items.length - 1; i++) {
      expect(result.items[i].title.localeCompare(result.items[i + 1].title)).toBeGreaterThanOrEqual(0);
    }
  });

  test('should sort by created date descending', async () => {
    const result = await pb.collection('posts').getList(1, 10, {
      sort: '-created'
    });

    expect(result.items.length).toBeGreaterThan(1);
    
    // Verify dates are in descending order
    for (let i = 0; i < result.items.length - 1; i++) {
      expect(result.items[i].created >= result.items[i + 1].created).toBe(true);
    }
  });

  test('should support multiple sort fields', async () => {
    const result = await pb.collection('posts').getList(1, 10, {
      sort: '-published,title'
    });

    expect(result.items.length).toBeGreaterThan(0);
    // Multiple sort is applied: first by published DESC, then by title ASC
  });
});

describe('PocketBase Filter Tests', () => {
  test('should filter by equality', async () => {
    const result = await pb.collection('posts').getList(1, 20, {
      filter: 'published = 1'
    });

    expect(result.items.length).toBeGreaterThan(0);
    for (const post of result.items) {
      expect(post.published).toBe(1);
    }
  });

  test('should filter by inequality', async () => {
    const result = await pb.collection('posts').getList(1, 20, {
      filter: 'published != 0'
    });

    expect(result.items.length).toBeGreaterThan(0);
    for (const post of result.items) {
      expect(post.published).not.toBe(0);
    }
  });

  test('should filter with text search (LIKE)', async () => {
    const result = await pb.collection('posts').getList(1, 20, {
      filter: 'title ~ "Bun"'
    });

    expect(result.items.length).toBeGreaterThan(0);
    for (const post of result.items) {
      expect(post.title.toLowerCase()).toContain('bun');
    }
  });

  test('should filter with AND operator', async () => {
    const result = await pb.collection('posts').getList(1, 20, {
      filter: 'published = 1 && authorId = "user1xxxxxxxxxx"'
    });

    expect(result.items.length).toBeGreaterThan(0);
    for (const post of result.items) {
      expect(post.published).toBe(1);
      expect(post.authorId).toBe('user1xxxxxxxxxx');
    }
  });

  test('should filter with OR operator', async () => {
    const result = await pb.collection('users').getList(1, 20, {
      filter: 'name = "John Doe" || name = "Jane Smith"'
    });

    expect(result.items.length).toBeGreaterThan(0);
    for (const user of result.items) {
      expect(['John Doe', 'Jane Smith']).toContain(user.name);
    }
  });

  test('should use pb.filter() for safe parameter binding', async () => {
    const searchTerm = "Bun's";
    const result = await pb.collection('posts').getList(1, 20, {
      filter: pb.filter('title ~ {:search}', { search: searchTerm })
    });

    expect(result.items).toBeDefined();
  });

  test('should filter with comparison operators', async () => {
    // Greater than
    const gt = await pb.collection('posts').getList(1, 20, {
      filter: 'published >= 1'
    });
    expect(gt.items.length).toBeGreaterThan(0);

    // Less than or equal
    const lte = await pb.collection('posts').getList(1, 20, {
      filter: 'published <= 1'
    });
    expect(lte.items.length).toBeGreaterThan(0);
  });
});

describe('PocketBase List Methods', () => {
  test('getList() should return paginated results', async () => {
    const result = await pb.collection('posts').getList(1, 2);

    expect(result.page).toBe(1);
    expect(result.perPage).toBe(2);
    expect(result.items.length).toBeLessThanOrEqual(2);
    expect(result.totalItems).toBeGreaterThan(0);
    expect(result.totalPages).toBeGreaterThan(0);
  });

  test('getList() should handle different pages', async () => {
    const page1 = await pb.collection('posts').getList(1, 2);
    const page2 = await pb.collection('posts').getList(2, 2);

    expect(page1.page).toBe(1);
    expect(page2.page).toBe(2);

    // Different pages should have different items (if there are enough)
    if (page1.totalItems > 2) {
      expect(page1.items[0]?.id).not.toBe(page2.items[0]?.id);
    }
  });

  test('getFullList() should return all records', async () => {
    const allPosts = await pb.collection('posts').getFullList({
      sort: '-created'
    });

    expect(Array.isArray(allPosts)).toBe(true);
    expect(allPosts.length).toBeGreaterThan(0);
    
    // Should be sorted by created descending
    for (let i = 0; i < allPosts.length - 1; i++) {
      expect(allPosts[i].created >= allPosts[i + 1].created).toBe(true);
    }
  });

  test('getFullList() should support filtering', async () => {
    const publishedPosts = await pb.collection('posts').getFullList({
      filter: 'published = 1'
    });

    expect(publishedPosts.length).toBeGreaterThan(0);
    for (const post of publishedPosts) {
      expect(post.published).toBe(1);
    }
  });

  test('getFullList() with batch size should handle pagination internally', async () => {
    const allPosts = await pb.collection('posts').getFullList(2, {
      sort: 'title'
    });

    expect(allPosts.length).toBeGreaterThan(0);
  });

  test('getFirstListItem() should return first matching record', async () => {
    const firstPost = await pb.collection('posts').getFirstListItem('published = 1', {
      sort: '-created'
    });

    expect(firstPost).toBeDefined();
    expect(firstPost.id).toBeDefined();
    expect(firstPost.published).toBe(1);
  });

  test('getFirstListItem() should throw on no results', async () => {
    await expect(
      pb.collection('posts').getFirstListItem('title = "NONEXISTENT_TITLE_12345"')
    ).rejects.toThrow();
  });

  test('getOne() should return single record by ID', async () => {
    const post = await pb.collection('posts').getOne('post1xxxxxxxxxx');

    expect(post).toBeDefined();
    expect(post.id).toBe('post1xxxxxxxxxx');
    expect(post.title).toBeDefined();
    expect(post.content).toBeDefined();
  });

  test('getOne() should support expand', async () => {
    const post = await pb.collection('posts').getOne('post1xxxxxxxxxx', {
      expand: 'authorId,categoryId'
    });

    expect(post.expand).toBeDefined();
    expect(post.expand?.authorId).toBeDefined();
    expect(post.expand?.categoryId).toBeDefined();
  });

  test('getOne() should throw 404 for non-existent ID', async () => {
    await expect(
      pb.collection('posts').getOne('nonexistent123')
    ).rejects.toThrow();
  });
});

describe('Combined Filter + Sort + Expand', () => {
  test('should combine filter, sort, and expand', async () => {
    const result = await pb.collection('posts').getList(1, 10, {
      filter: 'published = 1',
      sort: '-created',
      expand: 'authorId,categoryId'
    });

    expect(result.items.length).toBeGreaterThan(0);
    
    // Check filter
    for (const post of result.items) {
      expect(post.published).toBe(1);
    }

    // Check expand
    expect(result.items[0].expand?.authorId).toBeDefined();
    expect(result.items[0].expand?.categoryId).toBeDefined();

    // Check sort (descending by created)
    for (let i = 0; i < result.items.length - 1; i++) {
      expect(result.items[i].created >= result.items[i + 1].created).toBe(true);
    }
  });

  test('should work with getFullList using all options', async () => {
    const posts = await pb.collection('posts').getFullList({
      filter: 'published = 1',
      sort: 'title',
      expand: 'authorId'
    });

    expect(posts.length).toBeGreaterThan(0);
    
    for (const post of posts) {
      expect(post.published).toBe(1);
      expect(post.expand?.authorId).toBeDefined();
    }

    // Verify sort
    for (let i = 0; i < posts.length - 1; i++) {
      expect(posts[i].title.localeCompare(posts[i + 1].title)).toBeLessThanOrEqual(0);
    }
  });
});
