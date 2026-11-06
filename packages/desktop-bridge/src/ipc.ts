import type { ThemeState } from '@adecore/shell/bridge';
import type { SessionLoginCode } from '@ruimte/pulsar';
import type { BrowserContextAction, BrowserContextParams, OpenAiCredentialStatus, OpenAiLiveSession, WindowPoint } from './bridge.ts';
import type { BrowserRouteBinding, BrowserRouteBlocked } from './browser.ts';
import type { OpenPathRequest, SavePathRequest } from './database.ts';
import type { InstalledClientExtension } from './extensions.ts';
import type { MachineStopPreview } from './machine.ts';
import type { MenuSpec } from './menu.ts';
import type { KeepAwakeRequest, SystemIdleState } from './power.ts';
import type { BackgroundServiceState } from './service.ts';
import type { SpeechEvent, SpeechState } from './speech.ts';
import type { AgentActivity, ReleaseNotesState, UpdateState, UpdateTrack } from './update.ts';
import type { OpenAiLivePreferences } from './voice.ts';

/*
 * Every channel between the preload and the main process, with the arguments the preload sends and
 * what the handler answers. The preload builds its calls from these and the main process types each
 * handler against them, so an argument that moves is a type error on both sides. The tables hold
 * only names at runtime; the shapes live in the types. Types only are imported here, since the
 * preload bundles this file. A channel added after the first release is added to the bridge as optional.
 */

interface Invoke<Args extends unknown[], Result> {
    readonly kind: 'invoke';
    /* Type only. */
    readonly shape?: { args: Args; result: Result };
}

interface Send<Args extends unknown[]> {
    readonly kind: 'send';
    /* Type only. */
    readonly shape?: { args: Args };
}

interface Push<Args extends unknown[]> {
    readonly kind: 'event';
    /* Type only. */
    readonly shape?: { args: Args };
}

function invoke<Args extends unknown[], Result = void>(): Invoke<Args, Result> {
    return { kind: 'invoke' };
}

function send<Args extends unknown[] = []>(): Send<Args> {
    return { kind: 'send' };
}

function push<Args extends unknown[] = []>(): Push<Args> {
    return { kind: 'event' };
}

/* The page asks and waits for the answer (`ipcRenderer.invoke`, `ipc.handle`). */
export const IPC_INVOKE = {
    'daemon:local-secret': invoke<[], string | null>(),
    'usage:startup': invoke<[], number | null>(),
    'service:state': invoke<[], BackgroundServiceState>(),
    'service:set-keep-running': invoke<[keepRunning: boolean], BackgroundServiceState>(),
    'service:enable-linger': invoke<[], BackgroundServiceState>(),
    'service:restart-now': invoke<[], BackgroundServiceState>(),
    'service:restart-when-idle': invoke<[], BackgroundServiceState>(),
    'quick-look:show': invoke<[path: string], boolean>(),
    'extensions:list': invoke<[], InstalledClientExtension[]>(),
    'extensions:install': invoke<[pack: Uint8Array, options?: { fromStore?: boolean }], InstalledClientExtension>(),
    'extensions:remove': invoke<[id: string]>(),
    'extensions:set-enabled': invoke<[id: string, enabled: boolean]>(),
    'extensions:link': invoke<[folder: string, revision: number, enabled?: boolean]>(),
    'extensions:unlink': invoke<[id: string]>(),
    'browser:bind-route': invoke<[binding: BrowserRouteBinding], boolean>(),
    'browser:capture': invoke<[webContentsId: number], Uint8Array | null>(),
    'dialog:pick-folder': invoke<[initialPath?: string], string | null>(),
    'dialog:save-file': invoke<[suggestedName: string, bytes: Uint8Array, mime: string], string | null>(),
    'dialog:choose-save-path': invoke<[request: SavePathRequest], string | null>(),
    'dialog:choose-open-path': invoke<[request: OpenPathRequest], string | null>(),
    'shell:open-external': invoke<[url: string]>(),
    'shell:open-system-settings': invoke<[url: string]>(),
    'image:open': invoke<[suggestedName: string, bytes: Uint8Array, mime: string]>(),
    'clipboard:copy-files': invoke<[paths: string[]], boolean>(),
    'save-stream:begin': invoke<[suggestedName: string, mime: string], string | null>(),
    'save-stream:write': invoke<[id: string, bytes: Uint8Array]>(),
    'save-stream:end': invoke<[id: string], string>(),
    'save-stream:abort': invoke<[id: string]>(),
    'window:is-fullscreen': invoke<[], boolean>(),
    'window:claim': invoke<[key: string | null], boolean>(),
    'window:move-to-new': invoke<[at: WindowPoint | null], boolean>(),
    'window:close-if-others': invoke<[], boolean>(),
    'window:hold': invoke<[keys: string[]], string[]>(),
    'window:tab-drag': invoke<[phase: 'start' | 'end', key: string, grab: WindowPoint, whole: boolean, tabWidth: number | null], boolean>(),
    'power:idle-state': invoke<[thresholdSeconds: number], SystemIdleState>(),
    'update:state': invoke<[], UpdateState>(),
    'update:configure': invoke<[autoDownload: boolean]>(),
    'update:track': invoke<[track: UpdateTrack]>(),
    'update:check': invoke<[]>(),
    'update:download': invoke<[]>(),
    'releases:list': invoke<[refresh: boolean], ReleaseNotesState>(),
    'app:restart-safe-mode': invoke<[]>(),
    'media:request-microphone': invoke<[], boolean>(),
    'openai:credential-status': invoke<[], OpenAiCredentialStatus>(),
    'openai:save-api-key': invoke<[apiKey: string], OpenAiCredentialStatus>(),
    'openai:clear-api-key': invoke<[], OpenAiCredentialStatus>(),
    'openai:create-live-session': invoke<[sdp: string, preferences: OpenAiLivePreferences], OpenAiLiveSession>(),
    'database:secret-read': invoke<[key: string], string | null>(),
    'database:secret-write': invoke<[key: string, secret: string | null]>(),
    'database:secret-persistent': invoke<[], boolean>(),
    'speech:state': invoke<[], SpeechState>(),
    'speech:enable': invoke<[enabled: boolean], SpeechState>(),
    'speech:remove': invoke<[], SpeechState>(),
    'speech:start': invoke<[sessionId: string, language: string]>(),
    'speech:samples': invoke<[sessionId: string, samples: Float32Array]>(),
    'speech:stop': invoke<[sessionId: string]>(),
    'speech:cancel': invoke<[sessionId: string]>(),
    'machine:stop-preview': invoke<[], MachineStopPreview>(),
    'machine:choose': invoke<[mode: 'local' | 'none']>(),
    'pulsar:address-book': invoke<[], string>(),
    'pulsar:login-listen': invoke<[], { redirectUri: string }>(),
    'pulsar:login-callback': invoke<[], unknown>(),
    'pulsar:login-cancel': invoke<[]>(),
    'pulsar:exchange': invoke<[payload: SessionLoginCode], unknown>(),
    'pulsar:refresh': invoke<[], unknown>(),
    'pulsar:restore': invoke<[], unknown>(),
    'pulsar:sign-out': invoke<[]>()
};

