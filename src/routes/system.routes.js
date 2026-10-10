
'use strict';

const express = require('express');
const discovery = require('../services/discovery.service');
const wiz = require('../services/wiz.service');

const router = express.Router();

let discoveredBulbs = [];
let discoveryInProgress = false;
let lastDiscoveryTime = null;

function handleError(res, error) {
  console.error('[API] System request failed:', error.message);

  const status = error.message.includes('did not respond in time')
    ? 504
    : 502;

  return res.status(status).json({
    success: false,
    error: error.message
  });
}

async function runBroadcast(action) {
  const results = await Promise.allSettled(
    discoveredBulbs.map(async (bulb) => {
      let result;

      if (action === 'on') {
        result = await wiz.turnOn(bulb.ip);
      } else {
        result = await wiz.turnOff(bulb.ip);
      }

      return {
        ip: bulb.ip,
        success: true,
        result
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
      error: entry.reason?.message || 'Unknown error'
    };
  });
}

router.get('/discover', async (req, res) => {
  if (discoveryInProgress) {
    return res.status(409).json({
      success: false,
      error: 'Device discovery is already in progress.'
    });
  }

  discoveryInProgress = true;

  try {
    discoveredBulbs = await discovery.discoverDevices();
    lastDiscoveryTime = new Date().toISOString();

    return res.json({
      success: true,
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
  return res.json({
    success: true,
    count: discoveredBulbs.length,
    bulbs: discoveredBulbs,
    lastDiscoveryTime
  });
});

router.post('/broadcast/on', async (req, res) => {
  try {
    const results = await runBroadcast('on');
    const succeeded = results.filter((item) => item.success).length;

    return res.json({
      success: succeeded === results.length,
      action: 'on',
      count: results.length,
      succeeded,
      failed: results.length - succeeded,
      results
    });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post('/broadcast/off', async (req, res) => {
  try {
    const results = await runBroadcast('off');
    const succeeded = results.filter((item) => item.success).length;

    return res.json({
      success: succeeded === results.length,
      action: 'off',
      count: results.length,
      succeeded,
      failed: results.length - succeeded,
      results
    });
  } catch (error) {
    return handleError(res, error);
  }
});

router.get('/health', (req, res) => {
  return res.json({
    status: 'running',
    uptime: Math.floor(process.uptime()),
    discoveredBulbs: discoveredBulbs.length,
    lastDiscoveryTime
  });
});

module.exports = router;
