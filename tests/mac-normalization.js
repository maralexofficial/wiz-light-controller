'use strict';

const assert = require('node:assert/strict');
const { normalizeMac } = require('../src/utils/mac');

const cases = [
  ['AA:BB:CC:DD:EE:FF', 'aabbccddeeff'],
  ['aa-bb-cc-dd-ee-ff', 'aabbccddeeff'],
  ['aabbccddeeff', 'aabbccddeeff'],
  ['  AA:BB:CC:DD:EE:FF  ', 'aabbccddeeff'],
  [null, null],
  [undefined, null],
  ['invalid', null],
  ['zzzzzzzzzzzz', null]
];

for (const [input, expected] of cases) {
  assert.equal(normalizeMac(input), expected, `normalizeMac(${String(input)})`);
}

console.log('MAC normalization checks passed.');
