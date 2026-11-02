import { refusalBody } from '@adecore/agents/context';
import { ProjectError } from '../projects/project-error.ts';
import { runCanvasVerb } from './run-verb.ts';
import { VerbRefusal, type CanvasHost, type LaunchReading, type Noun, type Verb, type VerbCall } from './verb.ts';
import { verbNamed } from './verbs.ts';

export interface VerbAnswer {
    refused: boolean;
    lines: string[];
}

/*
 * What a tool call of the verb `name` answers `caller`, through the same `runCanvasVerb` the MCP
 * route runs: its lines, or a refusal as its `refused` rows.
 */
export async function answerOf(name: string, argv: readonly string[], caller: string, host: CanvasHost): Promise<VerbAnswer> {
    const verb = verbNamed(name);

    if (verb === undefined || verb.served === 'context') {
        throw new Error(`${name} is not a canvas verb`);
    }

    try {
        const lines = await runCanvasVerb(verb, argv, caller, host);

        return { refused: false, lines: lines.length === 0 ? [] : lines.join('\n').split('\n') };
    } catch (error) {
        if (error instanceof VerbRefusal) {
            return { refused: true, lines: refusalBody(error.code, error.message, error.lines).split('\n') };
        }

        if (error instanceof ProjectError) {
            return { refused: true, lines: refusalBody(error.code, error.message).split('\n') };
        }

        throw error;
    }
}

/* An approved service that has not run, as `launches list` reads one. */
export function launchReading(launchId: string, overrides: Partial<LaunchReading> = {}): LaunchReading {
    return { launchId, name: launchId, kind: 'service', approved: true, url: null, port: null, members: [], status: null, ...overrides };
}

/* The code of a refusal, or undefined for an answer. */
export function refusalCode(lines: string[]): string | undefined {
    return lines[0]!.startsWith('refused\t') ? lines[0]!.split('\t')[1] : undefined;
}

/* What the CLI prints: the lines of an answer, or the refusal with its advice. */
export async function printed(entry: Verb | Noun, argv: string[], call: VerbCall): Promise<string[]> {
    try {
        return await entry.run(argv, call);
    } catch (error) {
        if (error instanceof VerbRefusal) {
            return refusalBody(error.code, error.message, error.lines).split('\n');
        }
        throw error;
    }
}
