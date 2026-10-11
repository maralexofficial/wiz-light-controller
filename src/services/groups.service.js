'use strict';

const { randomUUID } = require('node:crypto');
const { getDatabase } = require('../database');

const DEVICE_TYPES = new Set(['light', 'plug']);

class GroupError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'GroupError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizeMac(mac) {
  if (typeof mac !== 'string') {
    throw new GroupError(
      'INVALID_DEVICE_MAC',
      'Every device must have a valid MAC address.'
    );
  }

  const normalized = mac
    .trim()
    .replace(/[:-]/g, '')
    .toLowerCase();

  if (!/^[0-9a-f]{12}$/.test(normalized)) {
    throw new GroupError(
      'INVALID_DEVICE_MAC',
      'Every device must have a valid MAC address.'
    );
  }

  return normalized;
}

function normalizeName(name) {
  if (typeof name !== 'string') {
    throw new GroupError(
      'INVALID_GROUP_NAME',
      'Group name must be a string.'
    );
  }

  const normalized = name.trim();

  if (normalized.length < 1 || normalized.length > 80) {
    throw new GroupError(
      'INVALID_GROUP_NAME',
      'Group name must contain between 1 and 80 characters.'
    );
  }

  return normalized;
}

function normalizeDeviceType(deviceType) {
  if (
    typeof deviceType !== 'string' ||
    !DEVICE_TYPES.has(deviceType)
  ) {
    throw new GroupError(
      'INVALID_DEVICE_TYPE',
      'Device type must be light or plug.'
    );
  }

  return deviceType;
}

function normalizeMembers(members) {
  if (!Array.isArray(members)) {
    throw new GroupError(
      'INVALID_GROUP_MEMBERS',
      'Group members must be an array of MAC addresses.'
    );
  }

  const normalized = members.map(normalizeMac);

  if (normalized.length < 2) {
    throw new GroupError(
      'TOO_FEW_GROUP_MEMBERS',
      'A group must contain at least two devices.'
    );
  }

  if (new Set(normalized).size !== normalized.length) {
    throw new GroupError(
      'DUPLICATE_GROUP_MEMBER',
      'A device cannot appear more than once in a group.'
    );
  }

  return normalized;
}

function getGroupById(db, id) {
  const group = db.prepare(`
    SELECT
      id,
      name,
      device_type AS deviceType,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM groups
    WHERE id = ?
  `).get(id);

  if (!group) {
    return null;
  }

  const members = db.prepare(`
    SELECT device_mac AS mac
    FROM group_members
    WHERE group_id = ?
    ORDER BY device_mac
  `).all(id);

  return {
    ...group,
    members: members.map((member) => member.mac)
  };
}

function listGroups() {
  const db = getDatabase();

  return db.prepare(`
    SELECT id
    FROM groups
    ORDER BY name COLLATE NOCASE, id
  `).all().map((row) => getGroupById(db, row.id));
}

function getGroup(id) {
  if (typeof id !== 'string' || !id.trim()) {
    throw new GroupError(
      'INVALID_GROUP_ID',
      'A valid group ID is required.'
    );
  }

  const group = getGroupById(getDatabase(), id);

  if (!group) {
    throw new GroupError(
      'GROUP_NOT_FOUND',
      'Group not found.',
      404
    );
  }

  return group;
}

function getSyncState() {
  const db = getDatabase();

  const state = db.prepare(`
    SELECT
      revision,
      updated_at AS updatedAt
    FROM group_sync_state
    WHERE id = 1
  `).get();

  if (!state) {
    throw new Error('Group synchronization state is missing.');
  }

  return state;
}

function incrementSyncRevision(db) {
  db.prepare(`
    UPDATE group_sync_state
    SET revision = revision + 1,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = 1
  `).run();
}

