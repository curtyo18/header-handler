# Header Handler — Glossary

Canonical domain terms. Term → meaning only; no implementation detail.

- **Profile** — A named, independently-toggleable set of header rules sharing a default matcher. Multiple profiles may be active at once; the applied rule set is the union of all enabled profiles.
- **Header rule** — A single instruction to Set or Remove one request header. Belongs to a profile. May carry its own matcher that overrides the profile's for that rule only.
- **Set** — Header operation that adds the header if absent or overwrites it if present (add and overwrite are the same operation).
- **Remove** — Header operation that strips the named header from the request.
- **Matcher** — A URL-matching condition with a mode: Contains, Exact, Starts with, Ends with, Domain, or Custom regex. Decides which requests a profile or header rule applies to.
- **Master switch** — The global on/off that disables all header rewriting regardless of per-profile state.
- **Live log** — The side-panel view listing observed requests that matched any active rule, with the request headers seen for that request. Session-only, held in memory, never persisted.
- **Share string** — A compressed, version-tagged, URL-safe text encoding of either one profile or the whole config, produced by Export and consumed by Import.
- **Single-profile share** — A share string carrying exactly one profile.
- **Global share** — A share string carrying every profile (a backup/transfer of the full config).
- **Compiled rule** — A `chrome.declarativeNetRequest` dynamic rule generated from the config; the runtime artifact that actually rewrites headers.
- **Single-item config** — A config small enough to store as one `chrome.storage.sync` item (the pre-chunking layout, still used whenever it fits).
- **Config chunk** — One slice of the compressed config blob, stored as its own `chrome.storage.sync` item when the whole config exceeds a single item's quota.
- **Chunk manifest** — The `sync:config` item that, for a chunked config, records how many chunks compose it and a check value a reader validates for a complete, untorn read before reassembling.
