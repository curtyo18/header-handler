import LZString from "lz-string";
import type { Profile, Config } from "../types";

const PREFIX = "HH";
const VERSION = "1";

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
  if (kind === "p") return { kind: "p", profile: parsed as Profile };
  if (kind === "g") return { kind: "g", profiles: (parsed.profiles ?? []) as Profile[] };
  throw new Error("Unknown share kind");
}
