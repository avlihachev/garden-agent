import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS plants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  variety TEXT,
  location TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('seed','seedling','planted','dormant','done')),
  sown_at TEXT,
  planted_out_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plant_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plant_id INTEGER NOT NULL REFERENCES plants(id),
  ts TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('sown','transplanted','harvested','treated','note')),
  note TEXT,
  author TEXT NOT NULL DEFAULT 'agent' CHECK (author IN ('me','agent'))
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  details TEXT,
  plant_id INTEGER REFERENCES plants(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dropped')),
  due_start TEXT,
  due_end TEXT,
  recurrence TEXT,
  source TEXT NOT NULL DEFAULT 'agent' CHECK (source IN ('agent','user')),
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS task_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  ts TEXT NOT NULL,
  author TEXT NOT NULL CHECK (author IN ('me','agent')),
  text TEXT NOT NULL
);
`;

// CREATE TABLE IF NOT EXISTS never touches a table that already exists, so a
// column added after a db was created needs an explicit ALTER. SQLite cannot
// attach the CHECK constraint this way — the store and the API validate instead.
function addColumnIfMissing(db: DatabaseSync, table: string, column: string, ddl: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  // events written before this column existed came from the agent
  addColumnIfMissing(db, "plant_events", "author", "author TEXT NOT NULL DEFAULT 'agent'");
  return db;
}
