'use strict';

const app = require('./app');
const config = require('./config');
const wizService = require('./services/wiz.service');
const logger = require('./utils/logger');
const fs = require('node:fs/promises');
const path = require('node:path');

const HOME_DATA_FILE = path.join(__dirname, '..', 'data', 'wiz-home.json');

let server;
let shuttingDown = false;

async function checkHomeData() {
  try {
    const content = await fs.readFile(HOME_DATA_FILE, 'utf8');
    const data = JSON.parse(content);

    if (
      !data ||
      typeof data !== 'object' ||
      !Array.isArray(data.rooms) ||
      !Array.isArray(data.devices)
    ) {
      throw new Error('Invalid home data structure.');
    }

    logger.info(
      `[Server] WiZ home data loaded | rooms=${data.rooms.length} | devices=${data.devices.length}`
    );
  } catch (error) {
    const reason = error.code === 'ENOENT'
      ? 'File does not exist.'
      : error instanceof SyntaxError
        ? 'Invalid JSON.'
        : error.message || 'Unknown error.';

    logger.warn(`[Server] Optional WiZ home data unavailable: ${reason}`);
  }
}

function startServer() {
  server = app.listen(config.port, config.host, () => {
    logger.info('[Server] WiZ Light Controller API started.');
    logger.info(`[Server] Listening on ${config.host}:${config.port}`);
    logger.info(`[Server] Environment: ${config.nodeEnv}`);
    logger.info(
      `[Server] API authentication: ${
        config.apiAuthEnabled ? 'enabled' : 'disabled'
      }`
    );
  });

  server.on('error', (error) => {
    logger.error('[Server] Failed to start:', error.message);
    process.exitCode = 1;
  });
}

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  logger.info(`[Server] Received ${signal}. Shutting down...`);

  const forceExitTimer = setTimeout(() => {
    logger.error('[Server] Graceful shutdown timed out.');
    process.exit(1);
  }, 10000);

  forceExitTimer.unref();

  if (!server) {
    try {
      await wizService.close();
    } catch (error) {
      logger.error('[Server] UDP shutdown error:', error.message);
    }

    process.exit(0);
    return;
  }

  server.close(async (error) => {
    if (error) {
      logger.error('[Server] HTTP shutdown error:', error.message);
    }

    try {
      await wizService.close();
      logger.info('[Server] Shutdown completed.');
      process.exit(error ? 1 : 0);
    } catch (closeError) {
      logger.error('[Server] UDP shutdown error:', closeError.message);
      process.exit(1);
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

async function main() {
  await checkHomeData();
  startServer();
}

main().catch((error) => {
  logger.warn(
    `[Server] Optional initialization failed: ${error.message}`
  );

  startServer();
});