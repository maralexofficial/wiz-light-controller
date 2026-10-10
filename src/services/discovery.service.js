'use strict';

const dgram = require('node:dgram');
const config = require('../config');
const logger = require('../utils/logger');

const DISCOVERY_MESSAGE = {
  method: 'registration',
  params: {
    phoneMac: config.discoveryPhoneMac,
    register: config.discoveryRegister,
    phoneIp: config.discoveryPhoneIp
  }
};

let activeDiscovery = null;
let cachedDevices = [];
let lastDiscoveryCompletedAt = 0;

function discoverDevices() {
  if (activeDiscovery) {
    logger.debug('[Discovery] Reusing active discovery request.');
    return activeDiscovery;
  }

  const now = Date.now();
  const cooldownMs = config.discoveryCooldownMs;
  const cacheIsValid =
    lastDiscoveryCompletedAt > 0 &&
    now - lastDiscoveryCompletedAt < cooldownMs;

  if (cacheIsValid) {
    logger.info('[Discovery] Returning cached discovery results.');

    return Promise.resolve(cachedDevices.map((device) => ({
      ...device
    })));
  }

  activeDiscovery = performDiscovery()
    .then((devices) => {
      cachedDevices = devices.map((device) => ({ ...device }));
      lastDiscoveryCompletedAt = Date.now();

      return devices;
    })
    .finally(() => {
      activeDiscovery = null;
    });

  return activeDiscovery;
}

function performDiscovery() {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const devices = new Map();

    let finished = false;
    let scanTimer = null;
    let broadcastTimer = null;
    let broadcastInProgress = false;

    const payload = Buffer.from(
      JSON.stringify(DISCOVERY_MESSAGE)
    );

    function cleanup() {
      if (scanTimer) {
        clearTimeout(scanTimer);
        scanTimer = null;
      }

      if (broadcastTimer) {
        clearInterval(broadcastTimer);
        broadcastTimer = null;
      }

      socket.removeAllListeners();

      try {
        socket.close();
      } catch {
        // The socket may already be closed.
      }
    }

    function finish(error) {
      if (finished) {
        return;
      }

      finished = true;

      const discoveredDevices = Array.from(devices.values());

      cleanup();

      if (error) {
        reject(error);
        return;
      }

      logger.info(
        `[Discovery] Completed. Found ${discoveredDevices.length} device(s).`
      );

      resolve(discoveredDevices);
    }

    function sendBroadcast() {
      if (finished || broadcastInProgress) {
        return;
      }

      broadcastInProgress = true;

      socket.send(
        payload,
        config.wizPort,
        config.discoveryAddress,
        (error) => {
          broadcastInProgress = false;

          if (finished) {
            return;
          }

          if (error) {
            logger.warn(
              '[Discovery] Broadcast attempt failed:',
              error.message
            );

            return;
          }

          logger.debug(
            `[Discovery] Broadcast sent to ${config.discoveryAddress}:${config.wizPort}.`
          );
        }
      );
    }

    socket.on('error', (error) => {
      logger.error('[Discovery] UDP error:', error.message);
      finish(error);
    });

    socket.on('message', (message, remote) => {
      let packet;

      try {
        packet = JSON.parse(message.toString('utf8'));
      } catch {
        logger.warn(
          `[Discovery] Ignored invalid JSON from ${remote.address}.`
        );
        return;
      }

      const params = packet?.params || {};
      const result = packet?.result || {};

      const macCandidates = [
        params.mac,
        params.macAddress,
        params.deviceMac,
        result.mac,
        result.macAddress,
        result.deviceMac,
        packet.mac,
        packet.macAddress,
        packet.deviceMac
      ];

      const macValue = macCandidates.find(
        (value) =>
          typeof value === 'string' &&
          /^[0-9a-f]{12}$/i.test(value.replace(/[:-]/g, ''))
      );

      if (!macValue) {
        logger.debug(
          `[Discovery] Response from ${remote.address} has no recognized MAC field.`
        );
        return;
      }

      const mac = macValue.replace(/[:-]/g, '').toLowerCase();

      devices.set(remote.address, {
        ip: remote.address,
        mac,
        success: true
      });

      logger.debug(
        `[Discovery] Found device ${remote.address} (${mac}).`
      );
    });

    socket.bind(0, config.discoveryBindAddress, () => {
      try {
        socket.setBroadcast(true);
      } catch (error) {
        finish(error);
        return;
      }

      logger.info('[Discovery] Starting device scan.');

      sendBroadcast();

      broadcastTimer = setInterval(
        sendBroadcast,
        config.discoveryBroadcastIntervalMs
      );

      scanTimer = setTimeout(
        () => finish(),
        config.discoveryTimeoutMs
      );
    });
  });
}

module.exports = {
  discoverDevices
};