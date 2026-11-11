import { loadOf } from '@/extensions/host/loads';
import type * as PublicClient from '../../../../../packages/extension/client';

/*
 * `@ruimte/extension/client` as a built-in imports it. The client's build binds every import of it under a built-in's
 * folder to this module with the built-in's id (`built-ins.ts` at the client's root), so a built-in reaches the same
 * API, permissions and lifecycle as an installed extension. Each name reaches the load in place when it is called: a
 * page runs a module once, and a lazy chunk of a built-in turned off and on again belongs to the new load.
 */
type Api = typeof PublicClient;
type ObjectName = { [Name in keyof Api]: Api[Name] extends (...args: never[]) => unknown ? never : Name }[keyof Api];
type FunctionName = Exclude<keyof Api, ObjectName>;

/* Replaced with the built-in's id as the build binds this module; reached unbound, it is a mistake in the build. */
function builtInExtensionId(): string {
    throw new Error('built-in-api.ts is only imported through the @ruimte/extension/client of a built-in');
}

const EXTENSION_ID: string = builtInExtensionId();

function current(): Api {
    return loadOf(EXTENSION_ID).api;
}

function call<Name extends FunctionName>(name: Name): Api[Name] {
    const forward = (...args: unknown[]): unknown => (current()[name] as (...args: unknown[]) => unknown)(...args);

    return forward as Api[Name];
}

function object<Name extends ObjectName>(name: Name): Api[Name] {
    return new Proxy({} as Api[Name], {
        get: (_target, key) => {
            const target = current()[name] as Record<PropertyKey, unknown>;
            const value = target[key];

            return typeof value === 'function' ? value.bind(target) : value;
        }
    });
}

export const definePanel = call('definePanel');
export const defineSidebarCard = call('defineSidebarCard');
export const defineView = call('defineView');
export const defineNode = call('defineNode');
export const defineCanvasOverlay = call('defineCanvasOverlay');
export const defineFileViewer = call('defineFileViewer');
export const defineMarkdownBlock = call('defineMarkdownBlock');
export const defineOverlay = call('defineOverlay');
export const defineToolResult = call('defineToolResult');
export const definePaletteSource = call('definePaletteSource');
export const defineSlashCommand = call('defineSlashCommand');
export const defineReference = call('defineReference');
export const defineDiffViewer = call('defineDiffViewer');
export const defineFileIcon = call('defineFileIcon');
export const defineVoiceAction = call('defineVoiceAction');
export const defineTemplate = call('defineTemplate');
export const defineCommand = call('defineCommand');
export const defineExtensionSettings = call('defineExtensionSettings');
export const defineAction = call('defineAction');
export const defineMenu = call('defineMenu');
export const defineWidget = call('defineWidget');
export const useServer = call('useServer');
export const getServer = call('getServer');
export const useServerEvent = call('useServerEvent');
export const useUsageLimits = call('useUsageLimits');
export const useNodeData = call('useNodeData');
export const useStorage = call('useStorage');
export const useProject = call('useProject');
export const useActiveView = call('useActiveView');
export const useSelection = call('useSelection');
export const useSetting = call('useSetting');
export const useMachine = call('useMachine');
export const useTheme = call('useTheme');
export const Chat = call('Chat');
export const useChat = call('useChat');
export const useNode = call('useNode');
export const useNodes = call('useNodes');
export const useViews = call('useViews');
export const useLocale = call('useLocale');
export const useEvent = call('useEvent');
export const onEvent = call('onEvent');
export const useAgents = call('useAgents');
export const host = object('host');
export const files = object('files');
export const git = object('git');
export const launches = object('launches');
export const routines = object('routines');
export const artifacts = object('artifacts');
export const browser = object('browser');
export const devices = object('devices');
export const terminals = object('terminals');
export const database = object('database');
export const chats = object('chats');
export const views = object('views');
export const context = object('context');
export const agents = object('agents');
export const canvas = object('canvas');
