'use strict';

const config = require('../config');
const tokenService = require('./token.service');
const { getDatabase } = require('../database');
const logger = require('../utils/logger');

const LEGACY_TOKEN_NAME = 'Migrated legacy API token';

function bootstrapLegacyToken() {
  const db = getDatabase();
  const legacyToken = config.apiToken;

  if (
    typeof legacyToken !== 'string' ||
    legacyToken.length < 32
  ) {
    throw new Error(
      'A valid legacy API token is required for the initial token migration.'
    );
  }

  const legacyHash = tokenService.hashToken(legacyToken);

  const existing = db.prepare(`
    SELECT id, name
    FROM api_tokens
    WHERE token_hash = ?
  `).get(legacyHash);

  if (existing) {
    logger.info(
      `[TOKENS] Legacy token is already registered | id=${existing.id}`
    );

    return {
      id: existing.id,
      created: false
    };
  }

  const result = db.prepare(`
    INSERT INTO api_tokens (
      name,
      token_hash,
      permissions
    )
    VALUES (?, ?, ?)
  `).run(
    LEGACY_TOKEN_NAME,
    legacyHash,
    JSON.stringify(tokenService.DEFAULT_MIGRATED_PERMISSIONS)
  );

  const id = Number(result.lastInsertRowid);

  logger.info(
    `[TOKENS] Legacy API token imported into token storage | id=${id}`
  );

  return {
    id,
    created: true
  };
}

module.exports = {
  bootstrapLegacyToken
};