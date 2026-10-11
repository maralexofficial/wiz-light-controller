'use strict';

const config = require('../config');
const tokenService = require('./token.service');
const { getDatabase } = require('../database');
const logger = require('../utils/logger');

const LEGACY_TOKEN_NAME = 'Migrated legacy API token';

function bootstrapLegacyToken() {
  const db = getDatabase();

  const legacyToken = config.legacyApiToken || config.apiToken || '';

  const tokenCount = db.prepare(
    'SELECT COUNT(*) AS count FROM api_tokens'
  ).get();

  const existingCount = Number(tokenCount?.count ?? 0);

  if (!legacyToken) {
    if (existingCount > 0) {
      logger.info(
        `[TOKENS] Token storage already initialized | tokens=${existingCount}`
      );

      return {
        id: null,
        created: false,
        skipped: true
      };
    }

    throw new Error(
      'No API tokens exist and API_TOKEN is not configured. Set API_TOKEN temporarily to import the initial token.'
    );
  }

  const legacyHash = tokenService.hashToken(legacyToken);

  const existing = db.prepare(
    'SELECT id, name FROM api_tokens WHERE token_hash = ?'
  ).get(legacyHash);

  if (existing) {
    logger.info(
      `[TOKENS] Legacy token is already registered | id=${existing.id}`
    );

    return {
      id: Number(existing.id),
      created: false,
      skipped: false
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
    created: true,
    skipped: false
  };
}

module.exports = {
  bootstrapLegacyToken
};