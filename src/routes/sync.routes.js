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

router.get(
  '/sync',
  requirePermission('system.read'),
  (req, res) => {
    try {
      const syncState = groupsService.getSyncState();
      const rooms = groupsService.listRooms();
      const groups = groupsService.listGroups();

      return response.success(res, {
        revision: syncState.revision,
        updatedAt: syncState.updatedAt,
        rooms,
        groups
      });
    } catch (error) {
      logger.error('[SYNC] Request failed:', error);

      return response.failure(
        res,
        500,
        'SYNC_FAILED',
        'Unable to retrieve synchronization data.'
      );
    }
  }
);

module.exports = router;