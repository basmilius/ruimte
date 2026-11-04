import { z } from 'zod';
import { defineActionTool, runAction } from './action-tool.ts';
import { field, orNote, requiredField } from './host.ts';
import { TAIL_INPUT, defineTool, defineToolkit } from './tool.ts';

const HELD_LINE =
    'held\tIt waits for a person to approve it from the launch chip in the toolbar, and starts nothing until then; tell them what you set up and why';

const CONTROLS = ['start', 'restart', 'stop'] as const;

function launchInput(tool: string) {
    return requiredField(`${tool} needs launch, the id or the name of a launch`);
}

const EnvInput = z
    .string()
    .transform((text, context) => {
        try {
            return JSON.parse(text) as unknown;
        } catch {
            context.addIssue({ code: 'custom', message: 'env is a JSON object of variables, such as {"PORT":"3000"}; null removes one' });

            return z.NEVER;
        }
    })
    .pipe(
        z.record(z.string(), z.string().nullable(), {
            error: 'env is a JSON object of variables with text values, such as {"PORT":"3000"}; null removes one'
        })
    );

const MembersInput = z
    .string()
    .min(1, 'members needs the launches a group starts')
    .transform((text) =>
        text
            .split(',')
            .map((member) => member.trim())
            .filter((member) => member !== '')
    );

const SAVE_INPUT = {
    command: z.string().optional(),
    cwd: z.string().min(1, 'cwd needs the path of a folder').optional(),
    url: z.string().optional().describe('Its port tells when it is up'),
    env: EnvInput.optional().describe('A JSON object of variables; null removes one'),
    members: MembersInput.optional().describe('For a group, launch ids or names in order')
};

type SaveInput = { [Name in keyof typeof SAVE_INPUT]?: z.output<(typeof SAVE_INPUT)[Name]> };

function saveFieldsOf(input: SaveInput) {
    return {
        ...(input.command === undefined ? {} : { command: input.command }),
        ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        ...(input.url === undefined ? {} : { url: input.url }),
        ...(input.env === undefined ? {} : { env: input.env }),
        ...(input.members === undefined ? {} : { members: input.members })
    };
}

function savedLaunchLines(saved: { launchId: string; name: string; kind: string; shared: boolean }): string[] {
    return [`saved\t${field(saved.launchId)}\t${field(saved.name)}\t${saved.kind}\t${saved.shared ? 'shared' : 'private'}`, HELD_LINE];
}

function startedLines(word: string, output: { launchId: string; name: string; members: string[] }): string[] {
    return [
        `${word}\t${field(output.launchId)}\t${field(output.name)}${output.members.length === 0 ? '' : `\t${output.members.map(field).join(',')}`}`,
        `see\tlaunch_list\twhether it came up; launch_read with launch ${field(output.launchId)} for its output`
    ];
}

const launchList = defineActionTool('launches', {
    name: 'launch_list',
    action: 'launch.list',
    description: 'Lists the launches of the project.',
    annotations: { readOnly: true },
    input: z.object({}),
    async run(_input, call) {
        const { launches } = await runAction(call, 'launch.list', {});

        return orNote(
            launches.map((launch) =>
                [
                    field(launch.launchId),
                    field(launch.name),
                    launch.kind,
                    launch.state === null ? '-' : launch.state === 'exited' ? `exited:${launch.exitCode ?? '-'}` : launch.state,
                    launch.approved ? 'yes' : 'no',
                    launch.port === null ? '-' : String(launch.port),
                    launch.url === null ? '-' : field(launch.url),
                    launch.members.length === 0 ? '-' : launch.members.map(field).join(',')
                ].join('\t')
            ),
            'This project has no launches; a person adds them from the launch chip in the toolbar, and launch_new adds one they approve'
        );
    }
});

const launchRead = defineActionTool('launches', {
    name: 'launch_read',
    action: 'launch.read',
    description: "Prints a launch's terminal output.",
    annotations: { readOnly: true },
    input: z.object({ launch: launchInput('launch_read'), tail: TAIL_INPUT }),
    async run(input, call) {
        const read = await runAction(call, 'launch.read', { launch: input.launch, tail: input.tail ?? null });

        if (read.text === null) {
            return [`note\t${read.name} has not run since this machine started`];
        }

        return read.text.split('\n');
    }
});

const launchNew = defineActionTool('launches', {
    name: 'launch_new',
    action: 'launch.create',
    description: 'Adds a service, task or group launch.',
    input: z.object({
        name: requiredField('launch_new needs name, the name of the launch'),
        kind: z.enum(['service', 'task', 'group'], { error: 'kind is service, task or group' }),
        ...SAVE_INPUT,
        shared: z.boolean().optional().describe('In the shared project file a team commits')
    }),
    async run(input, call) {
        return savedLaunchLines(
            await runAction(call, 'launch.create', { name: input.name, kind: input.kind, ...saveFieldsOf(input), shared: input.shared === true })
        );
    }
});

const launchEdit = defineActionTool('launches', {
    name: 'launch_edit',
    action: 'launch.edit',
    description: 'Changes a launch.',
    input: z.object({ launch: launchInput('launch_edit'), name: z.string().min(1, 'name needs a name').optional(), ...SAVE_INPUT }),
    async run(input, call) {
        return savedLaunchLines(
            await runAction(call, 'launch.edit', {
                launch: input.launch,
                ...(input.name === undefined ? {} : { name: input.name }),
                ...saveFieldsOf(input)
            })
        );
    }
});

/* Start, restart and stop meet the same approval, so one tool picks among them. */
const launchControl = defineTool('launches', {
    name: 'launch_control',
    description: 'Starts, restarts or stops an approved launch.',
    input: z.object({
        action: z.enum(CONTROLS, { error: `launch_control needs action, one of ${CONTROLS.join(', ')}` }),
        launch: launchInput('launch_control')
    }),
    async run(input, call) {
        switch (input.action) {
            case 'start':
                return startedLines('started', await runAction(call, 'launch.start', { launch: input.launch }));

            case 'restart':
                return startedLines('restarted', await runAction(call, 'launch.restart', { launch: input.launch }));

            case 'stop': {
                const stopped = await runAction(call, 'launch.stop', { launch: input.launch });

                if (stopped.stopping === 0) {
                    return [`note\t${stopped.name} was not running`];
                }

                return [`stopping\t${field(stopped.launchId)}\t${field(stopped.name)}\t${stopped.stopping}`];
            }
        }
    }
});

/* Named as the usage counter its calls add to, which the usage report and the client know. */
export const launchToolkit = defineToolkit('launches', [launchList, launchRead, launchNew, launchEdit, launchControl]);
