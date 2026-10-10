'use strict';

const express = require('express');
const discovery = require('../services/discovery.service');
const wiz = require('../services/wiz.service');
const response = require('../utils/response');
const logger = require('../utils/logger');

const router = express.Router();

let discoveredBulbs = [];
let discoveryInProgress = false;
let lastDiscoveryTime = null;

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

function enrichDeviceInfo(bulb, info) {
  const systemConfig = info.systemConfig || {};
  const deviceState = info.state;

  const state = deviceState && typeof deviceState === 'object'
    ? { ...deviceState }
    : null;

  if (state) {
    delete state.mac;
    delete state.rssi;
  }

  return {
    ip: bulb.ip,
    mac: bulb.mac,
    success: bulb.success,
    roomId: systemConfig.roomId ?? null,
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

router.get('/discover', async (req, res) => {
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

          return {
            ip: bulb.ip,
            mac: bulb.mac,
            success: bulb.success,
            roomId: null,
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
});

router.get('/bulbs', (req, res) => {
  return response.success(res, {
    count: discoveredBulbs.length,
    bulbs: getDiscoveredBulbs(),
    lastDiscoveryTime
  });
});

router.get('/states', async (req, res) => {
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
});

router.post('/broadcast/on', async (req, res) => {
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
});

router.post('/broadcast/off', async (req, res) => {
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
});

router.get('/health', (req, res) => {
  return response.success(res, {
    status: 'running',
    uptime: Math.floor(process.uptime()),
    discoveredBulbs: discoveredBulbs.length,
    lastDiscoveryTime
  });
});

module.exports = router;