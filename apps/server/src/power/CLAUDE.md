# Keep awake

`apps/server/README.md` ("With the lid closed") has the sudoers rule.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- Keep awake with the lid closed turns sleep off (`pmset -a disablesleep 1`) only through a sudoers rule a person installed for exactly the two pmset commands, never with root in the daemon. Only the local secret installs or removes it (`closed-lid.ts`).
- It holds only while keep awake holds, on the adapter or on battery from 20% up, following the power source through `pmset -g pslog`, never a clock.
- Sleep goes back on when it lets go, when the daemon stops, through a watchdog when the daemon dies, and at the next start when this home's marker says it was left off.
