"""Audit lossless export coverage.

For every UCLASS in C:/Users/Administrator/Documents/Unreal Projects/TSIC/
Source/TSIC/Public/DataAssets/**/*.h, scan UPROPERTY declarations and
compare against the actual JSON in
Tools/Export/test-output/Definitions/<folder>/. Report any silently-dropped
properties.
"""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

TSIC_ROOT = Path("C:/Users/Administrator/Documents/Unreal Projects/TSIC")
SOURCE_DIR = TSIC_ROOT / "Source" / "TSIC" / "Public" / "DataAssets"
EXPORT_DIR = TSIC_ROOT / "Tools" / "Export" / "test-output" / "Definitions"

# ---- naming helpers (mirror Tools/Export/lib/naming.py + scan_property_meta) ----
_FIRST_CAP = re.compile(r"(.)([A-Z][a-z]+)")
_ALL_CAP = re.compile(r"([a-z0-9])([A-Z])")


def pascal_to_snake(name: str) -> str:
    if not name:
        return name
    interim = _FIRST_CAP.sub(r"\1_\2", name)
    return _ALL_CAP.sub(r"\1_\2", interim).lower()


def class_to_folder(class_name: str) -> str:
    bare = class_name[1:] if class_name.startswith("U") else class_name
    snake = pascal_to_snake(bare)
    if snake.endswith("_definition"):
        return snake + "s"
    return snake


def normalize_prop_names(cpp_name: str) -> list[str]:
    """Mirror scan_property_meta.normalize_property_names — registers both
    `b_foo_bar` and `foo_bar` for booleans named `bFooBar`."""
    snake = pascal_to_snake(cpp_name)
    out = [snake]
    if len(cpp_name) >= 2 and cpp_name[0] == "b" and cpp_name[1].isupper():
        stripped = pascal_to_snake(cpp_name[1:])
        if stripped and stripped != snake:
            out.append(stripped)
    return out


# ---- regex (mirror scan_property_meta.py) ----
_LINE_COMMENT = re.compile(r"//[^\n]*")
_CLASS_DECL = re.compile(
    r"""
    (?P<kind>UCLASS|USTRUCT)\s*\([^)]*\)
    (?:[^{]*?)
    \b(?:class|struct)\b\s+
    (?:[A-Z_]+_API\s+)?
    (?P<name>[A-Z][A-Za-z0-9_]*)
    """,
    re.VERBOSE | re.DOTALL,
)
_UPROPERTY = re.compile(
    r"""
    UPROPERTY\s*\(
        (?P<tag>(?:[^()]|\([^()]*\))*)
    \)\s*
    (?P<decl>[^;{}]*?)
    ;
    """,
    re.VERBOSE | re.DOTALL,
)
_PARENT = re.compile(
    r"""
    (?:UCLASS|USTRUCT)\s*\([^)]*\)
    (?:[^{]*?)
    \b(?:class|struct)\b\s+
    (?:[A-Z_]+_API\s+)?
    (?P<name>[A-Z][A-Za-z0-9_]*)
    \s*:\s*public\s+
    (?P<parent>[A-Z][A-Za-z0-9_]*)
    """,
    re.VERBOSE | re.DOTALL,
)


def find_class_blocks(text: str):
    """Yield (name, body_start, body_end) for every UCLASS/USTRUCT."""
    blocks = []
    for m in _CLASS_DECL.finditer(text):
        name = m.group("name")
        brace = text.find("{", m.end())
        if brace == -1:
            continue
        depth = 1
        i = brace + 1
        while i < len(text) and depth > 0:
            ch = text[i]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    blocks.append((name, brace + 1, i))
                    break
            i += 1
    return blocks


def parse_decl_name(decl: str) -> str | None:
    decl = decl.strip()
    eq = decl.find("=")
    if eq != -1:
        decl = decl[:eq].strip()
    colon = decl.find(":")
    if colon != -1 and "<" not in decl[:colon]:
        decl = decl[:colon].strip()
    if not decl:
        return None
    parts = decl.rsplit(None, 1)
    if len(parts) < 2:
        return None
    cpp_name = parts[1].lstrip("*&")
    cpp_name = re.sub(r"\[[^\]]*\]$", "", cpp_name)
    if not cpp_name or not (cpp_name[0].isalpha() or cpp_name[0] == "_"):
        return None
    return cpp_name


