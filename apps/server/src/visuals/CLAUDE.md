# Visuals

`ruimte-context help visual` says how an agent shows, previews and measures a page.

- A render child (`render-child.ts`) runs its own Chrome on a throwaway profile, never the daemon's under `$RUIMTE_HOME/browser`.
- Its Chrome sends everything through a public-only SOCKS5 proxy (`socks-proxy.ts`) that refuses loopback, local networks and the machine's own addresses (`local-address.ts`) on the resolved address, and connects only to an address it checked. WebRTC is held to proxied UDP and QUIC is off.
- A page never loads from `file:`; it is served from memory as `https://visual.invalid/page.html` (`page-source.ts`), and the main frame stays there.
- At most two children run at once (`renderer.ts`), each with a hard limit, in its own process group, killed with its Chrome at the limit, when the daemon stops or when its stdin closes.
- The daemon never reads a path an agent names. The CLI embeds a page's local images in the agent's own process, only files whose bytes are an image (`apps/server/src/cli/visual-images.ts`).
- The daemon never serves a page inline; it goes out as a download with `nosniff`, shown only in a sandboxed frame.
- Every permission mode may show a visual.
- Sources and previews live in `$RUIMTE_HOME/chats/<chatId>.visuals/`. `visual write` writes only a validated filename in the caller's own chat folder. A clear or delete removes it (`VisualStore.removeChat`); a fork copies only published pages.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- Visual replies are on by default; a person turns them off per machine (`visualReplies` in `endpoint.json`). Off, an agent answers in text, and pages already in a thread still show.
