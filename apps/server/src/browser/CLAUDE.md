# Browser nodes

The page in the desktop app: `apps/client/src/browser/CLAUDE.md`. The tools: `apps/server/src/tools/browser-tools.ts`.

- A browser node's page lives where it is shown: a `<webview>` in the desktop client, or a page on the daemon for a client without a browser. The daemon reaches the first only while that client holds it (`browser.hold`, `browser.drive`) and drives both through `drive.ts`. Nobody holding the page is an answer, never an error.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- A development port reaches another client of the account only through a grant (`apps/server/src/ports`): one project, one literal loopback address (`127.0.0.1` or `::1`, never a hostname, and never the other family after a failure) and one port. A grant is stored under `$RUIMTE_HOME/ports` until a person revokes it and survives a restart. Discovery (`browser.devServers`), a launch's port and a URL in a project file grant nothing, and a grant never names a port Ruimte listens on.
- Only the local secret shares and revokes a port. An agent shares with `port_share` only while the machine's `agentsSharePorts` is on (off by default, read at every call, and set only on the local secret like `worktreeRoot`) and only for a port that answers HTTP or that a launch of the project uses, never for whatever else listens on loopback, and stops only a share an agent made. A peer machine gets no `port.*` request; any other client of the account, the station included, may open a stream to a grant.
- The first release carries HTTP and WebSocket on the granted port, as credited streams over the direct channel and never over the broker or the door on the local network. A page of a shared port reaches nothing else: an address outside it is refused with a message and never opened on the client's own network, and an asset from another origin is refused and counted on the node.
- A grant makes no Tunnels hostname and a hostname makes no grant (`apps/server/src/tunnels`). The hostname is the way to a browser outside Ruimte.
- A browser node is driven only over a line to the agent, and only by address: where the page goes, its history and a picture of it (the `browser_*` tools), never a click, keystroke or scroll. The one exception to the line is a chat view, which drives any browser node of the canvas it names with `--view` (`src/tools/chat-view.ts`).
