
'use strict';

const crypto = require('node:crypto');
const config = require('../config');

function unauthorized(res) {
  return res.status(401).json({
    success: false,
    error: 'Unauthorized. A valid API token is required.'
  });
}

function authMiddleware(req, res, next) {
  if (!config.apiAuthEnabled) {
    return next();
  }

  const authorization = req.get('authorization');

  if (!authorization || typeof authorization !== 'string') {
    return unauthorized(res);
  }

  const match = authorization.match(/^Bearer\s+(\S+)$/i);

  if (!match) {
    return unauthorized(res);
  }

  const providedToken = match[1];
  const expectedToken = config.apiToken;

  const providedBuffer = Buffer.from(providedToken, 'utf8');
  const expectedBuffer = Buffer.from(expectedToken, 'utf8');

  if (providedBuffer.length !== expectedBuffer.length) {
    return unauthorized(res);
  }

  const tokenMatches = crypto.timingSafeEqual(
    providedBuffer,
    expectedBuffer
  );

  if (!tokenMatches) {
    return unauthorized(res);
  }

  return next();
}

module.exports = authMiddleware;
