export const INITIAL_COLLABORATION = {
  schemaVersion: 1,
  rev: 0,
  profiles: [],
  connections: [],
  clients: [],
  notifications: [],
  audit: [],
  programs: [],
  measurements: [],
  availability: [],
  appointments: [],
  receivables: []
};

export function migrateCollaboration(value) {
  const collaboration = value && typeof value === 'object' && !Array.isArray(value) ? structuredClone(value) : {};

  return {
    ...collaboration,
    schemaVersion: 1,
    rev: Number.isInteger(collaboration.rev) && collaboration.rev >= 0 ? collaboration.rev : 0,
    ...Object.fromEntries(Object.keys(INITIAL_COLLABORATION)
      .filter((key) => key !== 'schemaVersion' && key !== 'rev')
      .map((key) => [key, Array.isArray(collaboration[key]) ? collaboration[key] : []]))
  };
}
