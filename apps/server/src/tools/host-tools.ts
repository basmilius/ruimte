import { CodedError } from '@adecore/agents';
import { ToolRefusal } from '@adecore/agents/context';
import { parseHostRef, type HostChange, type HostProviderStatus, type HostRef } from '@ruimte/contracts';
import { z } from 'zod';
import { orNote, placeOf } from '../canvas/host.ts';
import { callerKind } from '../canvas/tasks.ts';
import type { HostsAgentHost } from '../hosts/agent-host.ts';
import { linkOfIssue } from '../hosts/links.ts';
import { block, changeLines, changeRow, HOST_DATA_NOTE, issueLines, issueRow, quoted } from '../hosts/text.ts';
import { defineTool, defineToolkit, TAIL_INPUT, textInput, type ToolCall } from './tool.ts';

const LOG_TAIL = 80;
// The checks whose logs one call prints when it names none, which keeps a change with many failures inside one answer.
const LOGS_PER_CALL = 3;

type Capability = 'issues' | 'changes';

function hostsOf(call: ToolCall): HostsAgentHost {
    const hosts = call.host.hosts;

    if (hosts === undefined) {
        throw new ToolRefusal('unsupported', 'This host reads no code host or issue tracker');
    }

    return hosts;
}

/* Runs a read, and answers what the hosts refuse as a refusal of the tool under the same code. */
async function reading<Value>(read: () => Promise<Value>): Promise<Value> {
    try {
        return await read();
    } catch (e) {
        if (e instanceof CodedError && !(e instanceof ToolRefusal)) {
            throw new ToolRefusal(e.code, e.message, e.lines);
        }

        throw e;
    }
}

function providerLine(status: HostProviderStatus): string {
    const parts = [status.issues ? 'issues' : null, status.changes ? 'changes' : null, status.checks ? 'checks' : null].filter((part) => part !== null);

    return ['provider', status.provider, quoted(status.title), status.state, parts.join(','), status.repo === undefined ? '-' : quoted(status.repo)].join('\t');
}

/* The provider a list means: the one named, else the only one of the project that lists this. Several ask for a name. */
async function providerFor(call: ToolCall, tool: string, capability: Capability, named: string | undefined): Promise<HostProviderStatus> {
    const all = await reading(() => hostsOf(call).hosts.status(placeOf(call).projectId));
    const able = all.filter((status) => status[capability]);
    const found = named === undefined ? (able.length === 1 ? able[0] : undefined) : able.find((status) => status.provider === named);

    if (found === undefined) {
        throw new ToolRefusal(
            able.length === 0 ? 'no-provider' : 'unknown-provider',
            able.length === 0
                ? `This project has no provider that lists ${capability}`
                : named === undefined
                  ? `${tool} needs provider: this project has more than one that lists ${capability}`
                  : `${named} is no provider of this project that lists ${capability}`,
            able.map(providerLine)
        );
    }

    if (found.state !== 'ready') {
        throw new ToolRefusal(found.state, `${found.title} does not answer: ${found.reason ?? 'it gave no reason'}`);
    }

    return found;
}

async function issueRef(call: ToolCall, tool: string, text: string): Promise<HostRef> {
    const ref = await reading(() => hostsOf(call).hosts.resolve(placeOf(call).projectId, text));

    if (ref === null) {
        throw new ToolRefusal('unknown-issue', `${tool} takes an issue issue_list printed, its address or a short form its tracker knows; ${text} is none`);
    }

    return ref;
}

function changeRef(tool: string, text: string): HostRef {
    if (parseHostRef(text) === null) {
        throw new ToolRefusal('unknown-change', `${tool} takes a change as change_list prints it, such as tracker:12; ${text} is none`);
    }

    return text;
}

async function isChat(call: ToolCall): Promise<boolean> {
    const place = call.host.projects.locate(call.caller);
    const kind = place === null ? null : callerKind(await call.host.projects.read(place.projectId), call.caller);

    return (kind ?? call.host.hiddenAgents?.get(call.caller)?.node.kind) === 'chat';
}

