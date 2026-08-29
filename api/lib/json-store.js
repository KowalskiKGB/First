import fs from 'node:fs';
import path from 'node:path';

const clone = (value) => structuredClone(value);

export class RevisionConflictError extends Error {
  constructor() {
    super('stale collaboration revision');
    this.name = 'RevisionConflictError';
  }
}

export function createJsonStore({ file, initial, migrate }) {
  const write = (value) => {
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
    fs.renameSync(temporary, file);
  };

  const load = () => {
    const exists = fs.existsSync(file);
    const source = exists ? JSON.parse(fs.readFileSync(file, 'utf8')) : clone(initial);
    const migrated = migrate(source);

    if (!exists || JSON.stringify(source) !== JSON.stringify(migrated)) write(migrated);
    return migrated;
  };

  load();

  return {
    read() {
      return clone(load());
    },
    update(expectedRev, reducer) {
      const current = load();
      if (current.rev !== expectedRev) throw new RevisionConflictError();

      const next = reducer(clone(current));
      if (!next || typeof next !== 'object' || Array.isArray(next)) throw new TypeError('store reducer must return an object');

      const updated = { ...migrate(next), rev: current.rev + 1 };
      write(updated);
      return clone(updated);
    }
  };
}
