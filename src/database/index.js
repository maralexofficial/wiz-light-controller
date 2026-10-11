'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const logger = require('../utils/logger');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIRECTORY = path.join(PROJECT_ROOT, 'data');
const DATABASE_PATH = path.join(
  DATA_DIRECTORY,
  'wiz-controller.sqlite'
);

let database;

function initializeDatabase() {
  if (database) {
    return database;
  }

  fs.mkdirSync(DATA_DIRECTORY, {
    recursive: true,
    mode: 0o700
  });

  database = new DatabaseSync(DATABASE_PATH);

  try {
    database.exec('PRAGMA foreign_keys = ON;');
    database.exec('PRAGMA busy_timeout = 5000;');

    const foreignKeysEnabled = database
      .prepare('PRAGMA foreign_keys;')
      .get().foreign_keys;

    if (foreignKeysEnabled !== 1) {
      throw new Error('SQLite foreign key enforcement is unavailable.');
    }

    try {
      fs.chmodSync(DATABASE_PATH, 0o600);
    } catch (error) {
      logger.warn(
        `[DATABASE] Could not restrict database file permissions: ${error.message}`
      );
    }

    logger.info('[DATABASE] SQLite connection initialized.');

    return database;
  } catch (error) {
    database.close();
    database = undefined;
    throw error;
  }
}

function getDatabase() {
  if (!database) {
    throw new Error(
      'Database has not been initialized. Call initializeDatabase() first.'
    );
  }

  return database;
}

function closeDatabase() {
  if (!database) {
    return;
  }

  database.close();
  database = undefined;

  logger.info('[DATABASE] SQLite connection closed.');
}

module.exports = {
  initializeDatabase,
  getDatabase,
  closeDatabase,
  DATABASE_PATH
};