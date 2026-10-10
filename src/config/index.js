
'use strict';

const dotenv = require('dotenv');

dotenv.config();

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === '') {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();

  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean value: ${value}`);
}

function parseInteger(value, defaultValue, name, min, max) {
  if (value === undefined || value === '') {
    return defaultValue;
  }

  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < min ||
    parsed > max
  ) {
    throw new Error(
      `${name} must be an integer between ${min} and ${max}.`
    );
  }

  return parsed;
}

function parseString(value, defaultValue, name) {
  const result = value === undefined ? defaultValue : String(value).trim();

  if (!result) {
    throw new Error(`${name} must not be empty.`);
  }

  return result;
}

const config = {
  host: parseString(
    process.env.HOST,
    '127.0.0.1',
    'HOST'
  ),

  port: parseInteger(
    process.env.PORT,
    3000,
    'PORT',
    1,
    65535
  ),

  wizPort: parseInteger(
    process.env.WIZ_PORT,
    38899,
    'WIZ_PORT',
    1,
    65535
  ),

  discoveryTimeoutMs: parseInteger(
    process.env.DISCOVERY_TIMEOUT_MS,
    3000,
    'DISCOVERY_TIMEOUT_MS',
    500,
    30000
  ),

  commandTimeoutMs: parseInteger(
    process.env.COMMAND_TIMEOUT_MS,
    3000,
    'COMMAND_TIMEOUT_MS',
    500,
    30000
  ),

  apiAuthEnabled: parseBoolean(
    process.env.API_AUTH_ENABLED,
    true
  ),

  apiToken: process.env.API_TOKEN
    ? process.env.API_TOKEN.trim()
    : '',

  logLevel: parseString(
    process.env.LOG_LEVEL,
    'info',
    'LOG_LEVEL'
  ).toLowerCase(),

  nodeEnv: parseString(
    process.env.NODE_ENV,
    'development',
    'NODE_ENV'
  ).toLowerCase()
};

if (config.apiAuthEnabled && config.apiToken.length < 32) {
  throw new Error(
    'API authentication is enabled, but API_TOKEN must contain at least 32 characters.'
  );
}

if (!['debug', 'info', 'warn', 'error'].includes(config.logLevel)) {
  throw new Error(
    'LOG_LEVEL must be debug, info, warn, or error.'
  );
}

if (!['development', 'production', 'test'].includes(config.nodeEnv)) {
  throw new Error(
    'NODE_ENV must be development, production, or test.'
  );
}

module.exports = Object.freeze(config);
