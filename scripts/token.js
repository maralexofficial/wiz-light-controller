'use strict';

const {
  initializeDatabase,
  getDatabase,
  closeDatabase
} = require('../src/database');

const { runMigrations } = require('../src/database/migrations');
const tokenService = require('../src/services/token.service');

const HELP = `
WiZ Light Controller – Tokenverwaltung

Befehle:

  npm run token:create -- --name "Android App" --permissions devices.read,devices.control
  npm run token:list
  npm run token:permissions -- --id 2 --permissions devices.read,groups.read
  npm run token:revoke -- --id 2

Optionen:

  --name          Tokenname (1–80 Zeichen)
  --permissions   Kommagetrennte Liste von Berechtigungen
  --id            Token-ID
  --expires       Ablaufdatum, z. B. 2027-01-01T00:00:00Z
  --help          Hilfe anzeigen

Verfügbare Berechtigungen:

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
      throw new Error(`Unbekanntes Argument: ${arg}`);
    }

    const key = arg.slice(2);

    if (!['name', 'permissions', 'id', 'expires'].includes(key)) {
      throw new Error(`Unbekannte Option: ${arg}`);
    }

    if (options[key] !== undefined) {
      throw new Error(`Option mehrfach angegeben: ${arg}`);
    }

    const value = args[index + 1];

    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Für ${arg} fehlt ein Wert.`);
    }

    options[key] = value;
    index += 1;
  }

  return options;
}

function parseId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new Error('--id muss eine positive Ganzzahl sein.');
  }

  const id = Number(value);

  if (!Number.isSafeInteger(id)) {
    throw new Error('--id liegt außerhalb des gültigen Zahlenbereichs.');
  }

  return id;
}

function parsePermissions(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('--permissions darf nicht leer sein.');
  }

  const permissions = value
    .split(',')
    .map((permission) => permission.trim());

  if (permissions.some((permission) => !permission)) {
    throw new Error('Die Berechtigungsliste enthält einen leeren Eintrag.');
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
    throw new Error(`Token mit ID ${tokenId} wurde nicht gefunden.`);
  }

  if (target.revoked_at) {
    throw new Error(`Token mit ID ${tokenId} ist bereits widerrufen.`);
  }

  if (target.expires_at && Date.parse(target.expires_at) <= Date.now()) {
    throw new Error(`Token mit ID ${tokenId} ist bereits abgelaufen.`);
  }

  let currentPermissions;

  try {
    currentPermissions = JSON.parse(target.permissions);
  } catch {
    throw new Error('Die gespeicherten Berechtigungen des Tokens sind ungültig.');
  }

  if (!Array.isArray(currentPermissions)) {
    throw new Error('Die gespeicherten Berechtigungen des Tokens sind ungültig.');
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
      'Abbruch: Dies würde die letzte aktive tokens.manage-Berechtigung entfernen. Erstelle zuerst einen weiteren Token mit tokens.manage.'
    );
  }
}

function printTokenList(tokens) {
  if (tokens.length === 0) {
    console.log('Keine Tokens vorhanden.');
    return;
  }

  for (const token of tokens) {
    const expired = token.expiresAt &&
      Date.parse(token.expiresAt) <= Date.now();

    const status = token.revokedAt
      ? 'Widerrufen'
      : expired
        ? 'Abgelaufen'
        : 'Aktiv';

    console.log('');
    console.log(`ID:             ${token.id}`);
    console.log(`Name:           ${token.name}`);
    console.log(`Status:         ${status}`);
    console.log(`Berechtigungen:  ${token.permissions.join(', ') || '(keine)'}`);
    console.log(`Erstellt:       ${token.createdAt}`);
    console.log(`Aktualisiert:   ${token.updatedAt}`);
    console.log(`Ablaufdatum:    ${token.expiresAt || 'Keines'}`);
    console.log(`Widerrufen:     ${token.revokedAt || 'Nein'}`);
  }

  console.log('');
}

function runCreate(options) {
  if (!options.name) {
    throw new Error('--name ist erforderlich.');
  }

  if (!options.permissions) {
    throw new Error('--permissions ist erforderlich.');
  }

  const permissions = parsePermissions(options.permissions);

  let expiresAt = null;

  if (options.expires) {
    const timestamp = Date.parse(options.expires);

    if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
      throw new Error('--expires muss ein gültiges Datum in der Zukunft sein.');
    }

    expiresAt = new Date(timestamp).toISOString();
  }

  const created = tokenService.createToken(
    options.name,
    permissions,
    { expiresAt }
  );

  console.log('');
  console.log('Token erfolgreich erstellt.');
  console.log(`ID:             ${created.id}`);
  console.log(`Name:           ${created.name}`);
  console.log(`Berechtigungen: ${created.permissions.join(', ')}`);
  console.log(`Ablaufdatum:    ${created.expiresAt || 'Keines'}`);
  console.log('');
  console.log('WICHTIG: Der vollständige Token wird nur jetzt angezeigt.');
  console.log('Speichere ihn sicher; die Datenbank enthält nur den Hash.');
  console.log('');
  console.log(created.token);
  console.log('');
}

function runPermissions(options) {
  if (!options.id || !options.permissions) {
    throw new Error(
      'Für permissions sind --id und --permissions erforderlich.'
    );
  }

  const id = parseId(options.id);
  const permissions = parsePermissions(options.permissions);
  const db = getDatabase();

  ensureManagerSafeguard(db, id, permissions, 'permissions');
  tokenService.updateTokenPermissions(id, permissions);

  console.log(`Berechtigungen von Token ${id} wurden aktualisiert.`);
  console.log(permissions.join(', ') || '(keine)');
}

function runRevoke(options) {
  if (!options.id) {
    throw new Error('Für revoke ist --id erforderlich.');
  }

  const id = parseId(options.id);
  const db = getDatabase();

  ensureManagerSafeguard(db, id, [], 'revoke');
  tokenService.revokeToken(id);

  console.log(`Token ${id} wurde widerrufen.`);
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
    throw new Error(`Unbekannter Befehl: ${command}`);
  }

  let databaseInitialized = false;

  try {
    initializeDatabase();
    databaseInitialized = true;

    runMigrations();

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
  console.error(`Fehler: ${error.message}`);
  process.exitCode = 1;
}