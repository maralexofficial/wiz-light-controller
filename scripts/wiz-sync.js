'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const logger = require('../src/utils/logger');

const OUTPUT_DIR = path.join(__dirname, '..', 'data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'wiz-home.json');

function validateHomeData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('The response is not a valid JSON object.');
  }

  if (!Array.isArray(data.rooms) || !Array.isArray(data.devices)) {
    throw new Error('The JSON does not contain valid rooms and devices arrays.');
  }

  for (const room of data.rooms) {
    if (
      !room ||
      typeof room.room_id !== 'number' ||
      typeof room.name !== 'string'
    ) {
      throw new Error('The JSON contains an invalid room entry.');
    }
  }

  for (const device of data.devices) {
    if (
      !device ||
      typeof device.mac_address !== 'string' ||
      typeof device.name !== 'string' ||
      typeof device.room_id !== 'number'
    ) {
      throw new Error('The JSON contains an invalid device entry.');
    }
  }
}

async function downloadHomeData(url) {
  let parsedUrl;

  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('Please provide a valid integration URL.');
  }

  if (
    parsedUrl.protocol !== 'https:' ||
    parsedUrl.hostname !==
      'wiz-s3-local-integration-prd-artifacts.s3.eu-west-1.amazonaws.com'
  ) {
    throw new Error('The URL is not a recognized WiZ integration URL.');
  }

  const response = await fetch(parsedUrl, {
    signal: AbortSignal.timeout(20000),
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(
      `WiZ download failed with HTTP status ${response.status}. The integration link may have expired.`
    );
  }

  const responseText = await response.text();

  let data;

  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(
      'The WiZ response is not valid JSON. The integration link may have expired.'
    );
  }

  validateHomeData(data);

  // Do not persist the signing key when it is not needed by this controller.
  const { udp_signing_key, ...safeData } = data;

  return safeData;
}

async function saveHomeData(data) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const temporaryFile = `${OUTPUT_FILE}.tmp`;
  const json = `${JSON.stringify(data, null, 2)}\n`;

  try {
    await fs.writeFile(temporaryFile, json, {
      encoding: 'utf8',
      mode: 0o600
    });

    await fs.rename(temporaryFile, OUTPUT_FILE);
  } catch (error) {
    await fs.rm(temporaryFile, { force: true }).catch(() => {});
    throw error;
  }
}

async function main() {
  const integrationUrl = process.argv[2];

  if (!integrationUrl) {
    logger.error('[WiZ Sync] Missing integration URL.');
    logger.info('[WiZ Sync] Usage: npm run wiz:sync -- <integration-url>');
    process.exitCode = 1;
    return;
  }

  try {
    logger.info('[WiZ Sync] Downloading home structure...');

    const data = await downloadHomeData(integrationUrl);

    await saveHomeData(data);

    logger.info(
      `[WiZ Sync] Home structure saved | rooms=${data.rooms.length} | devices=${data.devices.length}`
    );
    logger.info(`[WiZ Sync] File: ${OUTPUT_FILE}`);
  } catch (error) {
    logger.error(`[WiZ Sync] ${error.message}`);
    process.exitCode = 1;
  }
}

main();