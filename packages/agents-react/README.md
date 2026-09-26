# @ruimte/agents-react

Ruimte's AI chat for any React app that runs agent CLIs: the thread and its composer, the approval and question cards, the model and mode pickers, the providers settings pane and the usage page. React 19, Base UI, zustand, react-i18next and Tailwind 4, on top of `@ruimte/ui` and `@ruimte/agent-contracts`.

Import per file, the way `@ruimte/ui` does: `@ruimte/agents-react/chat/ui/Timeline`, `@ruimte/agents-react/transport`.

## The seams

- **`ChatTransport`** (`transport`) is how the chat reaches whatever runs the chats: a typed request out of `AGENT_REQUEST_SCHEMAS` with its typed answer, the events of `AGENT_EVENT_SCHEMAS`, and the status of the link. A link that comes back counts as a fresh one: the chat asks `chat.list` again and attaches every open chat. `portTransport(port)` (`port-transport`) runs one over a `FramePort` of `@ruimte/agent-contracts/port`; its `close()` fails what still waits. A refusal carries a `code` (`errorCode`, `isConnectionError`).
- **`ChatScope`** (`scope`) is one host of chats as everything under `ChatScopeContext` sees it: an `id` for the stores that keep a row per host (providers, accounts, usage), `keyOf` and `owns` for the rows of the chats store, whose keys the app decides, the `transport`, and the `ChatClient` on it. An app with several hosts renders a scope per host; the usage page renders the host it shows as a scope of its own.
- **`setChatHost`** (`host`) hands over, once and before the first render, what only the app decides: its palette for account colors, toasts, its own actions (else every action is a request on the transport), file search for `@`, attached files, code themes, how replies stream, file links, find in a thread, dictation, prompts of its own beside a chat's, other chats to point at, the places of forks, tasks, confirmations, logins, project marks, and which settings section to open. Whatever an app leaves out is the chat without that part.
- **`setLazyPrefetch`** (`lazy`) hands the modules the chat loads lazily (the diff renderers) to the app's prefetcher.

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
import { setFormatSource } from '@ruimte/ui/format/locale';
import { FORMAT_LANGUAGE } from '@ruimte/ui/format/regions';
import { UI_LOCALES, UI_NAMESPACE } from '@ruimte/ui/locales';

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

setFormatSource({
    language: () => i18next.language,
    region: () => FORMAT_LANGUAGE,
    subscribe: (onChange) => {
        i18next.on('languageChanged', onChange);
        return () => i18next.off('languageChanged', onChange);
    }
});
setChatHost({ notify: (toast) => showToast(toast), openSettings: (section) => openSettings(section) });

// The words: the ui namespace and the chat's own, in the language on screen.
i18next.addResourceBundle(language, UI_NAMESPACE, (await UI_LOCALES[language]!()).default, true, true);
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

<ChatScopeContext.Provider value={scope}>
    <Chat chatId="chat-1" />
</ChatScopeContext.Provider>;
```

The stylesheet goes right after the ui theme, and Tailwind scans both packages. The markdown of a thread builds on the typography plugin, and a few rules read the terminal colors (`--term-bg`, `--term-fg`, `--term-green`, `--term-red`) and the find colors (`--find-current`) an app defines:

```css
@import "tailwindcss";
@import "@ruimte/ui/theme.css";
@import "@ruimte/agents-react/theme.css";
@source "<path to>/@ruimte/ui/src";
@source "<path to>/@ruimte/agents-react/src";
@plugin "@tailwindcss/typography";
```

## Settings and usage

`settings/sections` describes the two sections this package brings to the settings dialog of `@ruimte/ui`; `settingsSection` makes the entry the dialog takes, with the pane the app hands it:

```tsx
import { ProvidersPane } from '@ruimte/agents-react/providers/ProvidersPane';
import { PROVIDERS_SECTION, USAGE_SECTION, settingsSection } from '@ruimte/agents-react/settings/sections';
import { UsagePane } from '@ruimte/agents-react/usage/UsagePane';
import { SettingsDialog } from '@ruimte/ui/settings/SettingsDialog';

<SettingsDialog
    groups={[{ label: null, sections: [settingsSection(PROVIDERS_SECTION, ProvidersPane), settingsSection(USAGE_SECTION, () => <UsagePane onOpenPage={openUsage} />)] }]}
    {...rest}
/>;
```

`ProvidersPane` takes the `target` a search result leads to and `detailOf`, for a provider the app draws itself. The usage page is `UsageDialog` around `UsagePage`, with an `ErrorBoundary` between them; `pickers` and `notice` take what the app says about the host itself. `UsageLimitsCard` draws the plan windows of the scope's host behind a trigger of the app's.

## Rules

Nothing in `src` imports from an app or from `@ruimte/contracts` (`boundary.test.ts`), and every source file is exported under its own path. The words are the namespaces of `AGENTS_NAMESPACES`, English and Dutch, held against each other by `locales.test.ts`.
