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

    // Now handle LIKE operators - wrap the placeholder value in % for partial matching
    // We need to track which value indices are for LIKE operations
    const likeIndices: number[] = [];
    let valueIndex = 0;
    
    sql = sql.replace(/~\s*\?/g, () => {
      likeIndices.push(valueIndex);
      valueIndex++;
      return 'LIKE ?';
    });

    // Wrap LIKE values with % for partial matching
    for (const idx of likeIndices) {
      if (values[idx] !== null && values[idx] !== undefined) {
        values[idx] = `%${values[idx]}%`;
      }
    }

    return { sql, values };
  }
}
