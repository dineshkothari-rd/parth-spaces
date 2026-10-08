import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultBusinessSettings, requireBusinessIdentity, validateBusinessSettings } from './businessConfig';

test('placeholder and blank business identities cannot be used on customer documents', () => {
  assert.throws(() => requireBusinessIdentity(defaultBusinessSettings), /actual business name/);
  assert.throws(() => requireBusinessIdentity({ name: '   ' }), /actual business name/);
});

test('saved customer identities remain independent of the software brand', () => {
  for (const name of ['Kothari', 'Independent Library']) {
    const settings = validateBusinessSettings({ ...defaultBusinessSettings, name });
    assert.doesNotThrow(() => requireBusinessIdentity(settings));
  }
});
