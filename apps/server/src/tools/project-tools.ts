import { ToolRefusal } from '@adecore/agents/context';
import { PROJECT_PROPOSAL_LIMITS } from '@ruimte/contracts';
import { z } from 'zod';
import { ANSWER_WAKES_NOTE, field, orNote } from '../canvas/host.ts';
import { reachableLines, reachableProjects, reachedFolder, reachedProject, recentLines, SETTING_LINE } from '../canvas/reach.ts';
import { defineActionTool, runAction } from './action-tool.ts';
import { defineTool, defineToolkit, textInput, type ToolCall } from './tool.ts';

function projectIdInput(tool: string) {
    const needs = `${tool} needs project_id, the id of a project; project_list lists them`;

    return z.string({ error: needs }).min(1, needs);
}

const projectList = defineTool('project', {
    name: 'project_list',
    description: 'Lists the other open projects project reaches, and the Recent ones.',
    annotations: { readOnly: true },
    input: z.object({}),
    async run(_input, call) {
        // With the switch off an agent hears of no project, only of the setting, so it asks the person instead of working around it.
        if (call.host.reach?.enabled() !== true) {
            return [SETTING_LINE];
        }

        const own = call.host.projects.locate(call.caller)?.projectId ?? null;
        const open = await reachableProjects(call.host, own);
        const recent = await call.host.reach.recent();

        return [...reachableLines(open), ...recentLines(recent)];
    }
});

async function openFolder(folder: string, call: ToolCall): Promise<string[]> {
    const reached = await reachedFolder(call.host, call.caller, folder);

    if (reached.hasProject) {
        const opened = await reached.reach.openFolder(reached.folder);

        return [`project\t${opened.projectId}\t${field(opened.name)}\topened`];
    }

    const sent = reached.reach.askOpen(reached.ownProjectId, reached.folder, call.caller);

    return [
        `asked\t${field(reached.folder)}`,
        sent
            ? 'sent\tyes\tIt becomes a project only once a person confirms; project_list shows whether it did'
            : 'sent\tno\tNobody has your project on screen right now, so nobody was asked and nothing was made'
    ];
}

/*
 * Opening a project the machine has, or one a folder already holds, needs no one's answer; nobody holds
 * it for this, so nothing shows it and no launch starts. A folder without a project becomes one only
 * once a person confirms, as their own open of it; the call does not wait for that answer.
 */
const projectOpen = defineTool('project', {
    name: 'project_open',
    description: 'Opens a project from Recent or a folder, without showing it.',
    input: z.object({
        project_id: projectIdInput('project_open').optional(),
        folder: z
            .string({ error: 'folder needs an absolute path' })
            .min(1, 'folder needs an absolute path')
            .optional()
            .describe('An absolute folder on this machine')
    }),
    async run(input, call) {
        if (input.folder !== undefined && input.project_id === undefined) {
            return openFolder(input.folder, call);
        }

        if (input.project_id === undefined || input.folder !== undefined) {
            throw new ToolRefusal('bad-arguments', 'project_open takes project_id or folder; give one of them');
        }

        const { target, recent } = await reachedProject(call.host, call.caller, input.project_id, 'project_id', true);

        if (!recent) {
            return [`project\t${target.projectId}\t${field(target.name)}\talready open`];
        }

        await call.host.reach?.reopen(target.projectId);

        return [`project\t${target.projectId}\t${field(target.name)}\topened`];
    }
});

/*
 * Like `view_open`, an event: what a window shows is the person's, so each client with the caller's
 * project on screen decides by its own setting whether to follow.
 */
const projectActivate = defineTool('project', {
    name: 'project_activate',
    description: 'Shows another project to whoever has yours on screen.',
    input: z.object({ project_id: projectIdInput('project_activate') }),
    async run(input, call) {
        const { ownProjectId, target } = await reachedProject(call.host, call.caller, input.project_id, 'project_id', false);
        const sent = call.host.reach?.ask('activate', ownProjectId, target.projectId, call.caller) === true;

        return [
            `showing\t${target.projectId}\t${field(target.name)}`,
            sent ? 'sent\tyes\tEveryone with your project on screen was told' : 'sent\tno\tNobody has your project on screen right now, so nothing was shown'
        ];
    }
});

/*
 * Closing is a person's, so this only raises the confirmation they see when they close a project
 * themselves, in each client with the caller's project on screen. The call does not wait for the
 * answer; project_list shows whether it closed.
 */
const projectClose = defineTool('project', {
    name: 'project_close',
    description: 'Asks whoever has your project on screen to close another.',
    input: z.object({ project_id: projectIdInput('project_close') }),
    async run(input, call) {
        const { ownProjectId, target } = await reachedProject(call.host, call.caller, input.project_id, 'project_id', false);
        const sent = call.host.reach?.ask('askClose', ownProjectId, target.projectId, call.caller) === true;

        return [
            `asked\t${target.projectId}\t${field(target.name)}`,
            sent
                ? 'sent\tyes\tIt closes only once a person confirms; project_list shows whether it did'
                : 'sent\tno\tNobody has your project on screen right now, so nobody was asked and nothing closed'
        ];
    }
});

const projectPropose = defineActionTool('project', {
    name: 'project_propose',
    action: 'project.propose',
    description: 'Suggests in a card that this chat becomes a project; the answer wakes you.',
    audience: 'chat',
    input: z.object({
        name: textInput('project_propose', 'name', PROJECT_PROPOSAL_LIMITS.name, 'the name of the project'),
        reason: textInput('project_propose', 'reason', PROJECT_PROPOSAL_LIMITS.reason, 'why this is a project now'),
        folder: z
            .string()
            .trim()
            .min(1)
            .max(PROJECT_PROPOSAL_LIMITS.folder, `folder is at most ${PROJECT_PROPOSAL_LIMITS.folder} characters`)
            .optional()
            .describe('An absolute folder for it')
    }),
    async run(input, call) {
        const result = await runAction(call, 'project.propose', { name: input.name, reason: input.reason, folder: input.folder ?? null });

        return [`proposal\t${result.proposalId}\t${result.outcome}`, ...(result.outcome === 'waiting' ? [ANSWER_WAKES_NOTE] : [])];
    }
});

const projectIgnored = defineActionTool('project', {
    name: 'project_ignored',
    action: 'project.ignoredFiles',
    description: 'Lists the files git ignores in the project.',
    annotations: { readOnly: true },
    input: z.object({}),
    async run(_input, call) {
        const { root, files, truncated } = await runAction(call, 'project.ignoredFiles', {});

        return [
            `root\t${field(root)}`,
            ...orNote(
                files.map((file) => (file.link ? `link\t${field(file.path)}` : `file\t${field(file.path)}\t${file.size}`)),
                'git ignores no file here outside folders it ignores whole'
            ),
            ...(truncated ? ['note\tthe list is cut; more files are ignored than one answer lists'] : [])
        ];
    }
});

export const projectToolkit = defineToolkit('project', [projectList, projectOpen, projectActivate, projectClose, projectPropose, projectIgnored]);
