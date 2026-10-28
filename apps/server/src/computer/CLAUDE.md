# Computer use

`apps/computer-use/README.md` has the helper and its commands (⌥Space pauses, ⌥⎋ stops; `cu` is a debugging CLI that does not ship).

- Every action needs the machine's switch on (`computer.setEnabled`), else `computer-use-off` and no helper start. Every request to the helper carries the local secret.
- Every action that reads or operates an app needs a person's yes for that bundle id, in every mode; only `apps` asks nobody. "This time" lasts until the agent's turn ends; "always" goes to `$RUIMTE_HOME/computer-use/grants.json`, which no verb writes. The helper gets the pid the person let in, never the agent's name for it. Only a person lists or revokes grants.
- A call waits for a card `APPROVAL_WAIT_MS` (6 s, under the 10 s some CLIs give a shell command), with `--wait` up to `MAX_HOLD_MS` (110 s), then refuses with `awaiting-approval`. A verb may run `CANVAS_REQUEST_TIMEOUT_S` (240 s). A card stays `CARD_MS` (ten minutes) after the last ask (`approvals.ts`).
- An app that runs shells refuses with `terminal` whatever was granted: a process up to three levels below it with a controlling terminal the app does not share, or a bundle id in `terminal-apps.ts`, remembered in `grants.json`. The Ruimte desktop app is never a terminal.
- One agent operates the Mac at a time (`presence.ts`), until its turn ends, its node closes or it exits. Others get `busy`, or queue with `--wait`.
- Work stays behind the person's unless `--front`; what needs the front refuses with `needs-front` and is never retried in front.
- A pause or take-over makes calls wait within the same budget, then refuse with `paused` or `taken-over`. A cut-off action is never resent. A stop tells every agent that used computer use `stopped` once, drops every this-time grant, and then clears.
- The tree an agent last saw lives in the daemon (`tree-diff.ts`) and goes with the node or when computer use is turned off.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- Computer use is the desktop's own door, off per machine until a person turns it on. Then `ruimte-context computer` operates any app, Ruimte included, only after a person let the agent into that app (this time or always, in every mode), and never a terminal.
- Letting an agent into Ruimte itself is the person's own risk. It can do there whatever the person can, and the daemon refuses nothing extra from the Ruimte window meanwhile.
- Computer use stays as it is and gains no new abilities; Bas hopes to remove it once the agents' own computer use is good enough (2026-10-13).
