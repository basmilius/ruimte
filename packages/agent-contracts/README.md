# @ruimte/agent-contracts

The zod schemas a chat host and its client share: agents, models, provider accounts, the chat thread and its requests, usage, and the worktree an agent runs in. `AGENT_REQUEST_SCHEMAS` and `AGENT_EVENT_SCHEMAS` are the requests and events a chat host answers, in the same frames as Ruimte's wire (`{ id, type, payload }`, `{ id, ok, result }`, `{ type: 'event', event, payload }`).

Ruimte itself imports these through `@ruimte/contracts`, which places every entry in its own tables. The same rules hold as for the rest of the wire: a schema only gains optional fields, and never a new member of a chat item or an enum value in a chat payload, since the iPhone app validates those whole.
