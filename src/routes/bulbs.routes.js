
'use strict';

const express = require('express');
const net = require('node:net');
const wiz = require('../services/wiz.service');
const response = require('../utils/response');

const router = express.Router();

function validateIp(ip) {
  return typeof ip === 'string' && net.isIP(ip) === 4;
}

function getErrorStatus(error) {
  const message = error.message || '';

  if (
    message.includes('must be') ||
    message.includes('required') ||
    message.includes('Invalid') ||
    message.includes('A valid')
  ) {
    return 400;
  }

  if (message.includes('did not respond in time')) {
    return 504;
  }

  return 502;
}

function getErrorCode(status) {
  if (status === 400) {
    return 'VALIDATION_ERROR';
  }

  if (status === 504) {
    return 'DEVICE_TIMEOUT';
  }

  return 'DEVICE_OPERATION_FAILED';
}

function handleError(res, error) {
  const status = getErrorStatus(error);

  console.error('[API] Request failed:', error.message);

  return response.failure(
    res,
    status,
    getErrorCode(status),
    status === 400
      ? error.message
      : status === 504
        ? 'The device did not respond in time.'
        : 'The device operation failed.'
  );
}

function requireIp(req, res, next) {
  const ip = req.body?.ip;

  if (!validateIp(ip)) {
    return response.failure(
      res,
      400,
      'VALIDATION_ERROR',
      'A valid IPv4 address is required in the ip field.'
    );
  }

  req.deviceIp = ip;
  return next();
}

router.post('/on', requireIp, async (req, res) => {
  try {
    const result = await wiz.turnOn(req.deviceIp);

    return response.success(res, {
      ip: req.deviceIp,
      result
    });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post('/off', requireIp, async (req, res) => {
  try {
    const result = await wiz.turnOff(req.deviceIp);

    return response.success(res, {
      ip: req.deviceIp,
      result
    });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post('/toggle', requireIp, async (req, res) => {
  try {
    const result = await wiz.toggle(req.deviceIp);

    return response.success(res, {
      ip: req.deviceIp,
      result
    });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post('/brightness', requireIp, async (req, res) => {
  const brightness = req.body?.brightness;

  if (
    !Number.isInteger(brightness) ||
    brightness < 10 ||
    brightness > 100
  ) {
    return response.failure(
      res,
      400,
      'VALIDATION_ERROR',
      'Brightness must be an integer between 10 and 100.'
    );
  }

  try {
    const result = await wiz.setBrightness(
      req.deviceIp,
      brightness
    );

    return response.success(res, {
      ip: req.deviceIp,
      brightness,
      result
    });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post('/color', requireIp, async (req, res) => {
  const { r, g, b } = req.body || {};
  const values = [r, g, b];

  if (
    !values.every(
      (value) =>
        Number.isInteger(value) &&
        value >= 0 &&
        value <= 255
    )
  ) {
    return response.failure(
      res,
      400,
      'VALIDATION_ERROR',
      'RGB values must be integers between 0 and 255.'
    );
  }

  try {
    const result = await wiz.setColor(
      req.deviceIp,
      r,
      g,
      b
    );

    return response.success(res, {
      ip: req.deviceIp,
      color: { r, g, b },
      result
    });
  } catch (error) {
    return handleError(res, error);
  }
});

router.get('/state/:ip', async (req, res) => {
  const { ip } = req.params;

  if (!validateIp(ip)) {
    return response.failure(
      res,
      400,
      'VALIDATION_ERROR',
      'A valid IPv4 address is required.'
    );
  }

  try {
    const state = await wiz.getState(ip);

    return response.success(res, {
      ip,
      state: state.result
    });
  } catch (error) {
    return handleError(res, error);
  }
});

module.exports = router;
