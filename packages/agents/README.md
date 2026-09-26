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
- `host/`: `AgentHost`, `wireAgents` (the chats with the providers, accounts and usage around them, which `AgentHost` serves over a port), the request handlers, `cliEnvironment` and an in-memory port pair.
- `context/`: the registry behind a context CLI such as `ruimte-context`, the verbs an agent runs to act on its app. `context/argv.ts` splits the words, `context/verb.ts` defines verbs and nouns and renders `help` from them, `context/refusal.ts` writes and reads a refusal.
- `outbox/`: work a host owes that has to outlive the process, such as starting an agent a verb opened, and the worker that does it. `lineage.ts` keeps who opened whom and how deep, `modes.ts` the order of the runtime modes and the ceiling an opener hands down.
- `tasks/`: what one chat asks of another, the coordinator that settles it from what the child does, and the wake, the limit on background commands and the note about a waiting child that the outbox owes for it.

## A host of its own

A chat core knows nothing a host adds. A host adds it by extending `ChatCore` and overriding its protected methods, each of which does nothing on its own: `instructionsFor` (the note an agent gets at the start of every process), `promptNotesFor` (what goes in front of the next prompt), `referencesFor`, `envFor`, `admit`, `runtimeModeFor`, `opened`, `recordExtras`, `cleared`, `removed`, `broadcasted`, `endedAt` and `resumeWords`. Options of the core do the rest: `onInterruptedRun` and `limitResume` let a host take up a turn after a restart or a usage limit, and `checkpoints` shows what a turn changed. Ruimte's `ChatManager` in `apps/server/src/chat` is the example.

`AgentHost` answers every request in `AGENT_REQUEST_SCHEMAS` over a `FramePort` and sends the events in `AGENT_EVENT_SCHEMAS`, checking each frame with zod the way Ruimte's daemon checks a socket's. A request that needs a canvas (`chat.fork`, `chat.forkInfo`, `chat.summarize`, `chat.continueOn`) answers the code `chat-unsupported`. It takes:

- `dataDir`: where the chats, their attachments and bookmarks, the accounts and the usage index are kept;
- `env`: the environment the CLIs start in. `cliEnvironment(process.env)` drops the variables of a Ruimte terminal the app may have been started from, so its CLIs never post to that Ruimte;
- `systemNote`: what every agent is told, optional;
- `claude`: the options of the Claude backend, such as `allowedTools` for the app's own context CLI;
- `codexRules`: the same for Codex, `{ app, commands }`. Its sandbox in `workspace-write` blocks every socket, loopback included, so a context CLI would stop on an approval each call. The host writes `<app>.rules` into the `rules` folder of the Codex home and of every Codex account, allowing only the named commands out of the sandbox, never the network as a whole (`providers/codex-rules.ts`);
- `core`: the app's own core. It gets the `ChatCoreOptions` a plain core would get, since the core needs the providers and accounts the host builds first, and adds its own to them. Without it the host runs a plain `ChatCore`, and `host.chats` has the type the factory returns.

```ts
class MotionChats extends ChatCore {
    protected override instructionsFor(chatId: string): string | null {
        return rolePromptOf(chatId);
    }
}

const host = await AgentHost.open({ dataDir, core: (options) => new MotionChats({ ...options, ...motionOptions }) });
```

`close()` writes every thread and ends every CLI. On the next start a chat goes on through the CLI's own session id.

An app that answers requests on a wire of its own, beside requests of its own, calls `wireAgents` (`host/wiring.ts`) instead. It takes the same options except `background` and builds the same pieces: `providers`, `accounts`, `limits`, `usage`, `chats` and the `handlers` of every agent request, which take a payload and a client id. `connect(clientId, send)` sends one client its events until the returned function lets it go, `start()` runs the clocks of the accounts and the limits, and `stop()` ends them and every CLI. The app reads the accounts with `accounts.load()` before the first request. `AgentHost` is this wiring behind a port.

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

## Agents that open agents

A chat that starts others owes work it cannot do inside the verb: the start itself, a wake once a child is done. `OutboxStore` keeps that work, one file per entry under `<dataDir>/outbox`, until it is done, and `OutboxWorker` works it off. The host hands in its own kinds as a zod discriminated union on `kind`, each with a `payload`, and gets back a store and a worker typed by them:

```ts
import { z } from 'zod';
import { OutboxStore } from '@ruimte/agents/outbox/outbox';
import { OutboxWorker } from '@ruimte/agents/outbox/outbox-worker';

const WorkSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('start-chat'), payload: z.object({ prompt: z.string() }) }),
    z.object({ kind: z.literal('end-children'), payload: z.object({ chatIds: z.array(z.string()) }) })
]);

const store = new OutboxStore({
    dataDir,
    work: WorkSchema,
    lanesOf: (entry) => (entry.kind === 'end-children' ? [entry.target, ...entry.payload.chatIds] : [entry.target]),
    outlivesTarget: (entry) => entry.kind === 'end-children'
});
await store.load();

const worker = new OutboxWorker({
    store,
    handlers: {
        'start-chat': async (entry) => startChat(entry.target, entry.payload.prompt),
        'end-children': async (entry) => endChats(entry.payload.chatIds)
    }
});
worker.start();
await worker.enqueue(projectId, chatId, { kind: 'start-chat', payload: { prompt } });
```

