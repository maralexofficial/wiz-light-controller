'use strict';

const app = require('./app');
const config = require('./config');
const wizService = require('./services/wiz.service');
const logger = require('./utils/logger');
const fs = require('node:fs/promises');
const path = require('node:path');

const {
  initializeDatabase,
  closeDatabase
} = require('./database');

const {
  runMigrations
} = require('./database/migrations');

const HOME_DATA_FILE = path.join(
  __dirname,
  '..',
  'data',
  'wiz-home.json'
);

let server;
let shuttingDown = false;

async function checkHomeData() {
  try {
    const content = await fs.readFile(HOME_DATA_FILE, 'utf8');
    const data = JSON.parse(content);

    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      !Array.isArray(data.rooms) ||
      !Array.isArray(data.devices)
    ) {
      throw new Error('Invalid home data structure.');
    }

    logger.info(
      `[SERVER] WiZ home data loaded | rooms=${data.rooms.length} | devices=${data.devices.length}`
    );
  } catch (error) {
    const reason = error.code === 'ENOENT'
      ? 'File does not exist.'
      : error instanceof SyntaxError
        ? 'Invalid JSON.'
        : error.message || 'Unknown error.';

    logger.warn(
      `[SERVER] Optional WiZ home data unavailable: ${reason}`
    );
  }
}

function startServer() {
  server = app.listen(config.port, config.host, () => {
    logger.info('[SERVER] WiZ Light Controller API started.');
    logger.info(
      `[SERVER] Listening on ${config.host}:${config.port}`
    );
    logger.info(`[SERVER] Environment: ${config.nodeEnv}`);
    logger.info('[SERVER] API authentication: required');
  });

  server.on('error', (error) => {
    logger.error('[SERVER] Failed to start:', error.message);
    process.exitCode = 1;
  });
}

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  logger.info(`[SERVER] Received ${signal}. Shutting down...`);

  const forceExitTimer = setTimeout(() => {
    logger.error('[SERVER] Graceful shutdown timed out.');
    process.exit(1);
  }, 10000);

  forceExitTimer.unref();

  if (!server) {
    try {
      await closeResources();
      process.exit(0);
    } catch (error) {
      logger.error(
        '[SERVER] Resource shutdown error:',
        error.message
      );
      process.exit(1);
    }

    return;
  }

  server.close(async (error) => {
    if (error) {
      logger.error('[SERVER] HTTP shutdown error:', error.message);
    }

    try {
      await closeResources();
      logger.info('[SERVER] Shutdown completed.');
      process.exit(error ? 1 : 0);
    } catch (closeError) {
      logger.error(
        '[SERVER] Resource shutdown error:',
        closeError.message
      );
      process.exit(1);
    }
  });
}

async function closeResources() {
  try {
    await wizService.close();
  } finally {
    closeDatabase();
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

async function main() {
  await checkHomeData();

  const db = initializeDatabase();
  runMigrations(db);

  logger.info('[SERVER] Database migrations completed.');

  startServer();
}

main().catch(async (error) => {
  logger.error(
    `[SERVER] Initialization failed: ${error.message}`
  );

  try {
    await closeResources();
  } catch (closeError) {
    logger.error(
      '[SERVER] Resource cleanup failed:',
      closeError.message
    );
  }

  process.exitCode = 1;
});