'use strict';

const { getDatabase } = require('../database');

function saveDiscoveryState(devices, lastDiscoveryTime) {
  if (!Array.isArray(devices)) {
    throw new TypeError('Discovery devices must be an array.');
  }

  if (
    !Number.isSafeInteger(lastDiscoveryTime) ||
    lastDiscoveryTime <= 0
  ) {
    throw new TypeError('Discovery timestamp must be a positive integer.');
  }

  const db = getDatabase();

  db.prepare(`
    INSERT INTO device_discovery_state (
      id,
      devices_json,
      last_discovery_time,
      updated_at
    )
    VALUES (
      1,
      ?,
      ?,
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    )
    ON CONFLICT(id) DO UPDATE SET
      devices_json = excluded.devices_json,
      last_discovery_time = excluded.last_discovery_time,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `).run(JSON.stringify(devices), lastDiscoveryTime);
}

function loadDiscoveryState() {
  const db = getDatabase();

  const row = db.prepare(`
    SELECT devices_json, last_discovery_time
    FROM device_discovery_state
    WHERE id = 1
  `).get();

  if (!row) {
    return {
      devices: [],
      lastDiscoveryTime: null
    };
  }

  let devices;

  try {
    devices = JSON.parse(row.devices_json);
  } catch {
    throw new Error('Stored device discovery data is invalid JSON.');
  }

  if (!Array.isArray(devices)) {
    throw new Error('Stored device discovery data is not an array.');
  }

  return {
    devices,
    lastDiscoveryTime: row.last_discovery_time
  };
}

module.exports = {
  saveDiscoveryState,
  loadDiscoveryState
};