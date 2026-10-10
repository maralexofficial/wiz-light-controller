
'use strict';

const express = require('express');
const discovery = require('../services/discovery.service');
const wiz = require('../services/wiz.service');
const response = require('../utils/response');

const router = express.Router();

let discoveredBulbs = [];
let discoveryInProgress = false;
let lastDiscoveryTime = null;

function handleError(res, error) {
  console.error('[API] System request failed:', error.message);

  const isTimeout = error.message.includes('did not respond in time');

  return response.failure(
    res,
    isTimeout ? 504 : 502,
    isTimeout ? 'DEVICE_TIMEOUT' : 'DEVICE_OPERATION_FAILED',
    isTimeout
      ? 'The device did not respond in time.'
      : 'The device operation failed.'
  );
}

async function runBroadcast(action) {
  const results = await Promise.allSettled(
    discoveredBulbs.map(async (bulb) => {
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

    return {
      ip: discoveredBulbs[index].ip,
      success: false,
      result: null,
      error: {
        code: 'DEVICE_OPERATION_FAILED',
        message: entry.reason?.message || 'Unknown error'
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
    discoveredBulbs = await discovery.discoverDevices();
    lastDiscoveryTime = Date.now();

    return response.success(res, {
      count: discoveredBulbs.length,
      bulbs: discoveredBulbs,
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
    bulbs: discoveredBulbs,
    lastDiscoveryTime
  });
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
