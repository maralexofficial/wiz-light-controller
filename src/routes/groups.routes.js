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

function validateGroupCapability(group, action, value) {
  const knownDevices = getKnownDevices();
  const knownByMac = new Map(
    knownDevices.map((device) => [device.mac, device])
  );

  const members = group.members.map((mac) => ({
    mac: homeDataService.normalizeMac(mac),
    device: knownByMac.get(homeDataService.normalizeMac(mac))
  }));

  if (members.some((member) => !member.device)) {
    return {
      valid: false,
      statusCode: 400,
      code: 'UNKNOWN_DEVICE',
      message: 'At least one group member is missing from the home metadata.'
    };
  }

  if (members.some((member) => member.device.deviceType !== group.deviceType)) {
    return {
      valid: false,
      statusCode: 400,
      code: 'INCOMPATIBLE_DEVICE_TYPE',
      message: 'A group member has an incompatible device type.'
    };
  }

  if (action === 'brightness') {
    if (group.deviceType !== 'light') {
      return {
        valid: false,
        statusCode: 400,
        code: 'UNSUPPORTED_ACTION',
        message: 'Brightness control is only available for light groups.'
      };
    }

    if (
      members.some(
        (member) => member.device.traits?.is_dimmable !== true
      )
    ) {
      return {
        valid: false,
        statusCode: 400,
        code: 'UNSUPPORTED_CAPABILITY',
        message: 'Every group member must support brightness control.'
      };
    }
  }

  if (action === 'temperature') {
    if (group.deviceType !== 'light') {
      return {
        valid: false,
        statusCode: 400,
        code: 'UNSUPPORTED_ACTION',
        message: 'Color temperature control is only available for light groups.'
      };
    }

    const ranges = members.map((member) => {
      const traits = member.device.traits;
      const range = traits?.white_range;

      if (
        traits?.is_tunable_white !== true ||
        !Array.isArray(range) ||
        range.length !== 2 ||
        !Number.isInteger(range[0]) ||
        !Number.isInteger(range[1]) ||
        range[0] > range[1]
      ) {
        return null;
      }

      return {
        minimum: range[0],
        maximum: range[1]
      };
    });

    if (ranges.some((range) => range === null)) {
      return {
        valid: false,
        statusCode: 400,
        code: 'UNSUPPORTED_CAPABILITY',
        message: 'Every group member must support adjustable white color temperature.'
      };
    }

    const minimum = Math.max(...ranges.map((range) => range.minimum));
    const maximum = Math.min(...ranges.map((range) => range.maximum));

    if (minimum > maximum) {
      return {
        valid: false,
        statusCode: 400,
        code: 'NO_COMMON_TEMPERATURE_RANGE',
        message: 'The group members have no common color temperature range.'
      };
    }

    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      return {
        valid: false,
        statusCode: 400,
        code: 'INVALID_TEMPERATURE',
        message: `Temperature must be an integer between ${minimum} and ${maximum} Kelvin for this group.`,
        details: {
          minimum,
          maximum
        }
      };
    }
  }

  return { valid: true };
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

          case 'temperature':
            result = await wiz.setColorTemperature(bulb.ip, value);
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

    const capability = validateGroupCapability(group, action, value);

    if (!capability.valid) {
      return response.failure(
        res,
        capability.statusCode,
        capability.code,
        capability.message,
        capability.details ?? null
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
    return response.success(res, groupsService.listGroups());
  } catch (error) {
    return handleGroupError(res, error);
  }
});

router.get('/groups/:id', (req, res) => {
  try {
    return response.success(res, groupsService.getGroup(req.params.id));
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

    return response.success(res, group, 201);
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

    return response.success(res, group);
  } catch (error) {
    return handleGroupError(res, error);
  }
});

router.delete('/groups/:id', (req, res) => {
  try {
    groupsService.deleteGroup(req.params.id);

    return response.success(res, {
      id: req.params.id,
      deleted: true
    });
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

  return handleGroupAction(req, res, 'brightness', brightness);
});

router.post('/groups/:id/temperature', (req, res) => {
  const temperature = req.body?.temperature;

  if (!Number.isInteger(temperature)) {
    return response.failure(
      res,
      400,
      'INVALID_TEMPERATURE',
      'Temperature must be an integer value in Kelvin.'
    );
  }

  return handleGroupAction(req, res, 'temperature', temperature);
});

module.exports = router;