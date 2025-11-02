import { SQL, sql } from 'bun';
import { SchemaCache } from './schema-cache';

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
 * This implementation uses schema metadata from _collections table
 * to accurately resolve relation field mappings.
 */
export class ExpandResolver {
  private db: SQL;
  private schemaCache: SchemaCache;

  constructor(db: SQL, schemaCache: SchemaCache) {
    this.db = db;
    this.schemaCache = schemaCache;
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
    // Check schema cache for accurate relation mapping
    const relationCollection = this.schemaCache.getRelationCollection(collection, field);
    
    if (relationCollection) {
      // We have schema metadata - use it!
      return { 
        collection: relationCollection, 
        type: 'multiple' // Will be determined at runtime by checking if value is array
      };
    }

    // Fallback: Infer from field naming conventions
    // Convention: userId or user_id -> relation to "users"
    //            categoryId or category_id -> relation to "categories"
    //            pb_user_id -> relation to "users" (strip prefix)
    
    // Check for _id suffix (handles both userId and user_id)
    if (field.endsWith('_id') || field.endsWith('Id')) {
      // Extract the base name
      let baseName = field.endsWith('_id') 
        ? field.slice(0, -3)  // Remove _id
        : field.slice(0, -2); // Remove Id
      
      // Strip common prefixes like pb_, fk_, etc.
      baseName = baseName.replace(/^(pb_|fk_|rel_)/, '');
      
      // Pluralize: user -> users, category -> categories
      const relCollection = this.pluralize(baseName);
      
      // Determine if it's single or multiple by checking the actual field value
      // For now, assume _id fields can be either single or array
      return { collection: relCollection, type: 'multiple' };
    }

    // Assume plural fields are multiple relations
    return { collection: field, type: 'multiple' };
  }

  /**
   * Simple pluralization helper
   */
  private pluralize(word: string): string {
    // Handle special cases
    const irregulars: { [key: string]: string } = {
      'person': 'people',
      'child': 'children',
      'category': 'categories',
    };

    if (irregulars[word]) {
      return irregulars[word];
    }

    // Simple rules
    if (word.endsWith('y')) {
      return word.slice(0, -1) + 'ies'; // category -> categories
    }
    
    if (word.endsWith('s') || word.endsWith('x') || word.endsWith('ch') || word.endsWith('sh')) {
      return word + 'es';
    }

    return word + 's';
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
