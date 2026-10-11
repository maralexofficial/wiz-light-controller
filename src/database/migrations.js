'use strict';

const fs = require('node:fs');
const path = require('node:path');

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
  },
  {
    version: 4,
    description: 'Add rooms and assign existing groups to rooms',
    up(db) {
      const homePath = path.join(
        process.cwd(),
        'data',
        'wiz-home.json'
      );

      if (!fs.existsSync(homePath)) {
        throw new Error(
          `Home metadata file not found: ${homePath}`
        );
      }

      const home = JSON.parse(
        fs.readFileSync(homePath, 'utf8')
      );

      if (!Array.isArray(home.rooms)) {
        throw new Error(
          'Home metadata does not contain a valid rooms array.'
        );
      }

      const rooms = home.rooms.map((room) => {
        if (
          !Number.isSafeInteger(room.room_id) ||
          typeof room.name !== 'string' ||
          !room.name.trim()
        ) {
          throw new Error(
            'Home metadata contains an invalid room.'
          );
        }

        return {
          id: room.room_id,
          name: room.name.trim(),
          type: typeof room.type === 'string'
            ? room.type
            : 'UNKNOWN'
        };
      });

      const roomIds = new Set(rooms.map((room) => room.id));

      if (roomIds.size !== rooms.length) {
        throw new Error(
          'Home metadata contains duplicate room IDs.'
        );
      }

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
          ),
          CHECK (length(trim(name)) BETWEEN 1 AND 80)
        );
      `);

      const insertRoom = db.prepare(`
        INSERT INTO rooms (id, name, type)
        VALUES (?, ?, ?)
      `);

      for (const room of rooms) {
        insertRoom.run(room.id, room.name, room.type);
      }

      db.exec(`
        ALTER TABLE groups
        ADD COLUMN room_id INTEGER
        REFERENCES rooms(id)
        ON DELETE RESTRICT;
      `);

      const knownDeviceRooms = new Map();

      if (!Array.isArray(home.devices)) {
        throw new Error(
          'Home metadata does not contain a valid devices array.'
        );
      }

      for (const device of home.devices) {
        if (
          typeof device.mac_address !== 'string' ||
          !Number.isSafeInteger(device.room_id)
        ) {
          continue;
        }

        const mac = device.mac_address
          .trim()
          .replace(/[:-]/g, '')
          .toLowerCase();

        if (/^[0-9a-f]{12}$/.test(mac)) {
          knownDeviceRooms.set(mac, device.room_id);
        }
      }

      const groups = db.prepare(`
        SELECT id
        FROM groups
      `).all();

      const getMembers = db.prepare(`
        SELECT device_mac AS mac
        FROM group_members
        WHERE group_id = ?
      `);

      const assignRoom = db.prepare(`
        UPDATE groups
        SET room_id = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `);

      for (const group of groups) {
        const members = getMembers.all(group.id);

        if (members.length === 0) {
          throw new Error(
            `Existing group ${group.id} has no members; room assignment requires manual review.`
          );
        }

        const memberRoomIds = members.map((member) => {
          const mac = member.mac
            .trim()
            .replace(/[:-]/g, '')
            .toLowerCase();

          return knownDeviceRooms.get(mac);
        });

        if (memberRoomIds.some((roomId) => roomId === undefined)) {
          throw new Error(
            `Existing group ${group.id} contains a device without a known room.`
          );
        }

        const uniqueRoomIds = new Set(memberRoomIds);

        if (uniqueRoomIds.size !== 1) {
          throw new Error(
            `Existing group ${group.id} contains devices from multiple rooms.`
          );
        }

        const roomId = memberRoomIds[0];

        if (!roomIds.has(roomId)) {
          throw new Error(
            `Existing group ${group.id} references unknown room ${roomId}.`
          );
        }

        assignRoom.run(roomId, group.id);
      }

      db.exec(`
        CREATE INDEX idx_groups_room_id
          ON groups(room_id);
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