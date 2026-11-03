import { refusalBody, ToolRefusal } from '@adecore/agents/context';
import { ProjectError } from '../projects/project-error.ts';
import { runTool, type ToolCaller } from './tool.ts';
import { TOOLKITS } from './toolkits.ts';
import type { CanvasHost, LaunchReading } from './host.ts';

export interface ToolAnswer {
    refused: boolean;
    lines: string[];
    /* The pngs the tool handed back as image content. */
    images: string[];
}

/* A call for a tool that reads no file the agent names; one that does gets `files` of its own. */
export function toolCall(caller: string, host: CanvasHost): ToolCaller {
    return { caller, host, files: () => Promise.reject(new Error('This test hands the tool no files')) };
}

/*
 * What the tool `name` answers `caller` for this JSON input, through the same `runTool` the MCP route
 * runs: its lines, or a refusal as its `refused` rows, as the daemon words it before the route does.
 */
export async function toolAnswer(name: string, input: Readonly<Record<string, unknown>>, call: ToolCaller): Promise<ToolAnswer> {
    const tool = TOOLKITS.flatMap((toolkit) => toolkit.tools).find((candidate) => candidate.name === name);

    if (tool === undefined) {
        throw new Error(`${name} is no tool of a toolkit`);
    }

    try {
        const { lines, images } = await runTool(tool, input, call);

        return { refused: false, lines: lines.length === 0 ? [] : lines.join('\n').split('\n'), images };
    } catch (error) {
        if (error instanceof ToolRefusal || error instanceof ProjectError) {
            return { refused: true, lines: refusalBody(error.code, error.message, error instanceof ToolRefusal ? error.lines : []).split('\n'), images: [] };
        }

        throw error;
    }
}

/* An approved service that has not run, as `launch_list` reads one. */
export function launchReading(launchId: string, overrides: Partial<LaunchReading> = {}): LaunchReading {
    return { launchId, name: launchId, kind: 'service', approved: true, url: null, port: null, members: [], status: null, ...overrides };
}

/* The code of a refusal, or undefined for an answer. */
export function refusalCode(lines: string[]): string | undefined {
    return lines[0]!.startsWith('refused\t') ? lines[0]!.split('\t')[1] : undefined;
}
