/**
 * Generate a random 15-character ID similar to PocketBase
 */
export function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 15; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

/**
 * Get current timestamp in PocketBase format (ISO 8601)
 */
export function getCurrentTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}
