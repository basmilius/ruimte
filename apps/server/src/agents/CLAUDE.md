# Agent status and the CLIs' settings

The invariants of this folder. The repository root's `CLAUDE.md` has the map, the wire protocol and the rules that hold everywhere, including that agent status comes only from the CLIs' hooks; `apps/server/README.md` ("Agent status via hooks") has the hooks.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- The daemon writes into a CLI's global settings (the status hooks in `~/.claude/settings.json`, `~/.codex/hooks.json`, `~/.grok/hooks/ruimte.json`, `~/.copilot/hooks/ruimte.json` and `~/.gemini/config/hooks.json`, the Codex and Antigravity rules for `ruimte-context`, and the same in every account folder) only for a provider a person on this machine allowed. The choice is per provider, kept in `$RUIMTE_HOME/agent-integrations.json`, and changed only through the local secret (`integrations.ts`).
- A fresh home writes nothing until then; a home that already had Ruimte's hooks counts as allowed and asks once.
- Without them a terminal of that CLI shows no status and never asks for attention, and Codex cannot run `ruimte-context` outside its sandbox; a chat keeps its status from stream-json.
- Turning one off removes only Ruimte's own entries that are unchanged and says per file what happened. `--no-hooks` writes and removes nothing.
