
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
    const socket = dgram.createSocket({
      type: 'udp4',
      reuseAddr: true
    });

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

      resolve(result);
    }

    socket.on('error', (error) => {
      finish(error);
    });

    socket.on('message', (message, remote) => {
      let response;

      try {
        response = JSON.parse(message.toString('utf8'));
      } catch {
        return;
      }

      const params = response?.params;

      if (!params || typeof params !== 'object') {
        return;
      }

      const mac = typeof params.mac === 'string'
        ? params.mac.toLowerCase()
        : '';

      const ip = remote.address;

      if (!mac || !ip) {
        return;
      }

      devices.set(ip, {
        ip,
        mac,
        success: true
      });
    });

    socket.bind(0, '0.0.0.0', () => {
      if (finished) {
        return;
      }

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
            finish(error);
            return;
          }

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