/* The change a call means: the one it names, else the open change of the branch the calling chat works on. */
async function changeFor(call: ToolCall, tool: string, named: string | undefined): Promise<HostChange> {
    const { hosts } = hostsOf(call);
    const { projectId } = placeOf(call);

    if (named !== undefined) {
        return reading(() => hosts.change(projectId, changeRef(tool, named)));
    }

    const change = await reading(() => hosts.changeOfChat(projectId, call.caller));

    if (change === null) {
        throw new ToolRefusal('no-change', `The branch this session works on has no open change on its host; name one with change, as change_list prints it`);
    }

    return change;
}

const STATE = z.enum(['open', 'closed', 'all'], { error: 'state takes open, closed or all' }).optional();
const PROVIDER = z.string({ error: 'provider needs the id of a provider' }).min(1, 'provider needs the id of a provider').optional();
const QUERY = z.string().trim().max(300, 'query is at most 300 characters').optional();
const CURSOR = z.string().max(500, 'cursor is what the last page printed').optional().describe('From the last page');

const issueList = defineTool('hosts', {
    name: 'issue_list',
    description: "Lists a page of the issues of this project's tracker.",
    audience: 'hosts',
    annotations: { readOnly: true },
    input: z.object({
        provider: PROVIDER,
        state: STATE,
        assigned: z.boolean().optional().describe('Only those assigned to the person'),
        query: QUERY,
        cursor: CURSOR
    }),
    async run(input, call) {
        const { hosts, links } = hostsOf(call);
        const { projectId } = placeOf(call);
        const provider = await providerFor(call, 'issue_list', 'issues', input.provider);
        const page = await reading(() =>
            hosts.issues({
                projectId,
                provider: provider.provider,
                ...(provider.remote === undefined ? {} : { remote: provider.remote }),
                ...(input.state === undefined ? {} : { state: input.state }),
                ...(input.assigned === undefined ? {} : { assigned: input.assigned }),
                ...(input.query ? { query: input.query } : {}),
                ...(input.cursor === undefined ? {} : { cursor: input.cursor })
            })
        );
        const rows = await Promise.all(page.issues.map(async (issue) => issueRow(issue, (await links.chatsOf(issue.ref)).length)));

        return [HOST_DATA_NOTE, ...orNote(rows, `${provider.title} lists no such issue`), ...(page.cursor === undefined ? [] : [`cursor\t${page.cursor}`])];
    }
});

const issueRead = defineTool('hosts', {
    name: 'issue_read',
    description: 'Prints an issue with its comments and the chats that work on it.',
    audience: 'hosts',
    annotations: { readOnly: true },
    input: z.object({ issue: textInput('issue_read', 'issue', 400, 'as issue_list prints it, or its address') }),
    async run(input, call) {
        const { hosts, links } = hostsOf(call);
        const ref = await issueRef(call, 'issue_read', input.issue);
        const issue = await reading(() => hosts.issue(placeOf(call).projectId, ref));

        return issueLines(
            issue,
            (await links.chatsOf(ref)).map((link) => link.chatId)
        );
    }
});

/* Writes nothing to the host: the link is this machine's note of which chat works on which issue. */
const issueLink = defineTool('hosts', {
    name: 'issue_link',
    description: 'Links an issue to your chat, or unlinks it; the host hears nothing of it.',
    audience: 'hosts',
    input: z.object({
        issue: textInput('issue_link', 'issue', 400, 'as issue_list prints it, or its address'),
        unlink: z.boolean().optional()
    }),
    async run(input, call) {
        const { hosts, links } = hostsOf(call);

        if (call.reached !== undefined || !(await isChat(call))) {
            throw new ToolRefusal('not-a-chat', 'Only an AI chat links an issue, to itself and in its own project');
        }

        const ref = await issueRef(call, 'issue_link', input.issue);

        if (input.unlink === true) {
            return [`${(await links.unlink(call.caller, ref)) ? 'unlinked' : 'not-linked'}\t${ref}`];
        }

        const issue = await reading(() => hosts.issue(placeOf(call).projectId, ref));

        try {
            await links.link(call.caller, linkOfIssue(issue, 'agent'));
        } catch (e) {
            throw new ToolRefusal('too-many-links', e instanceof Error ? e.message : String(e));
        }

        return [`linked\t${ref}`];
    }
});

