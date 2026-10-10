
'use strict';

const express = require('express');
const net = require('node:net');
const wiz = require('../services/wiz.service');

const router = express.Router();

function validateIp(ip) {
  return typeof ip === 'string' && net.isIP(ip) === 4;
}

function getErrorStatus(error) {
  if (
    error.message.includes('must be') ||
    error.message.includes('required') ||
    error.message.includes('Invalid')
  ) {
    return 400;
  }

  if (error.message.includes('did not respond in time')) {
    return 504;
  }

  return 502;
}

function handleError(res, error) {
  const status = getErrorStatus(error);

  console.error('[API] Request failed:', error.message);

  return res.status(status).json({
    success: false,
    error: error.message
  });
}

function requireIp(req, res, next) {
  const ip = req.body?.ip;

  if (!validateIp(ip)) {
    return res.status(400).json({
      success: false,
      error: 'A valid IPv4 address is required in the ip field.'
    });
  }

  req.deviceIp = ip;
  next();
}

router.post('/on', requireIp, async (req, res) => {
  try {
    const result = await wiz.turnOn(req.deviceIp);

    return res.json({
      success: true,
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

    return res.json({
      success: true,
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

    return res.json({
      success: true,
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
    return res.status(400).json({
      success: false,
      error: 'Brightness must be an integer between 10 and 100.'
    });
  }

  try {
    const result = await wiz.setBrightness(
      req.deviceIp,
      brightness
    );

    return res.json({
      success: true,
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
    return res.status(400).json({
      success: false,
      error: 'RGB values must be integers between 0 and 255.'
    });
  }

  try {
    const result = await wiz.setColor(
      req.deviceIp,
      r,
      g,
      b
    );

    return res.json({
      success: true,
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
    return res.status(400).json({
      success: false,
      error: 'A valid IPv4 address is required.'
    });
  }

  try {
    const state = await wiz.getState(ip);

    return res.json({
      success: true,
      ip,
      state: state.result
    });
  } catch (error) {
    return handleError(res, error);
  }
});

module.exports = router;
