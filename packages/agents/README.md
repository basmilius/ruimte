# @ruimte/agents

The server side of Ruimte's AI chat: the Claude Code and Codex CLIs behind one backend seam, the thread they write into, the records and logs a chat is kept in, provider accounts, usage and plan limits, and a host that serves all of it over a port. Ruimte's daemon runs on it, and so can an app without a daemon.

It runs in Bun and in Node, Electron's utility process included. Nothing outside a test uses a Bun API, and nothing imports from an app; `src/boundary.test.ts` fails the run when either happens. The wire shapes come from `@ruimte/agent-contracts`.

Import per file: `@ruimte/agents/<path under src>`, without the extension.

## What is in it

- `chat/backend.ts`: the seam between a chat and one CLI. `chat/claude-backend.ts` and `chat/codex-backend.ts` speak Claude Code's stream-json and Codex's app-server protocol. `chat/chat-process.ts` starts a CLI through `node:child_process` in a process group of its own; a test passes a `SpawnChatProcess`, and `chat/fake-claude.ts` and `chat/fake-codex.ts` are CLIs that run in the test's own process.
- `chat/thread.ts` and `chat/projector.ts`: the thread a chat shows, built from what a backend reports.
- `chat/chat-session.ts`: one chat. A backend plus its thread, turns, queue, approvals and questions.
- `chat/chat-core.ts`: every chat of a host. Records and logs (`chat/chat-store.ts`, `chat/chat-log.ts`), `chat.attach` with `since`, `chat.status` to every client, attachments, bookmarks and subagent conversations.
- `providers/`: the CLIs a host offers (`registry.ts`), their model catalogs, and `accounts/`, the accounts a CLI runs under.
- `usage/`: the usage scanner over the CLIs' transcripts, prices, and `limits/`, what is left of each plan.
- `host/`: `AgentHost`, the request handlers, `cliEnvironment` and an in-memory port pair.
- `context/`: the registry behind a context CLI such as `ruimte-context`, the verbs an agent runs to act on its app. `context/argv.ts` splits the words, `context/verb.ts` defines verbs and nouns and renders `help` from them, `context/refusal.ts` writes and reads a refusal.

## A host of its own

A chat core knows nothing a host adds. A host adds it by extending `ChatCore` and overriding its protected methods, each of which does nothing on its own: `instructionsFor` (the note an agent gets at the start of every process), `promptNotesFor` (what goes in front of the next prompt), `referencesFor`, `envFor`, `admit`, `runtimeModeFor`, `opened`, `recordExtras`, `cleared`, `removed`, `broadcasted`, `endedAt` and `resumeWords`. Options of the core do the rest: `onInterruptedRun` and `limitResume` let a host take up a turn after a restart or a usage limit, and `checkpoints` shows what a turn changed. Ruimte's `ChatManager` in `apps/server/src/chat` is the example.

`AgentHost` is a plain core with the defaults. It answers every request in `AGENT_REQUEST_SCHEMAS` and sends the events in `AGENT_EVENT_SCHEMAS`, checking each frame with zod the way Ruimte's daemon checks a socket's. A request that needs a canvas (`chat.fork`, `chat.forkInfo`, `chat.summarize`, `chat.continueOn`) answers the code `chat-unsupported`. It takes:

- `dataDir`: where the chats, their attachments and bookmarks, the accounts and the usage index are kept;
- `env`: the environment the CLIs start in. `cliEnvironment(process.env)` drops the variables of a Ruimte terminal the app may have been started from, so its CLIs never post to that Ruimte;
- `systemNote`: what every agent is told, optional.

`close()` writes every thread and ends every CLI. On the next start a chat goes on through the CLI's own session id.

## Verbs of its own

An agent acts on its app through a CLI of that app, which sends the words after the verb to the app to parse. `createVerbRegistry<Call>({ cli })` makes the registry for one such CLI. `Call` is whatever a verb runs with, such as the caller and the host it reaches the app through; `cli` is the command an agent types, which every pointer to `help` names. Ruimte's registry is in `apps/server/src/canvas/verb.ts`, its table of verbs in `canvas/verbs.ts`.

