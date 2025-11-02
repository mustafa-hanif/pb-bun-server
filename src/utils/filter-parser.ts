/**
 * Parses PocketBase filter syntax into SQL WHERE clauses
 * 
 * PocketBase filter examples:
 * - "status = true && created > '2022-01-01'"
 * - "title ~ 'test' || description ~ 'test'"
 * - "age >= 18 && age <= 65"
 */
export class FilterParser {
  parse(filter: string): { sql: string; values: any[] } {
    const values: any[] = [];
    
    // First, handle the ?= operator BEFORE extracting values
    // Replace field.subfield ?= with field ?= (strip dot notation for array contains)
    filter = filter.replace(/(\w+)\.(\w+)\s*\?=/g, '$1 ?=');
    
    // Replace PocketBase operators with SQL equivalents
    let sql = filter
      .replace(/&&/g, ' AND ')
      .replace(/\|\|/g, ' OR ')
      .replace(/!=/g, '<>');

    // Extract values and replace with placeholders
    // Handle: 'string', "string", numbers, true, false, null
    // Support escaped quotes: 'Bun\'s' or "Bun\"s"
    const valuePattern = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b(\d+\.?\d*)\b|\btrue\b|\bfalse\b|\bnull\b/g;
    
    sql = sql.replace(valuePattern, (match) => {
      if (match === 'true') {
        values.push(1);
        return '?';
      } else if (match === 'false') {
        values.push(0);
        return '?';
      } else if (match === 'null') {
        values.push(null);
        return '?';
      } else if (match.startsWith("'") || match.startsWith('"')) {
        // String value - remove quotes and unescape
        let str = match.slice(1, -1);
        // Unescape escaped quotes
        str = str.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        values.push(str);
        return '?';
      } else {
        // Numeric value
        values.push(parseFloat(match));
        return '?';
      }
    });

    // Track which value indices are for special operators
    const likeIndices: number[] = [];
    const arrayContainsIndices: number[] = [];
    let valueIndex = 0;
    
    // Handle LIKE operators (~) - wrap the placeholder value in % for partial matching
    sql = sql.replace(/~\s*\?/g, () => {
      likeIndices.push(valueIndex);
      valueIndex++;
      return 'LIKE ?';
    });

    // Handle array contains operator (?=) - check if JSON array contains value
    // Converts: field ?= ? to: field LIKE ?
    sql = sql.replace(/\?=\s*\?/g, () => {
      arrayContainsIndices.push(valueIndex);
      valueIndex++;
      return 'LIKE ?';
    });

    // Wrap LIKE values with % for partial matching
    for (const idx of likeIndices) {
      if (values[idx] !== null && values[idx] !== undefined) {
        values[idx] = `%${values[idx]}%`;
      }
    }

    // Wrap array contains values for JSON array matching
    for (const idx of arrayContainsIndices) {
      if (values[idx] !== null && values[idx] !== undefined) {
        // For JSON arrays stored as strings, wrap with quotes and %
        values[idx] = `%"${values[idx]}"%`;
      }
    }

    return { sql, values };
  }
}
