import type { AssetItem } from "./parse/assets";

export type SceneSpec = {
  /** e.g. `bg bedroom` or `black` */
  image: string;
  atList: string[];
  withTransition: string | null;
};

export type PlaySpec = {
  channel: "music" | "sound" | "ambient";
  audio: string;
  fadein: string | null;
};

export type MediaOption = {
  name: string;
  note: string | null;
};

/** Parse argument after `scene `. */
export function parseSceneArg(arg: string): SceneSpec | null {
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
  let image = rest;
  if (atIdx >= 0) {
    image = rest.slice(0, atIdx).trim();
    atList = rest
      .slice(atIdx)
      .replace(/^\s*at\s+/i, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (!image) return null;
  return { image, atList, withTransition };
}

/** Parse `music audio.bgm_x fadein 0.5` (after `play `). */
export function parsePlayArg(arg: string): PlaySpec | null {
  const m = arg
    .trim()
    .match(
      /^(music|sound|ambient)\s+(\S+)(?:\s+fadein\s+(\S+))?\s*$/i,
    );
  if (!m) {
    // allow trailing junk like comments already stripped
    const loose = arg
      .trim()
      .match(/^(music|sound|ambient)\s+(\S+)(.*)$/i);
    if (!loose) return null;
    const channel = loose[1].toLowerCase() as PlaySpec["channel"];
    const audio = loose[2];
    const fadeinM = loose[3].match(/fadein\s+(\S+)/i);
    return {
      channel,
      audio,
      fadein: fadeinM ? fadeinM[1] : null,
    };
  }
  return {
    channel: m[1].toLowerCase() as PlaySpec["channel"],
    audio: m[2],
    fadein: m[3] ?? null,
  };
}

export function formatSceneStatement(spec: SceneSpec): string {
  let s = `scene ${spec.image}`;
  if (spec.atList.length) s += ` at ${spec.atList.join(", ")}`;
  if (spec.withTransition) s += ` with ${spec.withTransition}`;
  return s;
}

export function formatPlayStatement(spec: PlaySpec): string {
  let s = `play ${spec.channel} ${spec.audio}`;
  if (spec.fadein) s += ` fadein ${spec.fadein}`;
  return s;
}

export function bgTransforms(all: string[]): string[] {
  return all.filter((n) => n.startsWith("bg_"));
}

export function buildBackgroundOptions(items: AssetItem[]): MediaOption[] {
  const out: MediaOption[] = [
    { name: "black", note: "纯黑" },
    { name: "white", note: "纯白" },
  ];
  const seen = new Set(["black", "white"]);
  for (const item of items) {
    if (item.kind !== "bg") continue;
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    out.push({ name: item.name, note: item.note });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function buildAudioOptions(
  items: AssetItem[],
  kind: "bgm" | "sfx" | "snd",
): MediaOption[] {
  return items
    .filter((i) => i.kind === kind)
    .map((i) => ({ name: i.name, note: i.note }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function defaultFadeins(): string[] {
  return ["0.3", "0.4", "0.5", "1.0", "2.0", "BGM_FADEIN"];
}
