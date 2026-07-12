import LZString from "lz-string";
import type { Matcher, Profile, HeaderRule, Config } from "../types";
import { isMatchMode } from "./matcher";

const PREFIX = "HH";
const VERSION = "1";

// decodeShare parses arbitrary pasted input, so nothing about its shape can be
// trusted. Validate before returning: an unknown matcher mode compiles to a
// match-all condition (global header injection), and a missing `rules`/`matcher`
// throws deep in compileRules where it permanently wedges recompiles.
function isMatcher(m: unknown): m is Matcher {
  return !!m && typeof m === "object"
    && isMatchMode((m as { mode: unknown }).mode)
    && typeof (m as { value: unknown }).value === "string";
}

function validateRule(r: unknown): HeaderRule {
  if (!r || typeof r !== "object") throw new Error("Share string has a malformed header rule");
  const o = r as Record<string, unknown>;
  if (typeof o.name !== "string") throw new Error("A header rule is missing its name");
  if (o.op !== "set" && o.op !== "remove") throw new Error("A header rule has an invalid operation");
  if (o.value != null && typeof o.value !== "string") throw new Error("A header rule has an invalid value");
  if (o.matcher != null && !isMatcher(o.matcher)) throw new Error("A header rule has an invalid override matcher");
  return o as unknown as HeaderRule;
}

function validateProfile(p: unknown): Profile {
  if (!p || typeof p !== "object") throw new Error("Share string has a malformed profile");
  const o = p as Record<string, unknown>;
  if (typeof o.name !== "string") throw new Error("A profile is missing its name");
  if (!isMatcher(o.matcher)) throw new Error("A profile is missing a valid URL matcher");
  if (!Array.isArray(o.rules)) throw new Error("A profile is missing its rules list");
  o.rules.forEach(validateRule);
  return o as unknown as Profile;
}

type EncodeInput =
  | { kind: "p"; profile: Profile }
  | { kind: "g"; config: Config };

type DecodeOutput =
  | { kind: "p"; profile: Profile }
  | { kind: "g"; profiles: Profile[] };

const stripProfile = (p: Profile): Profile => ({
  ...p, id: "",
  rules: p.rules.map((r) => ({ ...r, id: "" })),
});

export function encodeShare(input: EncodeInput): string {
  const payload = input.kind === "p"
    ? stripProfile(input.profile)
    : { profiles: input.config.profiles.map(stripProfile) };
  const body = LZString.compressToEncodedURIComponent(JSON.stringify(payload));
  return PREFIX + VERSION + input.kind + body;
}

export function decodeShare(s: string): DecodeOutput {
  if (!s.startsWith(PREFIX)) throw new Error("Unrecognized share format");
  const version = s[2];
  if (version !== VERSION) throw new Error(`Unsupported share version: ${version}`);
  const kind = s[3];
  const body = s.slice(4);
  const json = LZString.decompressFromEncodedURIComponent(body);
  if (!json) throw new Error("Corrupt share string");
  const parsed = JSON.parse(json);
  if (kind === "p") return { kind: "p", profile: validateProfile(parsed) };
  if (kind === "g") {
    const list = (parsed as { profiles?: unknown }).profiles;
    if (!Array.isArray(list)) throw new Error("Bundle share string has no profiles list");
    return { kind: "g", profiles: list.map(validateProfile) };
  }
  throw new Error("Unknown share kind");
}
