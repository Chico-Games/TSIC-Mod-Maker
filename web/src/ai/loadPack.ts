// Bridge from the editor's definition store to the AI sandbox.
//
// The sandbox reads the SAME records every other tab edits, so a change made in the
// Definitions tab (or in the AI tab's own editors) is live in the sim on the next rebuild.
// Nothing is copied to disk or re-fetched.

import type { DefinitionRecord, DefinitionsKey } from '../store/definitionsStore';
import { plainDefinition } from '../components/ai/envelope';
import type { AiPack, DefJson } from './types';

/** Definition folder -> the pack slot the sandbox reads it from. */
export const AI_FOLDERS = {
  enemies: 'enemy_definitions',
  perception: 'perception_definitions',
  behaviors: 'behavior_definitions',
  skills: 'skill_definitions',
  furniture: 'damageable_furniture_definitions',
} as const;

export type AiFolderSlot = keyof typeof AI_FOLDERS;

/** Storage key for a definition, matching definitionsStore's `${folder}/${id}`. */
export const aiKey = (slot: AiFolderSlot, id: string): DefinitionsKey => `${AI_FOLDERS[slot]}/${id}`;

export function buildAiPack(definitions: Map<DefinitionsKey, DefinitionRecord>): AiPack {
  const pack: AiPack = { enemies: {}, perception: {}, behaviors: {}, skills: {}, furniture: {} };
  const slotByFolder = new Map<string, AiFolderSlot>(
    (Object.entries(AI_FOLDERS) as Array<[AiFolderSlot, string]>).map(([slot, folder]) => [folder, slot]),
  );

  for (const record of definitions.values()) {
    const slot = slotByFolder.get(record.folder);
    if (!slot) continue;
    // The store holds typed envelopes; the engine is a port of the C++ and reads the plain
    // shape the game loads off disk.
    const json = plainDefinition(record.json) as DefJson;
    // Key on the definition's own id — every `$ref`, `extends` and `behavior` field in the
    // data refers to assets by bare id, never by folder path.
    pack[slot][json?.id ?? record.id] = json;
  }
  return pack;
}

/** Enemies that carry the v2 stack and name a behaviour we can compile. */
export function aiEnemies(pack: AiPack): DefJson[] {
  return Object.values(pack.enemies)
    .filter((d) => d.properties?.ai_stack === 'v2' && d.properties?.behavior)
    .sort((a, b) =>
      String(a.properties?.display_name ?? a.id).localeCompare(String(b.properties?.display_name ?? b.id)),
    );
}

/** True when the loaded project has enough AI data to run the sandbox at all. */
export function packHasAi(pack: AiPack): boolean {
  return aiEnemies(pack).length > 0 && Object.keys(pack.behaviors).length > 0;
}

/**
 * Problems that would stop the sandbox cold, reported up-front rather than as a stack
 * trace: an enemy pointing at a behaviour or perception profile that isn't in the project.
 */
export function packIssues(pack: AiPack): string[] {
  const issues: string[] = [];
  for (const enemy of aiEnemies(pack)) {
    const behaviour = enemy.properties?.behavior;
    if (behaviour && !pack.behaviors[behaviour]) {
      issues.push(`${enemy.id}: behavior "${behaviour}" not found`);
    }
    const perception = enemy.properties?.perception;
    if (perception && !pack.perception[perception]) {
      issues.push(`${enemy.id}: perception "${perception}" not found`);
    }
  }
  for (const profile of Object.values(pack.perception)) {
    const base = profile.properties?.extends;
    if (base && !pack.perception[base]) {
      issues.push(`${profile.id}: extends "${base}" which is not in the project`);
    }
  }
  return issues;
}
