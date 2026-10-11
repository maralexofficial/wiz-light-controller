'use strict';

const express = require('express');

const groupsService = require('../services/groups.service');
const homeDataService = require('../services/home-data.service');
const wiz = require('../services/wiz.service');
const systemRouter = require('./system.routes');
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

function getDeviceResultError(error) {
  const message = error?.message || 'Device operation failed.';
  const isTimeout = message.includes('did not respond in time');

  return {
    code: isTimeout ? 'DEVICE_TIMEOUT' : 'DEVICE_OPERATION_FAILED',
    message: isTimeout
      ? 'The device did not respond in time.'
      : 'The device operation failed.'
  };
}

async function executeGroupAction(group, action, value) {
  const knownDevices = getKnownDevices();
  const discoveredDevices = systemRouter.getDiscoveredBulbs();

  const knownByMac = new Map(
    knownDevices.map((device) => [device.mac, device])
  );

  const discoveredByMac = new Map(
    discoveredDevices.map((device) => [
      homeDataService.normalizeMac(device.mac),
      device
    ])
  );

  const results = await Promise.all(
    group.members.map(async (mac) => {
      const normalizedMac = homeDataService.normalizeMac(mac);
      const metadata = knownByMac.get(normalizedMac);
      const bulb = discoveredByMac.get(normalizedMac);

      if (!metadata) {
        return {
          mac: normalizedMac,
          name: null,
          success: false,
          error: {
            code: 'UNKNOWN_DEVICE',
            message: 'Device is not present in the home metadata.'
          }
        };
      }

      if (metadata.deviceType !== group.deviceType) {
        return {
          mac: normalizedMac,
          name: metadata.name,
          success: false,
          error: {
            code: 'INCOMPATIBLE_DEVICE_TYPE',
            message: 'Device type does not match the group.'
          }
        };
      }

      if (!bulb || !bulb.ip || bulb.success === false) {
        return {
          mac: normalizedMac,
          name: metadata.name,
          ip: bulb?.ip ?? null,
          success: false,
          error: {
            code: 'DEVICE_OFFLINE',
            message: 'Device is not currently available through discovery.'
          }
        };
      }

      if (action === 'brightness' && metadata.traits?.is_dimmable !== true) {
        return {
          mac: normalizedMac,
          name: metadata.name,
          ip: bulb.ip,
          success: false,
          error: {
            code: 'UNSUPPORTED_CAPABILITY',
            message: 'This device does not support brightness control.'
          }
        };
      }

      try {
        let result;

        switch (action) {
          case 'on':
            result = await wiz.turnOn(bulb.ip);
            break;

          case 'off':
            result = await wiz.turnOff(bulb.ip);
            break;

          case 'brightness':
            result = await wiz.setBrightness(bulb.ip, value);
            break;

          default:
            throw new Error('Unsupported group action.');
        }

        return {
          mac: normalizedMac,
          name: metadata.name,
          ip: bulb.ip,
          success: true,
          result,
          error: null
        };
      } catch (error) {
        const deviceError = getDeviceResultError(error);

        logger.warn(
          `[GROUPS] Action ${action} failed | mac=${normalizedMac} | ip=${bulb.ip} | code=${deviceError.code}`
        );

        return {
          mac: normalizedMac,
          name: metadata.name,
          ip: bulb.ip,
          success: false,
          result: null,
          error: deviceError
        };
      }
    })
  );

  const succeeded = results.filter((item) => item.success).length;
  const failed = results.length - succeeded;

  return {
    groupId: group.id,
    groupName: group.name,
    action,
    value: value ?? null,
    count: results.length,
    succeeded,
    failed,
    results
  };
}

async function handleGroupAction(req, res, action, value) {
  try {
    const group = groupsService.getGroup(req.params.id);

    if (group.deviceType !== 'light' && group.deviceType !== 'plug') {
      return response.failure(
        res,
        400,
        'INVALID_DEVICE_TYPE',
        'Unsupported group device type.'
      );
    }

    if (action === 'brightness' && group.deviceType !== 'light') {
      return response.failure(
        res,
        400,
        'UNSUPPORTED_ACTION',
        'Brightness control is only available for light groups.'
      );
    }

    const result = await executeGroupAction(group, action, value);

    return response.success(
      res,
      result,
      result.failed > 0 ? 207 : 200
    );
  } catch (error) {
    return handleGroupError(res, error);
  }
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
    const group = groupsService.createGroup(
      req.body,
      getKnownDevices()
    );

    return response.success(res, { group }, 201);
  } catch (error) {
    return handleGroupError(res, error);
  }
});

router.patch('/groups/:id', (req, res) => {
  try {
    const group = groupsService.updateGroup(
      req.params.id,
      req.body,
      getKnownDevices()
    );

    return response.success(res, { group });
  } catch (error) {
    return handleGroupError(res, error);
  }
});

router.delete('/groups/:id', (req, res) => {
  try {
    return response.success(
      res,
      groupsService.deleteGroup(req.params.id)
    );
  } catch (error) {
    return handleGroupError(res, error);
  }
});

router.post('/groups/:id/on', (req, res) => {
  return handleGroupAction(req, res, 'on');
});

router.post('/groups/:id/off', (req, res) => {
  return handleGroupAction(req, res, 'off');
});

router.post('/groups/:id/brightness', (req, res) => {
  const brightness = req.body?.brightness;

  if (
    !Number.isInteger(brightness) ||
    brightness < 10 ||
    brightness > 100
  ) {
    return response.failure(
      res,
      400,
      'INVALID_BRIGHTNESS',
      'Brightness must be an integer between 10 and 100.'
    );
  }

  return handleGroupAction(
    req,
    res,
    'brightness',
    brightness
  );
});

module.exports = router;