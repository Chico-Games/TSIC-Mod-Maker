import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refWriteValue } from '../src/components/defRefWrite';

// Bug 2 regression: DefRefSlot must PRESERVE the cell's representation on write,
// never silently convert a soft_asset_ref into a definition_ref (that would
// break the envelope→lean round-trip).

test('refWriteValue: soft_asset_ref cell stays soft_asset_ref', () => {
  assert.deepEqual(
    refWriteValue('soft_asset_ref', 'ItemDefinition', 'ID_Onion_CN'),
    { type: 'soft_asset_ref', class: 'ItemDefinition', value: 'ID_Onion_CN' },
  );
});

test('refWriteValue: definition_ref cell stays definition_ref', () => {
  assert.deepEqual(
    refWriteValue('definition_ref', 'CraftRecipeDefinition', 'RD_Foo_CR'),
    { type: 'definition_ref', class: 'CraftRecipeDefinition', value: 'RD_Foo_CR' },
  );
});

test('refWriteValue: string-envelope cell stays a string envelope', () => {
  assert.deepEqual(
    refWriteValue('string', 'DamageableFurnitureDefinition', 'FD_Aircon_DF'),
    { type: 'string', value: 'FD_Aircon_DF' },
  );
});

test('refWriteValue: bare-string cell stays a bare string', () => {
  assert.equal(refWriteValue('bare_string', '', 'FD_Aircon_DF'), 'FD_Aircon_DF');
});

test('refWriteValue: empty/unknown cell defaults to soft_asset_ref', () => {
  assert.deepEqual(
    refWriteValue('', 'LootDefinition', 'LD_Aircon'),
    { type: 'soft_asset_ref', class: 'LootDefinition', value: 'LD_Aircon' },
  );
});
