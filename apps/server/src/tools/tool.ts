import {
    defineTool as defineCoreTool,
    defineToolkit as defineCoreToolkit,
    parseToolInput,
    REVISION_FIELD,
    type Tool as CoreTool,
    type ToolSpec as CoreToolSpec
} from '@adecore/agents/context';
import { z } from 'zod';
import type { AgentFiles } from '../mcp/files.ts';
import type { ArtifactUploads } from '../mcp/uploads.ts';
import { countToolCall } from '../stats/usage-stats.ts';
import { reachedPlace } from './reach.ts';
import type { AgentCall } from './host.ts';

/* Who sees a tool: every caller, only an AI chat, only while computer use is on, only in a project with a database connection. */
export type Audience = 'everyone' | 'chat' | 'computer' | 'database';

/* Who calls a tool: the caller and the daemon, and the files and uploads a tool that takes a path reads. */
export interface ToolCaller extends AgentCall {
    /* The folders a file this caller names may come from, worked out on first use. */
    files(): Promise<AgentFiles>;
    uploads?: ArtifactUploads;
}

/* What a tool runs with, which `runTool` gives it. */
export interface ToolCall extends ToolCaller {
    /* Hands back a png this call wrote, which goes back as image content; a path in the answer's text never does. */
    image(path: string): void;
}

export interface ToolOutcome {
    lines: string[];
    /* The pngs the tool handed back through `image`, read only inside the caller's folders. */
    images: string[];
}

export interface ToolSpec<Input extends z.ZodObject> extends CoreToolSpec<Input, ToolCall, string[]> {
    /* Everyone when left out. */
    audience?: Audience;
    /* The usage counter a call adds to, for a tool that replaced a tool of its own; the toolkit's name when left out. */
    counter?: string;
}

export interface Tool<Input extends z.ZodObject = z.ZodObject> extends CoreTool<ToolCall, string[], Input> {
    readonly audience: Audience;
    readonly counter: string;
}

/* A format a field takes as text, which `guide` prints on demand so no schema has to carry it. */
export interface GuideTopic {
    name: string;
    lines: readonly string[];
}

export interface Toolkit {
    /* The area, such as `node`, which is also the counter a call of its tools adds to. */
    readonly name: string;
    readonly tools: readonly Tool[];
    readonly guides: readonly GuideTopic[];
}

/* The `project` field of a tool that may work in another open project; `runTool` answers it, never the tool. */
export const PROJECT_INPUT = z
    .string({ error: 'project needs the id of a project; project_list lists them' })
    .min(1, 'project needs the id of a project; project_list lists them')
    .optional();

/* The `revision` field of a tool that writes the project file; `runTool` hands it on as the revision the write was decided on. */
export const REVISION_INPUT = z.number({ error: 'revision is the whole number a list printed last' }).int('revision is a whole number').optional();

/* The `view` field of a tool that works on a canvas. */
export const VIEW_INPUT = z.string({ error: 'view needs the id of a canvas' }).min(1, 'view needs the id of a canvas').optional();

/* The `tail` field of a tool that prints the last lines of something. */
export const TAIL_INPUT = z
    .number({ error: 'tail needs a positive whole number' })
    .int('tail needs a positive whole number')
    .positive('tail needs a positive whole number')
    .optional();

/* A required text field of `tool`, trimmed and capped at `max` characters. */
export function textInput(tool: string, name: string, max: number, what: string): z.ZodString {
    const needs = `${tool} needs ${name}, ${what}`;

    return z.string({ error: needs }).trim().min(1, needs).max(max, `${name} is at most ${max} characters`);
}

export function defineTool<Input extends z.ZodObject>(toolkit: string, spec: ToolSpec<Input>): Tool<Input> {
    return {
        ...defineCoreTool(toolkit, spec),
        audience: spec.audience ?? 'everyone',
        counter: spec.counter ?? toolkit
    };
}

export function defineToolkit(name: string, tools: readonly Tool[], guides: readonly GuideTopic[] = []): Toolkit {
    return { ...defineCoreToolkit(name, tools), tools, guides };
}

/*
 * Runs a tool for the caller with its JSON input checked. `project` and a numeric `revision` are
 * answered here, so no tool reads them on its own: the first moves the call into another open project,
 * checked again at every call, the second is the revision of the project file the write was decided
 * on. Throws a `ToolRefusal` or a `ProjectError` for a refusal.
 */
export async function runTool(tool: Tool, raw: unknown, call: ToolCaller): Promise<ToolOutcome> {
    const input = parseToolInput(tool, raw) as Record<string, unknown>;
    const { reached: _reached, expectedRevision: _revision, ...own } = call;
    const project = typeof input.project === 'string' ? input.project : undefined;
    const revision = input[REVISION_FIELD];
    const images: string[] = [];
    const ran: ToolCall = {
        ...own,
        ...(project === undefined ? {} : { reached: await reachedPlace(call.host, call.caller, project) }),
        ...(typeof revision === 'number' ? { expectedRevision: revision } : {}),
        image: (path) => {
            images.push(path);
        }
    };
    const lines = await tool.run(input, ran);
    countToolCall(tool.counter);

    return { lines, images };
}
