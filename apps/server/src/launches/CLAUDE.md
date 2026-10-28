# Launches

The verb: `apps/server/src/canvas/launch-verb.ts`.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- A launch is, with a routine (`apps/server/src/routines`), an exception to the rule that no verb starts a command. `ruimte-context launches` lists and reads them. It starts, restarts and stops only a launch a person on this machine approved for its command, folder and environment as they stand now (`agent-host.ts`). Anything else refuses with `launch-held`, and the chip asks the person.
- After a worktree chat settles the daemon starts one launch by itself: the one task a person chose for the project, which that choice approved for its worktrees as its command and environment stand then. It runs in that chat's worktree, once per settled turn, through the outbox (`run-after-settle`, `after-settle.ts`). The chat gets notes and no wake.
- An agent's stop is Ctrl+C, then SIGTERM. SIGKILL is only a person's Force stop (`runner.ts`).
- An agent adds and edits a launch through `ruimte-context launches new` and `launches edit`, and never approves one. Its save is `LaunchStore.saveByAgent`: the same checks as a person's (`problemIn`), keeping the rev and the entries this release cannot read, with no approval, so the launch is held until a person approves it as it stands. An edited launch stays in its file with its overlay; a new one goes in the private file unless it asks for the shared one. A variable holding a secret stays the person's (`secret-variable`), and an agent's save never drops a secret.
