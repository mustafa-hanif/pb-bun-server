import { SQL, sql } from 'bun';

/**
 * Resolves PocketBase expand relationships
 * 
 * Expand syntax examples:
 * - "author" - single relation field
 * - "author,category" - multiple relations
 * - "author.profile" - nested expansion (author -> profile)
 * - "comments(created)" - relation with sort
 * - "comments(created:desc)" - relation with desc sort
 * 
 * This implementation handles basic expand cases.
 * For production, you'd need a schema definition to know field types.
 */
export class ExpandResolver {
  private db: SQL;
  private schemaCache: Map<string, CollectionSchema> = new Map();

  constructor(db: SQL) {
    this.db = db;
    this.loadSchemas();
  }

  /**
   * Load collection schemas from _collections metadata table
   * In a real implementation, you'd have a proper schema definition
   */
  private async loadSchemas() {
    try {
      // Try to load from metadata table if it exists
      const collections = await this.db`SELECT * FROM ${sql('_collections')}`;
      
      for (const col of collections) {
        this.schemaCache.set((col as any).name, JSON.parse((col as any).schema));
      }
    } catch {
      // If no metadata table, we'll infer from queries
      console.log('No schema metadata found, will infer from data');
    }
  }

  /**
   * Resolve expand parameter for a list of records
   */
  async resolve(
    records: any[],
    collection: string,
    expand: string
  ): Promise<any[]> {
    if (!records || records.length === 0) {
      return records;
    }

    // Parse expand string into individual expand paths
    const expandPaths = this.parseExpandPaths(expand);

    // Process each expand path
    for (const path of expandPaths) {
      records = await this.resolveExpandPath(records, collection, path);
    }

    return records;
  }

  /**
   * Parse expand string into individual paths
   * Example: "author,category,comments.author" => ["author", "category", "comments.author"]
   */
  private parseExpandPaths(expand: string): string[] {
    // Simple split by comma - doesn't handle nested parentheses yet
    return expand.split(',').map((p) => p.trim());
  }

  /**
   * Resolve a single expand path
   */
  private async resolveExpandPath(
    records: any[],
    collection: string,
    path: string
  ): Promise<any[]> {
    // Parse path - could be "author" or "comments.author" or "comments(created)"
    const parts = path.split('.');
    const [fieldWithSort, ...nestedParts] = parts;
    
    // Extract field name and optional sort
    const { field, sort } = this.parseFieldWithSort(fieldWithSort);

    // Get the relation info
    const relInfo = this.getRelationInfo(collection, field);
    if (!relInfo) {
      console.warn(`No relation info found for ${collection}.${field}`);
      return records;
    }

    // Collect all foreign IDs from records
    const foreignIds = this.extractForeignIds(records, field, relInfo.type);

    if (foreignIds.length === 0) {
      return records;
    }

    // Fetch related records
    const relatedRecords = await this.fetchRelatedRecords(
      relInfo.collection,
      foreignIds,
      sort
    );

    // Map related records by ID for quick lookup
    const relatedMap = new Map(relatedRecords.map((r) => [r.id, r]));

    // Attach expanded data to original records
    for (const record of records) {
      if (relInfo.type === 'single') {
        // Single relation: author field contains ID
        const foreignId = record[field];
        if (foreignId && relatedMap.has(foreignId)) {
          record[`expand`] = record[`expand`] || {};
          record[`expand`][field] = relatedMap.get(foreignId);
        }
      } else {
        // Multiple relation: field contains array of IDs
        const foreignIds = this.parseRelationIds(record[field]);
        if (foreignIds.length > 0) {
          record[`expand`] = record[`expand`] || {};
          record[`expand`][field] = foreignIds
            .map((id) => relatedMap.get(id))
            .filter(Boolean);
        }
      }
    }

    // Handle nested expansion (e.g., "comments.author")
    if (nestedParts.length > 0) {
      const nestedPath = nestedParts.join('.');
      
      for (const record of records) {
        if (record.expand && record.expand[field]) {
          const expandedValue = record.expand[field];
          const isArray = Array.isArray(expandedValue);
          const nestedRecords = isArray ? expandedValue : [expandedValue];
          
          const resolvedNested = await this.resolveExpandPath(
            nestedRecords,
            relInfo.collection,
            nestedPath
          );
          
          // Keep the same structure (array or single object)
          record.expand[field] = isArray ? resolvedNested : resolvedNested[0];
        }
      }
    }

    return records;
  }

  /**
   * Parse field with optional sort: "comments(created)" or "comments(created:desc)"
   */
  private parseFieldWithSort(fieldWithSort: string): { field: string; sort?: string } {
    const match = fieldWithSort.match(/^([^(]+)(?:\(([^)]+)\))?$/);
    if (!match) {
      return { field: fieldWithSort };
    }

    const [, field, sortExpr] = match;
    return { field: field.trim(), sort: sortExpr?.trim() };
  }

  /**
   * Get relation info from schema or infer from data
   */
  private getRelationInfo(
    collection: string,
    field: string
  ): { collection: string; type: 'single' | 'multiple' } | null {
    // Check schema cache
    const schema = this.schemaCache.get(collection);
    if (schema && schema.fields[field]) {
      return schema.fields[field];
    }

    // Infer from field naming conventions
    // Convention: userId -> single relation to "users"
    //            categoryId -> single relation to "categories"
    //            tags -> multiple relation (array field)
    if (field.endsWith('Id')) {
      const relCollection = field.slice(0, -2) + 's'; // userId -> users
      return { collection: relCollection, type: 'single' };
    }

    // Assume plural fields are multiple relations
    return { collection: field, type: 'multiple' };
  }

  /**
   * Extract foreign IDs from records
   */
  private extractForeignIds(
    records: any[],
    field: string,
    type: 'single' | 'multiple'
  ): string[] {
    const ids = new Set<string>();

    for (const record of records) {
      if (!record[field]) continue;

      if (type === 'single') {
        ids.add(record[field]);
      } else {
        // Parse JSON array or comma-separated string
        const foreignIds = this.parseRelationIds(record[field]);
        foreignIds.forEach((id) => ids.add(id));
      }
    }

    return Array.from(ids);
  }

  /**
   * Parse relation IDs from field value (can be JSON array or comma-separated)
   */
  private parseRelationIds(value: any): string[] {
    if (!value) return [];
    
    if (Array.isArray(value)) return value;
    
    if (typeof value === 'string') {
      // Try JSON parse first
      if (value.startsWith('[')) {
        try {
          return JSON.parse(value);
        } catch {
          // Fall through to split
        }
      }
      // Try comma-separated
      return value.split(',').map((id) => id.trim()).filter(Boolean);
    }

    return [];
  }

  /**
   * Fetch related records from database
   */
  private async fetchRelatedRecords(
    collection: string,
    ids: string[],
    sort?: string
  ): Promise<any[]> {
    if (ids.length === 0) return [];

    // Build query with tagged template literal
    // Use sql() helper for IN clause with array of IDs
    let results;
    if (sort) {
      // Parse sort expression: "created" or "created:desc"
      const [field, direction] = sort.split(':');
      const dir = direction?.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
      
      // Use unsafe for dynamic ORDER BY since we control the sort field
      results = await this.db.unsafe(
        `SELECT * FROM ${collection} WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY ${field} ${dir}`,
        ids
      );
    } else {
      results = await this.db.unsafe(
        `SELECT * FROM ${collection} WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
      );
    }

    return results;
  }
}

interface CollectionSchema {
  fields: {
    [fieldName: string]: {
      collection: string;
      type: 'single' | 'multiple';
    };
  };
}
