'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const HOME_DATA_FILE = path.join(
  __dirname,
  '..',
  '..',
  'data',
  'wiz-home.json'
);

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

async function loadHomeDataFromFile() {
  const content = await fs.readFile(HOME_DATA_FILE, 'utf8');
  const data = JSON.parse(content);
  validateHomeData(data);
  return data;
}

async function tryLoadHomeData() {
  try {
    const data = await loadHomeDataFromFile();
    return {
      success: true,
      data,
      error: null,
      roomCount: data.rooms.length,
      deviceCount: data.devices.length
    };
  } catch (error) {
    const reason = error.code === 'ENOENT'
      ? 'File does not exist.'
      : error instanceof SyntaxError
        ? 'Invalid JSON.'
        : error.message || 'Unknown error.';

    return {
      success: false,
      data: null,
      error: reason,
      roomCount: 0,
      deviceCount: 0
    };
  }
}

module.exports = {
  HOME_DATA_FILE,
  validateHomeData,
  loadHomeDataFromFile,
  tryLoadHomeData
};