const changeList = defineTool('hosts', {
    name: 'change_list',
    description: "Lists a page of the pull or merge requests of this project's code host.",
    audience: 'hosts',
    annotations: { readOnly: true },
    input: z.object({
        provider: PROVIDER,
        state: z.enum(['open', 'closed', 'merged', 'all'], { error: 'state takes open, closed, merged or all' }).optional(),
        query: QUERY,
        cursor: CURSOR
    }),
    async run(input, call) {
        const provider = await providerFor(call, 'change_list', 'changes', input.provider);
        const page = await reading(() =>
            hostsOf(call).hosts.changes({
                projectId: placeOf(call).projectId,
                provider: provider.provider,
                ...(provider.remote === undefined ? {} : { remote: provider.remote }),
                ...(input.state === undefined ? {} : { state: input.state }),
                ...(input.query ? { query: input.query } : {}),
                ...(input.cursor === undefined ? {} : { cursor: input.cursor })
            })
        );

        return [
            HOST_DATA_NOTE,
            ...orNote(page.changes.map(changeRow), `${provider.title} lists no such change`),
            ...(page.cursor === undefined ? [] : [`cursor\t${page.cursor}`])
        ];
    }
});

/* A change of the chat's own branch that closes an issue says the chat works on that issue, so reading it links them. */
async function linkClosed(call: ToolCall, change: HostChange): Promise<void> {
    const { hosts, links } = hostsOf(call);
    const linked = new Set((await links.of(call.caller)).map((link) => link.ref));

    for (const ref of change.closes.filter((candidate) => !linked.has(candidate))) {
        // The change stays readable when an issue it names is not, or when the chat keeps no more links.
        await hosts
            .issue(placeOf(call).projectId, ref)
            .then((issue) => links.link(call.caller, linkOfIssue(issue, 'change')))
            .catch(() => undefined);
    }
}

const changeRead = defineTool('hosts', {
    name: 'change_read',
    description: 'Prints a pull or merge request with its checks and open review threads; without change, the one of your branch.',
    audience: 'hosts',
    annotations: { readOnly: true },
    input: z.object({ change: z.string().trim().min(1).max(400).optional().describe('As change_list prints it') }),
    async run(input, call) {
        const change = await changeFor(call, 'change_read', input.change);

        if (input.change === undefined && call.reached === undefined && (await isChat(call))) {
            await linkClosed(call, change);
        }

        return changeLines(change);
    }
});

const ciLogs = defineTool('hosts', {
    name: 'ci_logs',
    description: 'Prints the end of the logs of the failing checks of a change, or of one check by name.',
    audience: 'hosts',
    annotations: { readOnly: true },
    input: z.object({
        change: z.string().trim().min(1).max(400).optional().describe('As change_list prints it; your branch without it'),
        check: z.string().trim().min(1).max(300).optional().describe('A check by its name'),
        tail: TAIL_INPUT
    }),
    async run(input, call) {
        const { hosts } = hostsOf(call);
        const change = await changeFor(call, 'ci_logs', input.change);
        const named = input.check;
        const failing = change.checks.filter((check) => check.state === 'failure').map((check) => check.name);
        const checks = named === undefined ? failing.slice(0, LOGS_PER_CALL) : [named];

        if (named !== undefined && !change.checks.some((check) => check.name === named)) {
            throw new ToolRefusal(
                'unknown-check',
                `${change.ref} has no check of that name`,
                change.checks.map((check) => `check\t${quoted(check.name)}\t${check.state}`)
            );
        }

        if (checks.length === 0) {
            return [`note\tNo check of ${change.ref} failed`];
        }

        const lines = [HOST_DATA_NOTE];

        for (const check of checks) {
            const log = await reading(() => hosts.checkLog(placeOf(call).projectId, change.ref, check));
            const tail = log.text
                .replace(/\n$/, '')
                .split('\n')
                .slice(-(input.tail ?? LOG_TAIL));

            lines.push(`check\t${quoted(check)}`, ...block(tail.join('\n'), Number.MAX_SAFE_INTEGER));
        }

        return failing.length > checks.length && named === undefined
            ? [...lines, `note\t${failing.length - checks.length} more checks failed; name one with check`]
            : lines;
    }
});

export const hostToolkit = defineToolkit('hosts', [issueList, issueRead, issueLink, changeList, changeRead, ciLogs]);
