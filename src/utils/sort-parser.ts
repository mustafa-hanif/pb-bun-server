/**
 * Parses PocketBase sort syntax into SQL ORDER BY clauses
 * 
 * PocketBase sort examples:
 * - "created" => "created ASC"
 * - "-created" => "created DESC"
 * - "-created,title" => "created DESC, title ASC"
 */
export class SortParser {
  parse(sort: string): string {
    return sort
      .split(',')
      .map((field) => {
        field = field.trim();
        if (field.startsWith('-')) {
          return `${field.slice(1)} DESC`;
        }
        return `${field} ASC`;
      })
      .join(', ');
  }
}
