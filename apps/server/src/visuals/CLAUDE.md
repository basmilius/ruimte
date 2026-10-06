# Visuals

The invariants of this folder. The repository root's `CLAUDE.md` has the map, the wire protocol and the rules that hold everywhere; `apps/server/README.md` (`visual` under the canvas verbs) has the whole of how a page is shown, previewed and measured.

- A render child (`render-child.ts`, the daemon started again as `ruimte visual-render`) runs a Chrome of its own with a throwaway profile in a temporary folder, never the daemon's browser profile under `$RUIMTE_HOME/browser`, so a page an agent wrote never sees a person's cookies, logins or history.
- Everything a child's Chrome sends goes through the child's public-only SOCKS5 proxy (`socks-proxy.ts`). Loopback, local networks and every address an interface of the machine holds are refused (`local-address.ts`), checked on the addresses a name resolves to, and the proxy connects only to an address it checked. WebRTC is held to proxied UDP and QUIC is off, since either would go around it.
- A page never loads from `file:`: it is answered from memory as `https://visual.invalid/page.html` (`page-source.ts`), and the main frame stays there.
- Render children are bounded in number and time (`renderer.ts`): at most two at once and the rest in line, each with a hard limit, in a process group of its own that is killed with its Chrome at the limit and when the daemon stops. A child ends with its browser once its stdin closes, so a daemon that dies takes it along.
- The daemon never reads a path an agent names. The CLI embeds the local images a page names (`apps/server/src/cli/visual-images.ts`), in the agent's own process and inside whatever sandbox its CLI gives it, and only a file whose bytes are an image; read through the daemon, a path would hand the agent what its own sandbox withholds.
- A visual's page is never served inline on the daemon's origin: the attachment route and `bytes.read` hand it out as a download with `nosniff`, and a client shows it only in a sandboxed frame on an origin of its own.
- An agent in every permission mode may show a visual, since it touches nothing but its own thread. A person turns visual replies off per machine (`visualReplies`).