def parse_decl_type(decl: str) -> str | None:
    decl = decl.strip()
    eq = decl.find("=")
    if eq != -1:
        decl = decl[:eq].strip()
    colon = decl.find(":")
    if colon != -1 and "<" not in decl[:colon]:
        decl = decl[:colon].strip()
    parts = decl.rsplit(None, 1)
    if len(parts) < 2:
        return None
    return parts[0].strip()


# ---- pass 1: scan all .h files ----

# class_name -> list of (cpp_name, cpp_type, file)
own_props: dict[str, list[tuple[str, str, Path]]] = defaultdict(list)
# class_name -> parent class_name
parent_of: dict[str, str] = {}
# all known class names from headers
all_classes: set[str] = set()

header_files = list(SOURCE_DIR.rglob("*.h"))
print(f"Scanning {len(header_files)} header files...")

for h in header_files:
    text = _LINE_COMMENT.sub("", h.read_text(encoding="utf-8", errors="replace"))
    # parent relationships
    for pm in _PARENT.finditer(text):
        parent_of[pm.group("name")] = pm.group("parent")
        all_classes.add(pm.group("name"))
    # property bodies
    for cls_name, body_start, body_end in find_class_blocks(text):
        all_classes.add(cls_name)
        body = text[body_start:body_end]
        for pm in _UPROPERTY.finditer(body):
            decl = pm.group("decl")
            cpp_name = parse_decl_name(decl)
            cpp_type = parse_decl_type(decl) or ""
            if not cpp_name:
                continue
            own_props[cls_name].append((cpp_name, cpp_type, h))


def collect_inherited(cls: str, visited: set[str] | None = None) -> list[tuple[str, str, Path, str]]:
    """Return (cpp_name, cpp_type, file, source_class) for cls and every
    ancestor we have headers for."""
    if visited is None:
        visited = set()
    if cls in visited:
        return []
    visited.add(cls)
    out: list[tuple[str, str, Path, str]] = []
    for cpp_name, cpp_type, f in own_props.get(cls, []):
        out.append((cpp_name, cpp_type, f, cls))
    parent = parent_of.get(cls)
    if parent and parent in all_classes:
        out.extend(collect_inherited(parent, visited))
    return out


# ---- pass 2: enumerate every export folder and match to a class ----

# folder -> class name (UFoo)
folder_to_class: dict[str, str] = {}
for cls in all_classes:
    if not cls.startswith("U"):
        continue
    folder_to_class[class_to_folder(cls)] = cls

# Special folders that don't follow the convention:
# (e.g. furniture_upgrade_recipe is not pluralized — singular)
# Recompute including the no-pluralize variant
for cls in all_classes:
    if not cls.startswith("U"):
        continue
    bare = cls[1:]
    snake = pascal_to_snake(bare)
    folder_to_class.setdefault(snake, cls)

results: dict[str, dict] = {}  # leaf_class -> {missing: [...], total: N, ...}

if not EXPORT_DIR.is_dir():
    print(f"ERR: export dir not found: {EXPORT_DIR}")
    sys.exit(1)

total_uproperties_scanned = 0
total_unique_expected = 0
total_surfaced = 0

