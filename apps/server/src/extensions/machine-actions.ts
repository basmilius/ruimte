import { randomUUID } from 'node:crypto';
import { CodedError } from '@adecore/agents';
import type { ActionInput, ActionName, ActionOutput, ActionResult } from '@ruimte/actions';
import {
    EXTENSION_PUBLISH_MAX_BYTES,
    isExtensionActionName,
    parseExtensionActionInput,
    type Artifact,
    type ArtifactSummary,
    type ArtifactVersion,
    type ExtensionActionInput,
    type ExtensionActionName,
    type ExtensionActionOutput,
    type ExtensionArtifactInfo,
    type ExtensionBrowserState,
    type RoutineEntry
} from '@ruimte/contracts';
import type { ExtensionPublishInput } from '../artifacts/artifacts.ts';
import { asExtensionRefusal, ExtensionRefusal } from './refusal.ts';

/* Runs one action of the machine and answers its output, or throws why it did not run. */
export type ExecuteAction = <Action extends ActionName>(action: Action, input: ActionInput<Action>) => Promise<ActionOutput<Action>>;

interface Entry<Name extends ExtensionActionName, Action extends ActionName> {
    action: Action;
    input(input: ExtensionActionInput<Name>): ActionInput<Action>;
    output(output: ActionOutput<Action>): ExtensionActionOutput<Name>;
}

function entry<Name extends ExtensionActionName, Action extends ActionName>(
    action: Action,
    translate: Omit<Entry<Name, Action>, 'action'>
): Entry<Name, Action> {
    return { action, ...translate };
}

function routineOf(entry: RoutineEntry): ExtensionActionOutput<'routine.list'>['routines'][number] {
    const last = entry.runs[0];

    return {
        id: entry.routine.id,
        title: entry.routine.title,
        kind: entry.routine.kind,
        approved: entry.approved,
        paused: entry.local.pausedAt !== undefined,
        next: entry.next,
        lastRun: last === undefined ? null : { state: last.state === 'needs-you' ? 'needsYou' : last.state, at: last.at }
    };
}

function artifactOf(artifact: Pick<ArtifactSummary, 'artifactId' | 'title' | 'kind' | 'key' | 'createdAt'>): ExtensionArtifactInfo {
    return { id: artifact.artifactId, title: artifact.title, kind: artifact.kind, key: artifact.key ?? null, createdAt: artifact.createdAt };
}

function fileOf(file: { name: string; mime: string; size: number }): { name: string; mime: string; size: number } {
    return { name: file.name, mime: file.mime, size: file.size };
}

function browserOf(outcome: ActionOutput<'browser.inspect'>): ExtensionBrowserState {
    return { node: { id: outcome.nodeId }, open: outcome.open, page: outcome.page, error: outcome.error };
}

const node = (input: { node: { id: string } }) => ({ nodeId: input.node.id });
const launchNamed = (output: { launchId: string; name: string }) => ({ id: output.launchId, name: output.name });
const routineNamed = (output: { routineId: string; title: string }) => ({ id: output.routineId, title: output.title });

/*
 * Each action an extension may call, in the shape its API gives it: refs instead of ids, and only what the
 * extension reads. A new entry needs its permission in `EXTENSION_ACTIONS` and its types in `@ruimte/extension`.
 */
