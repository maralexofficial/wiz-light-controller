'use strict';

const crypto = require('node:crypto');
const tokenService = require('../services/token.service');
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

  let token;

  try {
    token = tokenService.findActiveToken(match[1]);
  } catch (error) {
    logger.error(
      '[API] Token authentication failed:',
      error.message
    );

    return response.failure(
      res,
      500,
      'AUTHENTICATION_UNAVAILABLE',
      'Authentication is temporarily unavailable.'
    );
  }

  if (!token) {
    logger.warn(
      `[API] Authentication failed | method=${req.method} | path=${req.path} | reason=invalid_or_inactive_token`
    );

    return unauthorized(res);
  }

  req.apiToken = {
    id: token.id,
    name: token.name,
    permissions: token.permissions
  };

  req.hasPermission = (permission) => (
    typeof permission === 'string' &&
    Array.isArray(req.apiToken.permissions) &&
    req.apiToken.permissions.includes(permission)
  );

  return next();
}

module.exports = authMiddleware;