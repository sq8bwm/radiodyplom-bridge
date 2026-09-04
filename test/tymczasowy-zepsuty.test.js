// TYMCZASOWY: sprawdzenie, że czerwone testy blokują scalenie. Do usunięcia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('celowo zepsuty', () => { assert.equal(1, 2, 'ma nie przejść'); });
