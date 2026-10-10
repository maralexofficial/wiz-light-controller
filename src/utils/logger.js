'use strict';

const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');
const config = require('../config');

const LEVELS = Object.freeze({
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40
});

const COLORS = Object.freeze({
  DEBUG: '\x1b[36m',
  INFO: '\x1b[32m',
  WARN: '\x1b[33m',
  ERROR: '\x1b[31m',
  RESET: '\x1b[0m'
});

const logDirectory = path.resolve(
  process.cwd(),
  config.logDirectory
);

const maxFileSize = config.logMaxSizeMb * 1024 * 1024;

function getTimestamp() {
  return new Date().toISOString();
}

function formatMessage(args) {
  return args
    .map((value) => {
      if (typeof value === 'string') {
        return value;
      }

      if (value instanceof Error) {
        return value.stack || value.message;
      }

      return util.inspect(value, {
        depth: 5,
        colors: false,
        compact: true
      });
    })
    .join(' ');
}

function getLogFileName() {
  const date = new Date().toISOString().slice(0, 10);

  return path.join(logDirectory, `app-${date}.log`);
}

function rotateLogFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const stats = fs.statSync(filePath);

  if (stats.size < maxFileSize) {
    return;
  }

  // Remove the oldest backup before shifting the remaining files.
  const oldestBackup = `${filePath}.${config.logMaxFiles}`;

  if (fs.existsSync(oldestBackup)) {
    fs.unlinkSync(oldestBackup);
  }

  // Shift existing backups from oldest to newest.
  for (
    let index = config.logMaxFiles - 1;
    index >= 1;
    index--
  ) {
    const source = `${filePath}.${index}`;
    const target = `${filePath}.${index + 1}`;

    if (fs.existsSync(source)) {
      fs.renameSync(source, target);
    }
  }

  // Preserve the current log as the first backup.
  fs.renameSync(filePath, `${filePath}.1`);
}

function writeToFile(line) {
  if (!config.logFileEnabled) {
    return;
  }

  try {
    fs.mkdirSync(logDirectory, { recursive: true });

    const filePath = getLogFileName();

    rotateLogFile(filePath);

    fs.appendFileSync(filePath, `${line}\n`, 'utf8');
  } catch (error) {
    process.stderr.write(
      `[LOGGER ERROR] Failed to write log file: ${error.message}\n`
    );
  }
}

function log(level, ...args) {
  const normalizedLevel = String(level).toUpperCase();

  if (!Object.prototype.hasOwnProperty.call(LEVELS, normalizedLevel)) {
    throw new Error(`Unknown log level: ${normalizedLevel}`);
  }

  if (LEVELS[normalizedLevel] < LEVELS[config.logLevel]) {
    return;
  }

  const timestamp = getTimestamp();
  const message = formatMessage(args);

  const plainLine =
    `${timestamp} [${normalizedLevel}] ${message}`;

  if (config.logConsoleEnabled) {
    const color = COLORS[normalizedLevel];

    const consoleLine =
      `${color}[${normalizedLevel}]${COLORS.RESET} ` +
      `${timestamp} ${message}`;

    const output = normalizedLevel === 'ERROR'
      ? process.stderr
      : process.stdout;

    output.write(`${consoleLine}\n`);
  }

  writeToFile(plainLine);
}

const logger = Object.freeze({
  debug: (...args) => log('DEBUG', ...args),
  info: (...args) => log('INFO', ...args),
  warn: (...args) => log('WARN', ...args),
  error: (...args) => log('ERROR', ...args)
});

module.exports = logger;