/* The page tells and goes on (`ipcRenderer.send`, `ipc.on`). */
export const IPC_SEND = {
    'usage:count': send<[name: string]>(),
    'service:stop-machine': send(),
    'quick-look:close': send(),
    'devtools:guest': send<[webContentsId: number]>(),
    'browser:context-action': send<[action: BrowserContextAction]>(),
    'app:language': send<[language: string]>(),
    'menu:set': send<[spec: MenuSpec]>(),
    'window:theme': send<[theme: ThemeState]>(),
    'window:open': send<[key: string | null, view: string | null, at: WindowPoint | null]>(),
    'window:state': send<[state: string | null]>(),
    'window:tab-strip': send<[rect: { x: number; y: number; width: number; height: number } | null]>(),
    'power:keep-awake': send<[keep: boolean]>(),
    'power:keep-awake-request': send<[request: KeepAwakeRequest | null]>(),
    'agents:activity': send<[activity: AgentActivity]>(),
    'update:install': send<[confirmed: boolean]>(),
    'microphone:claim': send()
};

/* The main process tells a page (`webContents.send`, `ipcRenderer.on`). */
export const IPC_EVENT = {
    'service:state': push<[state: BackgroundServiceState]>(),
    'extensions:changed': push(),
    'browser:route-blocked': push<[event: BrowserRouteBlocked]>(),
    'browser:context-menu': push<[params: BrowserContextParams]>(),
    'guest:focus': push<[webContentsId: number]>(),
    'menu:settings': push<[section: string | null]>(),
    'menu:run': push<[id: string]>(),
    'window:fullscreen': push<[fullscreen: boolean]>(),
    'window:show-view': push<[view: string]>(),
    'window:show-project': push<[key: string]>(),
    'window:take-project': push<[key: string, x: number | null]>(),
    'window:release-project': push<[key: string]>(),
    'window:tab-drag-over': push<[key: string, x: number]>(),
    'update:state': push<[state: UpdateState]>(),
    'speech:state': push<[state: SpeechState]>(),
    'speech:event': push<[event: SpeechEvent]>(),
    'microphone:claimed': push()
};

export type InvokeChannel = keyof typeof IPC_INVOKE;
export type SendChannel = keyof typeof IPC_SEND;
export type EventChannel = keyof typeof IPC_EVENT;

type InvokeShape<C extends InvokeChannel> = NonNullable<(typeof IPC_INVOKE)[C]['shape']>;

export type InvokeArgs<C extends InvokeChannel> = InvokeShape<C>['args'];
export type InvokeResult<C extends InvokeChannel> = InvokeShape<C>['result'];
export type SendArgs<C extends SendChannel> = NonNullable<(typeof IPC_SEND)[C]['shape']>['args'];
export type EventArgs<C extends EventChannel> = NonNullable<(typeof IPC_EVENT)[C]['shape']>['args'];