for folder_path in sorted(EXPORT_DIR.iterdir()):
    if not folder_path.is_dir():
        continue
    folder_name = folder_path.name
    if folder_name.startswith("."):
        continue
    leaf_cls = folder_to_class.get(folder_name)
    if leaf_cls is None:
        # No matching class - skip (likely scp_game_data is UScpGameData
        # which doesn't follow Definition naming)
        continue

    expected = collect_inherited(leaf_cls)
    if not expected:
        continue

    # Build set of expected snake_case names (BOTH bool variants register).
    expected_names_to_meta: dict[str, tuple[str, str, Path, str]] = {}
    for cpp_name, cpp_type, f, source_cls in expected:
        for snake in normalize_prop_names(cpp_name):
            # Keep first wins (most-derived first, since collect_inherited
            # goes child -> parent).
            expected_names_to_meta.setdefault(snake, (cpp_name, cpp_type, f, source_cls))

    # Read every asset's properties dict, union the surfaced keys.
    json_files = sorted(folder_path.glob("*.json"))
    if not json_files:
        continue

    union_actual: set[str] = set()
    for jf in json_files:
        try:
            data = json.loads(jf.read_text(encoding="utf-8"))
        except Exception:
            continue
        props = data.get("properties") or {}
        union_actual.update(props.keys())

    # Missing = expected names not present in any asset's JSON.
    # For booleans with both `b_foo` and `foo` registered, treat as covered
    # if EITHER form appears in actual.
    missing: list[tuple[str, str, Path, str, list[str]]] = []
    seen_cpp: set[str] = set()
    for cpp_name, cpp_type, f, source_cls in expected:
        if cpp_name in seen_cpp:
            continue
        seen_cpp.add(cpp_name)
        candidate_snakes = normalize_prop_names(cpp_name)
        if any(s in union_actual for s in candidate_snakes):
            continue
        missing.append((cpp_name, cpp_type, f, source_cls, candidate_snakes))

    unique_cpp_count = len(seen_cpp)
    total_uproperties_scanned += sum(len(own_props.get(cls, [])) for cls in {leaf_cls})
    total_unique_expected += unique_cpp_count
    total_surfaced += unique_cpp_count - len(missing)

    results[leaf_cls] = {
        "folder": folder_name,
        "asset_count": len(json_files),
        "expected_count": unique_cpp_count,
        "surfaced_count": unique_cpp_count - len(missing),
        "missing": missing,
        "union_actual_keys": sorted(union_actual),
    }


# ---- pass 3: print + serialize ----

# Aggregate counters
all_uproperties_total = sum(len(v) for v in own_props.values())
print(f"\nTotal UPROPERTYs across ALL .h files: {all_uproperties_total}")
print(f"Audited leaf classes: {len(results)}")
print(f"Total unique-cpp-name properties expected across audited classes: {total_unique_expected}")
print(f"Total surfaced in JSON: {total_surfaced}")
print(f"Total MISSING (drilling down next): {total_unique_expected - total_surfaced}")

# Per-class missing
print("\n--- Per-class missing ---")
for cls, info in sorted(results.items()):
    if not info["missing"]:
        continue
    print(f"\n{cls}  ({info['folder']}, {info['asset_count']} assets)  -- {len(info['missing'])} missing")
    for cpp_name, cpp_type, f, source_cls, snakes in info["missing"]:
        print(f"   - {cpp_name} :: {cpp_type}   [from {source_cls}, {f.name}]   (snake: {snakes})")

# Save raw results JSON for the report writer
out_json = {
    "totals": {
        "uproperties_total_all_classes": all_uproperties_total,
        "audited_leaf_classes": len(results),
        "unique_expected_audited": total_unique_expected,
        "surfaced": total_surfaced,
        "missing": total_unique_expected - total_surfaced,
    },
    "per_class": {
        cls: {
            "folder": info["folder"],
            "asset_count": info["asset_count"],
            "expected_count": info["expected_count"],
            "surfaced_count": info["surfaced_count"],
            "missing": [
                {
                    "cpp_name": cpp_name,
                    "cpp_type": cpp_type,
                    "source_class": source_cls,
                    "source_file": str(f.relative_to(TSIC_ROOT)),
                    "snake_candidates": snakes,
                }
                for cpp_name, cpp_type, f, source_cls, snakes in info["missing"]
            ],
        }
        for cls, info in results.items()
    },
}
out_path = Path("C:/Users/Administrator/Documents/Projects/tsic-definition-editor/scripts/audit_results.json")
out_path.write_text(json.dumps(out_json, indent=2), encoding="utf-8")
print(f"\nWrote results to {out_path}")
