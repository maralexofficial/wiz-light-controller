'use strict';

const { getDatabase } = require('../database');

function normalizeMac(mac) {
  if (typeof mac !== 'string') {
    return '';
  }

  return mac.replace(/[^a-f0-9]/gi, '').toLowerCase();
}

function mergeDevices(previousDevices, discoveredDevices) {
  const devicesByMac = new Map();

  for (const device of previousDevices) {
    if (!device || typeof device !== 'object') {
      continue;
    }

    const mac = normalizeMac(device.mac);

    if (mac) {
      devicesByMac.set(mac, { ...device });
    }
  }

  for (const device of discoveredDevices) {
    if (!device || typeof device !== 'object') {
      continue;
    }

    const mac = normalizeMac(device.mac);

    if (!mac) {
      continue;
    }

    const previous = devicesByMac.get(mac);

    devicesByMac.set(mac, {
      ...(previous || {}),
      ...device,
      mac: device.mac
    });
  }

  return Array.from(devicesByMac.values());
}

function saveDiscoveryState(devices, lastDiscoveryTime) {
  if (!Array.isArray(devices)) {
    throw new TypeError('Discovery devices must be an array.');
  }

  if (
    !Number.isSafeInteger(lastDiscoveryTime) ||
    lastDiscoveryTime <= 0
  ) {
    throw new TypeError(
      'Discovery timestamp must be a positive integer.'
    );
  }

  const db = getDatabase();
  const existing = loadDiscoveryState();
  const mergedDevices = mergeDevices(existing.devices, devices);

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
  `).run(JSON.stringify(mergedDevices), lastDiscoveryTime);

  return {
    devices: mergedDevices,
    lastDiscoveryTime
  };
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
    throw new Error(
      'Stored device discovery data is invalid JSON.'
    );
  }

  if (!Array.isArray(devices)) {
    throw new Error(
      'Stored device discovery data is not an array.'
    );
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