function validateKnownDevices(members, expectedType, knownDevices) {
  if (!Array.isArray(knownDevices)) {
    throw new GroupError(
      'DEVICE_DATA_UNAVAILABLE',
      'Device metadata is unavailable.',
      503
    );
  }

  const devicesByMac = new Map();

  for (const device of knownDevices) {
    try {
      devicesByMac.set(normalizeMac(device.mac), device);
    } catch {
      // Ignore invalid device metadata.
    }
  }

  for (const mac of members) {
    const device = devicesByMac.get(mac);

    if (!device) {
      throw new GroupError(
        'UNKNOWN_DEVICE',
        `Device ${mac} is not present in the known device list.`
      );
    }

    if (device.deviceType !== expectedType) {
      throw new GroupError(
        'INCOMPATIBLE_DEVICE_TYPE',
        `Device ${mac} is not compatible with group type ${expectedType}.`
      );
    }
  }
}

function createGroup(input, knownDevices) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new GroupError(
      'INVALID_REQUEST',
      'A group request object is required.'
    );
  }

  const name = normalizeName(input.name);
  const deviceType = normalizeDeviceType(input.deviceType);
  const members = normalizeMembers(input.members);

  validateKnownDevices(members, deviceType, knownDevices);

  const db = getDatabase();
  const id = randomUUID();

  try {
    db.exec('BEGIN IMMEDIATE;');

    db.prepare(`
      INSERT INTO groups (id, name, device_type)
      VALUES (?, ?, ?)
    `).run(id, name, deviceType);

    const insertMember = db.prepare(`
      INSERT INTO group_members (group_id, device_mac)
      VALUES (?, ?)
    `);

    for (const mac of members) {
      insertMember.run(id, mac);
    }

    incrementSyncRevision(db);

    db.exec('COMMIT;');

    return getGroupById(db, id);
  } catch (error) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // Preserve the original error.
    }

    if (String(error.message).includes('UNIQUE constraint failed: groups.name')) {
      throw new GroupError(
        'GROUP_NAME_EXISTS',
        'A group with this name already exists.',
        409
      );
    }

    throw error;
  }
}

function updateGroup(id, input, knownDevices) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new GroupError(
      'INVALID_REQUEST',
      'A group update object is required.'
    );
  }

  const existing = getGroup(id);

  const name = input.name === undefined
    ? existing.name
    : normalizeName(input.name);

  const members = input.members === undefined
    ? existing.members
    : normalizeMembers(input.members);

  validateKnownDevices(members, existing.deviceType, knownDevices);

  const db = getDatabase();

  try {
    db.exec('BEGIN IMMEDIATE;');

    db.prepare(`
      UPDATE groups
      SET name = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(name, id);

    if (input.members !== undefined) {
      db.prepare(`
        DELETE FROM group_members
        WHERE group_id = ?
      `).run(id);

      const insertMember = db.prepare(`
        INSERT INTO group_members (group_id, device_mac)
        VALUES (?, ?)
      `);

      for (const mac of members) {
        insertMember.run(id, mac);
      }
    }

    incrementSyncRevision(db);

    db.exec('COMMIT;');

    return getGroupById(db, id);
  } catch (error) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // Preserve the original error.
    }

    if (String(error.message).includes('UNIQUE constraint failed: groups.name')) {
      throw new GroupError(
        'GROUP_NAME_EXISTS',
        'A group with this name already exists.',
        409
      );
    }

    throw error;
  }
}

function deleteGroup(id) {
  getGroup(id);

  const db = getDatabase();

  db.exec('BEGIN IMMEDIATE;');

  try {
    db.prepare(`
      DELETE FROM groups
      WHERE id = ?
    `).run(id);

    incrementSyncRevision(db);

    db.exec('COMMIT;');

    return { id, deleted: true };
  } catch (error) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // Preserve the original error.
    }

    throw error;
  }
}

module.exports = {
  GroupError,
  listGroups,
  getGroup,
  createGroup,
  updateGroup,
  deleteGroup,
  getSyncState
};