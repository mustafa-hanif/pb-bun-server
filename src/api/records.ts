import { Hono } from 'hono';
import type { SQL } from 'bun';
import { sql, s3 } from 'bun';
import { FilterParser } from '../utils/filter-parser';
import { SortParser } from '../utils/sort-parser';
import { ExpandResolver } from '../utils/expand-resolver';
import { generateId, getCurrentTimestamp } from '../utils/helpers';
import type { RealtimeAPI } from './realtime';

export class RecordsAPI {
  private db: SQL;
  private filterParser: FilterParser;
  private sortParser: SortParser;
  private expandResolver: ExpandResolver;
  private realtimeAPI?: RealtimeAPI;

  constructor(db: SQL, realtimeAPI?: RealtimeAPI) {
    this.db = db;
    this.filterParser = new FilterParser();
    this.sortParser = new SortParser();
    this.expandResolver = new ExpandResolver(db);
    this.realtimeAPI = realtimeAPI;
  }

  routes() {
    const app = new Hono();

    // List records with pagination, filtering, sorting, and expand
    app.get('/:collection/records', async (c) => {
      const collection = c.req.param('collection');
      const page = Number.parseInt(c.req.query('page') || '1');
      const perPage = Number.parseInt(c.req.query('perPage') || '30');
      const filter = c.req.query('filter');
      const sort = c.req.query('sort');
      const expand = c.req.query('expand');
      const skipTotal = c.req.query('skipTotal') === 'true' || c.req.query('skipTotal') === '1';

      try {
        // Parse filter to get WHERE clause
        let filterParsed = null;
        if (filter) {
          filterParsed = this.filterParser.parse(filter);
        }

        // Build and execute main query using unsafe (due to dynamic table name and filter SQL)
        const offset = (page - 1) * perPage;
        let queryStr = `SELECT * FROM ${collection}`;
        
        if (filterParsed) {
          queryStr += ` WHERE ${filterParsed.sql}`;
        }
        
        if (sort) {
          queryStr += ` ORDER BY ${this.sortParser.parse(sort)}`;
        }
        
        queryStr += ` LIMIT ${perPage} OFFSET ${offset}`;
        
        let items = await this.db.unsafe(queryStr, filterParsed?.values || []);

        // Get total count (unless skipTotal is true)
        let totalItems = -1;
        let totalPages = -1;

        if (!skipTotal) {
          let countQuery = `SELECT COUNT(*) as count FROM ${collection}`;
          if (filterParsed) {
            countQuery += ` WHERE ${filterParsed.sql}`;
            const result = await this.db.unsafe(countQuery, filterParsed.values);
            totalItems = result[0].count;
          } else {
            const result = await this.db`SELECT COUNT(*) as count FROM ${sql(collection)}`;
            totalItems = result[0].count;
          }
          totalPages = Math.ceil(totalItems / perPage);
        }

        // Apply expand (resolve relations)
        if (expand) {
          items = await this.expandResolver.resolve(items, collection, expand);
        }

        // Parse JSON arrays back to arrays for all items
        items = items.map((item: any) => {
          for (const key in item) {
            if (typeof item[key] === 'string' && item[key].startsWith('[')) {
              try {
                item[key] = JSON.parse(item[key]);
              } catch {
                // Not JSON, leave as string
              }
            }
          }
          // Add collectionName for file URL building
          item.collectionName = collection;
          return item;
        });

        return c.json({
          page,
          perPage,
          totalItems,
          totalPages,
          items,
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

    // Get single record by ID
    app.get('/:collection/records/:id', async (c) => {
      const collection = c.req.param('collection');
      const id = c.req.param('id');
      const expand = c.req.query('expand');

      try {
        // Use tagged template literal for safe ID parameter binding
        const results = await this.db`SELECT * FROM ${sql(collection)} WHERE id = ${id}`;
        let record = results[0];

        if (!record) {
          return c.json(
            {
              code: 404,
              message: 'The requested resource wasn\'t found.',
              data: {},
            },
            404
          );
        }

        // Parse JSON arrays back to arrays
        for (const key in record) {
          if (typeof record[key] === 'string' && record[key].startsWith('[')) {
            try {
              record[key] = JSON.parse(record[key]);
            } catch {
              // Not JSON, leave as string
            }
          }
        }

        // Add collectionName for file URL building
        record.collectionName = collection;

        // Apply expand
        if (expand) {
          const expanded = await this.expandResolver.resolve([record], collection, expand);
          record = expanded[0];
        }

        return c.json(record);
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

    // Create new record
    app.post('/:collection/records', async (c) => {
      const collection = c.req.param('collection');
      
      try {
        // Handle both JSON and FormData (for file uploads)
        let body: any;
        const contentType = c.req.header('content-type') || '';
        
        if (contentType.includes('multipart/form-data')) {
          const formData = await c.req.formData();
          body = {};
          
          // Check if S3 is configured
          const useS3 = !!(process.env.S3_BUCKET || process.env.AWS_BUCKET);
          
          // Convert FormData to object, handling files
          for (const [key, value] of formData.entries()) {
            // Remove + or - prefix from field names (used by SDK for file operations)
            const cleanKey = key.replace(/^[+-]|[+-]$/g, '');
            
            if (typeof value === 'object' && 'name' in value) {
              // It's a File - upload to S3 if configured
              const file = value as File;
              
              if (useS3) {
                // Upload to S3
                const originalName = file.name || 'file.bin';
                const filename = `${Date.now()}_${Math.random().toString(36).substring(7)}_${originalName}`;
                const s3Path = `uploads/${collection}/${filename}`;
                const s3File = s3.file(s3Path);
                await s3File.write(file);
                
                // Store filename in database
                if (body[cleanKey]) {
                  // Append to existing array
                  if (Array.isArray(body[cleanKey])) {
                    body[cleanKey].push(filename);
                  } else {
                    body[cleanKey] = [body[cleanKey], filename];
                  }
                } else {
                  body[cleanKey] = filename;
                }
              } else {
                // No S3 - store null (files won't work without S3)
                body[cleanKey] = null;
              }
            } else {
              // Regular field
              if (body[cleanKey]) {
                // Append to existing array
                if (Array.isArray(body[cleanKey])) {
                  body[cleanKey].push(value);
                } else {
                  body[cleanKey] = [body[cleanKey], value];
                }
              } else {
                body[cleanKey] = value;
              }
            }
          }
        } else {
          body = await c.req.json();
        }
        
        // Generate ID and timestamps
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

        // Use sql() helper for inserting object
        await this.db`INSERT INTO ${sql(collection)} ${sql(record)}`;

        // Fetch and return the created record
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

        // Broadcast realtime event
        if (this.realtimeAPI) {
          this.realtimeAPI.broadcastEvent(collection, 'create', createdRecord);
        }
        
        return c.json(createdRecord);
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

    // Update existing record
    app.patch('/:collection/records/:id', async (c) => {
      const collection = c.req.param('collection');
      const id = c.req.param('id');

      try {
        // Handle both JSON and FormData (for file uploads)
        let body: any;
        const contentType = c.req.header('content-type') || '';
        
        if (contentType.includes('multipart/form-data')) {
          const formData = await c.req.formData();
          body = {};
          
          // Check if S3 is configured
          const useS3 = !!(process.env.S3_BUCKET || process.env.AWS_BUCKET);
          
          // Convert FormData to object, handling files
          for (const [key, value] of formData.entries()) {
            // Remove + or - prefix from field names
            const cleanKey = key.replace(/^[+-]|[+-]$/g, '');
            
            if (typeof value === 'object' && 'name' in value) {
              // It's a File - upload to S3 if configured
              const file = value as File;
              
              if (useS3) {
                // Upload to S3
                const originalName = file.name || 'file.bin';
                const filename = `${Date.now()}_${Math.random().toString(36).substring(7)}_${originalName}`;
                const s3Path = `uploads/${collection}/${filename}`;
                const s3File = s3.file(s3Path);
                await s3File.write(file);
                
                // Store filename in database
                if (body[cleanKey]) {
                  // Append to existing array
                  if (Array.isArray(body[cleanKey])) {
                    body[cleanKey].push(filename);
                  } else {
                    body[cleanKey] = [body[cleanKey], filename];
                  }
                } else {
                  body[cleanKey] = filename;
                }
              } else {
                // No S3 - store null
                body[cleanKey] = null;
              }
            } else {
              // Regular field
              if (body[cleanKey]) {
                // Append to existing array
                if (Array.isArray(body[cleanKey])) {
                  body[cleanKey].push(value);
                } else {
                  body[cleanKey] = [body[cleanKey], value];
                }
              } else {
                body[cleanKey] = value;
              }
            }
          }
        } else {
          body = await c.req.json();
          
          // Handle null file deletion - convert to empty string per PocketBase convention
          for (const key in body) {
            if (body[key] === null) {
              body[key] = '';
            }
          }
        }
        
        // Add updated timestamp
        const updates = {
          ...body,
          updated: getCurrentTimestamp(),
        };

        // Convert arrays to JSON strings for SQLite
        for (const key in updates) {
          if (Array.isArray(updates[key])) {
            updates[key] = JSON.stringify(updates[key]);
          }
        }

        // Use sql() helper for update
        await this.db`UPDATE ${sql(collection)} SET ${sql(updates)} WHERE id = ${id}`;

        // Fetch and return the updated record
        const results = await this.db`SELECT * FROM ${sql(collection)} WHERE id = ${id}`;
        const updatedRecord = results[0];

        if (!updatedRecord) {
          return c.json(
            {
              code: 404,
              message: 'The requested resource wasn\'t found.',
              data: {},
            },
            404
          );
        }

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

        // Broadcast realtime event
        if (this.realtimeAPI) {
          this.realtimeAPI.broadcastEvent(collection, 'update', updatedRecord);
        }

        return c.json(updatedRecord);
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

    // Delete record
    app.delete('/:collection/records/:id', async (c) => {
      const collection = c.req.param('collection');
      const id = c.req.param('id');

      try {
        // Fetch the record before deleting (for realtime broadcast)
        let deletedRecord = null;
        if (this.realtimeAPI) {
          const results = await this.db`SELECT * FROM ${sql(collection)} WHERE id = ${id}`;
          deletedRecord = results[0];
          if (deletedRecord) {
            deletedRecord.collectionName = collection;
          }
        }

        // Use tagged template literal for DELETE
        await this.db`DELETE FROM ${sql(collection)} WHERE id = ${id}`;

        // Broadcast realtime event
        if (this.realtimeAPI && deletedRecord) {
          this.realtimeAPI.broadcastEvent(collection, 'delete', deletedRecord);
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

    return app;
  }
}
