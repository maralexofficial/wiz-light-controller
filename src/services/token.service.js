
'use strict';

const crypto = require('node:crypto');
const { getDatabase } = require('../database');

const AVAILABLE_PERMISSIONS = Object.freeze([
  'rooms.read',
  'groups.read',
  'groups.create',
  'groups.update',
  'groups.delete',
  'devices.read',
  'devices.control',
  'devices.discover',
  'system.read',
  'system.broadcast',
  'presets.read',
  'presets.execute',
  'presets.manage',
  'tokens.manage'
]);

const DEFAULT_MIGRATED_PERMISSIONS = Object.freeze([
  'rooms.read',
  'groups.read',
  'groups.create',
  'groups.update',
  'groups.delete',
  'devices.read',
  'devices.control',
  'devices.discover',
  'system.read',
  'system.broadcast'
]);

function hashToken(token) {
  if (typeof token !== 'string' || token.length < 32) {
    throw new Error('Token must contain at least 32 characters.');
  }

  return crypto
    .createHash('sha256')
    .update(token, 'utf8')
    .digest('hex');
}

function normalizePermissions(permissions) {
  if (!Array.isArray(permissions)) {
    throw new Error('Permissions must be an array.');
  }

  const uniquePermissions = [...new Set(permissions)];

  for (const permission of uniquePermissions) {
    if (
      typeof permission !== 'string' ||
      !AVAILABLE_PERMISSIONS.includes(permission)
    ) {
      throw new Error(`Unknown permission: ${String(permission)}`);
    }
  }

  return uniquePermissions.sort();
}

function createToken(name, permissions, options = {}) {
  if (
    typeof name !== 'string' ||
    name.trim().length < 1 ||
    name.trim().length > 80
  ) {
    throw new Error('Token name must contain between 1 and 80 characters.');
  }

  const normalizedPermissions = normalizePermissions(permissions);
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = options.expiresAt ?? null;

  if (
    expiresAt !== null &&
    (
      typeof expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(expiresAt)) ||
      Date.parse(expiresAt) <= Date.now()
    )
  ) {
    throw new Error('Expiry must be a valid future date.');
  }

  const db = getDatabase();

  const result = db.prepare(`
    INSERT INTO api_tokens (
      name,
      token_hash,
      permissions,
      expires_at
    )
    VALUES (?, ?, ?, ?)
  `).run(
    name.trim(),
    tokenHash,
    JSON.stringify(normalizedPermissions),
    expiresAt
  );

  return {
    id: Number(result.lastInsertRowid),
    name: name.trim(),
    token,
    permissions: normalizedPermissions,
    expiresAt
  };
}

function findActiveToken(token) {
  const tokenHash = hashToken(token);
  const db = getDatabase();

  const record = db.prepare(`
    SELECT
      id,
      name,
      permissions,
      created_at,
      updated_at,
      expires_at
    FROM api_tokens
    WHERE token_hash = ?
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  `).get(tokenHash);

  if (!record) {
    return null;
  }

  let permissions;

  try {
    permissions = normalizePermissions(
      JSON.parse(record.permissions)
    );
  } catch {
    return null;
  }

  return {
    id: record.id,
    name: record.name,
    permissions,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    expiresAt: record.expires_at
  };
}

function listTokens() {
  const db = getDatabase();

  return db.prepare(`
    SELECT
      id,
      name,
      permissions,
      created_at,
      updated_at,
      expires_at,
      revoked_at
    FROM api_tokens
    ORDER BY id
  `).all().map((record) => {
    let permissions = [];

    try {
      permissions = normalizePermissions(
        JSON.parse(record.permissions)
      );
    } catch {
      // Invalid stored permissions are represented as empty.
    }

    return {
      id: record.id,
      name: record.name,
      permissions,
      createdAt: record.created_at,
      updatedAt: record.updated_at,
      expiresAt: record.expires_at,
      revokedAt: record.revoked_at
    };
  });
}

function updateTokenPermissions(id, permissions) {
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error('Token ID must be a positive integer.');
  }

  const normalizedPermissions = normalizePermissions(permissions);
  const db = getDatabase();

  const result = db.prepare(`
    UPDATE api_tokens
    SET permissions = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
      AND revoked_at IS NULL
  `).run(JSON.stringify(normalizedPermissions), id);

  if (result.changes === 0) {
    throw new Error('Active token not found.');
  }

  return true;
}

function revokeToken(id) {
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error('Token ID must be a positive integer.');
  }

  const db = getDatabase();

  const result = db.prepare(`
    UPDATE api_tokens
    SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
      AND revoked_at IS NULL
  `).run(id);

  if (result.changes === 0) {
    throw new Error('Active token not found.');
  }

  return true;
}

module.exports = {
  AVAILABLE_PERMISSIONS,
  DEFAULT_MIGRATED_PERMISSIONS,
  hashToken,
  normalizePermissions,
  createToken,
  findActiveToken,
  listTokens,
  updateTokenPermissions,
  revokeToken
};
