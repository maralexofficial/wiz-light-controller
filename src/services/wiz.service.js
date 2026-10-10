'use strict';

const dgram = require('node:dgram');
const net = require('node:net');
const config = require('../config');

const socket = dgram.createSocket('udp4');

const pendingRequests = new Map();
const deviceQueues = new Map();

let socketReady = false;
let closed = false;
let socketStarting = false;

socket.on('listening', () => {
  socketReady = true;
  socketStarting = false;
});

socket.on('message', (message, remote) => {
  const pending = pendingRequests.get(remote.address);

  if (!pending) {
    return;
  }

  let response;

  try {
    response = JSON.parse(message.toString('utf8'));
  } catch {
    return;
  }

  clearTimeout(pending.timer);
  pendingRequests.delete(remote.address);

  pending.resolve(response);
});

socket.on('error', (error) => {
  console.error('[WiZ UDP] Socket error:', error.message);

  socketReady = false;
  socketStarting = false;

  for (const [ip, pending] of pendingRequests) {
    clearTimeout(pending.timer);
    pendingRequests.delete(ip);
    pending.reject(error);
  }
});

function validateIp(ip) {
  if (typeof ip !== 'string' || net.isIP(ip) !== 4) {
    throw new Error('A valid IPv4 address is required.');
  }

  return ip;
}

function waitForSocket() {
  if (closed) {
    return Promise.reject(
      new Error('The UDP service has been shut down.')
    );
  }

  if (socketReady) {
    return Promise.resolve();
  }

  if (socketStarting) {
    return new Promise((resolve, reject) => {
      const onListening = () => {
        cleanup();
        resolve();
      };

      const onError = (error) => {
        cleanup();
        reject(error);
      };

      const cleanup = () => {
        socket.off('listening', onListening);
        socket.off('error', onError);
      };

      socket.once('listening', onListening);
      socket.once('error', onError);
    });
  }

  socketStarting = true;

  return new Promise((resolve, reject) => {
    const onListening = () => {
      cleanup();
      resolve();
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      socket.off('listening', onListening);
      socket.off('error', onError);
    };

    socket.once('listening', onListening);
    socket.once('error', onError);

    try {
      socket.bind(0);
    } catch (error) {
      cleanup();
      socketStarting = false;
      reject(error);
    }
  });
}

async function sendRaw(ip, command) {
  validateIp(ip);
  await waitForSocket();

  if (closed) {
    throw new Error('The UDP service has been shut down.');
  }

  if (pendingRequests.has(ip)) {
    throw new Error(`A UDP request is already pending for ${ip}.`);
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(ip);

      reject(
        new Error(`WiZ device ${ip} did not respond in time.`)
      );
    }, config.commandTimeoutMs);

    pendingRequests.set(ip, {
      resolve,
      reject,
      timer
    });

    const payload = Buffer.from(JSON.stringify(command));

    socket.send(payload, config.wizPort, ip, (error) => {
      if (!error) {
        return;
      }

      const pending = pendingRequests.get(ip);

      if (pending) {
        clearTimeout(pending.timer);
        pendingRequests.delete(ip);
        pending.reject(error);
      }
    });
  });
}

function sendCommand(ip, command) {
  validateIp(ip);

  if (
    !command ||
    typeof command !== 'object' ||
    typeof command.method !== 'string' ||
    !command.params ||
    typeof command.params !== 'object'
  ) {
    return Promise.reject(
      new Error('A valid WiZ command is required.')
    );
  }

  if (closed) {
    return Promise.reject(
      new Error('The UDP service has been shut down.')
    );
  }

  const previous = deviceQueues.get(ip) || Promise.resolve();

  const current = previous
    .catch(() => {})
    .then(() => sendRaw(ip, command));

  deviceQueues.set(ip, current);

  current.finally(() => {
    if (deviceQueues.get(ip) === current) {
      deviceQueues.delete(ip);
    }
  }).catch(() => {});

  return current;
}

function setPilot(ip, state) {
  return sendCommand(ip, {
    method: 'setPilot',
    params: state
  });
}

function turnOn(ip) {
  return setPilot(ip, {
    state: true
  });
}

function turnOff(ip) {
  return setPilot(ip, {
    state: false
  });
}

async function toggle(ip) {
  const response = await getState(ip);

  if (!response || !response.result) {
    throw new Error(`Invalid state response received from ${ip}.`);
  }

  const currentlyOn = Boolean(response.result.state);

  if (currentlyOn) {
    return turnOff(ip);
  }

  return turnOn(ip);
}

function setBrightness(ip, brightness) {
  if (
    !Number.isInteger(brightness) ||
    brightness < 10 ||
    brightness > 100
  ) {
    throw new Error(
      'Brightness must be an integer between 10 and 100.'
    );
  }

  return setPilot(ip, {
    dimming: brightness
  });
}

function setColor(ip, r, g, b) {
  const values = [r, g, b];

  if (
    !values.every(
      (value) =>
        Number.isInteger(value) &&
        value >= 0 &&
        value <= 255
    )
  ) {
    throw new Error(
      'RGB values must be integers between 0 and 255.'
    );
  }

  return setPilot(ip, {
    r,
    g,
    b
  });
}

function getState(ip) {
  return sendCommand(ip, {
    method: 'getPilot',
    params: {}
  });
}

async function close() {
  if (closed) {
    return;
  }

  closed = true;

  for (const [ip, pending] of pendingRequests) {
    clearTimeout(pending.timer);
    pendingRequests.delete(ip);

    pending.reject(
      new Error('The WiZ service is shutting down.')
    );
  }

  deviceQueues.clear();

  if (!socketReady && !socketStarting) {
    return;
  }

  await new Promise((resolve) => {
    try {
      socket.close(resolve);
    } catch {
      resolve();
    }
  });

  socketReady = false;
  socketStarting = false;
}

module.exports = {
  sendCommand,
  turnOn,
  turnOff,
  toggle,
  setBrightness,
  setColor,
  getState,
  close
};
