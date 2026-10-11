'use strict';

const migrations = [
  {
    version: 1,
    description: 'Create schema migration tracking',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          description TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT (
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          )
        );
      `);
    }
  }
];

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      )
    );
  `);

  const getAppliedMigration = db.prepare(
    'SELECT version FROM schema_migrations WHERE version = ?'
  );

  const insertMigration = db.prepare(`
    INSERT INTO schema_migrations (version, description)
    VALUES (?, ?)
  `);

  for (const migration of migrations) {
    if (getAppliedMigration.get(migration.version)) {
      continue;
    }

    db.exec('BEGIN IMMEDIATE;');

    try {
      if (getAppliedMigration.get(migration.version)) {
        db.exec('COMMIT;');
        continue;
      }

      migration.up(db);

      insertMigration.run(
        migration.version,
        migration.description
      );

      db.exec('COMMIT;');
    } catch (error) {
      try {
        db.exec('ROLLBACK;');
      } catch {
        // Preserve the original migration error.
      }

      throw new Error(
        `Database migration ${migration.version} failed: ${error.message}`,
        { cause: error }
      );
    }
  }
}

module.exports = {
  runMigrations
};