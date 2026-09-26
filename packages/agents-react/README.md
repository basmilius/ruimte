# @ruimte/agents-react

The AI chat of Ruimte's client and what goes with it, for any React app that runs agent CLIs: the transport to whatever runs the chats and its words.

## The transport

A chat talks to its host through a `ChatTransport`: a typed request out of `AGENT_REQUEST_SCHEMAS` with its typed answer, the events of `AGENT_EVENT_SCHEMAS`, and the status of the link. `portTransport(port)` is one over a `FramePort` from `@ruimte/agent-contracts/port`, such as a `MessagePort` to a process that runs the chats.

## Rules

Nothing in `src` imports from an app or from `@ruimte/contracts`; the chat only knows the contracts of a chat host.
