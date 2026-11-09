import { ToolRefusal } from '@adecore/agents/context';
import { z } from 'zod';
import { field } from '../canvas/host.ts';
import { accepted, scopedProjects } from './external-reach.ts';
import { defineTool, type ToolCall } from './tool.ts';

function externalOf(call: ToolCall): NonNullable<ToolCall['external']> {
    if (call.external === undefined) {
        throw new ToolRefusal('not-external', 'This tool is for a client elsewhere');
    }

    return call.external;
}

const projectId = (tool: string): z.ZodString => {
    const needs = `${tool} needs project_id, the id of a project; project_list lists them`;

    return z.string({ error: needs }).min(1, needs);
};

const projectList = defineTool('project', {
    name: 'project_list',
    description: 'Lists the open projects this credential reaches, and the Recent ones.',
    annotations: { readOnly: true },
    input: z.object({}),
    async run(_input, call) {
        return accepted(await scopedProjects(call.host, externalOf(call).grant));
    }
});

/* A project out of Recent, with no window: nothing shows it and no launch starts. A folder is never opened from outside. */
const projectOpen = defineTool('project', {
    name: 'project_open',
    description: 'Opens a project from Recent, without showing it.',
    input: z.object({ project_id: projectId('project_open') }),
    async run(input, call) {
        const projects = await scopedProjects(call.host, externalOf(call).grant);
        const open = projects.open.find((project) => project.projectId === input.project_id);

        if (open !== undefined) {
            return [`project\t${open.projectId}\t${field(open.name)}\talready open`];
        }

        const recent = projects.recent.find((project) => project.projectId === input.project_id);

        if (recent === undefined) {
            throw new ToolRefusal(
                'project-out-of-scope',
                `${input.project_id} is no project this credential reaches; project_list lists them`,
                accepted(projects)
            );
        }

        await call.host.reach?.reopen(recent.projectId);

        return [`project\t${recent.projectId}\t${field(recent.name)}\topened`];
    }
});

/* Like `view_open`, an event: what a window shows is the person's, so a client with the project on screen decides by its own setting. */
const projectActivate = defineTool('project', {
    name: 'project_activate',
    description: 'Brings a project forward in the window that has it.',
    input: z.object({ project_id: projectId('project_activate') }),
    async run(input, call) {
        const external = externalOf(call);
        const projects = await scopedProjects(call.host, external.grant);
        const open = projects.open.find((project) => project.projectId === input.project_id);

        if (open === undefined) {
            throw new ToolRefusal(
                'project-out-of-scope',
                `${input.project_id} is no open project this credential reaches; project_list lists them`,
                accepted(projects)
            );
        }

        const sent = call.host.reach?.ask('activate', open.projectId, open.projectId, external.id) === true;

        return [
            `showing\t${open.projectId}\t${field(open.name)}`,
            sent ? 'sent\tyes\tThe window with that project was told' : 'sent\tno\tNo window has that project on screen, so nothing was shown'
        ];
    }
});

/* The project tools of a client elsewhere. They take the place of the agent tools of the same names, which are about the caller's own project. */
export const EXTERNAL_PROJECT_TOOLS = [projectList, projectOpen, projectActivate];
