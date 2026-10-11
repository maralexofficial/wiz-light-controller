'use strict';

const express = require('express');
const groupsService = require('../services/groups.service');
const homeDataService = require('../services/home-data.service');
const response = require('../utils/response');
const logger = require('../utils/logger');

const router = express.Router();

function handleGroupError(res, error) {
  if (error instanceof groupsService.GroupError) {
    return response.failure(
      res,
      error.statusCode,
      error.code,
      error.message
    );
  }

  if (error instanceof homeDataService.HomeDataError) {
    return response.failure(
      res,
      error.statusCode,
      error.code,
      error.message
    );
  }

  logger.error('[GROUPS] Request failed:', error);

  return response.failure(
    res,
    500,
    'INTERNAL_SERVER_ERROR',
    'Internal server error.'
  );
}

function getKnownDevices() {
  return homeDataService.getKnownDevices();
}

router.get('/groups', (req, res) => {
  try {
    return response.success(res, {
      groups: groupsService.listGroups()
    });
  } catch (error) {
    return handleGroupError(res, error);
  }
});

router.get('/groups/:id', (req, res) => {
  try {
    return response.success(res, {
      group: groupsService.getGroup(req.params.id)
    });
  } catch (error) {
    return handleGroupError(res, error);
  }
});

router.post('/groups', (req, res) => {
  try {
    const knownDevices = getKnownDevices();

    const group = groupsService.createGroup(
      req.body,
      knownDevices
    );

    return response.success(
      res,
      { group },
      201
    );
  } catch (error) {
    return handleGroupError(res, error);
  }
});

router.patch('/groups/:id', (req, res) => {
  try {
    const knownDevices = getKnownDevices();

    const group = groupsService.updateGroup(
      req.params.id,
      req.body,
      knownDevices
    );

    return response.success(res, { group });
  } catch (error) {
    return handleGroupError(res, error);
  }
});

router.delete('/groups/:id', (req, res) => {
  try {
    const result = groupsService.deleteGroup(req.params.id);

    return response.success(res, result);
  } catch (error) {
    return handleGroupError(res, error);
  }
});

module.exports = router;