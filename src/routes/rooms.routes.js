'use strict';

const express = require('express');
const groupsService = require('../services/groups.service');
const response = require('../utils/response');
const logger = require('../utils/logger');

const router = express.Router();

function requirePermission(permission) {
  return (req, res, next) => {
    if (
      typeof req.hasPermission !== 'function' ||
      !req.hasPermission(permission)
    ) {
      logger.warn(
        `[API] Permission denied | method=${req.method} | path=${req.path} | permission=${permission} | tokenId=${req.apiToken?.id ?? 'unknown'}`
      );

      return response.failure(
        res,
        403,
        'FORBIDDEN',
        'The API token does not have the required permission.'
      );
    }

    return next();
  };
}

function handleError(res, error) {
  if (error instanceof groupsService.GroupError) {
    const status = Number.isInteger(error.status)
      ? error.status
      : Number.isInteger(error.statusCode)
        ? error.statusCode
        : 500;

    const code =
      typeof error.code === 'string' && error.code.length > 0
        ? error.code
        : 'ROOMS_REQUEST_FAILED';

    const message =
      typeof error.message === 'string' && error.message.length > 0
        ? error.message
        : 'Unable to retrieve room data.';

    if (status === 500) {
      logger.error('[ROOMS] Group service error:', error);
    }

    return response.failure(
      res,
      status,
      code,
      message,
      error.details
    );
  }

  logger.error('[ROOMS] Request failed:', error);

  return response.failure(
    res,
    500,
    'ROOMS_REQUEST_FAILED',
    'Unable to retrieve room data.'
  );
}

router.get(
  '/rooms',
  requirePermission('rooms.read'),
  (req, res) => {
    try {
      const rooms = groupsService.listRooms();
      return response.success(res, rooms);
    } catch (error) {
      return handleError(res, error);
    }
  }
);

router.get(
  '/rooms/:roomId/groups',
  requirePermission('rooms.read'),
  (req, res) => {
    try {
      const result = groupsService.getGroupsByRoom(req.params.roomId);
      return response.success(res, result);
    } catch (error) {
      return handleError(res, error);
    }
  }
);

module.exports = router;