// Per-folder visual theme — emoji glyph + accent color used for the folder
// list rows and the editor header stripe. Keeping this central so adding
// a new folder is one line, not a sweep through CSS.

export interface FolderTheme {
  emoji: string;
  color: string; // CSS color (used for left-border accent)
}

const DEFAULT: FolderTheme = { emoji: '📁', color: '#5fb3ff' };

const THEMES: Record<string, FolderTheme> = {
  ammo_definitions: { emoji: '🔫', color: '#c9a36b' },
  available_recipe_rules_definitions: { emoji: '📜', color: '#b78cff' },
  biome_definitions: { emoji: '🏔️', color: '#6dc4a0' },
  constructable_item_definitions: { emoji: '🧱', color: '#d4894e' },
  consumable_definitions: { emoji: '🥗', color: '#7bc97c' },
  containment_cage_definitions: { emoji: '🪤', color: '#888c95' },
  craft_recipe_definitions: { emoji: '📋', color: '#e8c45e' },
  crafting_material_definitions: { emoji: '🧪', color: '#a4c8ff' },
  crafting_station_definitions: { emoji: '🛠️', color: '#ff9b54' },
  damageable_furniture_definitions: { emoji: '🪑', color: '#ce6c6c' },
  death_box_definitions: { emoji: '⚰️', color: '#7d7d7d' },
  elevator_definitions: { emoji: '🛗', color: '#7ad6e8' },
  enemy_definitions: { emoji: '👹', color: '#ef6c6c' },
  enemy_spawn_point_definitions: { emoji: '📍', color: '#d57171' },
  equippable_definitions: { emoji: '⚔️', color: '#7aa6d6' },
  furniture_definitions: { emoji: '🛋️', color: '#b39870' },
  furniture_upgrade_recipe: { emoji: '🔧', color: '#d8b06b' },
  furniture_with_components_definitions: { emoji: '🪟', color: '#a4a07f' },
  glove_definitions: { emoji: '🧤', color: '#e6a4c5' },
  html_game_definitions: { emoji: '🕹️', color: '#7fbf8f' },
  interactable_text_definitions: { emoji: '💬', color: '#9bb1c8' },
  inventory_rules_definitions: { emoji: '📦', color: '#c0a370' },
  layout_definitions: { emoji: '🗺️', color: '#888c95' },
  layout_object_definitions: { emoji: '🗺️', color: '#888c95' },
  loot_definitions: { emoji: '💰', color: '#e8c45e' },
  loot_spawn_point_definitions: { emoji: '✨', color: '#f0d77a' },
  plant_recipe_definitions: { emoji: '🌱', color: '#7ec97a' },
  plantable_definitions: { emoji: '🌿', color: '#9adc7e' },
  production_station_definitions: { emoji: '🏭', color: '#a78fff' },
  scp_game_data: { emoji: '🎮', color: '#5fb3ff' },
  seed_item_definitions: { emoji: '🌰', color: '#b08968' },
  shop_definitions: { emoji: '🏪', color: '#7ec5b1' },
  shopping_cart_definitions: { emoji: '🛒', color: '#7ec5b1' },
  spawn_point_definitions: { emoji: '📌', color: '#a4c8ff' },
  static_item_definitions: { emoji: '📦', color: '#a08c66' },
  storage_definitions: { emoji: '🗄️', color: '#9b8a6b' },
  teleporter_definitions: { emoji: '🌀', color: '#bb87ff' },
  toggleable_furniture_definitions: { emoji: '💡', color: '#e0c45e' },
  trap_item_definitions: { emoji: '🪤', color: '#a06b3f' },
  universal_storage_definitions: { emoji: '📚', color: '#7d8aa3' },
};

export function getFolderTheme(folder: string): FolderTheme {
  return THEMES[folder] ?? DEFAULT;
}
