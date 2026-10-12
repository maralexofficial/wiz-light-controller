'use strict';

function normalizeMac(mac) {
  if (typeof mac !== 'string') {
    return null;
  }

  const normalized = mac
    .trim()
    .replace(/[:-]/g, '')
    .toLowerCase();

  return /^[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : null;
}

module.exports = {
  normalizeMac
};
