'use strict';

const dgram = require('node:dgram');
const config = require('../config');

const DISCOVERY_ADDRESS = '255.255.255.255';

const DISCOVERY_MESSAGE = {
  method: 'registration',
  params: {
    phoneMac: 'ffffffffffff',
    register: false,
    phoneIp: '0.0.0.0'
  }
};

let activeDiscovery = null;

function discoverDevices() {
  if (activeDiscovery) {
    return activeDiscovery;
  }

  activeDiscovery = performDiscovery().finally(() => {
    activeDiscovery = null;
  });

  return activeDiscovery;
}

function performDiscovery() {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const devices = new Map();

    let finished = false;
    let timer = null;

    function cleanup() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
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

      const result = Array.from(devices.values());

      cleanup();

      if (error) {
        reject(error);
        return;
      }

      console.log(
        `[Discovery] Completed. Found ${result.length} device(s).`
      );

      resolve(result);
    }

    socket.on('error', (error) => {
      console.error('[Discovery] UDP error:', error.message);
      finish(error);
    });

    socket.on('message', (message, remote) => {
      let response;

      try {
        response = JSON.parse(message.toString('utf8'));
      } catch {
        console.warn(
          `[Discovery] Ignored invalid JSON from ${remote.address}.`
        );
        return;
      }

      const params = response?.params || {};
      const mac = typeof params.mac === 'string'
        ? params.mac.toLowerCase()
        : '';

      if (!mac) {
        console.log(
          `[Discovery] Received a response from ${remote.address}, but no MAC address was present.`
        );
        return;
      }

      devices.set(remote.address, {
        ip: remote.address,
        mac,
        success: true
      });

      console.log(
        `[Discovery] Found device ${remote.address} (${mac}).`
      );
    });

    socket.bind(0, '0.0.0.0', () => {
      try {
        socket.setBroadcast(true);
      } catch (error) {
        finish(error);
        return;
      }

      const payload = Buffer.from(
        JSON.stringify(DISCOVERY_MESSAGE)
      );

      socket.send(
        payload,
        config.wizPort,
        DISCOVERY_ADDRESS,
        (error) => {
          if (error) {
            console.error(
              '[Discovery] Failed to send broadcast:',
              error.message
            );
            finish(error);
            return;
          }

          console.log(
            `[Discovery] Broadcast sent to ${DISCOVERY_ADDRESS}:${config.wizPort}.`
          );

          timer = setTimeout(() => {
            finish();
          }, config.discoveryTimeoutMs);
        }
      );
    });
  });
}

module.exports = {
  discoverDevices
};
