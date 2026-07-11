export type MatchMode = "contains" | "exact" | "starts" | "ends" | "domain" | "regex";

export interface Matcher {
  mode: MatchMode;
  value: string;
}

export type HeaderOp = "set" | "remove";

export interface HeaderRule {
  id: string;
  enabled: boolean;
  op: HeaderOp;
  name: string;
  value?: string;
  matcher?: Matcher;
}

export interface Profile {
  id: string;
  name: string;
  enabled: boolean;
  matcher: Matcher;
  rules: HeaderRule[];
}

export interface Config {
  version: 1;
  masterEnabled: boolean;
  profiles: Profile[];
}

export const emptyConfig = (): Config => ({ version: 1, masterEnabled: true, profiles: [] });
