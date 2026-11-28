# Launches

The tools: `apps/server/src/tools/launch-tools.ts`.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- A launch is, with a routine, an exception to the rule that no tool starts a command. `launch_control` starts, restarts and stops only a launch a person on this machine approved for its command, folder and environment as they stand now (`agent-host.ts`). Anything else refuses with `launch-held`, and the chip asks the person.
- After a worktree chat settles, the daemon starts the one task a person chose for the project, as that choice approved it for its worktrees. It runs in that chat's worktree, once per settled turn, through the outbox (`run-after-settle`, `after-settle.ts`). The chat gets notes and no wake.
- An agent's stop is Ctrl+C, then SIGTERM. SIGKILL is only a person's Force stop (`runner.ts`).
- A launch a source of an extension lists (`defineLaunchSource`, `sources.ts`) is held like a launch of a project file, through the same approvals under `$RUIMTE_HOME`. Its approval covers the command, the folder, the variables and the fingerprint the source gave of what it read, so a changed fingerprint asks again though the command stayed. A person approves one launch (`launch.start` with `approve`) or everything a source lists in the project as it stands (`launches.approveSource`); an external MCP client whose credential has the approvals box on approves one, as for any launch. No extension call, agent tool or action open to the `extension` actor approves. The source only describes: the runner starts the launch, reads the source again before every start, and nothing of it is written to a project file, so it is gone once its source stops listing it. It never runs after a chat settles.
- An extension adds and edits a launch with `launches.write` (`launch.create`, `launch.edit`) under an agent's rules: `saveByAgent`, never the shared file, never an approval. `launch.save` stays a person's.
- An agent adds and edits a launch (`launch_new`, `launch_edit`) and never approves one. `LaunchStore.saveByAgent` runs a person's checks (`problemIn`), keeps the rev and unreadable entries, and approves nothing, so the launch waits on a person. An edited launch stays in its file with its overlay; a new one goes in the private file unless it asks for the shared one. A variable holding a secret stays the person's (`secret-variable`), and an agent's save never drops a secret.
