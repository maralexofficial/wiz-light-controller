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
  },
  {
    version: 2,
    description: 'Create groups and group members',
    up(db) {
      db.exec(`
        CREATE TABLE groups (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL COLLATE NOCASE,
          device_type TEXT NOT NULL
            CHECK (device_type IN ('light', 'plug')),
          created_at TEXT NOT NULL DEFAULT (
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          ),
          updated_at TEXT NOT NULL DEFAULT (
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          ),
          CHECK (length(trim(name)) BETWEEN 1 AND 80)
        );

        CREATE TABLE group_members (
          group_id TEXT NOT NULL,
          device_mac TEXT NOT NULL COLLATE NOCASE,
          created_at TEXT NOT NULL DEFAULT (
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          ),

          PRIMARY KEY (group_id, device_mac),

          FOREIGN KEY (group_id)
            REFERENCES groups(id)
            ON DELETE CASCADE,

          CHECK (
            length(replace(replace(device_mac, ':', ''), '-', '')) = 12
          )
        );

        CREATE INDEX idx_group_members_device_mac
          ON group_members(device_mac);
      `);
    }
  },
  {
    version: 3,
    description: 'Create group synchronization revision',
    up(db) {
      db.exec(`
        CREATE TABLE group_sync_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          revision INTEGER NOT NULL DEFAULT 0
            CHECK (revision >= 0),
          updated_at TEXT NOT NULL DEFAULT (
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          )
        );

        INSERT INTO group_sync_state (id, revision)
        VALUES (1, 0);
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