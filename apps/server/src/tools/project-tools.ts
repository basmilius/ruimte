import { PROJECT_PROPOSAL_LIMITS } from '@ruimte/contracts';
import { z } from 'zod';
import { field, orNote } from '../canvas/host.ts';
import { reachableLines, reachableProjects } from '../canvas/reach.ts';
import { defineActionTool, runAction } from './action-tool.ts';
import { defineTool, defineToolkit, textInput } from './tool.ts';

const projectList = defineTool('project', {
    name: 'project_list',
    description: 'Lists the other open projects project reaches.',
    annotations: { readOnly: true },
    input: z.object({}),
    async run(_input, call) {
        return reachableLines(await reachableProjects(call.host, call.host.projects.locate(call.caller)?.projectId ?? null));
    }
});

const projectPropose = defineActionTool('project', {
    name: 'project_propose',
    action: 'project.propose',
    description: 'Suggests in a card that this chat becomes a project.',
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

        return [`proposal\t${result.proposalId}\t${result.outcome}`];
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

export const projectToolkit = defineToolkit('project', [projectList, projectPropose, projectIgnored]);
