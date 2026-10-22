/** Deterministic PostgreSQL bootstrap. Each generated app gets its own schema. */
const identifier = value => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error('Invalid schema identifier: ' + value);
  return '"' + value + '"';
};
function fragment(value) {
  const text = String(value);
  if (/[;]|--|\/\*|\*\//.test(text)) throw new Error('Unsafe SQL schema fragment');
  return text;
}
export function migrationSQL(schema) {
  const statements = [];
  for (const table of schema?.tables || []) {
    if (!table.fields?.length) throw new Error('Table has no fields');
    const fields = table.fields.map(f => `${identifier(f.name)} ${fragment(f.type || 'TEXT')} ${(f.constraints || []).map(fragment).join(' ')}`);
    statements.push(`CREATE TABLE IF NOT EXISTS ${identifier(table.name)} (${fields.join(', ')});`);
  }
  for (const table of schema?.tables || []) {
    for (const fk of table.foreignKeys || []) {
      const match = fk.references.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\(([a-zA-Z_][a-zA-Z0-9_]*)\)$/);
      if (!match) throw new Error('Invalid foreign key reference');
      const action = fk.onDelete || 'CASCADE';
      if (!['CASCADE', 'RESTRICT', 'SET NULL', 'NO ACTION', 'SET DEFAULT'].includes(action)) throw new Error('Invalid foreign key action');
      const name = identifier(`fk_${table.name}_${fk.field}`);
      statements.push(`DO $$ BEGIN ALTER TABLE ${identifier(table.name)} ADD CONSTRAINT ${name} FOREIGN KEY (${identifier(fk.field)}) REFERENCES ${identifier(match[1])} (${identifier(match[2])}) ON DELETE ${action}; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    }
    for (const index of table.indexes || []) {
      const columns = index.split(',').map(s => s.trim());
      statements.push(`CREATE INDEX IF NOT EXISTS ${identifier('idx_' + table.name + '_' + columns.join('_'))} ON ${identifier(table.name)} (${columns.map(identifier).join(', ')});`);
    }
  }
  return statements.join('\n');
}
