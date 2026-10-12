'use strict';

const readline = require('node:readline/promises');

const logger = require('../src/utils/logger');
const {
  initializeDatabase,
  closeDatabase,
  getDatabase
} = require('../src/database');
const { runMigrations } = require('../src/database/migrations');
const tokenService = require('../src/services/token.service');
const { syncHomeData } = require('./wiz-sync');

const deviceDiscovery = require('../src/services/device-discovery.service');
const wizService = require('../src/services/wiz.service');

const INITIAL_ADMIN_NAME = 'Initial Administrator';

const INITIAL_ADMIN_PERMISSIONS = [
  ...tokenService.AVAILABLE_PERMISSIONS
];

function writeOutput(message = '') {
  process.stdout.write(`${message}\n`);
}

async function promptForIntegrationUrl() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      'Interactive terminal input is required to run setup.'
    );
  }

  writeOutput('WiZ integration setup');
  writeOutput('Paste the integration URL from the WiZ app.');
  writeOutput('Input is hidden.');

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let input = '';
    let finished = false;

    function cleanup() {
      stdin.removeListener('data', onData);

      if (stdin.isTTY) {
        stdin.setRawMode(false);
      }

      stdin.pause();
    }

    function finish(error, value) {
      if (finished) {
        return;
      }

      finished = true;
      cleanup();
      writeOutput();

      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    }

    function onData(chunk) {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          finish(new Error('Setup cancelled by user.'));
          return;
        }

        if (character === '\r' || character === '\n') {
          finish(
            null,
            input.trim()
          );
          return;
        }

        if (character === '\u007f' || character === '\b') {
          input = input.slice(0, -1);
          continue;
        }

        if (character >= ' ') {
          input += character;
        }
      }
    }

    try {
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');
      stdin.on('data', onData);
      process.stdout.write('Integration URL: ');
    } catch (error) {
      finish(
        new Error(`Could not enable hidden input: ${error.message}`)
      );
    }
  }).then((url) => {
    if (!url) {
      throw new Error('An integration URL is required.');
    }

    return url;
  });
}

function getTokenCount() {
  const db = getDatabase();

  const result = db.prepare(
    'SELECT COUNT(*) AS count FROM api_tokens'
  ).get();

  return Number(result?.count ?? 0);
}

function createInitialAdminTokenIfNeeded() {
  const existingCount = getTokenCount();

  if (existingCount > 0) {
    logger.info(
      `[SETUP] Existing token records found | count=${existingCount} | token creation skipped`
    );

    return null;
  }

  const created = tokenService.createToken(
    INITIAL_ADMIN_NAME,
    INITIAL_ADMIN_PERMISSIONS
  );

  logger.info(
    `[SETUP] Initial administrator token created | tokenId=${created.id}`
  );

  return created;
}

async function performInitialDiscovery() {
  logger.info('[SETUP] Starting initial device discovery...');

  try {
    const devices =
      await deviceDiscovery.discoverDevicesWithDetails();

    const successful = devices.filter(
      (device) => device.success === true
    ).length;

    const failed = devices.length - successful;

    logger.info(
      `[SETUP] Initial discovery completed | discovered=${devices.length} | successful=${successful} | failed=${failed}`
    );

    return {
      count: devices.length,
      successful,
      failed
    };
  } finally {
    await wizService.close();
  }
}

async function main() {
  let databaseInitialized = false;
  let initialToken = null;

  try {
    const integrationUrl = await promptForIntegrationUrl();

    await syncHomeData(integrationUrl);

    initializeDatabase();
    databaseInitialized = true;

    const db = getDatabase();
    runMigrations(db);

    logger.info('[SETUP] Database migrations completed.');

    initialToken = createInitialAdminTokenIfNeeded();

    const discoveryResult = await performInitialDiscovery();

    writeOutput('');
    writeOutput('Setup completed.');
    writeOutput(`Discovered devices: ${discoveryResult.count}`);
    writeOutput(
      `Successful device queries: ${discoveryResult.successful}`
    );
    writeOutput(`Failed device queries: ${discoveryResult.failed}`);

    if (initialToken) {
      writeOutput('');
      writeOutput('IMPORTANT: Save this administrator token securely.');
      writeOutput('It will not be displayed again.');
      writeOutput(`Administrator token: ${initialToken.token}`);
      writeOutput('');
    } else {
      writeOutput(
        'Existing tokens were preserved. No new token was created.'
      );
    }

    if (discoveryResult.failed > 0) {
      writeOutput(
        'Some devices could not be queried. Check the application logs.'
      );
    }
  } catch (error) {
    logger.error(`[SETUP] Setup failed: ${error.message}`);
    writeOutput(`Setup failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    try {
      await wizService.close();
    } catch (error) {
      logger.warn(
        `[SETUP] WiZ service cleanup failed: ${error.message}`
      );
    }

    if (databaseInitialized) {
      try {
        closeDatabase();
      } catch (error) {
        logger.warn(
          `[SETUP] Database cleanup failed: ${error.message}`
        );
      }
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  getTokenCount,
  createInitialAdminTokenIfNeeded,
  promptForIntegrationUrl
};