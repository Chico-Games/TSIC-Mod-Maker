// Engine schema store. Fully populated in Task 6; this stub exists so other
// modules can import the types and lookups without circular dependencies.

export interface ClassNode {
  name: string;
  parents: string[];
  folder: string | null;
}

export interface EnumMember {
  name: string;
  display_name?: string;
}

export interface PropertyMeta {
  tooltip: string | null;
  category: string | null;
  cpp_type: string | null;
  element_class: string | null;
  clamp_min: number | string | null;
  clamp_max: number | string | null;
  ui_min: number | string | null;
  ui_max: number | string | null;
  edit_condition: string | null;
  edit_spec: string | null;
  display_name: string | null;
  categories: string | null;
}
