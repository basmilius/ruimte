import { z } from 'zod';
import { ARTIFACT_LIMITS, ArtifactKeySchema, ArtifactRequestIdSchema, KnownArtifactKindSchema } from './artifact.ts';

/*
 * What an extension gives each action of the machine it may call, and what it reads back: the `MachineActions` of
 * `@ruimte/extension`. Smaller than the actions themselves, so a change to one moves the API only when it should.
 */
const NodeRefSchema = z.object({ id: z.string().min(1) });
const nodeInput = z.object({ node: NodeRefSchema });
const launchInput = z.object({ launch: z.string().trim().min(1) });
const routineInput = z.object({ routine: z.string().min(1) });
const publishedName = z.string().min(1).max(ARTIFACT_LIMITS.fileNameLength);
// A file an extension publishes goes in the call itself: it has no upload route of its own.
const PublishedTextSchema = z.object({ name: publishedName, text: z.string() });
const PublishedBytesSchema = z.object({ name: publishedName, base64: z.base64() });

// What one publish of an extension holds, every file together: as much as one frame carries.
export const EXTENSION_PUBLISH_MAX_BYTES = 2 * 1024 * 1024;

export const EXTENSION_ACTION_INPUTS = {
    'launch.list': z.object({}),
    'launch.read': launchInput.extend({ tail: z.number().int().min(1).optional() }),
    'launch.start': launchInput,
    'launch.restart': launchInput,
    'launch.stop': launchInput,
    'routine.list': z.object({}),
    'routine.run': routineInput,
    'routine.pause': routineInput,
    'routine.resume': routineInput,
    'artifact.list': z.object({}),
    'artifact.read': z.object({ artifact: z.string().min(1), version: z.string().min(1).optional(), file: z.number().int().nonnegative().optional() }),
    'artifact.publish': z.object({
        files: z
            .array(z.union([PublishedTextSchema, PublishedBytesSchema]))
            .min(1)
            .max(ARTIFACT_LIMITS.filesPerVersion),
        title: z.string().trim().min(1).max(ARTIFACT_LIMITS.titleLength).optional(),
        kind: KnownArtifactKindSchema.optional(),
        key: ArtifactKeySchema.optional(),
        requestId: ArtifactRequestIdSchema.optional()
    }),
    'browser.inspect': nodeInput,
    'browser.navigate': nodeInput.extend({ url: z.string().min(1) }),
    'browser.back': nodeInput,
    'browser.forward': nodeInput,
    'browser.reload': nodeInput.extend({ hard: z.boolean().optional() }),
    'browser.screenshot': nodeInput,
    'device.list': z.object({}),
    'device.inspect': nodeInput,
    'device.screenshot': nodeInput,
    'device.tap': nodeInput.extend({ x: z.number().min(0), y: z.number().min(0) }),
    'device.launch': nodeInput.extend({ app: z.string().trim().min(1).max(256) })
} as const;

export type ExtensionActionName = keyof typeof EXTENSION_ACTION_INPUTS;
export type ExtensionActionInput<Name extends ExtensionActionName> = z.infer<(typeof EXTENSION_ACTION_INPUTS)[Name]>;

export function isExtensionActionName(name: string): name is ExtensionActionName {
    return Object.hasOwn(EXTENSION_ACTION_INPUTS, name);
}

/* The input of an action as the machine takes it, or why it takes another: the extension's mistake, which it hears as a throw. */
export function parseExtensionActionInput<Name extends ExtensionActionName>(
    name: Name,
    input: unknown
): { ok: true; input: ExtensionActionInput<Name> } | { ok: false; message: string } {
    const parsed = EXTENSION_ACTION_INPUTS[name].safeParse(input ?? {});

    if (!parsed.success) {
        return { ok: false, message: `${name} takes another input: ${parsed.error.issues[0]?.message ?? 'invalid'}` };
    }

    return { ok: true, input: parsed.data as ExtensionActionInput<Name> };
}

interface NodeRef {
    id: string;
}

export interface ExtensionLaunchSummary {
    id: string;
    name: string;
    kind: 'service' | 'task' | 'group';
    state: 'starting' | 'running' | 'stopping' | 'exited' | null;
    exitCode: number | null;
    approved: boolean;
    port: number | null;
    url: string | null;
    members: string[];
}

export interface ExtensionRoutineSummary {
    id: string;
    title: string;
    kind: 'agent' | 'command' | 'launch';
    approved: boolean;
    paused: boolean;
    next: number | null;
    lastRun: { state: 'skipped' | 'starting' | 'running' | 'needsYou' | 'limit' | 'done' | 'failed'; at: number } | null;
}

export interface ExtensionArtifactFile {
    name: string;
    mime: string;
    size: number;
}

export interface ExtensionArtifactInfo {
    id: string;
    title: string;
    kind: string;
    key: string | null;
    createdAt: number;
}

export interface ExtensionArtifactSummary extends ExtensionArtifactInfo {
    latest: { id: string; number: number; createdAt: number; files: ExtensionArtifactFile[] };
    versions: number;
}

export interface ExtensionBrowserState {
    node: NodeRef;
    open: boolean;
    page: { url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean } | null;
    error: string | null;
}

export interface ExtensionDeviceInfo {
    name: string;
    platform: 'ios' | 'android';
    kind: 'simulator' | 'physical';
    runtime: string;
}

export interface ExtensionDeviceState {
    node: NodeRef;
    device: ExtensionDeviceInfo;
    present: boolean;
    state: 'booted' | 'shutdown' | 'transitioning' | null;
    screen: { width: number; height: number } | null;
    buttons: string[];
    can: { shot: boolean; input: boolean; type: boolean; launch: boolean };
}

export interface ExtensionActionOutputs {
    'launch.list': { launches: ExtensionLaunchSummary[] };
    'launch.read': { id: string; name: string; text: string | null };
    'launch.start': { id: string; name: string };
    'launch.restart': { id: string; name: string };
    'launch.stop': { id: string; name: string; stopping: number };
    'routine.list': { routines: ExtensionRoutineSummary[] };
    'routine.run': { id: string; title: string; runId: string };
    'routine.pause': { id: string; title: string };
    'routine.resume': { id: string; title: string };
    'artifact.list': { artifacts: ExtensionArtifactSummary[] };
    'artifact.read': {
        artifact: ExtensionArtifactInfo;
        version: { id: string; number: number };
        file: ExtensionArtifactFile;
        text: string | null;
        truncated: boolean;
    };
    'artifact.publish': { artifact: ExtensionArtifactInfo; version: { id: string; number: number }; existing: boolean };
    'browser.inspect': ExtensionBrowserState;
    'browser.navigate': ExtensionBrowserState;
    'browser.back': ExtensionBrowserState;
    'browser.forward': ExtensionBrowserState;
    'browser.reload': ExtensionBrowserState;
    'browser.screenshot': ExtensionBrowserState & { path: string | null };
    'device.list': { devices: (ExtensionDeviceInfo & { id: string; state: 'booted' | 'shutdown' | 'transitioning' })[] };
    'device.inspect': ExtensionDeviceState;
    'device.screenshot': { node: NodeRef; path: string; width: number; height: number };
    'device.tap': { node: NodeRef };
    'device.launch': { node: NodeRef };
}

export type ExtensionActionOutput<Name extends ExtensionActionName> = ExtensionActionOutputs[Name];
