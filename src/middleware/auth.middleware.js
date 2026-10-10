'use strict';

const crypto = require('node:crypto');
const config = require('../config');
const response = require('../utils/response');
const logger = require('../utils/logger');

function unauthorized(res) {
  return response.failure(
    res,
    401,
    'UNAUTHORIZED',
    'A valid API token is required.'
  );
}

function authMiddleware(req, res, next) {
  if (!config.apiAuthEnabled) {
    return next();
  }

  const authorization = req.get('authorization');

  if (!authorization || typeof authorization !== 'string') {
    logger.warn(
      `[API] Authentication failed | method=${req.method} | path=${req.path} | reason=missing_token`
    );

    return unauthorized(res);
  }

  const match = authorization.match(/^Bearer\s+(\S+)$/i);

  if (!match) {
    logger.warn(
      `[API] Authentication failed | method=${req.method} | path=${req.path} | reason=invalid_authorization_format`
    );

    return unauthorized(res);
  }

  const providedToken = match[1];
  const expectedToken = config.apiToken;

  const providedBuffer = Buffer.from(providedToken, 'utf8');
  const expectedBuffer = Buffer.from(expectedToken, 'utf8');

  if (providedBuffer.length !== expectedBuffer.length) {
    logger.warn(
      `[API] Authentication failed | method=${req.method} | path=${req.path} | reason=token_length_mismatch`
    );

    return unauthorized(res);
  }

  const tokenMatches = crypto.timingSafeEqual(
    providedBuffer,
    expectedBuffer
  );

  if (!tokenMatches) {
    logger.warn(
      `[API] Authentication failed | method=${req.method} | path=${req.path} | reason=invalid_token`
    );

    return unauthorized(res);
  }

  return next();
}

module.exports = authMiddleware;