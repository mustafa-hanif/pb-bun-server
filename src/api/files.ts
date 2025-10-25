import { Hono } from 'hono';
import type { SQL } from 'bun';
import { s3, S3Client, sql } from 'bun';

export class FilesAPI {
  private readonly db: SQL;
  private readonly s3Client: S3Client;
  private readonly useS3: boolean;

  constructor(db: SQL, s3Client?: S3Client) {
    this.db = db;
    
    // Use provided S3 client or create one from environment variables
    // If no S3 credentials are set, fall back to local filesystem
    this.s3Client = s3Client || s3;
    
    // Check if S3 is configured (Bun will read from env vars like S3_BUCKET, S3_ACCESS_KEY_ID, etc.)
    this.useS3 = !!(process.env.S3_BUCKET || process.env.AWS_BUCKET);
  }

  routes() {
    const app = new Hono();

    // Serve file - GET /api/files/:collection/:recordId/:filename
    app.get('/:collection/:recordId/:filename', async (c) => {
      const collection = c.req.param('collection');
      const recordId = c.req.param('recordId');
      const filename = c.req.param('filename');

      try {
        // Verify record exists
        const records = await this.db`SELECT * FROM ${sql(collection)} WHERE id = ${recordId}`;
        if (!records || records.length === 0) {
          return c.json(
            {
              code: 404,
              message: 'Record not found.',
              data: {},
            },
            404
          );
        }

        if (this.useS3) {
          // Use S3 for file storage
          const s3Path = `${collection}/${recordId}/${filename}`;
          const file = this.s3Client.file(s3Path);

          // Check if file exists
          const exists = await file.exists();
          if (!exists) {
            return c.json(
              {
                code: 404,
                message: 'File not found.',
                data: {},
              },
              404
            );
          }

          // Check for download query param
          const download = c.req.query('download');
          
          if (download !== undefined && download !== 'false') {
            // Generate presigned URL for download
            const presignedUrl = file.presign({
              expiresIn: 3600, // 1 hour
              method: 'GET',
            });
            
            // Redirect to presigned URL
            return c.redirect(presignedUrl);
          } else {
            // Stream file directly from S3
            // new Response(S3File) automatically creates a 302 redirect to presigned URL
            return new Response(file);
          }
        } else {
          // Use local filesystem as fallback
          const localPath = `./uploads/${collection}/${recordId}/${filename}`;
          const file = Bun.file(localPath);
          
          const exists = await file.exists();
          if (!exists) {
            return c.json(
              {
                code: 404,
                message: 'File not found.',
                data: {},
              },
              404
            );
          }

          const download = c.req.query('download');
          const disposition = download !== undefined && download !== 'false'
            ? `attachment; filename="${filename}"`
            : 'inline';

          return new Response(file, {
            headers: {
              'Content-Type': file.type || 'application/octet-stream',
              'Content-Disposition': disposition,
            },
          });
        }
      } catch (error: any) {
        return c.json(
          {
            code: 400,
            message: error.message,
            data: {},
          },
          400
        );
      }
    });

    // Upload file - POST /api/files/:collection/:recordId
    app.post('/:collection/:recordId', async (c) => {
      const collection = c.req.param('collection');
      const recordId = c.req.param('recordId');

      try {
        // Verify record exists
        const records = await this.db`SELECT * FROM ${sql(collection)} WHERE id = ${recordId}`;
        if (!records || records.length === 0) {
          return c.json(
            {
              code: 404,
              message: 'Record not found.',
              data: {},
            },
            404
          );
        }

        const formData = await c.req.formData();
        const file = formData.get('file') as File;

        if (!file) {
          return c.json(
            {
              code: 400,
              message: 'No file provided.',
              data: {},
            },
            400
          );
        }

        const filename = file.name;

        if (this.useS3) {
          // Upload to S3
          const s3Path = `${collection}/${recordId}/${filename}`;
          const s3File = this.s3Client.file(s3Path);
          
          // Write file to S3
          await s3File.write(file, {
            type: file.type,
          });

          return c.json({
            filename,
            size: file.size,
            type: file.type,
            url: `/api/files/${collection}/${recordId}/${filename}`,
          });
        } else {
          // Save to local filesystem
          const localPath = `./uploads/${collection}/${recordId}/${filename}`;
          await Bun.write(localPath, file);

          return c.json({
            filename,
            size: file.size,
            type: file.type,
            url: `/api/files/${collection}/${recordId}/${filename}`,
          });
        }
      } catch (error: any) {
        return c.json(
          {
            code: 400,
            message: error.message,
            data: {},
          },
          400
        );
      }
    });

    // Delete file - DELETE /api/files/:collection/:recordId/:filename
    app.delete('/:collection/:recordId/:filename', async (c) => {
      const collection = c.req.param('collection');
      const recordId = c.req.param('recordId');
      const filename = c.req.param('filename');

      try {
        if (this.useS3) {
          // Delete from S3
          const s3Path = `${collection}/${recordId}/${filename}`;
          const file = this.s3Client.file(s3Path);
          await file.delete();
        } else {
          // Delete from local filesystem
          const localPath = `./uploads/${collection}/${recordId}/${filename}`;
          const file = Bun.file(localPath);
          await file.unlink();
        }

        return c.body(null, 204);
      } catch (error: any) {
        return c.json(
          {
            code: 400,
            message: error.message,
            data: {},
          },
          400
        );
      }
    });

    // Get file token (for private file access) - POST /api/files/token
    app.post('/token', async (c) => {
      try {
        // Generate a simple token (in production, use proper JWT or session)
        const token = Buffer.from(Date.now().toString()).toString('base64');
        
        return c.json({
          token,
        });
      } catch (error: any) {
        return c.json(
          {
            code: 400,
            message: error.message,
            data: {},
          },
          400
        );
      }
    });

    return app;
  }
}