const MACHINE_ACTIONS: { [Name in Exclude<ExtensionActionName, 'artifact.publish'>]: Entry<Name, ActionName> } = {
    'launch.list': entry('launch.list', {
        input: () => ({}),
        output: ({ launches }) => ({ launches: launches.map(({ launchId, ...launch }) => ({ id: launchId, ...launch })) })
    }),
    'launch.read': entry('launch.read', {
        input: ({ launch, tail }) => ({ launch, tail: tail ?? null }),
        output: ({ launchId, name, text }) => ({ id: launchId, name, text })
    }),
    'launch.start': entry('launch.start', { input: ({ launch }) => ({ launch }), output: launchNamed }),
    'launch.restart': entry('launch.restart', { input: ({ launch }) => ({ launch }), output: launchNamed }),
    'launch.stop': entry('launch.stop', {
        input: ({ launch }) => ({ launch }),
        output: ({ launchId, name, stopping }) => ({ id: launchId, name, stopping })
    }),
    'routine.list': entry('routine.list', { input: () => ({}), output: ({ routines }) => ({ routines: routines.map(routineOf) }) }),
    'routine.run': entry('routine.run', {
        input: ({ routine }) => ({ routineId: routine }),
        output: ({ routineId, title, runId }) => ({ id: routineId, title, runId })
    }),
    'routine.pause': entry('routine.pause', { input: ({ routine }) => ({ routineId: routine }), output: routineNamed }),
    'routine.resume': entry('routine.resume', { input: ({ routine }) => ({ routineId: routine }), output: routineNamed }),
    'artifact.list': entry('artifact.list', {
        input: () => ({}),
        output: ({ artifacts }) => ({
            artifacts: artifacts.map((artifact) => ({
                ...artifactOf(artifact),
                latest: {
                    id: artifact.latest.versionId,
                    number: artifact.latest.number,
                    createdAt: artifact.latest.createdAt,
                    files: artifact.latest.files.map(fileOf)
                },
                versions: artifact.versionCount
            }))
        })
    }),
    'artifact.read': entry('artifact.read', {
        input: ({ artifact, version, file }) => ({
            artifactId: artifact,
            ...(version === undefined ? {} : { versionId: version }),
            ...(file === undefined ? {} : { file })
        }),
        output: ({ artifact, version, file, text, truncated }) => ({
            artifact: artifactOf(artifact),
            version: { id: version.versionId, number: version.number },
            file: fileOf(file),
            text,
            truncated
        })
    }),
    'browser.inspect': entry('browser.inspect', { input: node, output: browserOf }),
    'browser.navigate': entry('browser.navigate', { input: (input) => ({ ...node(input), url: input.url }), output: browserOf }),
    'browser.back': entry('browser.back', { input: node, output: browserOf }),
    'browser.forward': entry('browser.forward', { input: node, output: browserOf }),
    'browser.reload': entry('browser.reload', { input: (input) => ({ ...node(input), hard: input.hard ?? false }), output: browserOf }),
    'browser.screenshot': entry('browser.screenshot', { input: node, output: (output) => ({ ...browserOf(output), path: output.path }) }),
    'device.list': entry('device.list', {
        input: () => ({}),
        output: ({ devices }) => ({
            devices: devices.map((device) => ({
                id: device.deviceId,
                name: device.name,
                platform: device.platform,
                kind: device.kind,
                runtime: device.runtime,
                state: device.state
            }))
        })
    }),
    'device.inspect': entry('device.inspect', {
        input: node,
        output: (output) => ({
            node: { id: output.nodeId },
            device: { name: output.device.name, platform: output.device.platform, kind: output.device.kind, runtime: output.device.runtime },
            present: output.present,
            state: output.state,
            screen: output.screen,
            buttons: output.buttons,
            can: { shot: output.can.shot, input: output.can.input, type: output.can.type, launch: output.can.launch }
        })
    }),
    'device.screenshot': entry('device.screenshot', {
        input: node,
        output: ({ nodeId, path, width, height }) => ({ node: { id: nodeId }, path, width, height })
    }),
    'device.tap': entry('device.tap', { input: (input) => ({ ...node(input), x: input.x, y: input.y }), output: ({ nodeId }) => ({ node: { id: nodeId } }) }),
    'device.launch': entry('device.launch', { input: (input) => ({ ...node(input), app: input.app }), output: ({ nodeId }) => ({ node: { id: nodeId } }) })
};

export function outputOf<Action extends ActionName>(result: ActionResult<Action>): ActionOutput<Action> {
    if (result.status === 'failed') {
        throw asExtensionRefusal(new CodedError(result.error.code, result.error.message));
    }

    if (result.status === 'needs_confirmation') {
        throw new ExtensionRefusal('refused', `${result.action} needs a confirmation`);
    }

    return result.output;
}

/* Publishes an extension's files to the Output of the project its call came from. */
export type PublishFiles = (input: ExtensionPublishInput) => Promise<{ artifact: Artifact; version: ArtifactVersion; result: { existing: boolean } }>;

/* An extension's publish: its files come with the call, since an agent's upload route is not open to it. */
async function publishOf(input: ExtensionActionInput<'artifact.publish'>, publish: PublishFiles): Promise<ExtensionActionOutput<'artifact.publish'>> {
    const files = input.files.map((file) => ({
        name: file.name,
        bytes: 'text' in file ? new TextEncoder().encode(file.text) : Uint8Array.from(Buffer.from(file.base64, 'base64'))
    }));

    if (files.reduce((sum, file) => sum + file.bytes.byteLength, 0) > EXTENSION_PUBLISH_MAX_BYTES) {
        throw new ExtensionRefusal('limit', `An extension publishes at most ${EXTENSION_PUBLISH_MAX_BYTES / 1024 / 1024} MB at once`);
    }

    const { artifact, version, result } = await publish({
        files,
        requestId: input.requestId ?? randomUUID(),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        ...(input.key === undefined ? {} : { key: input.key })
    });

    return { artifact: artifactOf(artifact), version: { id: version.versionId, number: version.number }, existing: result.existing };
}

export async function runMachineAction(name: string, input: unknown, execute: ExecuteAction, publish: PublishFiles): Promise<unknown> {
    if (!isExtensionActionName(name)) {
        throw new ExtensionRefusal('not-found', `An extension cannot ask for ${name}`);
    }

    const parsed = parseExtensionActionInput(name, input);

    if (!parsed.ok) {
        throw new ExtensionRefusal('invalid-input', parsed.message);
    }

    if (name === 'artifact.publish') {
        return publishOf(parsed.input as ExtensionActionInput<'artifact.publish'>, publish);
    }

    const translate = MACHINE_ACTIONS[name] as Entry<ExtensionActionName, ActionName>;

    return translate.output(await execute(translate.action, translate.input(parsed.input as never)));
}
