'use strict';

const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');

const discovery = require('../services/discovery.service');
const wiz = require('../services/wiz.service');
const response = require('../utils/response');
const logger = require('../utils/logger');

const router = express.Router();

const HOME_DATA_FILE = path.join(
  __dirname,
  '..',
  '..',
  'data',
  'wiz-home.json'
);

let discoveredBulbs = [];
let discoveryInProgress = false;
let lastDiscoveryTime = null;
let homeData = null;
let homeDataLoadPromise = null;

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

function validateHomeData(data) {
  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    !Array.isArray(data.rooms) ||
    !Array.isArray(data.devices)
  ) {
    throw new Error('Invalid home data structure.');
  }

  for (const room of data.rooms) {
    if (
      !room ||
      typeof room.room_id !== 'number' ||
      typeof room.name !== 'string'
    ) {
      throw new Error('Invalid room entry.');
    }
  }

  for (const device of data.devices) {
    if (
      !device ||
      typeof device.mac_address !== 'string' ||
      typeof device.name !== 'string' ||
      typeof device.room_id !== 'number'
    ) {
      throw new Error('Invalid device entry.');
    }
  }
}

async function loadHomeData() {
  try {
    const content = await fs.readFile(HOME_DATA_FILE, 'utf8');
    const data = JSON.parse(content);

    validateHomeData(data);
    homeData = data;

    logger.info(
      `[API] WiZ metadata loaded | rooms=${data.rooms.length} | devices=${data.devices.length}`
    );
  } catch (error) {
    homeData = null;

    const reason = error.code === 'ENOENT'
      ? 'File does not exist.'
      : error instanceof SyntaxError
        ? 'Invalid JSON.'
        : error.message || 'Unknown error.';

    logger.warn(`[API] WiZ metadata unavailable: ${reason}`);
  }
}

function ensureHomeDataLoaded() {
  if (!homeDataLoadPromise) {
    homeDataLoadPromise = loadHomeData();
  }

  return homeDataLoadPromise;
}

function normalizeMac(mac) {
  if (typeof mac !== 'string') {
    return '';
  }

  return mac.replace(/[^a-f0-9]/gi, '').toLowerCase();
}

function getDeviceMetadata(mac) {
  const emptyMetadata = {
    roomName: null,
    deviceName: null,
    deviceType: null
  };

  if (!homeData || !Array.isArray(homeData.devices)) {
    return emptyMetadata;
  }

  const normalizedMac = normalizeMac(mac);

  if (!normalizedMac) {
    return emptyMetadata;
  }

  const device = homeData.devices.find(
    (item) => normalizeMac(item.mac_address) === normalizedMac
  );

  if (!device) {
    return emptyMetadata;
  }

  const room = homeData.rooms.find(
    (item) => item.room_id === device.room_id
  );

  return {
    roomName: room?.name ?? null,
    deviceName: device.name ?? null,
    deviceType: device.type ?? null
  };
}

function handleError(res, error) {
  logger.error('[API] System request failed:', error);

  const message = error?.message || '';
  const isTimeout = message.includes('did not respond in time');

  return response.failure(
    res,
    isTimeout ? 504 : 502,
    isTimeout ? 'DEVICE_TIMEOUT' : 'DEVICE_OPERATION_FAILED',
    isTimeout
      ? 'The device did not respond in time.'
      : 'The device operation failed.'
  );
}

function getDiscoveredBulbs() {
  return discoveredBulbs.map((bulb) => ({ ...bulb }));
}

function findDiscoveredBulbByMac(mac) {
  const normalizedMac = normalizeMac(mac);

  if (!normalizedMac) {
    return null;
  }

  const bulb = discoveredBulbs.find(
    (item) => normalizeMac(item.mac) === normalizedMac
  );

  return bulb ? { ...bulb } : null;
}

function enrichDeviceInfo(bulb, info) {
  const systemConfig = info?.systemConfig || {};
  const deviceState = info?.state;

  const state = deviceState && typeof deviceState === 'object'
    ? { ...deviceState }
    : null;

  if (state) {
    delete state.mac;
    delete state.rssi;
  }

  const metadata = getDeviceMetadata(bulb.mac);

  return {
    ip: bulb.ip,
    mac: bulb.mac,
    success: bulb.success,
    roomId: systemConfig.roomId ?? null,
    roomName: metadata.roomName,
    deviceName: metadata.deviceName,
    deviceType: metadata.deviceType,
    moduleName: systemConfig.moduleName ?? null,
    firmwareVersion: systemConfig.fwVersion ?? null,
    state,
    rssi: deviceState?.rssi ?? null
  };
}

async function runBroadcast(action) {
  const bulbs = getDiscoveredBulbs();

  const results = await Promise.allSettled(
    bulbs.map(async (bulb) => {
      const result = action === 'on'
        ? await wiz.turnOn(bulb.ip)
        : await wiz.turnOff(bulb.ip);

      return {
        ip: bulb.ip,
        success: true,
        result,
        error: null
      };
    })
  );

  return results.map((entry, index) => {
    if (entry.status === 'fulfilled') {
      return entry.value;
    }

    const error = entry.reason;

    logger.warn(
      `[API] Broadcast ${action} failed for ${bulbs[index].ip}:`,
      error?.message || 'Unknown error'
    );

    return {
      ip: bulbs[index].ip,
      success: false,
      result: null,
      error: {
        code: error?.message?.includes('did not respond in time')
          ? 'DEVICE_TIMEOUT'
          : 'DEVICE_OPERATION_FAILED',
        message: error?.message || 'Unknown error'
      }
    };
  });
}