```ts
import { z } from 'zod';
import { createVerbRegistry, requiredField, type VerbEntry } from '@ruimte/agents/context/verb';

interface Call {
    caller: string;
    expectedRevision?: number;
}

const { defineVerb, defineAction, defineNoun, defineHelp, dryRunLine } = createVerbRegistry<Call>({ cli: 'motion-context' });

const layerNew = defineAction('layer', {
    name: 'new',
    usage: '--title T',
    summary: 'Adds a layer to the composition',
    detail: ['flag\t--title T\trequired\tWhat the layer is called'],
    positionals: z.array(z.string()).max(0, 'layer new takes no arguments'),
    flags: z.object({ title: requiredField('layer new needs --title, what the layer is called') }),
    dryRun: true,
    revision: true,
    run: async ({ flags, dryRun }) => [dryRun ? 'dry-run' : `layer\t${flags.title}`]
});

const layer = defineNoun({ name: 'layer', summary: 'Adds and lists the layers', detail: [], actions: [layerNew] });

const help = defineHelp({
    entries: () => VERBS,
    root: () => [dryRunLine()],
    refusal: 'refusal\trefused<TAB><code><TAB><message> on stderr\texit 3 refused'
});

export const VERBS: readonly VerbEntry<Call>[] = [help, layer];
```

A verb stands on its own (`help`); a noun only names what its actions work on (`layer new`). Each takes its positionals and flags as zod schemas, and `help` renders from the same objects, so the two never drift. A flag the detail documents but the usage leaves out is added to the usage. `dryRun: true` adds `--dry-run`, which every other verb refuses by name; `revision: true` adds `--revision N`, which reaches `run` as `call.expectedRevision` for a write that must not land on a newer document.

A verb says no by throwing a `VerbRefusal` with a code, a sentence and the lines the agent can pick instead. `refusalBody` writes it as the CLI prints it, one row per line with tab-separated fields: `refused<TAB><code><TAB><message>`, then every line of advice under it. `field` takes a tab or a newline out of a value before it goes into a row, and `parseRefusalBody` reads a refusal back.

## Wiring it into an Electron app

The host runs in a `utilityProcess`, which dies with the app. The renderer gets one end of a `MessageChannelMain`, the host the other, and each end is wrapped as a `FramePort`.

The main process:

```ts
import { join } from 'node:path';
import { app, BrowserWindow, MessageChannelMain, utilityProcess } from 'electron';

const agents = utilityProcess.fork(join(__dirname, 'agents.js'), [], { serviceName: 'Agents' });
agents.postMessage({ type: 'open', dataDir: join(app.getPath('userData'), 'agents') });

export const connectAgents = (window: BrowserWindow): void => {
    const { port1, port2 } = new MessageChannelMain();
    agents.postMessage({ type: 'connect' }, [port1]);
    window.webContents.postMessage('agents:port', null, [port2]);
};

// The CLIs get their SIGTERM and the threads are written before the app goes.
let closed = false;
app.on('before-quit', (event) => {
    if (closed) {
        return;
    }
    event.preventDefault();
    agents.once('exit', () => {
        closed = true;
        app.quit();
    });
    agents.postMessage({ type: 'close' });
});
```

The utility process, `agents.ts`:

```ts
import type { FramePort } from '@ruimte/agent-contracts';
import { AgentHost } from '@ruimte/agents/host/agent-host';
import { cliEnvironment } from '@ruimte/agents/host/environment';
import type { MessagePortMain } from 'electron';

const asFramePort = (port: MessagePortMain): FramePort => ({
    send: (frame) => port.postMessage(frame),
    onFrame: (listener) => {
        const receive = (event: { data: unknown }): void => listener(event.data);
        port.on('message', receive);
        port.start();
        return () => port.off('message', receive);
    }
});

let host: Promise<AgentHost> | null = null;

process.parentPort.on('message', async ({ data, ports }) => {
    if (data.type === 'open') {
        host = AgentHost.open({
            dataDir: data.dataDir,
            env: cliEnvironment(process.env),
            systemNote: 'You work inside the motion editor. The project folder is the current directory.'
        });
    }
    if (data.type === 'connect' && host) {
        (await host).connect(asFramePort(ports[0]!));
    }
    if (data.type === 'close') {
        await (await host)?.close();
        process.exit(0);
    }
});
```

The preload hands the renderer its end, wrapped the same way over a DOM `MessagePort` (`port.onmessage`, `port.postMessage`). The client then sends the frames it sends a daemon: `{ id, type, payload }` in, `{ id, ok, result }` and `{ type: 'event', event, payload }` out.

The package ships TypeScript. Bundle the utility process with the rest of the app, or run it on Node's type stripping: the sources use only erasable syntax and import each other with `.ts` extensions.
