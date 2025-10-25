import PocketBase from 'pocketbase';

const pb = new PocketBase('http://localhost:8090');

async function testAPI() {
  console.log('🧪 Testing PocketBase-compatible API\n');

  try {
    // Test 1: List posts without expand
    console.log('1️⃣ List posts (no expand):');
    const posts1 = await pb.collection('posts').getList(1, 10, {
      filter: 'published = 1',
      sort: '-created'
    });
    console.log(`   Found ${posts1.totalItems} posts`);
    console.log(`   First post: "${posts1.items[0].title}"`);
    console.log(`   Author ID: ${posts1.items[0].authorId}`);
    console.log();

    // Test 2: List posts with single expand
    console.log('2️⃣ List posts with author expand:');
    const posts2 = await pb.collection('posts').getList(1, 10, {
      filter: 'published = 1',
      expand: 'authorId'
    });
    console.log(`   First post: "${posts2.items[0].title}"`);
    console.log(`   Author name: ${posts2.items[0].expand?.authorId?.name}`);
    console.log(`   Author email: ${posts2.items[0].expand?.authorId?.email}`);
    console.log();

    // Test 3: List posts with multiple expands
    console.log('3️⃣ List posts with author + category expand:');
    const posts3 = await pb.collection('posts').getList(1, 10, {
      expand: 'authorId,categoryId'
    });
    console.log(`   First post: "${posts3.items[0].title}"`);
    console.log(`   Author: ${posts3.items[0].expand?.authorId?.name}`);
    console.log(`   Category: ${posts3.items[0].expand?.categoryId?.name}`);
    console.log();

    // Test 4: Get single post with expand
    console.log('4️⃣ Get single post by ID with expand:');
    const post = await pb.collection('posts').getOne('post1xxxxxxxxxx', {
      expand: 'authorId,categoryId'
    });
    console.log(`   Post: "${post.title}"`);
    console.log(`   By: ${post.expand?.authorId?.name}`);
    console.log(`   In: ${post.expand?.categoryId?.name}`);
    console.log();

    // Test 5: Nested expand
    console.log('5️⃣ Comments with nested expand (post.author):');
    const comments = await pb.collection('comments').getList(1, 10, {
      expand: 'postId.authorId,authorId'
    });
    console.log(`   First comment: "${comments.items[0].content}"`);
    console.log(`   Comment by: ${comments.items[0].expand?.authorId?.name}`);
    console.log(`   On post: "${comments.items[0].expand?.postId?.title}"`);
    console.log(`   Post by: ${comments.items[0].expand?.postId?.expand?.authorId?.name}`);
    console.log();

    // Test 6: Create new post
    console.log('6️⃣ Create new post:');
    const newPost = await pb.collection('posts').create({
      title: 'Test Post from SDK',
      content: 'This was created via the PocketBase SDK!',
      authorId: 'user1xxxxxxxxxx',
      categoryId: 'cat1xxxxxxxxxxx',
      published: 1,
      tags: '["test","sdk"]'
    });
    console.log(`   Created: "${newPost.title}"`);
    console.log(`   ID: ${newPost.id}`);
    console.log();

    // Test 7: Update the post
    console.log('7️⃣ Update the post:');
    const updatedPost = await pb.collection('posts').update(newPost.id, {
      title: 'Updated Test Post',
      content: 'Content updated!'
    });
    console.log(`   Updated title: "${updatedPost.title}"`);
    console.log();

    // Test 8: Filter with text search
    console.log('8️⃣ Search posts by title:');
    const searchResults = await pb.collection('posts').getList(1, 10, {
      filter: pb.filter('title ~ {:search}', { search: 'Bun' })
    });
    console.log(`   Found ${searchResults.totalItems} posts matching "Bun"`);
    if (searchResults.items.length > 0) {
      console.log(`   First: "${searchResults.items[0].title}"`);
    }
    console.log();

    // Test 9: Delete the test post
    console.log('9️⃣ Delete test post:');
    await pb.collection('posts').delete(newPost.id);
    console.log(`   Deleted post ${newPost.id}`);
    console.log();

    console.log('✅ All tests passed!');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error(error);
  }
}

testAPI();
