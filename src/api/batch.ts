import { Hono } from 'hono';
import type { SQL } from 'bun';
import { sql } from 'bun';
import { RecordsAPI } from './records';

interface BatchRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: any;
}

interface BatchRequestPayload {
  requests: BatchRequest[];
}

interface BatchResponse {
  status: number;
  body: any;
}

export class BatchAPI {
  private readonly db: SQL;
  private readonly recordsAPI: RecordsAPI;

  constructor(db: SQL) {
    this.db = db;
    this.recordsAPI = new RecordsAPI(db);
  }

  routes() {
    const app = new Hono();

    // POST /api/batch - Execute batch requests
    app.post('/', async (c) => {
      try {
        const formData = await c.req.formData();
        const jsonPayload = formData.get('@jsonPayload') as string;

        if (!jsonPayload) {
          return c.json(
            {
              code: 400,
              message: 'Missing @jsonPayload in request.',
              data: {},
            },
            400
          );
        }

        const payload: BatchRequestPayload = JSON.parse(jsonPayload);
        const responses: BatchResponse[] = [];

        // Process each request in the batch
        for (let i = 0; i < payload.requests.length; i++) {
          const request = payload.requests[i];
          
          try {
            const result = await this.executeRequest(request, formData, i);
            responses.push(result);
          } catch (error: any) {
            // If a request fails, return error response for that request
            responses.push({
              status: error.status || 400,
              body: {
                code: error.status || 400,
                message: error.message || 'Request failed',
                data: {},
              },
            });
          }
        }

        return c.json(responses);
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

  private async executeRequest(
    request: BatchRequest,
    formData: FormData,
    requestIndex: number
  ): Promise<BatchResponse> {
    // Parse URL to extract collection and record info
    // Expected formats:
    // POST   /api/collections/:collection/records
    // PUT    /api/collections/:collection/records (upsert)
    // PATCH  /api/collections/:collection/records/:id
    // DELETE /api/collections/:collection/records/:id

    const urlMatch = request.url.match(/\/api\/collections\/([^/]+)\/records(?:\/([^/?]+))?/);
    if (!urlMatch) {
      throw new Error(`Invalid URL format: ${request.url}`);
    }

    const collection = decodeURIComponent(urlMatch[1]);
    const recordId = urlMatch[2] ? decodeURIComponent(urlMatch[2]) : undefined;

    // Extract query parameters from URL
    const queryParams: Record<string, string> = {};
    const urlObj = new URL(request.url, 'http://dummy.com');
    urlObj.searchParams.forEach((value, key) => {
      queryParams[key] = value;
    });

    // Merge files from formData into body
    const body = { ...request.body };
    const filePrefix = `requests.${requestIndex}.`;
    
    // Check if S3 is configured
    const useS3 = !!(process.env.S3_BUCKET || process.env.AWS_BUCKET);
    
    for (const [key, value] of formData.entries()) {
      if (key.startsWith(filePrefix)) {
        const fieldName = key.substring(filePrefix.length);
        
        // Check if this is a file
        if (typeof value === 'object' && 'name' in value) {
          const file = value as File;
          
          if (useS3) {
            // Upload to S3
            const { s3 } = await import('bun');
            const originalName = file.name || 'file.bin';
            const filename = `${Date.now()}_${Math.random().toString(36).substring(7)}_${originalName}`;
            const s3Path = `uploads/${collection}/${filename}`;
            const s3File = s3.file(s3Path);
            await s3File.write(file);
            
            // Store filename in body
            if (!body[fieldName]) {
              body[fieldName] = filename;
            } else if (Array.isArray(body[fieldName])) {
              body[fieldName].push(filename);
            } else {
              body[fieldName] = [body[fieldName], filename];
            }
          } else {
            // No S3 configured, store null
            body[fieldName] = null;
          }
        } else {
          // Regular field value
          if (!body[fieldName]) {
            body[fieldName] = value;
          } else if (Array.isArray(body[fieldName])) {
            body[fieldName].push(value);
          } else {
            body[fieldName] = [body[fieldName], value];
          }
        }
      }
    }

    // Execute the appropriate operation
    switch (request.method.toUpperCase()) {
      case 'POST':
        return await this.handleCreate(collection, body, queryParams);
      
      case 'PUT':
        // Upsert - create if id exists in body, otherwise create new
        if (body.id) {
          return await this.handleUpdate(collection, body.id, body, queryParams);
        } else {
          return await this.handleCreate(collection, body, queryParams);
        }
      
      case 'PATCH':
        if (!recordId) {
          throw new Error('Record ID required for PATCH');
        }
        return await this.handleUpdate(collection, recordId, body, queryParams);
      
      case 'DELETE':
        if (!recordId) {
          throw new Error('Record ID required for DELETE');
        }
        return await this.handleDelete(collection, recordId);
      
      default:
        throw new Error(`Unsupported method: ${request.method}`);
    }
  }

  private async handleCreate(
    collection: string,
    body: any,
    queryParams: Record<string, string>
  ): Promise<BatchResponse> {
    const { generateId, getCurrentTimestamp } = await import('../utils/helpers');
    
    const newId = generateId();
    const now = getCurrentTimestamp();
    
    const record = {
      id: newId,
      created: now,
      updated: now,
      ...body,
    };

    // Convert arrays to JSON strings for SQLite
    for (const key in record) {
      if (Array.isArray(record[key])) {
        record[key] = JSON.stringify(record[key]);
      }
    }

    await this.db`INSERT INTO ${sql(collection)} ${sql(record)}`;

    const results = await this.db`SELECT * FROM ${sql(collection)} WHERE id = ${newId}`;
    const createdRecord = results[0];
    
    // Parse JSON arrays back to arrays
    for (const key in createdRecord) {
      if (typeof createdRecord[key] === 'string' && createdRecord[key].startsWith('[')) {
        try {
          createdRecord[key] = JSON.parse(createdRecord[key]);
        } catch {
          // Not JSON, leave as string
        }
      }
    }
    
    // Add collectionName for file URL building
    createdRecord.collectionName = collection;
    
    return {
      status: 200,
      body: createdRecord,
    };
  }

  private async handleUpdate(
    collection: string,
    id: string,
    body: any,
    queryParams: Record<string, string>
  ): Promise<BatchResponse> {
    const { getCurrentTimestamp } = await import('../utils/helpers');
    
    const updates = {
      ...body,
      updated: getCurrentTimestamp(),
    };

    // Remove id from updates
    delete updates.id;

    // Convert arrays to JSON strings for SQLite
    for (const key in updates) {
      if (Array.isArray(updates[key])) {
        updates[key] = JSON.stringify(updates[key]);
      }
    }

    await this.db`UPDATE ${sql(collection)} SET ${sql(updates)} WHERE id = ${id}`;

    const results = await this.db`SELECT * FROM ${sql(collection)} WHERE id = ${id}`;
    
    if (!results || results.length === 0) {
      return {
        status: 404,
        body: {
          code: 404,
          message: 'Record not found.',
          data: {},
        },
      };
    }

    const updatedRecord = results[0];
    
    // Parse JSON arrays back to arrays
    for (const key in updatedRecord) {
      if (typeof updatedRecord[key] === 'string' && updatedRecord[key].startsWith('[')) {
        try {
          updatedRecord[key] = JSON.parse(updatedRecord[key]);
        } catch {
          // Not JSON, leave as string
        }
      }
    }
    
    // Add collectionName for file URL building
    updatedRecord.collectionName = collection;

    return {
      status: 200,
      body: updatedRecord,
    };
  }

  private async handleDelete(collection: string, id: string): Promise<BatchResponse> {
    await this.db`DELETE FROM ${sql(collection)} WHERE id = ${id}`;
    
    return {
      status: 204,
      body: null,
    };
  }
}
