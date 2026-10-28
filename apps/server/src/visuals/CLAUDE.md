# Visuals

`ruimte-context help visual` says how an agent shows, previews and measures a page.

- A render child (`render-child.ts`, the daemon started again as `ruimte visual-render`) runs its own Chrome with a throwaway profile in a temporary folder, never the daemon's browser profile under `$RUIMTE_HOME/browser`, so an agent's page never sees a person's cookies, logins or history.
- Everything a child's Chrome sends goes through the child's public-only SOCKS5 proxy (`socks-proxy.ts`). It refuses loopback, local networks and every address a machine interface holds (`local-address.ts`), checked on the addresses a name resolves to, and connects only to an address it checked. WebRTC is held to proxied UDP and QUIC is off, since either would bypass it.
- A page never loads from `file:`. It is answered from memory as `https://visual.invalid/page.html` (`page-source.ts`), and the main frame stays there.
- Render children are bounded in number and time (`renderer.ts`): at most two at once, the rest queued, each with a hard limit, in its own process group, killed with its Chrome at the limit and when the daemon stops. A child ends with its browser once its stdin closes, so a dying daemon takes it along.
- The daemon never reads a path an agent names. The CLI embeds the local images a page names (`apps/server/src/cli/visual-images.ts`), in the agent's own process and inside its CLI's sandbox, and only files whose bytes are an image. Read through the daemon, a path would hand the agent what its sandbox withholds.
- A visual's page is never served inline on the daemon's origin. The attachment route and `bytes.read` hand it out as a download with `nosniff`, and a client shows it only in a sandboxed frame on an origin of its own.
- An agent in every permission mode may show a visual, since it touches only its own thread.
- Source files and preview PNGs live in `$RUIMTE_HOME/chats/<chatId>.visuals/`, outside the project. `visual write --name chart.html` takes HTML on stdin and writes only a validated filename in the caller's own chat folder. It works in every permission mode without granting writes to the rest of the machine's home. Clearing or deleting the chat removes this folder (`VisualStore.removeChat`); a fork copies published pages, not working sources or previews.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- Visual replies are on by default; a person turns them off per machine (`visualReplies` in `endpoint.json`). Off, an agent answers in text, and pages already in a thread still show.
