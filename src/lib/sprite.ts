import type { AssetItem } from "./parse/assets";

export type SpriteShowSpec = {
  tag: string;
  /** Expression attribute, null = default image */
  attr: string | null;
  atList: string[];
  withTransition: string | null;
};

export type SpriteHideSpec = {
  tag: string;
  withTransition: string | null;
};

export type SpriteTagInfo = {
  tag: string;
  /** Available expression attrs (not including default) */
  attrs: string[];
};

const COMMON_TRANSITIONS = [
  "dissolve",
  "dissolve_long",
  "fade",
  "pixellate",
];

/** Parse the argument of `show …` (everything after `show `). */
export function parseShowArg(arg: string): SpriteShowSpec | null {
  let rest = arg.trim();
  if (!rest) return null;

  let withTransition: string | null = null;
  const withIdx = rest.search(/\s+with\s+/i);
  if (withIdx >= 0) {
    withTransition =
      rest.slice(withIdx).replace(/^\s*with\s+/i, "").trim() || null;
    rest = rest.slice(0, withIdx).trim();
  }

  let atList: string[] = [];
  const atIdx = rest.search(/\s+at\s+/i);
  let head = rest;
  if (atIdx >= 0) {
    head = rest.slice(0, atIdx).trim();
    atList = rest
      .slice(atIdx)
      .replace(/^\s*at\s+/i, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const parts = head.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const tag = parts[0];
  const attr = parts.length > 1 ? parts.slice(1).join(" ") : null;
  return { tag, attr, atList, withTransition };
}

/** Parse the argument of `hide …`. */
export function parseHideArg(arg: string): SpriteHideSpec | null {
  let rest = arg.trim();
  if (!rest) return null;
  let withTransition: string | null = null;
  const withIdx = rest.search(/\s+with\s+/i);
  if (withIdx >= 0) {
    withTransition =
      rest.slice(withIdx).replace(/^\s*with\s+/i, "").trim() || null;
    rest = rest.slice(0, withIdx).trim();
  }
  const tag = rest.split(/\s+/)[0];
  if (!tag) return null;
  return { tag, withTransition };
}

export function formatShowStatement(spec: SpriteShowSpec): string {
  let s = `show ${spec.tag}`;
  if (spec.attr) s += ` ${spec.attr}`;
  if (spec.atList.length) s += ` at ${spec.atList.join(", ")}`;
  if (spec.withTransition) s += ` with ${spec.withTransition}`;
  return s;
}

export function formatHideStatement(spec: SpriteHideSpec): string {
  let s = `hide ${spec.tag}`;
  if (spec.withTransition) s += ` with ${spec.withTransition}`;
  return s;
}

export function spritePositionTransforms(all: string[]): string[] {
  return all.filter(
    (n) => n.startsWith("sprite_") || n === "shake" || n === "shake_hard",
  );
}

export function buildSpriteCatalog(items: AssetItem[]): SpriteTagInfo[] {
  const map = new Map<string, Set<string>>();
  for (const item of items) {
    if (item.kind !== "sprite") continue;
    if (item.name === "bg" || item.name.startsWith("bg ")) continue;
    const parts = item.name.split(/\s+/);
    const tag = parts[0];
    if (!/^[A-Za-z_][\w]*$/.test(tag)) continue;
    if (!map.has(tag)) map.set(tag, new Set());
    if (parts.length > 1) {
      map.get(tag)!.add(parts.slice(1).join(" "));
    }
  }
  return [...map.entries()]
    .map(([tag, attrs]) => ({
      tag,
      attrs: [...attrs].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

export function defaultTransitions(): string[] {
  return [...COMMON_TRANSITIONS];
}
