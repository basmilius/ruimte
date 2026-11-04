# Launches

The tools: `apps/server/src/tools/launch-tools.ts`.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- A launch is, with a routine, an exception to the rule that no tool starts a command. `launch_control` starts, restarts and stops only a launch a person on this machine approved for its command, folder and environment as they stand now (`agent-host.ts`). Anything else refuses with `launch-held`, and the chip asks the person.
- After a worktree chat settles, the daemon starts the one task a person chose for the project, as that choice approved it for its worktrees. It runs in that chat's worktree, once per settled turn, through the outbox (`run-after-settle`, `after-settle.ts`). The chat gets notes and no wake.
- An agent's stop is Ctrl+C, then SIGTERM. SIGKILL is only a person's Force stop (`runner.ts`).
- An agent adds and edits a launch (`launch_new`, `launch_edit`) and never approves one. `LaunchStore.saveByAgent` runs a person's checks (`problemIn`), keeps the rev and unreadable entries, and approves nothing, so the launch waits on a person. An edited launch stays in its file with its overlay; a new one goes in the private file unless it asks for the shared one. A variable holding a secret stays the person's (`secret-variable`), and an agent's save never drops a secret.
