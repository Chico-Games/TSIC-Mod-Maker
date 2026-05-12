import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useAppSchemaStore } from '../src/store/appSchemaStore';

function mockFetch(routes: Record<string, { status: number; body: string }>): typeof fetch {
  return (async (url: string | URL) => {
    const u = url.toString();
    const r = routes[u];
    if (!r) return { ok: false, status: 404, text: async () => '' } as any;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body } as any;
  }) as any;
}

test('loadSchema populates classNodes and propertyMeta', async () => {
  useAppSchemaStore.setState({ loaded: false, classNodes: new Map(), propertyMeta: new Map(), enumMeta: new Map() });
  const hierarchy = {
    classes: [
      { name: 'UItemDefinition', parents: [], folder: 'items' },
    ],
  };
  const propertyMeta = {
    properties: {
      'ItemDefinition.name': { tooltip: 'The display name', clamp_min: null, clamp_max: null },
    },
    enums: { EFoo: [{ name: 'A' }, { name: 'B' }] },
  };
  const fetcher = mockFetch({
    '/schema/class-hierarchy.json': { status: 200, body: JSON.stringify(hierarchy) },
    '/schema/property-meta.json': { status: 200, body: JSON.stringify(propertyMeta) },
  });
  await useAppSchemaStore.getState().loadSchema(fetcher);
  const s = useAppSchemaStore.getState();
  assert.equal(s.loaded, true);
  assert.equal(s.classNodes.get('UItemDefinition')?.folder, 'items');
  assert.equal(s.propertyMeta.get('ItemDefinition.name')?.tooltip, 'The display name');
  assert.equal(s.enumMeta.get('Foo')?.[0].name, 'A');
});

test('loadSchema is idempotent', async () => {
  useAppSchemaStore.setState({ loaded: false, classNodes: new Map(), propertyMeta: new Map(), enumMeta: new Map() });
  let calls = 0;
  const fetcher: typeof fetch = (async (url: string | URL) => {
    calls++;
    const u = url.toString();
    if (u.endsWith('class-hierarchy.json')) return { ok: true, status: 200, text: async () => '{"classes":[]}' } as any;
    if (u.endsWith('property-meta.json')) return { ok: true, status: 200, text: async () => '{"properties":{},"enums":{}}' } as any;
    return { ok: false, status: 404, text: async () => '' } as any;
  }) as any;
  await useAppSchemaStore.getState().loadSchema(fetcher);
  await useAppSchemaStore.getState().loadSchema(fetcher);
  assert.equal(calls, 2); // 2 fetches once, idempotency means no extra fetches the second call
});

test('loadSchema throws on 404', async () => {
  useAppSchemaStore.setState({ loaded: false, classNodes: new Map(), propertyMeta: new Map(), enumMeta: new Map() });
  const fetcher = mockFetch({});
  await assert.rejects(useAppSchemaStore.getState().loadSchema(fetcher), /class-hierarchy/);
});

test('getPropertyMeta walks parent chain', () => {
  useAppSchemaStore.setState({
    loaded: true,
    classNodes: new Map([
      ['UConsumableDefinition', { name: 'UConsumableDefinition', parents: ['UItemDefinition'], folder: 'consumables' }],
      ['UItemDefinition', { name: 'UItemDefinition', parents: [], folder: 'items' }],
    ]),
    propertyMeta: new Map([['ItemDefinition.name', {
      tooltip: 'from base', category: null, cpp_type: null, element_class: null,
      clamp_min: null, clamp_max: null, ui_min: null, ui_max: null,
      edit_condition: null, edit_spec: null, display_name: null, categories: null,
    }]]),
    enumMeta: new Map(),
  });
  const m = useAppSchemaStore.getState().getPropertyMeta('ConsumableDefinition', 'name');
  assert.equal(m?.tooltip, 'from base');
});
