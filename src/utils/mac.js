'use strict';

function normalizeMac(mac) {
  if (typeof mac !== 'string') {
    return '';
  }

  return mac.replace(/[^a-f0-9]/gi, '').toLowerCase();
}

module.exports = {
  normalizeMac
};
