
'use strict';

const app = require('./app');
const config = require('./config');
const wizService = require('./services/wiz.service');

let server;
let shuttingDown = false;

function startServer() {
  server = app.listen(config.port, config.host, () => {
    console.log('[Server] WiZ Light Controller API started.');
    console.log(`[Server] Listening on ${config.host}:${config.port}`);
    console.log(`[Server] Environment: ${config.nodeEnv}`);
    console.log(
      `[Server] API authentication: ${
        config.apiAuthEnabled ? 'enabled' : 'disabled'
      }`
    );
  });

  server.on('error', (error) => {
    console.error('[Server] Failed to start:', error.message);
    process.exitCode = 1;
  });
}

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log(`[Server] Received ${signal}. Shutting down...`);

  const forceExitTimer = setTimeout(() => {
    console.error('[Server] Graceful shutdown timed out.');
    process.exit(1);
  }, 10000);

  forceExitTimer.unref();

  if (!server) {
    wizService.close()
      .catch((error) => {
        console.error('[Server] UDP shutdown error:', error.message);
      })
      .finally(() => {
        process.exit(0);
      });

    return;
  }

  server.close(async (error) => {
    if (error) {
      console.error('[Server] HTTP shutdown error:', error.message);
    }

    try {
      await wizService.close();
      console.log('[Server] Shutdown completed.');
      process.exit(error ? 1 : 0);
    } catch (closeError) {
      console.error(
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
