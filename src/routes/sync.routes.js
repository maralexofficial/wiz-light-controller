'use strict';

const express = require('express');

const groupsService = require('../services/groups.service');
const response = require('../utils/response');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/sync', (req, res) => {
  try {
    const syncState = groupsService.getSyncState();
    const groups = groupsService.listGroups();

    return response.success(res, {
      revision: syncState.revision,
      updatedAt: syncState.updatedAt,
      groups
    });
  } catch (error) {
    logger.error('[SYNC] Failed to retrieve synchronization state:', error);

    return response.failure(
      res,
      500,
      'SYNC_FAILED',
      'Unable to retrieve synchronization data.'
    );
  }
});

module.exports = router;