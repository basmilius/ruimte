# Ruimte

Terminals, agents and browsers on one infinite canvas. Sessions survive restarts. Focus stays where you put it. The camera moves only when you move it.

https://ruimte.app

## Principles

- **One canvas, many kinds of things on it.** Terminal, chat, browser and group nodes, plus free text that is not a node.
- **Focus and camera are explicit state.** Canvas mode or node mode, never decided by where the pointer happens to be. Nothing in the background moves the view.
- **Server first.** There is always a backend that owns sessions and talks to the UI over WebSocket. The desktop app embeds it; a remote machine is another endpoint.
- **Opinionated.** A handful of settings in the UI. Everything else is a default.
- **Written from scratch.** Inspired by nodeterm and T3 Code, sharing ideas and open-source building blocks, never their code.

## Stack

React 19, TypeScript, Vite, Tailwind v4, Base UI, motion, zustand, lucide. Bun for tooling.

## Develop

```sh
bun install
bun dev
```

`bun run build` typechecks and builds. Phase 1 is a browser-only UI prototype; see the issues for the phases that follow.
