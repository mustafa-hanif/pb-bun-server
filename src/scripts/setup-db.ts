import { SQL, sql } from 'bun';

const db = new SQL('sqlite://data.db');

console.log('Setting up database...');

// Create sample tables

// Posts table
await db`
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    created TEXT NOT NULL,
    updated TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    authorId TEXT,
    categoryId TEXT,
    tags TEXT,
    published INTEGER DEFAULT 0,
    attachment TEXT,
    attachments TEXT
  )
`;

// Users table
await db`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    created TEXT NOT NULL,
    updated TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE,
    password TEXT NOT NULL,
    avatar TEXT,
    verified INTEGER DEFAULT 0
  )
`;

// Superusers table (admins)
await db`
  CREATE TABLE IF NOT EXISTS _superusers (
    id TEXT PRIMARY KEY,
    created TEXT NOT NULL,
    updated TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE,
    password TEXT NOT NULL,
    avatar TEXT,
    verified INTEGER DEFAULT 1
  )
`;

// Categories table
await db`
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    created TEXT NOT NULL,
    updated TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL
  )
`;

// Comments table (for nested expand example)
await db`
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    created TEXT NOT NULL,
    updated TEXT NOT NULL,
    postId TEXT NOT NULL,
    authorId TEXT NOT NULL,
    content TEXT NOT NULL
  )
`;

// Schema metadata table (optional - for relation definitions)
await db`
  CREATE TABLE IF NOT EXISTS _collections (
    name TEXT PRIMARY KEY,
    schema TEXT NOT NULL
  )
`;

// Insert schema metadata
const schemas = [
  {
    name: 'posts',
    schema: JSON.stringify({
      fields: {
        authorId: { collection: 'users', type: 'single' },
        categoryId: { collection: 'categories', type: 'single' },
        tags: { collection: 'tags', type: 'multiple' },
      },
    }),
  },
  {
    name: 'comments',
    schema: JSON.stringify({
      fields: {
        postId: { collection: 'posts', type: 'single' },
        authorId: { collection: 'users', type: 'single' },
      },
    }),
  },
];

for (const schema of schemas) {
  await db`
    INSERT OR REPLACE INTO ${sql('_collections')} 
    (name, schema) 
    VALUES (${schema.name}, ${schema.schema})
  `;
}

// Insert sample data
const now = new Date().toISOString().replace('T', ' ').replace('Z', '');

// Sample users
const users = [
  { id: 'user1xxxxxxxxxx', name: 'Alice Johnson', email: 'alice@example.com', username: 'alice', password: 'password123' },
  { id: 'user2xxxxxxxxxx', name: 'Bob Smith', email: 'bob@example.com', username: 'bob', password: 'password123' },
  { id: 'user3xxxxxxxxxx', name: 'Charlie Brown', email: 'charlie@example.com', username: 'charlie', password: 'password123' },
];

for (const user of users) {
  await db`
    INSERT OR IGNORE INTO ${sql('users')} 
    (id, created, updated, name, email, username, password, verified) 
    VALUES (${user.id}, ${now}, ${now}, ${user.name}, ${user.email}, ${user.username}, ${user.password}, 1)
  `;
}

// Sample superusers (admins)
const superusers = [
  { id: 'admin1xxxxxxxxx', name: 'Admin User', email: 'admin@example.com', username: 'admin', password: 'admin123' },
];

for (const superuser of superusers) {
  await db`
    INSERT OR IGNORE INTO ${sql('_superusers')} 
    (id, created, updated, name, email, username, password, verified) 
    VALUES (${superuser.id}, ${now}, ${now}, ${superuser.name}, ${superuser.email}, ${superuser.username}, ${superuser.password}, 1)
  `;
}

// Sample categories
const categories = [
  { id: 'cat1xxxxxxxxxxx', name: 'Technology', slug: 'technology' },
  { id: 'cat2xxxxxxxxxxx', name: 'Lifestyle', slug: 'lifestyle' },
];

for (const cat of categories) {
  await db`
    INSERT OR IGNORE INTO ${sql('categories')} 
    (id, created, updated, name, slug) 
    VALUES (${cat.id}, ${now}, ${now}, ${cat.name}, ${cat.slug})
  `;
}

// Sample posts
const posts = [
  {
    id: 'post1xxxxxxxxxx',
    title: 'Introduction to Bun',
    content: 'Bun is a fast JavaScript runtime...',
    authorId: 'user1xxxxxxxxxx',
    categoryId: 'cat1xxxxxxxxxxx',
    tags: '["javascript","bun","performance"]',
    published: 1,
  },
  {
    id: 'post2xxxxxxxxxx',
    title: 'Healthy Living Tips',
    content: 'Here are some tips for healthy living...',
    authorId: 'user2xxxxxxxxxx',
    categoryId: 'cat2xxxxxxxxxxx',
    tags: '["health","wellness"]',
    published: 1,
  },
  {
    id: 'post3xxxxxxxxxx',
    title: 'Draft Post',
    content: 'This is a draft...',
    authorId: 'user1xxxxxxxxxx',
    categoryId: 'cat1xxxxxxxxxxx',
    tags: '[]',
    published: 0,
  },
];

for (const post of posts) {
  await db`
    INSERT OR IGNORE INTO ${sql('posts')} 
    (id, created, updated, title, content, authorId, categoryId, tags, published) 
    VALUES (${post.id}, ${now}, ${now}, ${post.title}, ${post.content}, 
            ${post.authorId}, ${post.categoryId}, ${post.tags}, ${post.published})
  `;
}

// Sample comments
const comments = [
  {
    id: 'comm1xxxxxxxxxx',
    postId: 'post1xxxxxxxxxx',
    authorId: 'user2xxxxxxxxxx',
    content: 'Great article!',
  },
  {
    id: 'comm2xxxxxxxxxx',
    postId: 'post1xxxxxxxxxx',
    authorId: 'user3xxxxxxxxxx',
    content: 'Very informative.',
  },
  {
    id: 'comm3xxxxxxxxxx',
    postId: 'post2xxxxxxxxxx',
    authorId: 'user1xxxxxxxxxx',
    content: 'Thanks for sharing!',
  },
];

for (const comment of comments) {
  await db`
    INSERT OR IGNORE INTO ${sql('comments')} 
    (id, created, updated, postId, authorId, content) 
    VALUES (${comment.id}, ${now}, ${now}, ${comment.postId}, 
            ${comment.authorId}, ${comment.content})
  `;
}

console.log('✅ Database setup complete!');
console.log('');
console.log('Sample data created:');
console.log('  - 3 users');
console.log('  - 1 superuser (admin@example.com / admin123)');
console.log('  - 2 categories');
console.log('  - 3 posts');
console.log('  - 3 comments');
console.log('');
console.log('Try these queries with the PocketBase SDK:');
console.log('  pb.collection("posts").getList(1, 10, { expand: "authorId,categoryId" })');
console.log('  pb.collection("comments").getList(1, 10, { expand: "postId.authorId" })');
console.log('  pb.collection("_superusers").authWithPassword("admin@example.com", "admin123")');
console.log('  pb.collection("users").impersonate("user1xxxxxxxxxx", 3600)');

await db.close();
