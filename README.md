# PocketBase-Compatible Bun Server

A PocketBase-compatible API server built with Bun and SQLite, focusing on the Records API with full expand support.

## Features

- ✅ **Records API**: Full CRUD operations (list, get, create, update, delete)
- ✅ **Filtering**: PocketBase filter syntax (`status = true && created > '2022-01-01'`)
- ✅ **Sorting**: PocketBase sort syntax (`-created,title`)
- ✅ **Pagination**: Page-based pagination with total counts
- ✅ **Expand**: Full relation expansion support
  - Single relations: `expand=authorId`
  - Multiple relations: `expand=authorId,categoryId`
  - Nested expansion: `expand=comments.authorId`
  - With sorting: `expand=comments(created:desc)`

## Quick Start

### 1. Install dependencies

```bash
cd /Users/mustafa.hanif/code/pb-bun-server
bun install
```

### 2. Setup database

```bash
bun run db:setup
```

This creates sample tables (users, posts, categories, comments) with test data.

### 3. Start server

```bash
bun run dev
```

Server runs on http://localhost:8090

## Usage with PocketBase SDK

```typescript
import PocketBase from 'pocketbase';

const pb = new PocketBase('http://localhost:8090');

// List posts with expanded author and category
const posts = await pb.collection('posts').getList(1, 20, {
  filter: 'published = true',
  sort: '-created',
  expand: 'authorId,categoryId'
});

console.log(posts.items[0].expand.authorId.name); // "John Doe"

// Nested expand: comments with post author
const comments = await pb.collection('comments').getList(1, 20, {
  expand: 'postId.authorId'
});

console.log(comments.items[0].expand.postId.expand.authorId.name);

// Create new post
const newPost = await pb.collection('posts').create({
  title: 'My New Post',
  content: 'Content here...',
  authorId: 'user1xxxxxxxxxx',
  categoryId: 'cat1xxxxxxxxxxx',
  published: 1
});
```

## API Endpoints

### List Records
```
GET /api/collections/{collection}/records
Query params: page, perPage, filter, sort, expand, skipTotal
```

### Get Single Record
```
GET /api/collections/{collection}/records/{id}
Query params: expand
```

### Create Record
```
POST /api/collections/{collection}/records
Body: JSON object with record fields
```

### Update Record
```
PATCH /api/collections/{collection}/records/{id}
Body: JSON object with fields to update
```

### Delete Record
```
DELETE /api/collections/{collection}/records/{id}
```

## Expand Syntax Examples

| Expand | Description |
|--------|-------------|
| `authorId` | Single relation - expand author field |
| `authorId,categoryId` | Multiple fields - expand both |
| `comments.authorId` | Nested - expand comments, then each comment's author |
| `comments(created)` | With sort - expand comments sorted by created ASC |
| `comments(created:desc)` | With desc sort - expand comments sorted by created DESC |

## Filter Syntax

Uses PocketBase filter syntax:

```typescript
// Equality
filter: "status = true"
filter: "age = 25"

// Comparison
filter: "age >= 18"
filter: "created > '2022-01-01'"

// Text matching (LIKE with %)
filter: "title ~ 'test'"  // becomes: title LIKE '%test%'

// Boolean logic
filter: "status = true && published = 1"
filter: "category = 'tech' || category = 'news'"
```

## Sort Syntax

```typescript
// Ascending
sort: "created"

// Descending
sort: "-created"

// Multiple fields
sort: "-created,title"  // created DESC, title ASC
```

## Project Structure

```
src/
  ├── server.ts              # Main server entry point
  ├── api/
  │   └── records.ts         # Records API implementation
  ├── utils/
  │   ├── filter-parser.ts   # PocketBase filter → SQL WHERE
  │   ├── sort-parser.ts     # PocketBase sort → SQL ORDER BY
  │   ├── expand-resolver.ts # Relation expansion logic
  │   └── helpers.ts         # ID generation, timestamps
  └── scripts/
      └── setup-db.ts        # Database initialization
```

## What's NOT Implemented Yet

- ❌ Authentication (auth endpoints)
- ❌ File uploads (file endpoints)
- ❌ Realtime subscriptions (SSE/WebSocket)
- ❌ Collection management API
- ❌ Admin/superuser endpoints

## Notes

- This server is compatible with the official PocketBase JavaScript SDK
- It returns responses in the exact format expected by the SDK
- Schema metadata is stored in `_collections` table for relation definitions
- Relations follow naming conventions: `authorId` → `users` collection
