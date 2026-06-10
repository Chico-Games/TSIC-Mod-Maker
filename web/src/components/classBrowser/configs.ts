import type { ClassBrowserConfig } from './types';
import { getFolderTheme } from '../folderTheme';

const t = (folder: string) => getFolderTheme(folder).emoji;

export const CONFIGS: Record<string, ClassBrowserConfig> = {
  // ---- Items ----
  crafting_material_definitions: {
    label: 'Crafting Materials', emoji: t('crafting_material_definitions'),
    newRecordClass: 'CraftingMaterialDefinition',
    hasStaticPartner: true,
    columns: [
      { key: 'weight', label: 'Wt', path: ['properties','weight','value'], kind: 'number', width: 60 },
      { key: 'stackable', label: 'Stack', path: ['properties','stackable','value'], kind: 'bool', width: 60 },
      { key: 'category', label: 'Cat', path: ['properties','item_category_tag','value'], kind: 'tag' },
    ],
    warnings: [
      { id: 'zero-weight', severity: 'warn',
        test: (r) => r.json?.properties?.weight?.value === 0 ? 'weight = 0' : null },
    ],
  },
  consumable_definitions: {
    label: 'Consumables', emoji: t('consumable_definitions'),
    newRecordClass: 'ConsumableDefinition',
    hasStaticPartner: true,
    columns: [
      { key: 'weight', label: 'Wt', path: ['properties','weight','value'], kind: 'number', width: 60 },
      { key: 'stackable', label: 'Stack', path: ['properties','stackable','value'], kind: 'bool', width: 60 },
    ],
  },
  constructable_item_definitions: {
    label: 'Constructables', emoji: t('constructable_item_definitions'),
    newRecordClass: 'ConstructableItemDefinition',
    hasStaticPartner: true,
    columns: [
      { key: 'weight', label: 'Wt', path: ['properties','weight','value'], kind: 'number', width: 60 },
      { key: 'stackable', label: 'Stack', path: ['properties','stackable','value'], kind: 'bool', width: 60 },
    ],
  },
  equippable_definitions: {
    label: 'Equippables', emoji: t('equippable_definitions'),
    newRecordClass: 'EquippableDefinition',
    hasStaticPartner: true,
    columns: [
      { key: 'slot', label: 'Slot', path: ['properties','equipment_slot','value'], kind: 'tag' },
      { key: 'has_ammo', label: 'Ammo', path: ['properties','has_ammo','value'], kind: 'bool', width: 60 },
      { key: 'has_durability', label: 'Dur', path: ['properties','has_durability','value'], kind: 'bool', width: 60 },
      { key: 'max_ammo', label: 'Max', path: ['properties','max_ammo','value'], kind: 'number', width: 60 },
    ],
  },
  glove_definitions: {
    label: 'Gloves', emoji: t('glove_definitions'),
    newRecordClass: 'GloveDefinition',
    hasStaticPartner: true,
    columns: [
      { key: 'weight', label: 'Wt', path: ['properties','weight','value'], kind: 'number', width: 60 },
    ],
  },
  ammo_definitions: {
    label: 'Ammo', emoji: t('ammo_definitions'),
    newRecordClass: 'AmmoDefinition',
    hasStaticPartner: true,
    columns: [
      { key: 'weight', label: 'Wt', path: ['properties','weight','value'], kind: 'number', width: 60 },
    ],
  },
  seed_item_definitions: {
    label: 'Seeds', emoji: t('seed_item_definitions'),
    newRecordClass: 'SeedItemDefinition',
    hasStaticPartner: true,
    columns: [
      { key: 'weight', label: 'Wt', path: ['properties','weight','value'], kind: 'number', width: 60 },
    ],
  },
  trap_item_definitions: {
    label: 'Traps', emoji: t('trap_item_definitions'),
    newRecordClass: 'TrapItemDefinition',
    hasStaticPartner: true,
    columns: [
      { key: 'weight', label: 'Wt', path: ['properties','weight','value'], kind: 'number', width: 60 },
    ],
  },
  static_item_definitions: {
    label: 'Static Items', emoji: t('static_item_definitions'),
    newRecordClass: 'StaticItemDefinition',
    hasStaticPartner: false,
    columns: [],
  },

  // ---- Furniture ----
  furniture_definitions: {
    label: 'Furniture', emoji: t('furniture_definitions'),
    newRecordClass: 'FurnitureDefinition',
    tierGrouping: true,
    columns: [
      { key: 'level', label: 'Lvl', path: ['properties','level','value'], kind: 'number', width: 60 },
      { key: 'weight', label: 'Wt', path: ['properties','weighted_chance','value'], kind: 'number', width: 70 },
    ],
  },
  damageable_furniture_definitions: {
    label: 'Damageable', emoji: t('damageable_furniture_definitions'),
    newRecordClass: 'DamageableFurnitureDefinition',
    tierGrouping: true,
    columns: [
      { key: 'health', label: 'HP', path: ['properties','starting_health','value'], kind: 'number', width: 70 },
      { key: 'armour', label: 'Arm', path: ['properties','furniture_armour','value'], kind: 'number', width: 60 },
      { key: 'draggable', label: 'Drag', path: ['properties','is_draggable','value'], kind: 'bool', width: 60 },
      { key: 'level', label: 'Lvl', path: ['properties','level','value'], kind: 'number', width: 60 },
      { key: 'loot', label: 'Loot', path: ['properties','loot_dropped_on_death','value'], kind: 'count', width: 60 },
    ],
  },
  toggleable_furniture_definitions: {
    label: 'Toggleable', emoji: t('toggleable_furniture_definitions'),
    newRecordClass: 'ToggleableFurnitureDefinition',
    tierGrouping: true,
    columns: [
      { key: 'level', label: 'Lvl', path: ['properties','level','value'], kind: 'number', width: 60 },
    ],
  },
  furniture_with_components_definitions: {
    label: 'With Components', emoji: t('furniture_with_components_definitions'),
    newRecordClass: 'FurnitureWithComponentsDefinition',
    tierGrouping: true,
    columns: [
      { key: 'level', label: 'Lvl', path: ['properties','level','value'], kind: 'number', width: 60 },
    ],
  },
  storage_definitions: {
    label: 'Storage', emoji: t('storage_definitions'),
    newRecordClass: 'StorageDefinition',
    tierGrouping: true,
    columns: [
      { key: 'level', label: 'Lvl', path: ['properties','level','value'], kind: 'number', width: 60 },
    ],
  },
  universal_storage_definitions: {
    label: 'Universal Storage', emoji: t('universal_storage_definitions'),
    newRecordClass: 'UniversalStorageDefinition',
    tierGrouping: true,
    columns: [],
  },
  crafting_station_definitions: {
    label: 'Crafting Stations', emoji: t('crafting_station_definitions'),
    newRecordClass: 'CraftingStationDefinition',
    tierGrouping: true,
    columns: [
      { key: 'arr', label: 'ARR', path: ['properties','available_recipe_rules_definition','value'], kind: 'ref' },
      { key: 'level', label: 'Lvl', path: ['properties','level','value'], kind: 'number', width: 60 },
    ],
  },
  production_station_definitions: {
    label: 'Production Stations', emoji: t('production_station_definitions'),
    newRecordClass: 'ProductionStationDefinition',
    tierGrouping: true,
    columns: [
      { key: 'arr', label: 'ARR', path: ['properties','available_recipe_rules_definition','value'], kind: 'ref' },
      { key: 'level', label: 'Lvl', path: ['properties','level','value'], kind: 'number', width: 60 },
    ],
  },
  shop_definitions: {
    label: 'Shops', emoji: t('shop_definitions'),
    newRecordClass: 'ShopDefinition',
    tierGrouping: true,
    columns: [
      { key: 'arr', label: 'ARR', path: ['properties','available_recipe_rules_definition','value'], kind: 'ref' },
      { key: 'level', label: 'Lvl', path: ['properties','level','value'], kind: 'number', width: 60 },
    ],
  },
  plantable_definitions: {
    label: 'Plantable', emoji: t('plantable_definitions'),
    newRecordClass: 'PlantableDefinition',
    tierGrouping: true,
    columns: [
      { key: 'arr', label: 'ARR', path: ['properties','available_recipe_rules_definition','value'], kind: 'ref' },
    ],
  },
  elevator_definitions: {
    label: 'Elevator', emoji: t('elevator_definitions'),
    newRecordClass: 'ElevatorDefinition', columns: [],
  },
  teleporter_definitions: {
    label: 'Teleporter', emoji: t('teleporter_definitions'),
    newRecordClass: 'TeleporterDefinition', columns: [],
  },
  death_box_definitions: {
    label: 'Death Box', emoji: t('death_box_definitions'),
    newRecordClass: 'DeathBoxDefinition', columns: [],
  },
  containment_cage_definitions: {
    label: 'Containment Cage', emoji: t('containment_cage_definitions'),
    newRecordClass: 'ContainmentCageDefinition', columns: [],
  },
  shopping_cart_definitions: {
    label: 'Shopping Cart', emoji: t('shopping_cart_definitions'),
    newRecordClass: 'ShoppingCartDefinition', columns: [],
  },
  biome_definitions: {
    label: 'Biomes', emoji: t('biome_definitions'),
    newRecordClass: 'BiomeDefinition',
    columns: [
      { key: 'role', label: 'Role', path: ['properties','role','value'], kind: 'string' as const },
      { key: 'maze_openness', label: 'Open', path: ['properties','maze_openness','value'], kind: 'number', width: 60 },
      { key: 'loot_mult', label: 'Loot×', path: ['properties','loot_multiplier','value'], kind: 'number', width: 60 },
    ],
  },
  spawn_point_definitions: {
    label: 'Spawn Points', emoji: t('spawn_point_definitions'),
    newRecordClass: 'SpawnPointDefinition', columns: [],
  },
  enemy_spawn_point_definitions: {
    label: 'Enemy Spawn Points', emoji: t('enemy_spawn_point_definitions'),
    newRecordClass: 'EnemySpawnPointDefinition', columns: [],
  },
  interactable_text_definitions: {
    label: 'Interactable Text', emoji: t('interactable_text_definitions'),
    newRecordClass: 'InteractableTextDefinition', columns: [],
  },
  html_game_definitions: {
    label: 'HTML Games', emoji: t('html_game_definitions'),
    newRecordClass: 'HTMLGameDefinition',
    columns: [
      { key: 'path', label: 'HTML Path', path: ['properties', 'game_htmlpath', 'value'], kind: 'string' as const },
    ],
  },
};
