import { useMemo, useState } from 'react';
import { NumberSlider } from '../NumberSlider';

interface Props {
  /** The full effects_to_apply struct envelope. */
  envelope: any;
  /** Called with the next struct envelope (full replacement). */
  onChange: (next: any) => void;
}

interface Pair {
  /** e.g. 'flat_damage_increase' */
  key: string;
  /** e.g. 'b_apply_flat_damage_increase' */
  boolKey: string;
  /** Float | bool */
  valueEnvelope: any;
  /** True when active (b_apply_X === true). */
  active: boolean;
}

const LABELS: Record<string, string> = {
  flat_damage_increase: 'flat damage',
  percentage_damage_increase: 'percent damage',
  life_steal_percentage: 'life steal',
  flat_armour_increase: 'flat armour',
  flat_speed_increase: 'flat speed',
  max_health_increase: 'max health',
  max_stamina_increase: 'max stamina',
  stamina_regen_per_second: 'stamina regen / s',
  stamina_regen_delay_reduction: 'stamina regen delay -',
  carry_capacity_increase: 'carry capacity',
  tool_durability_multiplier: 'tool durability x',
  xp_gain_multiplier: 'xp gain x',
  heal_per_second: 'heal / s',
  instant_heal: 'instant heal',
  flat_satiation: 'satiation',
  satiation_per_second: 'satiation / s',
  radiation_immunity: 'radiation immunity',
  cold_immunity: 'cold immunity',
  heat_immunity: 'heat immunity',
  water_breathing: 'water breathing',
};

function humanise(k: string): string {
  return LABELS[k] ?? k.replace(/_/g, ' ');
}

export function SmartEffectsView({ envelope, onChange }: Props) {
  const [showAll, setShowAll] = useState(false);

  const pairs = useMemo<Pair[]>(() => {
    const v = envelope?.value ?? {};
    const out: Pair[] = [];
    for (const k of Object.keys(v)) {
      if (!k.startsWith('b_apply_')) continue;
      const boolKey = k;
      const valueKey = k.slice('b_apply_'.length);
      const partner = v[valueKey];
      if (!partner) continue;
      out.push({
        key: valueKey,
        boolKey,
        valueEnvelope: partner,
        active: !!v[boolKey]?.value,
      });
    }
    return out;
  }, [envelope]);

  if (showAll) {
    return (
      <div className="smart-effects">
        <button className="smart-toggle" onClick={() => setShowAll(false)}>← Active effects only</button>
        <div className="muted">Standard view rendered by parent. Toggle off to return.</div>
      </div>
    );
  }

  const active = pairs.filter((p) => p.active);
  const inactive = pairs.filter((p) => !p.active);

  const setBool = (boolKey: string, val: boolean) => {
    const next = JSON.parse(JSON.stringify(envelope));
    if (next.value[boolKey]) next.value[boolKey].value = val;
    onChange(next);
  };
  const setValue = (valueKey: string, val: any) => {
    const next = JSON.parse(JSON.stringify(envelope));
    if (next.value[valueKey]) next.value[valueKey].value = val;
    onChange(next);
  };
  const addEffect = (valueKey: string) => {
    const next = JSON.parse(JSON.stringify(envelope));
    const partner = next.value[valueKey];
    if (next.value[`b_apply_${valueKey}`]) next.value[`b_apply_${valueKey}`].value = true;
    if (partner?.type === 'float' && (partner.value === 0 || partner.value == null)) partner.value = 1.0;
    if (partner?.type === 'bool' && !partner.value) partner.value = true;
    onChange(next);
  };

  return (
    <div className="smart-effects">
      <header className="smart-effects-header">
        <strong>Active effects</strong>
        <button className="smart-toggle" onClick={() => setShowAll(true)}>Show all ({pairs.length}) ▾</button>
      </header>
      {active.length === 0 && <div className="muted">No active effects.</div>}
      <ul className="smart-effects-list">
        {active.map((p) => (
          <li key={p.key} className="smart-effect-row">
            <span className="label">{humanise(p.key)}</span>
            {p.valueEnvelope.type === 'float' || p.valueEnvelope.type === 'int' ? (
              <NumberSlider
                value={Number(p.valueEnvelope.value ?? 0)}
                min={0}
                max={100}
                onChange={(v) => setValue(p.key, v)}
              />
            ) : (
              <input
                type="checkbox"
                checked={!!p.valueEnvelope.value}
                onChange={(e) => setValue(p.key, e.target.checked)}
              />
            )}
            <button className="smart-effect-remove" onClick={() => setBool(p.boolKey, false)}>×</button>
          </li>
        ))}
      </ul>
      {inactive.length > 0 && (
        <details className="smart-effects-add">
          <summary>+ Add effect</summary>
          <ul>
            {inactive.map((p) => (
              <li key={p.key}>
                <button onClick={() => addEffect(p.key)}>{humanise(p.key)}</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
