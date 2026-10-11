'use strict';

const fs = require('node:fs');
const path = require('node:path');

const HOME_DATA_FILE = path.resolve(
  __dirname,
  '..',
  '..',
  'data',
  'wiz-home.json'
);

class HomeDataError extends Error {
  constructor(code, message, statusCode = 503) {
    super(message);
    this.name = 'HomeDataError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizeMac(mac) {
  if (typeof mac !== 'string') {
    return null;
  }

  const normalized = mac
    .trim()
    .replace(/[:-]/g, '')
    .toLowerCase();

  return /^[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : null;
}

function loadHomeData() {
  let data;

  try {
    data = JSON.parse(
      fs.readFileSync(HOME_DATA_FILE, 'utf8')
    );
  } catch (error) {
    throw new HomeDataError(
      'HOME_DATA_UNAVAILABLE',
      `Could not read home data: ${error.message}`
    );
  }

  if (!data || !Array.isArray(data.devices)) {
    throw new HomeDataError(
      'INVALID_HOME_DATA',
      'Home data does not contain a valid devices array.'
    );
  }

  return data;
}

function getKnownDevices() {
  const data = loadHomeData();

  return data.devices
    .filter((device) => {
      return (
        normalizeMac(device.mac_address) !== null &&
        ['light', 'plug'].includes(device.type)
      );
    })
    .map((device) => ({
      mac: normalizeMac(device.mac_address),
      deviceType: device.type,
      name: device.name,
      roomId: device.room_id,
      traits: device.traits || {}
    }));
}

function getKnownDevice(mac) {
  const normalizedMac = normalizeMac(mac);

  if (!normalizedMac) {
    return null;
  }

  return getKnownDevices().find(
    (device) => device.mac === normalizedMac
  ) || null;
}

module.exports = {
  HomeDataError,
  getKnownDevices,
  getKnownDevice,
  normalizeMac
};