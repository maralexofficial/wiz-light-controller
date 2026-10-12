'use strict';

const express = require('express');
const deviceDiscovery = require('../services/device-discovery.service');
const {
  saveDiscoveryState
} = require('../services/device-discovery-state.service');
const wiz = require('../services/wiz.service');
const response = require('../utils/response');
const logger = require('../utils/logger');
const { normalizeMac } = require('../utils/mac');
const {
  loadHomeDataFromFile,
  validateHomeData
} = require('../utils/home-data');

const router = express.Router();

let discoveredBulbs = [];
let discoveryInProgress = false;
let lastDiscoveryTime = null;
let homeData = null;
let homeDataLoadPromise = null;

function restoreDiscoveryState(devices, timestamp) {
  if (!Array.isArray(devices)) {
    throw new TypeError(
      'Restored discovery devices must be an array.'
    );
  }

  if (
    timestamp !== null &&
    (!Number.isSafeInteger(timestamp) || timestamp <= 0)
  ) {
    throw new TypeError(
      'Restored discovery timestamp is invalid.'
    );
  }

  discoveredBulbs = devices.map((device) => ({ ...device }));
  lastDiscoveryTime = timestamp;
}

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

async function loadHomeData() {
  try {
    const data = await loadHomeDataFromFile();
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

function enrichDeviceInfo(bulb) {
  const systemConfig = bulb?.systemConfig || {};
  const deviceState = bulb?.state;

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
    success: bulb.success === true,
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

      const devices =
        await deviceDiscovery.discoverDevicesWithDetails();

      const enrichedDevices = devices.map(enrichDeviceInfo);
      const discoveryTime = Date.now();

      const savedState = saveDiscoveryState(
        enrichedDevices,
        discoveryTime
      );

      discoveredBulbs = savedState.devices.map(
        (device) => ({ ...device })
      );
      lastDiscoveryTime = savedState.lastDiscoveryTime;

      logger.info(
        `[API] Discovery completed and saved | discovered=${devices.length} | stored=${discoveredBulbs.length} | timestamp=${lastDiscoveryTime}`
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
module.exports.restoreDiscoveryState = restoreDiscoveryState;
