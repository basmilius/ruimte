# Peering (this machine as the one that is worked in)

"A" is the machine whose person works elsewhere; "B" is this one.

## Links and admission

- Nothing is granted without a link a person made on B (`links.ts`, `$RUIMTE_HOME/peers/<machineIdA>.json`): one project of B per machine A and a mode ceiling, `supervised` until a person chooses. Only a client acting as a person changes it (`peer.bind`, `peer.setCeiling`, `peer.unbind`).
- A peer gets in on a statement the address book signed for it (`checkPeerStatement`, ten minutes, its own signing prefix). Its `auth.json` record has `origin: 'peer'`, never `statement`. A peer gets no ticket and subscribes to no event.
- A peer is vouched for 30 days after its last statement (`PEER_ATTESTATION_TTL_MS`); after that a new statement brings it back with its links. A's window renews it silently while a person uses the link (`apps/client/src/project/peer-renewal.ts`). A forgets its peer key, known machines and statements when it leaves its account.
- Unlinking ends that machine's nodes here and removes the canvas and the link. Revoking its session puts its peer key on the revoked keys, which no later statement undoes.

## What a peer may ask

- A peer is never an owner. Its whole list: `endpoint.info`, `server.ping`, `peer.taskStart`, `peer.taskStop`, `peer.result`, `peer.bundlePut`, `peer.bundleRead`, `peer.close` (`handlers/peer-tasks.ts`) and `peer.artifactList`, `peer.artifactGet`, `peer.artifactRead` (`handlers/peer-artifacts.ts`). No `fs.*`, `bytes.read`, `session.*`, `chat.*`, `launch.*`, `project.*`, `device.*`, `browser.*`, `database.*`, `computer.*` or `auth.ticket`.
- The dispatcher (`apps/server/src/dispatcher.ts`) refuses a peer everything outside `{ peer: true }` as `forbidden` before parsing, and `register` throws on `owner` with `peer`. Add a request only after asking what a lying machine could do with it. `endpoint.info` names only the peer requests.
- Every `peer.*` request starts with `requirePeerLinks` (`peer-not-linked`).
- The artifact requests read only the Output of the linked project (another project's is `not-found`), read-only, in pieces of at most `PEER_ARTIFACT_PIECE_BYTES` (256 KiB). Nothing here writes on a peer's word.
- Another machine's answers are read with the request's schema (`remote/peer-reply.ts`), and a result text is cut to `MAX_RESULT_LENGTH`.

## Tasks a peer gives

- The folder, mode and depth are B's: the linked project, `--cwd` inside it or its worktrees (`startCwdGuard` at every start), the narrowest of A's mode, A's ceiling and the link's ceiling, and depth `max(1, depth A gives)`, refused above B's maximum.
- Everything a peer starts runs as `actor: 'agent'` with B's own `start-agent` entry and lineage (`openedBy` = `peer:<A>:<parentNodeId>`). A launch there stays held until a person approves it through B. Worktrees go under B's worktree folder.
- A peer drives no device (`peer-no-device`), and `peer.placeNodes` drops any line to a device or a task node.
- A's nodes sit on one hidden, private canvas per machine A (`peerCanvasId`) with A's node ids. Hiddenness is laid over the document (`withHiddenCanvases`), never written, and a hidden canvas cannot be shared. A's window manages only the ids it placed with `peer.placeNodes`, never a task node or one a person placed, and `peer.taskStart` takes over only a node that window placed or a new one. Where a task runs is recorded beside it, never in the project file.
- A peer task's parent is the hidden canvas. `wake-parent` skips it, and its lineage carries `peer`, so end-children does not take its opener for a deleted one. Its result is owed in `deliver-remote-result` until A acknowledges (`peer.result { ack: true }`). A hears `peer.taskSettled` and asks again on reconnect, so nothing here runs on a clock.
- Limits per machine: `PEER_MAX_OPEN_TASKS` (4), the fifth `peer-busy` so A waits rather than fails; `PEER_MAX_BUNDLES` (2) and `PEER_MAX_BUNDLE_BYTES` (512 MiB), finished ones included, with `PEER_MAX_RESULT_BUNDLES` for results; `PEER_MAX_WORKTREES` (8), which a person removes and nothing here does; branch names up to `PEER_MAX_BRANCH_LENGTH` (100, `branch-too-long`).
- Only the daemon starts a peer task's chat: `chat.create` refuses (`peer-task-starting`) while its `start-agent` is owed.
- A task holds its project under the channel that started it, until the machine's last open task settles, the channel closes or `peer.close`.
- Every end of a peer task A did not ask for is told with `peer.taskSettled`; a task A stopped itself (`peer.taskStop`) is not.

## Bundles and untrusted folders

- A bundle from A is data. It passes `git bundle verify`, only its one `refs/ruimte/handoff/*` ref is fetched (into `refs/ruimte/received/<id>`, deleted once used), and hooks stay off in every following git call. Nothing a bundle carries moves a branch a person has checked out.
- Each peer has its own bundle store under `bundles/peers`. A result bundle goes only to the machine whose task it came from and is removed once read to its last byte.
- A folder from another machine, either way, is untrusted and recorded before git makes it, and so is any worktree cut from a branch such work arrived on.
- A person's own handoff (`git.bundle` there, `git.fetchBundle` with `into: 'worktree'` here) and a worktree it starts here from origin are trusted. What the sending machine never vouched for stays untrusted (`untrusted` on the bundle, which can only narrow), and so does anything cut from a foreign tip. Work brought back home keeps its `refs/remotes/ruimte-*` mark and stays untrusted whoever asked. Origin is outside these records.
- `UntrustedFolders` (`untrusted.ts`) covers a node that machine gave a task, one an untrusted node opened (through `openedBy` and forks), and any node whose cwd lies in a folder from that machine's work (`$RUIMTE_HOME/peer-worktrees`, which outlives the link). Such a node loads no project configuration (`projectConfigFor`) and never runs the after-settle task.
- `peer.taskStart`, and `agent` or `team` from an untrusted node or into an untrusted `--cwd`, refuse a provider without `ignoresProjectConfig: true` and a terminal agent (`untrusted-folder`), before any task or worktree exists.
- A one-shot CLI run (commit message, conflict help, a Codex chat title) in such a folder works in `$RUIMTE_HOME/oneshot` (`one-shot-place.ts`), since a CLI loads the hooks of the folder it starts in. The prompt carries everything those runs read, and none lets the CLI read files itself.
