'use strict';

const app = require('./app');
const config = require('./config');
const wizService = require('./services/wiz.service');
const logger = require('./utils/logger');
const { tryLoadHomeData } = require('./utils/home-data');

const {
  initializeDatabase,
  closeDatabase
} = require('./database');

const {
  runMigrations
} = require('./database/migrations');

const {
  loadDiscoveryState
} = require('./services/device-discovery-state.service');

const systemRouter = require('./routes/system.routes');

let server;
let shuttingDown = false;

async function checkHomeData() {
  const result = await tryLoadHomeData();

  if (result.success) {
    logger.info(
      `[SERVER] WiZ home data loaded | rooms=${result.roomCount} | devices=${result.deviceCount}`
    );
    return;
  }

  logger.warn(
    `[SERVER] Optional WiZ home data unavailable: ${result.error}`
  );
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

  const discoveryState = loadDiscoveryState();

  systemRouter.restoreDiscoveryState(
    discoveryState.devices,
    discoveryState.lastDiscoveryTime
  );

  logger.info(
    `[SERVER] Discovery state restored | devices=${discoveryState.devices.length} | lastDiscoveryTime=${discoveryState.lastDiscoveryTime ?? 'never'}`
  );

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
