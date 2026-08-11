// Shapes shared across the AI sandbox engine.
//
// Definition JSON is deliberately `any`: it is authored data whose shape is owned by the
// C++ UPROPERTYs and the schema sidecar, not by this module. Everything the sim DERIVES
// from it is typed.

import type { Vec2 } from './util';

/** A raw definition file as the editor holds it: `{ id, class, properties }`. */
export interface DefJson {
  id: string;
  class?: string;
  properties?: any;
  [k: string]: any;
}

/** The AI-relevant slice of the loaded project, keyed by definition id. */
export interface AiPack {
  enemies: Record<string, DefJson>;
  perception: Record<string, DefJson>;
  behaviors: Record<string, DefJson>;
  skills: Record<string, DefJson>;
  furniture: Record<string, DefJson>;
}

// ---------------------------------------------------------------------------
// Perception
// ---------------------------------------------------------------------------

export interface SightSettings {
  cone_angle: number;
  range: number;
  peripheral_cone_angle: number;
  peripheral_range: number;
  peripheral_gain: number;
  auto_detect_radius: number;
  time_to_spot: number;
  time_to_forget_glimpse: number;
  memory_seconds: number;
  ghost_track_seconds: number;
  stealth: { spot_multiplier: number; range_multiplier: number };
  motion: { still: number; sprint: number };
}

export interface ResolvedProfile {
  update_interval: { near: number; mid: number; far: number };
  sight: SightSettings;
  hearing: { acuity: number; occlusion_attenuation: number; noise_lifetime: number };
  damage: { total_halflife: number; recent_window: number };
  observed: { enabled: boolean; range: number; fov_margin: number };
  stalemate: { give_up_seconds: number; resume_seconds: number; search_near_spawn: boolean };
  targeting: {
    target_priority: string[];
    switch_damage: number;
    alert_allies_radius: number;
    patrol_return_distance: number;
  };
  compiledPriority: string[];
  daySectionOverrides: Record<string, any>;
  /** PRC_ ids from the root of the `extends` chain down to the definition itself. */
  sourceChain: string[];
  activeDaySection: string | null;
}

/** How a sight record's fill rate was arrived at — the "why can't it see me" answer. */
export interface VisibilityBreakdown {
  fill: number;
  instant: boolean;
  reason: string;
  distance: number;
  angle: number;
  coneGain: number;
  distanceFalloff: number;
  motionMultiplier: number;
  stealthMultiplier: number;
  motion01?: number;
  los: boolean;
  via: string | null;
  primaryRange?: number;
  peripheralRange?: number;
  effectiveRange?: number;
}

export interface SensedRecord {
  actor: any;
  lastKnownLocation: Vec2;
  sensedNow: boolean;
  firstSensedTime: number;
  lastSensedTime: number;
  lastSeenTime: number;
  strength: number;
  recentDamage: number;
  spotted: boolean;
  avoid: boolean;
  lastSocialTime: number;
  lastVisibility?: VisibilityBreakdown;
  liveStrength?: number;
}

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------

export interface CompiledCondition {
  kind: string;
  negate: boolean;
  params: any;
}

export interface CompiledAction {
  kind: string;
  params: any;
}

export interface CompiledTransition {
  trigger: string;
  event: string | null;
  toIndex: number;
  toName: string | null;
  result: string | null;
  conditions: CompiledCondition[];
  priority: number;
}

export interface CompiledState {
  index: number;
  name: string;
  label: string;
  actions: CompiledAction[];
  minCommitSeconds: number;
  children: number[];
  initialChild: number;
  transitions: CompiledTransition[];
}

export interface CompiledRootEntry {
  name: string;
  when: CompiledCondition[];
  holdSeconds: number;
  failCooldown: number;
  navPolicy: 'breach' | 'blocking';
  entryIndex: number;
  stateIndex: number;
  isAlias: boolean;
  priority: number;
}

export interface CompiledSkill {
  id: string;
  rootIndex: number;
  inputs: Record<string, string>;
}

export interface CompiledBehavior {
  id: string;
  rootEvalInterval: number;
  rootEntries: CompiledRootEntry[];
  states: CompiledState[];
  skills: Record<string, CompiledSkill>;
  errors: string[];
}

export type RunStatus = 'Running' | 'Succeeded' | 'Failed';
export type ExitReason = 'Completed' | 'Interrupted' | 'Stopped';

export interface MachineFrame {
  compiled: CompiledBehavior;
  kind: 'behavior' | 'skill';
  skillId: string | null;
  rootIndex: number | null;
  parent: MachineFrame | null;
  inputs: Record<string, any> | null;
  /** `$Var.<name>` storage — frame-local, written by set_var / find_spot. */
  vars: Record<string, any>;
  activePath: number[];
  pathEnterTimes: number[];
  actionStatus: RunStatus[][];
  completionHandled: boolean[];
  memory: Map<string, any>;
  pendingResult: number;
  actionsLive: boolean;
  transitionBudget: number;
  /** Consecutive ticks a same-tick self-retry has been deferred — see performTransition. */
  selfRetryDeferrals: number;
}

/** One root entry's live when-list verdict, rebuilt every selection pass. */
export interface RootTraceEntry {
  name: string;
  alias: boolean;
  conditions: Array<{ label: string; pass: boolean; raw: boolean }>;
  pass: boolean;
  cooldown: boolean;
  cooldownRemaining?: number;
  entryIndex: number;
  selected: boolean;
}

// ---------------------------------------------------------------------------
// Abilities
// ---------------------------------------------------------------------------

export interface AbilityData {
  label: string;
  kind: 'melee' | 'ranged' | 'charge' | 'grab';
  minRange: number | null;
  maxRange: number | null;
  cooldownSeconds: number;
  minCombatSeconds: number;
  checkLineOfSight: boolean;
  commitToAttack: boolean;
  montageSeconds: number;
  playRate: number;
  hitboxReach?: number;
  hitboxHalfWidth?: number;
  hitboxBone?: string;
  projectileSpeed?: number;
  grabHoldSeconds?: number;
  granted?: boolean;
  deadNote?: string | null;
  montage?: string;
}

/** One row of the attack-selection verdict table. */
export interface AttackCandidate {
  tag: string;
  label: string;
  weight: number;
  minRange: number | null;
  maxRange: number | null;
  cooldown: number;
  eligible: boolean;
  reason: string;
  dead: boolean;
  deadNote: string | null;
  notGranted?: boolean;
  rank?: number;
  sortMin?: number;
  sortMax?: number;
  sortCooldown?: number;
}

/** A single entry in the decision timeline strip. */
export interface TimelineEvent {
  t: number;
  kind: 'root' | 'state' | 'event' | 'ability' | 'target' | 'fail' | 'sense';
  text: string;
  agentId: number;
}
