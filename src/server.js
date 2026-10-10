'use strict';

const app = require('./app');
const config = require('./config');
const wizService = require('./services/wiz.service');
const logger = require('./utils/logger');

let server;
let shuttingDown = false;

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

function shutdown(signal) {
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
    wizService.close()
      .catch((error) => {
        logger.error('[Server] UDP shutdown error:', error.message);
      })
      .finally(() => {
        process.exit(0);
      });

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
      logger.error(
        '[Server] UDP shutdown error:',
        closeError.message
      );

      process.exit(1);
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

startServer();