Every entry has a `target`, the node or chat it is about. Entries for one target run one at a time and oldest first, while other targets do not wait; `lanesOf` names more nodes an entry holds, and `outlivesTarget` keeps an entry that `prune` would otherwise drop with its target. A handler must be idempotent, since a restart between the work and the removal of its file runs it again. A handler that throws is tried again after 1, 5 and 30 seconds and then given up on (`onParked`); one that answers `'wait'` keeps its entry without an attempt until `wake(target)` names its target. `enqueue` with a `notBefore` owes work at a time, which holds no lane until then. The clock is a seam: a test passes `ManualClock` (`outbox/manual-clock.ts`) and moves it by hand.

`AgentLineageStore` writes down, under `<dataDir>/lineage`, which node opened which, how deep it sits and the widest mode it may run in: outside the project, so an agent with a shell cannot reset its own depth, and on disk, so a restart does not either. `ceilingForOpening(openerMode, requested)` in `modes.ts` refuses a `--mode` wider than the opener's own with a `VerbRefusal`, `narrowerMode` clamps a mode to a ceiling, and `modeFlag` is the flag's schema. Ruimte binds the store to its kinds in `apps/server/src/outbox/outbox.ts`.

### Tasks

A chat can give another chat a task and sleep until it is done. `wireTasks` in `tasks/wiring.ts` keeps the rules Ruimte keeps: a task settles on the child's last answer, or on `done`, and never while its CLI still runs a background subagent or workflow. A command left running in the background holds it for at most 30 minutes, through a `background-limit` entry, and a restart fails a task that only such commands held. A settled task wakes its parent once, as soon as the parent has no turn running, and the tasks of one batch wake it together. A child that waits on a question or an approval leaves its parent a note after 15 seconds and does not wake it.

The host implements:

- `chats`: `TaskChats`, a `Pick` of `ChatCore` (`get`, `observe`, `hasStored`, `create`, `answer`, `deliverNote`). Hand in the host's own core.
- `outbox`: `TaskOutbox`, with `list`, `enqueue`, `remove` and `wake` over the host's `OutboxStore` and `OutboxWorker`. The outbox's union takes the four task kinds from `tasks/task-work.ts` beside the host's own.
- `placed(nodeId)`: whether the node still exists. A child that went is cancelled by `prune`, never failed.
- `titleFor(nodeId)`, and `alert(nodeId, title, body)` for a task that failed.
- `words`: `app` and `cli`, which the note about a waiting child names. It tells the parent to run `<cli> answer <child> <request> --answer A` (or `--answers JSON`). `assignment(task)` is what a running chat is sent with a task given to it, and `restOf(childId)` says where the rest of a result cut at 8 KiB is read.
- `changed(task)`, optional: told of every task written, from inside a chat's broadcast, so it only notes. Ruimte draws the task's row in the parent from it.

The host gets:

- `verbs`, the `TaskVerbs` its CLI's verbs call: `open` (also with a `batchId`), `give` for a chat that already runs, `chatState`, `done` and `involving`. The verbs themselves, and what they print, are the host's.
- `handlers` for the four kinds, to spread into the worker's handlers, `onParked` for the worker, and `prune(projectId, ids)` for nodes that went.
- `requests`, which is what an `answer` verb reaches, and `coordinator`. `coordinator.agentEnded(childId, text)` fails the task of an agent that is not a chat, and `coordinator.startFailed(childId, error)` fails one whose agent never started. A host with only chats needs neither.

`TaskStore` keeps one file per task under `<dataDir>/tasks`, and `subscribe` sends every client `task.changed`. Load it and the outbox, then call `restartBackgroundLimits(outbox, now)` before the worker starts.

```ts
import { OutboxWorker } from '@ruimte/agents/outbox/outbox-worker';
import { restartBackgroundLimits } from '@ruimte/agents/tasks/background-limit';
import { TaskStore } from '@ruimte/agents/tasks/task-store';
import { BackgroundLimitWorkSchema, DeliverWaitingWorkSchema, GiveTaskWorkSchema, WakeParentWorkSchema } from '@ruimte/agents/tasks/task-work';
import { wireTasks } from '@ruimte/agents/tasks/wiring';

const WorkSchema = z.discriminatedUnion('kind', [StartChatSchema, BackgroundLimitWorkSchema, WakeParentWorkSchema, GiveTaskWorkSchema, DeliverWaitingWorkSchema]);
const outbox = new OutboxStore({ dataDir, work: WorkSchema });
await outbox.load();
await restartBackgroundLimits(outbox, Date.now());
const tasks = new TaskStore(dataDir);
await tasks.load();

let worker: OutboxWorker<z.infer<typeof WorkSchema>>;
const wiring = wireTasks({
    tasks,
    chats: core,
    outbox: {
        list: () => outbox.list(),
        enqueue: (projectId, target, work, notBefore) => worker.enqueue(projectId, target, work, notBefore),
        remove: (id) => outbox.remove(id),
        wake: (target) => worker.wake(target)
    },
    placed: (nodeId) => layers.has(nodeId),
    titleFor: (nodeId) => layers.get(nodeId)?.title ?? null,
    alert: (nodeId, title) => notify(nodeId, title),
    words: { app: 'Motion', cli: 'motion-context' }
});
worker = new OutboxWorker({
    store: outbox,
    handlers: { ...wiring.handlers, 'start-chat': startChat },
    onParked: (entry, error) => wiring.onParked(entry, error)
});
worker.start();
```

`AgentHost` offers no tasks of its own. A task is given and reported through the verbs of a context CLI, and the host needs to know which chat ran a verb. A plain host has neither. An app that wants tasks extends `ChatCore` for its CLI, as it does for its verbs, hands it to `AgentHost` or `wireAgents` as `core`, and wires tasks as above. The core of an `AgentHost` (`host.chats`) works as `chats` too, which `tasks/wiring.test.ts` does.

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
