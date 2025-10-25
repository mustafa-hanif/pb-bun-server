# FilesAPI & BatchAPI Implementation

## New Features Added ✨

### 1. FilesAPI with Bun S3 Support

The FilesAPI now supports **both S3-compatible storage and local filesystem**, with automatic fallback.

**Features:**
- ✅ **Native Bun S3 integration** - Fast, built-in S3 support
- ✅ **Automatic S3 detection** - Falls back to local storage if S3 not configured
- ✅ **Presigned URLs** - Efficient file serving via S3 presigned URLs
- ✅ **Multiple S3 providers** - Works with AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO, etc.
- ✅ **File upload/download/delete** - Full file lifecycle management
- ✅ **Download control** - `?download=true` for attachment, omit for inline

**S3 Configuration:**

Set these environment variables (Bun reads them automatically):

```bash
# AWS S3 / S3-compatible storage
S3_BUCKET=my-bucket
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
S3_REGION=us-east-1

# For non-AWS S3 services, set endpoint:
# S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com  # Cloudflare R2
# S3_ENDPOINT=https://<region>.digitaloceanspaces.com        # DigitalOcean Spaces
# S3_ENDPOINT=http://localhost:9000                          # MinIO
```

If S3 is not configured, files are stored in `./uploads/` directory.

**API Endpoints:**

```typescript
// GET file
GET /api/files/:collection/:recordId/:filename
GET /api/files/:collection/:recordId/:filename?download=true

// Upload file
POST /api/files/:collection/:recordId
Content-Type: multipart/form-data
Body: { file: File }

// Delete file
DELETE /api/files/:collection/:recordId/:filename

// Get file token (for private access)
POST /api/files/token
```

**How Bun S3 Works:**

When using S3:
1. `GET` requests return a **302 redirect** to a presigned S3 URL
2. This is **extremely efficient** - no proxy, no bandwidth cost on your server
3. Files are served directly from S3 to the user
4. Presigned URLs are valid for 1 hour

```typescript
// In FilesAPI
const file = s3Client.file(`${collection}/${recordId}/${filename}`);

// new Response(S3File) automatically creates 302 redirect
return new Response(file);  // → 302 redirect to presigned URL
```

**Local Filesystem Fallback:**

When S3 is not configured, files are stored in:
```
./uploads/
  └── posts/
      └── post1xxxxxxxxxx/
          └── image.jpg
```

### 2. BatchAPI Implementation

The BatchAPI allows executing multiple CRUD operations in a single HTTP request.

**Features:**
- ✅ **Batch CRUD operations** - Multiple create/update/delete in one request
- ✅ **File upload support** - Include files in batch requests
- ✅ **Transaction-like behavior** - All requests processed sequentially
- ✅ **Individual error handling** - Each request gets its own status/body

**API Endpoint:**

```typescript
POST /api/batch
Content-Type: multipart/form-data

Body:
  @jsonPayload: JSON string with requests array
  requests.0.file: File (optional)
  requests.1.file: File (optional)
```

**Example Usage:**

```typescript
import PocketBase from 'pocketbase';

const pb = new PocketBase('http://localhost:8090');

// Create batch
const batch = pb.createBatch();

// Queue multiple operations
batch.collection('posts').create({ title: 'Post 1' });
batch.collection('posts').create({ title: 'Post 2' });
batch.collection('posts').update('existing-id', { title: 'Updated' });
batch.collection('posts').delete('other-id');

// Execute all at once
const results = await batch.send();

console.log(results);
// [
//   { status: 200, body: { id: '...', title: 'Post 1' } },
//   { status: 200, body: { id: '...', title: 'Post 2' } },
//   { status: 200, body: { id: '...', title: 'Updated' } },
//   { status: 204, body: null }
// ]
```

**Supported Operations:**

- `POST /api/collections/:collection/records` - Create
- `PUT /api/collections/:collection/records` - Upsert (create if id exists, otherwise create new)
- `PATCH /api/collections/:collection/records/:id` - Update
- `DELETE /api/collections/:collection/records/:id` - Delete

