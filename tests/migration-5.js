'use strict';

const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(
  process.env.HOME,
  'wiz-light-controller'
);

const { runMigrations } = require(
  path.join(projectRoot, 'src/database/migrations')
);

const db = new DatabaseSync(':memory:');

try {
  db.exec('PRAGMA foreign_keys = ON;');

  // Migration 1: Create migration tracking.
  db.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      )
    );
  `);

  // Run migrations 2 through 4 using the actual migration runner.
  // Migration 1 is already marked as applied.
  db.prepare(`
    INSERT INTO schema_migrations (version, description)
    VALUES (1, 'Create schema migration tracking')
  `).run();

  // Apply migration 2.
  const migrationsSource = fs.readFileSync(
    path.join(projectRoot, 'src/database/migrations.js'),
    'utf8'
  );

  assert.ok(
    migrationsSource.includes(
      "description: 'Require a valid room for every group'"
    ),
    'Migration 5 was not found.'
  );

  // Build the schema expected immediately before migration 5.
  db.exec(`
    CREATE TABLE rooms (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'UNKNOWN',
      created_at TEXT NOT NULL DEFAULT (
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      ),
      updated_at TEXT NOT NULL DEFAULT (
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      )
    );

    INSERT INTO rooms (id, name, type)
    VALUES (36921073, 'Küche', 'KITCHEN');

    CREATE TABLE groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE,
      device_type TEXT NOT NULL
        CHECK (device_type IN ('light', 'plug')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      room_id INTEGER REFERENCES rooms(id) ON DELETE RESTRICT
    );

    CREATE TABLE group_members (
      group_id TEXT NOT NULL,
      device_mac TEXT NOT NULL COLLATE NOCASE,
      created_at TEXT NOT NULL,
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

    CREATE INDEX idx_groups_room_id
      ON groups(room_id);

    INSERT INTO groups (
      id, name, device_type, created_at, updated_at, room_id
    ) VALUES (
      'migration-test-group',
      'Testgruppe',
      'light',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      36921073
    );

    INSERT INTO group_members (group_id, device_mac, created_at)
    VALUES
      ('migration-test-group', 'cc4085a3ab3a', '2026-01-01T00:00:01.000Z'),
      ('migration-test-group', 'cc4085a3b6c8', '2026-01-01T00:00:02.000Z'),
      ('migration-test-group', 'cc4085a3bb2c', '2026-01-01T00:00:03.000Z'),
      ('migration-test-group', 'cc4085a3df62', '2026-01-01T00:00:04.000Z');
  `);

  const before = db.prepare(`
    SELECT device_mac, created_at
    FROM group_members
    WHERE group_id = ?
    ORDER BY device_mac
  `).all('migration-test-group');

  assert.equal(before.length, 4);

  // Extract and run migration 5 against the prepared test database.
  // The actual migration is loaded through a temporary module export.
  const Module = require('node:module');
  const migrationModule = new Module(
    path.join(projectRoot, 'src/database/migrations.js'),
    module
  );

  migrationModule.filename = path.join(
    projectRoot,
    'src/database/migrations.js'
  );
  migrationModule.paths = Module._nodeModulePaths(projectRoot);

  const migrationSource = migrationsSource.replace(
    'module.exports = {\n  runMigrations\n};',
    `module.exports = {
      runMigrations,
      migrations
    };`
  );

  migrationModule._compile(migrationSource, migrationModule.filename);

  const migration5 = migrationModule.exports.migrations.find(
    (migration) => migration.version === 5
  );

  assert.ok(migration5, 'Migration 5 was not found.');
  migration5.up(db);

  const after = db.prepare(`
    SELECT device_mac, created_at
    FROM group_members
    WHERE group_id = ?
    ORDER BY device_mac
  `).all('migration-test-group');

  assert.deepEqual(after, before);

  const roomColumn = db.prepare(
    'PRAGMA table_info(groups)'
  ).all().find((column) => column.name === 'room_id');

  assert.equal(roomColumn.notnull, 1);

  assert.deepEqual(db.prepare(
    'PRAGMA foreign_key_check'
  ).all(), []);

  console.log('PASS: All 4 members and their timestamps were preserved.');
  console.log('PASS: groups.room_id is NOT NULL.');
  console.log('PASS: Foreign key check is clean.');
  console.log('Preserved members:', after);
} catch (error) {
  console.error('FAIL:', error.message);
  process.exitCode = 1;
} finally {
  db.close();
}