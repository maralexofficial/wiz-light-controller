'use strict';

const {
  initializeDatabase,
  getDatabase,
  closeDatabase
} = require('../src/database');

const { runMigrations } = require('../src/database/migrations');
const tokenService = require('../src/services/token.service');

const HELP = `
WiZ Light Controller - Token Management

Commands:

  npm run token:create -- --name "Android App" --permissions devices.read,devices.control
  npm run token:list
  npm run token:permissions -- --id 2 --permissions devices.read,groups.read
  npm run token:revoke -- --id 2

Options:

  --name          Token name (1-80 characters)
  --permissions   Comma-separated permission list
  --id            Token ID
  --expires       Expiration date, e.g. 2027-01-01T00:00:00Z
  --help          Show help

Available permissions:

  ${tokenService.AVAILABLE_PERMISSIONS.join('\n  ')}
`;

function parseArgs(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (!arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    const key = arg.slice(2);

    if (!['name', 'permissions', 'id', 'expires'].includes(key)) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (options[key] !== undefined) {
      throw new Error(`Option specified more than once: ${arg}`);
    }

    const value = args[index + 1];

    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}.`);
    }

    options[key] = value;
    index += 1;
  }

  return options;
}

function parseId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new Error('--id must be a positive integer.');
  }

  const id = Number(value);

  if (!Number.isSafeInteger(id)) {
    throw new Error('--id is outside the valid integer range.');
  }

  return id;
}

function parsePermissions(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('--permissions must not be empty.');
  }

  const permissions = value
    .split(',')
    .map((permission) => permission.trim());

  if (permissions.some((permission) => !permission)) {
    throw new Error('The permission list contains an empty entry.');
  }

  return tokenService.normalizePermissions(permissions);
}

function ensureManagerSafeguard(db, tokenId, newPermissions, action) {
  const target = db.prepare(`
    SELECT id, permissions, revoked_at, expires_at
    FROM api_tokens
    WHERE id = ?
  `).get(tokenId);

  if (!target) {
    throw new Error(`Token ${tokenId} was not found.`);
  }

  if (target.revoked_at) {
    throw new Error(`Token ${tokenId} has already been revoked.`);
  }

  if (target.expires_at && Date.parse(target.expires_at) <= Date.now()) {
    throw new Error(`Token ${tokenId} has already expired.`);
  }

  let currentPermissions;

  try {
    currentPermissions = JSON.parse(target.permissions);
  } catch {
    throw new Error('The stored token permissions are invalid.');
  }

  if (!Array.isArray(currentPermissions)) {
    throw new Error('The stored token permissions are invalid.');
  }

  const removesManagerPermission =
    currentPermissions.includes('tokens.manage') &&
    (
      action === 'revoke' ||
      !newPermissions.includes('tokens.manage')
    );

  if (!removesManagerPermission) {
    return;
  }

  const activeTokens = db.prepare(`
    SELECT id, permissions
    FROM api_tokens
    WHERE revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > ?)
  `).all(new Date().toISOString());

  const otherActiveManagers = activeTokens.filter((row) => {
    if (Number(row.id) === tokenId) {
      return false;
    }

    try {
      const permissions = JSON.parse(row.permissions);

      return Array.isArray(permissions) &&
        permissions.includes('tokens.manage');
    } catch {
      return false;
    }
  });

  if (otherActiveManagers.length === 0) {
    throw new Error(
      'Operation denied: this would remove the last active tokens.manage permission. Create another token with tokens.manage first.'
    );
  }
}

function printTokenList(tokens) {
  if (tokens.length === 0) {
    console.log('No tokens found.');
    return;
  }

  for (const token of tokens) {
    const expired = token.expiresAt &&
      Date.parse(token.expiresAt) <= Date.now();

    const status = token.revokedAt
      ? 'Revoked'
      : expired
        ? 'Expired'
        : 'Active';

    console.log('');
    console.log(`ID:             ${token.id}`);
    console.log(`Name:           ${token.name}`);
    console.log(`Status:         ${status}`);
    console.log(`Permissions:    ${token.permissions.join(', ') || '(none)'}`);
    console.log(`Created:        ${token.createdAt}`);
    console.log(`Updated:        ${token.updatedAt}`);
    console.log(`Expires:        ${token.expiresAt || 'Never'}`);
    console.log(`Revoked:        ${token.revokedAt || 'No'}`);
  }

  console.log('');
}

function runCreate(options) {
  if (!options.name) {
    throw new Error('--name is required.');
  }

  if (!options.permissions) {
    throw new Error('--permissions is required.');
  }

  const permissions = parsePermissions(options.permissions);

  let expiresAt = null;

  if (options.expires) {
    const timestamp = Date.parse(options.expires);

    if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
      throw new Error('--expires must be a valid date in the future.');
    }

    expiresAt = new Date(timestamp).toISOString();
  }

  const created = tokenService.createToken(
    options.name,
    permissions,
    { expiresAt }
  );

  console.log('');
  console.log('Token created successfully.');
  console.log(`ID:             ${created.id}`);
  console.log(`Name:           ${created.name}`);
  console.log(`Permissions:    ${created.permissions.join(', ')}`);
  console.log(`Expires:        ${created.expiresAt || 'Never'}`);
  console.log('');
  console.log('IMPORTANT: The full token is displayed only once.');
  console.log('Store it securely. Only its hash is stored in the database.');
  console.log('');
  console.log(created.token);
  console.log('');
}

function runPermissions(options) {
  if (!options.id || !options.permissions) {
    throw new Error('Both --id and --permissions are required.');
  }

  const id = parseId(options.id);
  const permissions = parsePermissions(options.permissions);
  const db = getDatabase();

  ensureManagerSafeguard(db, id, permissions, 'permissions');
  tokenService.updateTokenPermissions(id, permissions);

  console.log(`Permissions updated for token ${id}.`);
  console.log(permissions.join(', ') || '(none)');
}

function runRevoke(options) {
  if (!options.id) {
    throw new Error('--id is required.');
  }

  const id = parseId(options.id);
  const db = getDatabase();

  ensureManagerSafeguard(db, id, [], 'revoke');
  tokenService.revokeToken(id);

  console.log(`Token ${id} has been revoked.`);
}

function main() {
  const command = process.argv[2];

  if (!command || command === '--help' || command === '-h') {
    console.log(HELP);
    return;
  }

  const options = parseArgs(process.argv.slice(3));

  if (options.help) {
    console.log(HELP);
    return;
  }

  if (!['create', 'list', 'permissions', 'revoke'].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  let databaseInitialized = false;

  try {
    initializeDatabase();
    databaseInitialized = true;

    const db = getDatabase();
    runMigrations(db);

    switch (command) {
      case 'create':
        runCreate(options);
        break;

      case 'list':
        printTokenList(tokenService.listTokens());
        break;

      case 'permissions':
        runPermissions(options);
        break;

      case 'revoke':
        runRevoke(options);
        break;
    }
  } finally {
    if (databaseInitialized) {
      closeDatabase();
    }
  }
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}