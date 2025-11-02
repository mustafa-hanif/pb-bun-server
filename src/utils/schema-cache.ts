import type { SQL } from 'bun';

interface FieldSchema {
  id: string;
  name: string;
  type: string;
  collectionId?: string;
  [key: string]: any;
}

interface CollectionSchema {
  id: string;
  name: string;
  fields: FieldSchema[];
}

/**
 * Schema cache that loads collection metadata from _collections table
 * and provides relation field to collection name mappings
 */
export class SchemaCache {
  private readonly db: SQL;
  private readonly collections: Map<string, CollectionSchema> = new Map();
  private readonly collectionIdToName: Map<string, string> = new Map();
  private initialized = false;

  constructor(db: SQL) {
    this.db = db;
  }

  /**
   * Load schema metadata from _collections table
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const results = await this.db.unsafe(
        'SELECT id, name, fields FROM _collections'
      ) as Array<{
        id: string;
        name: string;
        fields: string | FieldSchema[];
      }>;

      for (const row of results) {
        const fields = typeof row.fields === 'string' 
          ? JSON.parse(row.fields) 
          : row.fields;

        const schema: CollectionSchema = {
          id: row.id,
          name: row.name,
          fields,
        };

        this.collections.set(row.name, schema);
        this.collectionIdToName.set(row.id, row.name);
      }

      this.initialized = true;
      console.log(`✅ Schema cache initialized with ${this.collections.size} collections`);
    } catch (error) {
      console.error('Failed to initialize schema cache:', error);
      throw error;
    }
  }

  /**
   * Get the collection name for a relation field
   * @param collectionName The collection containing the field
   * @param fieldName The relation field name
   * @returns The target collection name, or null if not found
   */
  getRelationCollection(collectionName: string, fieldName: string): string | null {
    const schema = this.collections.get(collectionName);
    if (!schema) return null;

    const field = schema.fields.find(f => f.name === fieldName && f.type === 'relation');
    if (!field?.collectionId) return null;

    return this.collectionIdToName.get(field.collectionId) || null;
  }

  /**
   * Check if a field is a relation field
   */
  isRelationField(collectionName: string, fieldName: string): boolean {
    const schema = this.collections.get(collectionName);
    if (!schema) return false;

    const field = schema.fields.find(f => f.name === fieldName);
    return field?.type === 'relation';
  }

  /**
   * Get all relation fields for a collection
   */
  getRelationFields(collectionName: string): string[] {
    const schema = this.collections.get(collectionName);
    if (!schema) return [];

    return schema.fields
      .filter(f => f.type === 'relation')
      .map(f => f.name);
  }

  /**
   * Refresh the cache (useful if schema changes)
   */
  async refresh(): Promise<void> {
    this.collections.clear();
    this.collectionIdToName.clear();
    this.initialized = false;
    await this.initialize();
  }
}
