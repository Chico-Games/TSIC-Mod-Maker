// Dummy stand-ins for the real GAS abilities.
//
// These carry ONLY the gates the AI actually consults — minRange, maxRange, cooldown
// duration, minCombatSeconds, bCheckLineOfSight, bCommitToAttack — plus the montage length
// as the swing duration and the audited hitbox reach as the damage footprint. There is no
// damage model, no effect groups and no projectile assets.
//
// 2026-07-31, from the live editor via Unreal MCP ObjectTools.get_properties on each GA_* CDO (Default__GA_*_C) plus its cooldown GE and first montage.
// Hitboxes: AnimNotify(State)_Hitbox offsets audited 2026-07-28; reach = offsetY + halfExtentY. Drawn as the attack's damage footprint.
// To refresh: Re-read with ObjectTools.get_properties on the ability CDOs if the .uassets change; this file is the only hand-maintained data in the tool.

import type { AbilityData } from './types';
import type { AbilityPack } from './sim';

export const ABILITY_PACK: AbilityPack = {
  "abilities": {
    "AI.BoneHead.Attack.Melee": {
      "label": "BoneHead Melee",
      "kind": "melee",
      "minRange": null,
      "maxRange": 150,
      "cooldownSeconds": 0,
      "minCombatSeconds": 0,
      "checkLineOfSight": false,
      "commitToAttack": true,
      "montageSeconds": 3.733,
      "playRate": 1,
      "hitboxReach": 260,
      "hitboxHalfWidth": 100,
      "montage": "AM_Manager_Melee_UE5"
    },
    "AI.BoneHead.Attack.Charge": {
      "label": "BoneHead Charge",
      "kind": "charge",
      "minRange": 150,
      "maxRange": 750,
      "cooldownSeconds": 15,
      "minCombatSeconds": 5,
      "checkLineOfSight": true,
      "commitToAttack": true,
      "montageSeconds": 4,
      "playRate": 1,
      "hitboxReach": 125,
      "hitboxHalfWidth": 70,
      "montage": "AM_Manager_ChargeAttack_UE5"
    },
    "AI.BoneHead.Attack.Throw": {
      "label": "BoneHead Throw",
      "kind": "ranged",
      "minRange": 400,
      "maxRange": 2000,
      "cooldownSeconds": 15,
      "minCombatSeconds": 5,
      "checkLineOfSight": true,
      "commitToAttack": true,
      "montageSeconds": 7,
      "playRate": 1,
      "projectileSpeed": 1400,
      "montage": "AM_Manager_Throw_UE5"
    },
    "AI.Janitor.Attack.Melee": {
      "label": "Janitor Melee",
      "kind": "melee",
      "minRange": 0,
      "maxRange": 110,
      "cooldownSeconds": 1.75,
      "minCombatSeconds": 0,
      "checkLineOfSight": false,
      "commitToAttack": true,
      "montageSeconds": 4.633,
      "playRate": 1,
      "hitboxReach": 85,
      "hitboxHalfWidth": 25,
      "hitboxBone": "hand_r",
      "montage": "AS_Attack_01/02/03_Montage"
    },
    "AI.Janitor.Attack.Acid.Melee": {
      "label": "Janitor Acid AOE",
      "kind": "melee",
      "minRange": 0,
      "maxRange": 200,
      "cooldownSeconds": 12,
      "minCombatSeconds": 4,
      "checkLineOfSight": false,
      "commitToAttack": true,
      "montageSeconds": 5.4,
      "playRate": 1,
      "hitboxReach": 220,
      "montage": "Roar__1__Anim1_Montage",
      "hitboxHalfWidth": 80,
      "note": "TWO damage windows: MouthSpray (22 dmg, forward jet) and AcidPool (8 dmg / 30 vs entities, wide splash). Both notifies exist on the montage and both effect groups carry GE_Damage \u2014 verified in-editor 2026-08-02. The earlier 'shipped dead' note was wrong."
    },
    "AI.Janitor.Attack.Acid.Ranged": {
      "label": "Janitor Acid Ranged",
      "kind": "ranged",
      "minRange": 0,
      "maxRange": 3000,
      "cooldownSeconds": 16,
      "minCombatSeconds": 2,
      "checkLineOfSight": true,
      "commitToAttack": true,
      "montageSeconds": 1.717,
      "playRate": 0.8,
      "projectileSpeed": 1600,
      "deadNote": "UNVERIFIED, not dead: AS_Throw has no Hitbox notify so the ability's own MouthSpray effect group never fires, but the montage carries an AnimNotify_SpawnActor at 0.525s and the effect group's description says 'the thrown flask carries its own damage'. The flask's payload has not been read. Do not model damage until it has.",
      "montage": "AS_Throw"
    },
    "AI.LivingMannequin.Attack.Grab": {
      "label": "Mannequin Grab",
      "kind": "grab",
      "minRange": 0,
      "maxRange": 200,
      "cooldownSeconds": 14,
      "minCombatSeconds": 5,
      "checkLineOfSight": false,
      "commitToAttack": true,
      "montageSeconds": 4.5,
      "playRate": 1,
      "hitboxReach": 184,
      "hitboxHalfWidth": 45,
      "grabHoldSeconds": 4.5,
      "montage": "AM_LivingMannequin_Paired_Attack_Grab_Attacker"
    },
    "AI.LivingMannequin.Attack.Regular": {
      "label": "Mannequin Regular",
      "kind": "melee",
      "minRange": 0,
      "maxRange": 140,
      "cooldownSeconds": 2.5,
      "minCombatSeconds": 0,
      "checkLineOfSight": false,
      "commitToAttack": true,
      "montageSeconds": 10.222,
      "playRate": 1,
      "hitboxReach": 0,
      "deadNote": "UNVERIFIED damage window. The ability is granted and castable (parity test, 2026-08-02). Some LivingMannequin SEQUENCES carry an empty Hitbox notify, but on every enemy checked the real damage window lives on the MONTAGE and the sequence notify is vestigial \u2014 so absence has NOT been established here.",
      "montage": "AM_LivingMannequin_Attack_Hit"
    },
    "AI.LivingMannequin.Attack.PowerSwing.Forward": {
      "label": "Mannequin Power Swing",
      "kind": "melee",
      "minRange": 0,
      "maxRange": 190,
      "cooldownSeconds": 9,
      "minCombatSeconds": 3,
      "checkLineOfSight": false,
      "commitToAttack": true,
      "montageSeconds": 2.222,
      "playRate": 1,
      "hitboxReach": 0,
      "deadNote": "UNVERIFIED damage window. The ability is granted and castable (parity test, 2026-08-02). Some LivingMannequin SEQUENCES carry an empty Hitbox notify, but on every enemy checked the real damage window lives on the MONTAGE and the sequence notify is vestigial \u2014 so absence has NOT been established here.",
      "montage": "AN_..._PowerSwing01_Forward"
    },
    "AI.MaleStaff.Attack.Melee": {
      "label": "Male Staff Melee",
      "kind": "melee",
      "minRange": null,
      "maxRange": 50,
      "cooldownSeconds": 0,
      "minCombatSeconds": 0,
      "checkLineOfSight": false,
      "commitToAttack": true,
      "montageSeconds": 2.633,
      "playRate": 1,
      "hitboxReach": 140,
      "hitboxHalfWidth": 50,
      "montage": "AS_Attack_01/02/03_Montage"
    },
    "AI.TVHead.Attack.Melee": {
      "label": "TV Head Melee",
      "kind": "melee",
      "minRange": null,
      "maxRange": 100,
      "cooldownSeconds": 0,
      "minCombatSeconds": 0,
      "checkLineOfSight": false,
      "commitToAttack": true,
      "montageSeconds": 2.633,
      "playRate": 1,
      "hitboxReach": 140,
      "hitboxHalfWidth": 50,
      "montage": "MaleStaff AS_Attack_0{1,2,3}_Montage (shared)"
    },
    "AI.Gardener.Attack.Melee": {
      "label": "Gardener Melee",
      "kind": "melee",
      "minRange": null,
      "maxRange": 100,
      "cooldownSeconds": 0,
      "minCombatSeconds": 0,
      "checkLineOfSight": false,
      "commitToAttack": true,
      "montageSeconds": 2.633,
      "playRate": 1,
      "hitboxReach": 140,
      "hitboxHalfWidth": 50,
      "montage": "MaleStaff AS_Attack_0{1,2,3}_Montage (shared)"
    },
    "AI.HeavyStaff.Attack.Melee": {
      "label": "Heavy Staff Melee",
      "kind": "melee",
      "minRange": null,
      "maxRange": 120,
      "cooldownSeconds": 0,
      "minCombatSeconds": 0,
      "checkLineOfSight": false,
      "commitToAttack": true,
      "montageSeconds": 4.633,
      "playRate": 1,
      "hitboxReach": 140,
      "hitboxHalfWidth": 50,
      "montage": "AS_Attack_01/02/03_Montage"
    },
    "AI.HeavyStaff.Attack.GroundPound": {
      "label": "Heavy Staff Ground Pound",
      "kind": "melee",
      "minRange": 0,
      "maxRange": 200,
      "cooldownSeconds": 8,
      "minCombatSeconds": 5,
      "checkLineOfSight": false,
      "commitToAttack": true,
      "montageSeconds": 3,
      "playRate": 1,
      "hitboxReach": 0,
      "deadNote": "SHIPPED DEAD: animationMontages is [None] \u2014 the referenced GroundPoundWall folder no longer exists. Its 3 effect groups can never fire.",
      "montage": "(missing)"
    },
    "Ability.TVHead.Spotlight": {
      "label": "TV Head Spotlight",
      "kind": "melee",
      "minRange": 0,
      "maxRange": 0,
      "cooldownSeconds": 0,
      "minCombatSeconds": 0,
      "checkLineOfSight": false,
      "commitToAttack": false,
      "montageSeconds": 0,
      "playRate": 1,
      "hitboxReach": 0,
      "montage": "(none)",
      "note": "Not a PlayAnimation, so it declares no Min/MaxRange \u2014 which makes it sort FIRST for TVHead (unlimited reach beats any cap) and it is what TVHead mostly uses: 148 activations vs 11 melee in the live Gauntlet run. Granted via C++ UGameplayAbility_Spotlight's constructor."
    }
  },
  "grantedByEnemy": {
    "_note": "Verified by TSIC.AI.V2.Parity.AbilityTable on 2026-08-02: EVERY attack tag on EVERY v2 enemy is granted through AScpCharacter::DefaultAbilities and backed by a real ability asset. There is no dead loadout entry anywhere. Two earlier 'not granted' claims (the Mannequin's, and Ability.TVHead.Spotlight) were both tool bugs, not content bugs."
  },
  "coordinator": {
    "maxSimultaneousAttackers": 2,
    "note": "UScpCombatCoordinatorSubsystem::MaxSimultaneousAttackers \u2014 token pool is per TARGET, cost per agent defaults to 1."
  },
  "approach": {
    "gapUnits": 40,
    "defaultCapsuleRadius": 35,
    "note": "ScpAi2::GetApproachEnvelope = agentRadius + targetRadius + 40. The approach envelope, not the ability range, is how close move_to drives."
  },
  "capsuleRadiusByEnemy": {
    "_note": "Collision radius per enemy, DERIVED from the closest approach TSIC.AI.V2's AiApproachParityTest Gauntlet node measured against a 42uu dummy (contact = rEnemy + rDummy), averaged over the runs of 2026-08-02. Capsules are NOT uniform: modelling every enemy at 42uu put TVHead 100uu closer than it can ever get and made its melee look unreachable. Re-measure with the node if capsules change.",
    "ED_BoneHead": 52,
    "ED_Gardener": 30,
    "ED_HeavyStaff": 63,
    "ED_Janitor": 43,
    "ED_MaleStaff": 33,
    "ED_TVHead": 141,
    "ED_LivingMannequin": 42
  }
} as AbilityPack;

export const ABILITIES: Record<string, AbilityData> = ABILITY_PACK.abilities;
