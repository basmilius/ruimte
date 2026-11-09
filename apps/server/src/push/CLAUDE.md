# Push to a phone

`apps/server/README.md` ("Push notifications") has the requests, kinds and read state.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- A push to a phone waits while a person is at a desktop (`service.ts`). Each client reports `presence.report` from the system's idle state: input in any app counts, a locked screen does not. A report lapses after a minute.
- A wait or an attention alert waits 60 seconds and an approval 10. Each goes out only if it is still unread or unanswered then.
- A finished turn or a process warning that came due while the person stayed goes nowhere.
- Once the person leaves, everything still held goes out at once.
- An alert someone asked for (`alert`) never waits.
- A device's quiet hours (`quietHours` on `push.subscribe`, off unless set) hold its alerts only. Agents, routines and wakes run as before, and the app and its counts still show the truth.
    - An alert someone asked for (`alert`) passes. A wait, an approval and an alert the daemon raised (a failed task, a wake given up, a usage limit) are held for that device alone, one per node and one per approval request, and a Live Activity push is skipped.
    - A finished turn and a process warning are dropped, as they are at a desk.
    - When the hours end, each held alert is looked at again as a held one is: a snoozed node, an answered approval, a wait that stopped and a limit that lifted stay silent. The rest goes out with a fresh expiry to that device only, and the machine's counts are sent again. There is no summary push.
    - The hold lives in memory and one timer waits for the soonest end while anything is held (`quiet-hold.ts`). A restart forgets what was held, and nothing is armed at the start of quiet hours. Time-sensitive only breaks through Focus, never through quiet hours.
- A chat that stops on a usage limit raises an attention alert, never a finished turn: it waits at a desk like any other and goes out under `needs-you`, once per limit of an account. It breaks through Focus (`timeSensitive`) unless the machine resumes the chat at the reset. An overload stays a finished turn, and a window a read sees at 100% or a terminal raises nothing of the kind. There is no second push when the limit lifts.
