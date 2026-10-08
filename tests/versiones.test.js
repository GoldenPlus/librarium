import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indexVersionado } from '../scripts/versionar.js';

test('index.html tiene las marcas de versión al día (si falla: npm run versionar)', () => {
  assert.equal(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), indexVersionado());
});
