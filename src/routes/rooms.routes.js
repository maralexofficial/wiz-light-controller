'use strict';

const express = require('express');
const groupsService = require('../services/groups.service');
const response = require('../utils/response');
const logger = require('../utils/logger');

const router = express.Router();

function handleError(res, error) {
  if (error instanceof groupsService.GroupError) {
    return response.failure(
      res,
      error.status,
      error.code,
      error.message,
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

router.get('/rooms', (req, res) => {
  try {
    const rooms = groupsService.listRooms();
    return response.success(res, rooms);
  } catch (error) {
    return handleError(res, error);
  }
});

router.get('/rooms/:roomId/groups', (req, res) => {
  try {
    const result = groupsService.getGroupsByRoom(req.params.roomId);
    return response.success(res, result);
  } catch (error) {
    return handleError(res, error);
  }
});

module.exports = router;