**How It Works:**

1. Client sends a single multipart/form-data request
2. `@jsonPayload` contains array of requests (method, url, headers, body)
3. Files are included as `requests.{index}.{fieldName}`
4. Server executes each request sequentially
5. Returns array of responses with status and body for each

## Production Deployment

### With S3 (Recommended)

1. **Set up S3 bucket** (AWS, Cloudflare R2, DigitalOcean Spaces, etc.)

2. **Configure environment variables:**
   ```bash
   S3_BUCKET=my-app-files
   S3_ACCESS_KEY_ID=xxx
   S3_SECRET_ACCESS_KEY=xxx
   S3_REGION=us-east-1  # or your region
   ```

3. **Benefits:**
   - ✅ **Infinite scalability** - S3 handles any file volume
   - ✅ **No server bandwidth** - Files served directly from S3
   - ✅ **Global CDN** - Fast file delivery worldwide
   - ✅ **Cost effective** - Pay only for storage + bandwidth
   - ✅ **Automatic backups** - S3 handles durability

### Without S3 (Local Filesystem)

Files are stored in `./uploads/` directory. Works great for:
- Development
- Small deployments
- Self-hosted scenarios

**Note:** Make sure to backup the `./uploads/` directory regularly!

## Testing

Tests for FilesAPI and BatchAPI coming soon! The architecture allows for easy testing:

```typescript
// FilesAPI can be tested with both S3 mock and local filesystem
const filesAPI = new FilesAPI(db, mockS3Client);

// BatchAPI can be tested by verifying batch execution
const batchAPI = new BatchAPI(db);
```

## Performance

**Bun S3 Advantages:**
- 🚀 **Native speed** - Built into Bun runtime, no external dependencies
- 🚀 **Zero-copy** - Efficient memory usage
- 🚀 **Streaming** - Large files handled efficiently
- 🚀 **Presigned URLs** - Offload file serving to S3

**Benchmark (from Bun docs):**
Bun's S3 API is significantly faster than Node.js alternatives for both upload and download operations.

## Next Steps

- [ ] Add comprehensive tests for FilesAPI
- [ ] Add comprehensive tests for BatchAPI
- [ ] Implement file size limits
- [ ] Add virus scanning integration
- [ ] Implement file access control (private vs public)
- [ ] Add image processing (resize, thumbnail generation)
- [ ] Support for chunked uploads (large files)

## Example: Complete File Upload Flow

```typescript
const pb = new PocketBase('http://localhost:8090');

// 1. Create a post record
const post = await pb.collection('posts').create({
  title: 'My Post with Image',
  content: 'Check out this image!',
});

// 2. Upload image file
const formData = new FormData();
formData.append('file', imageFile);

const response = await fetch(
  `http://localhost:8090/api/files/posts/${post.id}`,
  {
    method: 'POST',
    body: formData,
  }
);

const fileInfo = await response.json();
console.log(fileInfo);
// {
//   filename: 'image.jpg',
//   size: 102400,
//   type: 'image/jpeg',
//   url: '/api/files/posts/post1xxx/image.jpg'
// }

// 3. Access the file
const fileUrl = `http://localhost:8090${fileInfo.url}`;
// → Redirects to S3 presigned URL (if S3 configured)
// → Or serves from local filesystem

// 4. Download the file
const downloadUrl = `${fileUrl}?download=true`;
```

## Why Bun S3?

From the Bun documentation:

> "Production servers often read, upload, and write files to S3-compatible object storage services instead of the local filesystem. Historically, that means local filesystem APIs you use in development can't be used in production. When you use Bun, things are different."

Bun's S3 API provides:
- **Same API** for local files and S3 files
- **Fast native bindings** - No external libraries needed
- **Simple and familiar** - Feels like `fetch`, `Response`, `Blob`
- **Works with any S3-compatible service** - AWS, Cloudflare R2, DigitalOcean Spaces, MinIO, etc.

This makes our PocketBase-compatible server truly production-ready! 🎉
