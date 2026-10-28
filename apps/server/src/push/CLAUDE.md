# Push to a phone

`apps/server/README.md` ("Push notifications") has the requests, kinds and read state.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- A push to a phone waits while a person is at a desktop (`service.ts`). Each client reports `presence.report` from the system's idle state: input in any app counts, a locked screen does not. A report lapses after a minute.
- A wait or an attention alert waits 60 seconds and an approval 10. Each goes out only if it is still unread or unanswered then.
- A finished turn or a process warning that came due while the person stayed goes nowhere.
- Once the person leaves, everything still held goes out at once.
- An alert someone asked for (`ruimte-context alert`) never waits.
