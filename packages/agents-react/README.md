# @ruimte/agents-react

Ruimte's AI chat for any React app that runs agent CLIs: the thread and its composer, the approval and question cards, the model and mode pickers, the providers settings pane and the usage page. React 19, Base UI, zustand, react-i18next and Tailwind 4, on top of `@adecore/ui` and `@ruimte/agent-contracts`. The app brings `@adecore/ui`, React, `react-dom`, i18next and `react-i18next` as peer dependencies.

Import per file: `@ruimte/agents-react/chat/ui/Timeline`, `@ruimte/agents-react/transport`.

## The seams

- **`ChatTransport`** (`transport`) is how the chat reaches whatever runs the chats: a typed request out of `AGENT_REQUEST_SCHEMAS` with its typed answer, the events of `AGENT_EVENT_SCHEMAS`, and the status of the link. A link that comes back counts as a fresh one: the chat asks `chat.list` again and attaches every open chat. `portTransport(port)` (`port-transport`) runs one over a `FramePort` of `@ruimte/agent-contracts/port`; its `close()` fails what still waits. A refusal carries a `code` (`errorCode`, `isConnectionError`).
- **`ChatScope`** (`scope`) is one host of chats as everything under `ChatScopeContext` sees it: an `id` for the stores that keep a row per host (providers, accounts, usage), `keyOf` and `owns` for the rows of the chats store, whose keys the app decides, the `transport`, and the `ChatClient` on it. An app with several hosts renders a scope per host; the usage page renders the host it shows as a scope of its own.
- **`setChatHost`** (`host`) hands over, once and before the first render, what only the app decides: its palette for account colors, toasts, its own actions (else every action is a request on the transport), file search for `@`, attached files, code themes, how replies stream, file links, find in a thread, dictation, prompts of its own beside a chat's, other chats to point at, whether an empty thread names the folder a chat works in, whether a chat before its first message opens on a greeting with the composer under it, the places of forks, tasks, confirmations, logins, project marks, which settings section to open, and its own parts in the chat (below). Whatever an app leaves out is the chat without that part.
- **`setLazyPrefetch`** (`lazy`) hands the modules the chat loads lazily (the diff renderers) to the app's prefetcher.
- **`onLazyOpenError`** (`lazy`) tells the app when one of those modules fails to load for a render, never for a prefetch, so it can reload after a deploy.

## Wiring it up

In the process that runs the chats, the host answers `AGENT_REQUEST_SCHEMAS` on a `MessagePort`. In the window:

```tsx
import i18next from 'i18next';
import { ChatClient } from '@ruimte/agents-react/chat/chat-client';
import { portTransport } from '@ruimte/agents-react/port-transport';
import { ChatScopeContext, type ChatScope } from '@ruimte/agents-react/scope';
import { chatSink } from '@ruimte/agents-react/state/chats';
import { providerSinkFor } from '@ruimte/agents-react/state/providers';
import { watchProviderAccounts } from '@ruimte/agents-react/state/provider-accounts';
import { setChatHost } from '@ruimte/agents-react/host';
import { AGENTS_LOCALES } from '@ruimte/agents-react/locales';
import { UIProvider } from '@adecore/ui';
import { FORMAT_LANGUAGE, type FormatSource } from '@adecore/ui/format';

// The port the utility process handed over, as the frames the chat speaks.
const transport = portTransport({
    send: (frame) => port.postMessage(frame),
    onFrame: (listener) => {
        const onMessage = (event: MessageEvent) => listener(event.data);
        port.addEventListener('message', onMessage);
        port.start();
        return () => port.removeEventListener('message', onMessage);
    }
});

// One host, so a chat's own id is its key.
const scope: ChatScope = {
    id: 'local',
    keyOf: (chatId) => chatId,
    owns: () => true,
    transport,
    chats: new ChatClient(transport, chatSink((chatId) => chatId), providerSinkFor('local'))
};
watchProviderAccounts(scope.id, transport);

const formatSource: FormatSource = {
    language: () => i18next.language,
    region: () => FORMAT_LANGUAGE,
    subscribe: (onChange) => {
        i18next.on('languageChanged', onChange);
        return () => i18next.off('languageChanged', onChange);
    }
};
setChatHost({ notify: (toast) => showToast(toast), openSettings: (section) => openSettings(section) });

// The chat's own words, in the language on screen. `UIProvider` adds the library's.
for (const [namespace, words] of Object.entries(await AGENTS_LOCALES[language]!())) {
    i18next.addResourceBundle(language, namespace, words, true, true);
}
```

A chat, opened while it is on screen:

```tsx
import { useEffect } from 'react';
import DiffPool from '@ruimte/agents-react/chat/ui/DiffPool';
import { Composer } from '@ruimte/agents-react/chat/ui/Composer';
import { Timeline } from '@ruimte/agents-react/chat/ui/Timeline';
import { useChatRow } from '@ruimte/agents-react/state/chats';
import DiffWorker from '@pierre/diffs/worker/worker.js?worker';

function Chat({ chatId }: { chatId: string }) {
    const info = useChatRow(chatId, (row) => row?.info);
    useEffect(() => {
        void scope.chats.open(chatId, { cwd: projectFolder });
        return () => void scope.chats.detach(chatId);
    }, [chatId]);
    return (
        <DiffPool workerFactory={() => new DiffWorker()}>
            <Timeline
                chatId={chatId}
                composer={
                    info && (
                        <Composer
                            chatId={chatId}
                            info={info}
                            focused
                            disabled={transport.status !== 'open'}
                            providerFixed={false}
                            onSend={(text, extras) => void scope.chats.send(chatId, text, extras)}
                            onRetarget={(provider, selection) => void scope.chats.retarget(chatId, provider, selection)}
                        />
                    )
                }
            />
        </DiffPool>
    );
}

<UIProvider i18n={i18next} formatSource={formatSource}>
    <ChatScopeContext.Provider value={scope}>
        <Chat chatId="chat-1" />
    </ChatScopeContext.Provider>
</UIProvider>;
```