async function runBulkStateRequest() {
  const bulbs = getDiscoveredBulbs();

  const results = await Promise.allSettled(
    bulbs.map(async (bulb) => {
      const state = await wiz.getState(bulb.ip);

      return {
        ip: bulb.ip,
        success: true,
        state: state.result,
        error: null
      };
    })
  );

  return results.map((entry, index) => {
    if (entry.status === 'fulfilled') {
      return entry.value;
    }

    const error = entry.reason;
    const isTimeout = error?.message?.includes(
      'did not respond in time'
    );

    logger.warn(
      `[API] State request failed for ${bulbs[index].ip}:`,
      error?.message || 'Unknown error'
    );

    return {
      ip: bulbs[index].ip,
      success: false,
      state: null,
      error: {
        code: isTimeout
          ? 'DEVICE_TIMEOUT'
          : 'DEVICE_OPERATION_FAILED',
        message: isTimeout
          ? 'The device did not respond in time.'
          : 'The device operation failed.'
      }
    };
  });
}

router.get(
  '/discover',
  requirePermission('devices.discover'),
  async (req, res) => {
    if (discoveryInProgress) {
      return response.failure(
        res,
        409,
        'DISCOVERY_IN_PROGRESS',
        'Device discovery is already in progress.'
      );
    }

    discoveryInProgress = true;

    try {
      await ensureHomeDataLoaded();

      const devices = await discovery.discoverDevices();

      const enrichedDevices = await Promise.all(
        devices.map(async (bulb) => {
          try {
            const info = await wiz.getDeviceInfo(bulb.ip);
            return enrichDeviceInfo(bulb, info);
          } catch (error) {
            logger.warn(
              `[API] Device information request failed for ${bulb.ip}:`,
              error?.message || 'Unknown error'
            );

            const metadata = getDeviceMetadata(bulb.mac);

            return {
              ip: bulb.ip,
              mac: bulb.mac,
              success: bulb.success,
              roomId: null,
              roomName: metadata.roomName,
              deviceName: metadata.deviceName,
              deviceType: metadata.deviceType,
              moduleName: null,
              firmwareVersion: null,
              state: null,
              rssi: null
            };
          }
        })
      );

      discoveredBulbs = enrichedDevices;
      lastDiscoveryTime = Date.now();

      logger.info(
        `[API] Discovery completed | devices=${discoveredBulbs.length}`
      );

      return response.success(res, {
        count: discoveredBulbs.length,
        bulbs: getDiscoveredBulbs(),
        lastDiscoveryTime
      });
    } catch (error) {
      return handleError(res, error);
    } finally {
      discoveryInProgress = false;
    }
  }
);

router.get(
  '/bulbs',
  requirePermission('devices.read'),
  (req, res) => {
    return response.success(res, {
      count: discoveredBulbs.length,
      bulbs: getDiscoveredBulbs(),
      lastDiscoveryTime
    });
  }
);

router.get(
  '/states',
  requirePermission('devices.read'),
  async (req, res) => {
    if (discoveredBulbs.length === 0) {
      return response.failure(
        res,
        503,
        'NO_DISCOVERED_DEVICES',
        'No discovered devices are available. Call GET /api/discover first.'
      );
    }

    try {
      const results = await runBulkStateRequest();
      const succeeded = results.filter((item) => item.success).length;
      const failed = results.length - succeeded;

      return response.success(
        res,
        {
          count: results.length,
          succeeded,
          failed,
          lastDiscoveryTime,
          results
        },
        failed > 0 ? 207 : 200
      );
    } catch (error) {
      return handleError(res, error);
    }
  }
);

router.post(
  '/broadcast/on',
  requirePermission('system.broadcast'),
  async (req, res) => {
    try {
      const results = await runBroadcast('on');
      const succeeded = results.filter((item) => item.success).length;
      const failed = results.length - succeeded;

      return response.success(
        res,
        {
          action: 'on',
          count: results.length,
          succeeded,
          failed,
          results
        },
        failed > 0 ? 207 : 200
      );
    } catch (error) {
      return handleError(res, error);
    }
  }
);

router.post(
  '/broadcast/off',
  requirePermission('system.broadcast'),
  async (req, res) => {
    try {
      const results = await runBroadcast('off');
      const succeeded = results.filter((item) => item.success).length;
      const failed = results.length - succeeded;

      return response.success(
        res,
        {
          action: 'off',
          count: results.length,
          succeeded,
          failed,
          results
        },
        failed > 0 ? 207 : 200
      );
    } catch (error) {
      return handleError(res, error);
    }
  }
);

router.get(
  '/health',
  requirePermission('system.read'),
  (req, res) => {
    return response.success(res, {
      status: 'running',
      uptime: Math.floor(process.uptime()),
      discoveredBulbs: discoveredBulbs.length,
      lastDiscoveryTime
    });
  }
);

module.exports = router;
module.exports.getDiscoveredBulbs = getDiscoveredBulbs;
module.exports.findDiscoveredBulbByMac = findDiscoveredBulbByMac;