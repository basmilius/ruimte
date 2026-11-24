# Code hosts and issue trackers

The `host` area: the issues, changes and checks of a project, read through a provider an extension supplies with `defineHostProvider`. The panel, the wire shapes, the links and the agent tools are Ruimte's. An adapter for one host is an extension and never lives here. `docs/EXTENSIONS.md` ("Provider points") has the provider side.

## What is where

- `hosts.ts` (`Hosts`) knows which providers a project has and asks them. A provider with `match` is a code host, bound once per checkout of the project whose remote it takes (`git/host-checkouts.ts`, the seam `seams.git.hostCheckouts`). One without is a tracker, asked `status` for every project and left out where it answers `not-configured`. The list per project is kept until an extension changes or a client asks `host.status`.
- `packages/contracts/src/host.ts` holds the neutral shapes and the requests. `extension-hosts.ts` beside it reads what a provider answered into them, and `createTestServer` uses the same reads (`extensions/host-provider-test.ts`).
- `links.ts` (`HostLinks`) is a sidecar of the chat core: `$RUIMTE_HOME/chats/<chatId>.links.json`, with the chats of an issue as an index in memory.
- `watches.ts` (`HostWatches`) keeps who asked `host.watch` and tells them to read again.
- `text.ts` words an issue or a change for an agent and for the prompt of a chat started on an issue.
- The tools are `tools/host-tools.ts`, the toolkit `hosts` in `agent-features/host.ts`, shown through the audience `hosts` (`mcp/mcp-route.ts`).

## Rules the code does not show

- Nothing a provider answers is used as it came. `extension-hosts.ts` cuts every text to `HOST_LIMITS`, takes the line breaks out of a title or a name, drops an address that is not http(s), and makes the ref itself from the provider's id and the locator the provider gave, so a provider never names another provider's issue.
- A check is one of `pending`, `success`, `failure`, `neutral`, `skipped`. Any other word a provider says reads as `failure` (`hostCheckState`), and the state of a change is summed from its checks, never taken from the provider.
- Everything from a host reaches an agent quoted as data: a title, a name and a label as a JSON string, a body as lines that start with `| `, under `HOST_DATA_NOTE`. A new tool or wake that carries host text goes through `text.ts`.
- A ref names its provider by id alone. Two extensions that supply the same id: the first keeps it, and the second reads why in its log.
- A link holds the title and state of the issue as read when it was made. Nothing reads the host again for a link, on a clock or otherwise.
- A link is written by a person (`host.link`), by an agent for its own chat (`issue_link`), and when a chat reads the change of its own branch and that change closes the issue (`change_read` without a ref). An agent links no other chat.
- The change of a chat is found from the branch of the checkout its folder is in, against the code host bound to one of that checkout's remotes. Never from the project folder, and never from a tracker.
- Nothing here writes to a host and nothing asks a host on a clock. Both are still to build, see below.
- The tools are in no tier of an external MCP client (`mcp/external-tiers.ts`), by choice for version one.
- `trackers` in `.ruimte/project.json`, which the plan names for a tracker a project picks, is not written or read. A tracker says per project whether it applies.

## Still to build on this

- Writes are proposals a person confirms, on the pattern of `tunnels/tunnel-proposals.ts`: `host.proposals`, `host.proposalConfirm`, `host.proposalDecline`, and the tools `issue_propose` and `change_propose`. A provider gets them as optional members of `IssueCapability` and `ChangeCapability` in `packages/extension/server.d.ts`, each operation with a pre-check and an execute, and a new name in `HOST_PROVIDER_METHODS`. `hostProviderCall` in `extensions/server-api.ts` reaches any `<part>.<function>` without a change.
- The watch polls on the clock rule of `outbox/CLAUDE.md`, one poller per change. `HostWatches.watched()` says what a client looks at and `changed(projectId, ref)` tells them, so a panel and a chat's watch share one read. A cheaper read for the poller is another optional member of `ChangeCapability`.
- `checkHostProvider` (`extensions/host-provider-check.ts`, in `@ruimte/extension/testing`) is the set of rules every provider passes in its own tests. Trackline runs it in `extensions/dev/trackline/test/server.test.ts`. A real adapter runs it on recorded answers behind a fake command runner, and a rule for writes is added there.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- Links live on the machine with the chat, never in a project file.
- A new comment on a linked issue wakes no chat.
- Every write to a host is a card a person confirms.