The stylesheet goes right after the theme of `@adecore/ui`, and Tailwind scans the `dist` of both packages, which is what npm ships. The markdown of a thread builds on the typography plugin, and a few rules read the terminal colors (`--term-bg`, `--term-fg`, `--term-green`, `--term-red`) and the find colors (`--find-current`) an app defines. Colored tool output also reads the ANSI palette, `--term-ansi-black` through `--term-ansi-white` and their `--term-ansi-bright-*` variants. `@adecore/terminal/terminal.css` defines the ground, the text and that palette; the other colors are the app's own:

```css
@import "tailwindcss";
@import "@adecore/ui/theme.css";
@import "@ruimte/agents-react/theme.css";
@source "<path to>/node_modules/@adecore/ui/dist";
@source "<path to>/node_modules/@ruimte/agents-react/dist";
@plugin "@tailwindcss/typography";
```

## An app's own parts in the chat

Four fields of `setChatHost` put an app's own words and parts in the chat. Each is optional; without them the chat looks as it always did.

- **`useComposerPlaceholder(scopeId, chatId)`** returns the words an empty composer opens with, in place of "Ask anything". The keys it hints at (`/`, `@`, `$`) still follow, and a composer without a connection still says so. Return null to keep the chat's own words.
- **`ComposerSlot`** is a component drawn in the composer's row of controls, after the pickers. It gets `scopeId`, `chatId`, `disabled` and `insert(text)`, which types the text in at the caret as if the person had typed it, a space apart from a word it would touch.
- **`useThreadCards(scopeId, chatId)`** returns the cards an app shows between the messages of a thread, as `{ id, at, render }`. `at` is a time in milliseconds on the clock of a chat item's `createdAt`. A card goes right before the first row that began after it: in a folded turn that is under the fold, in an open turn between its calls, and in a running turn above the working line. `render` is called only while the card is on screen. The cards are the app's alone and never go over the wire. Return the same array while none of them changed.
- **`useReplyAuthor(scopeId, chatId)`** returns `{ name, mark? }` to draw a header over every reply: the mark (an avatar, say), the name and how long ago the turn began. It goes over the first row after the question or the agent's own turn opener, so a reply split by tool calls gets one. A screen reader hears the name from the reply's heading instead. Return null to keep the thread without headers.

The gaps between messages are custom properties on `.chat-thread`, in the `components` layer, so an app's own rule overrides them: `--chat-answer-gap` from a question to its answer, `--chat-turn-gap` from the end of a turn to the next question, and `--chat-block-gap` where a run of tool lines meets prose or a card. A chat in a view of its own (`.chat-column`) sets wider ones.

```css
.chat-thread, .chat-column .chat-thread { --chat-answer-gap: 14px; --chat-turn-gap: 14px; --chat-block-gap: 8px; }
```

```tsx
setChatHost({
    useComposerPlaceholder: () => 'Message the producer',
    ComposerSlot: ({ insert, disabled }) => {
        const time = usePlayhead((s) => s.time);
        return (
            <Button variant="secondary" size="sm" disabled={disabled} onClick={() => insert(`at ${formatTime(time)}`)}>
                {formatTime(time)}
            </Button>
        );
    },
    useThreadCards: (_scopeId, chatId) => {
        const versions = useVersions(chatId);
        return useMemo(() => versions.map((version) => ({ id: `v${version.n}`, at: version.at, render: () => <VersionCard version={version} /> })), [versions]);
    },
    useReplyAuthor: () => ({ name: 'Producer', mark: <Avatar role="producer" /> })
});
```

## Settings and usage

`settings/sections` describes the two sections this package brings to the settings dialog of `@adecore/ui`; `settingsSection` makes the entry the dialog takes, with the pane the app hands it:

```tsx
import { ProvidersPane } from '@ruimte/agents-react/providers/ProvidersPane';
import { PROVIDERS_SECTION, USAGE_SECTION, settingsSection } from '@ruimte/agents-react/settings/sections';
import { UsagePane } from '@ruimte/agents-react/usage/UsagePane';
import { SettingsDialog } from '@adecore/ui/settings';

<SettingsDialog
    groups={[{ label: null, sections: [settingsSection(PROVIDERS_SECTION, ProvidersPane), settingsSection(USAGE_SECTION, () => <UsagePane onOpenPage={openUsage} />)] }]}
    {...rest}
/>;
```

`ProvidersPane` takes the `target` a search result leads to, `detailOf`, for a provider the app draws itself, and `defaults={false}` for an app that decides what a new chat starts with elsewhere, which leaves "Defaults for new chats" out of a CLI's detail. The usage page is `UsageDialog` around `UsagePage`, with an `ErrorBoundary` between them; `pickers` and `notice` take what the app says about the host itself. `UsageLimitsCard` draws the plan windows of the scope's host behind a trigger of the app's.

## Rules

Nothing in `src` imports from an app or from `@ruimte/contracts` (`boundary.test.ts`), and every source file is exported under its own path. The words are the namespaces of `AGENTS_NAMESPACES`, English and Dutch, held against each other by `locales.test.ts`.
