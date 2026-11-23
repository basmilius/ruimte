import { ToolRefusal } from '@adecore/agents/context';
import type { ActionHandlers } from '@ruimte/actions';
import type { SecretField } from '@ruimte/contracts';
import type { SecretTarget } from '../secrets/secret-requests.ts';
import { hostService, requireChatCaller, type ServerActionContext } from './context.ts';
import { launchHostOf, launchLines, named } from './launch-actions.ts';

// The daemon hands every session these itself; a secret under one would take over its wiring.
const RESERVED_PREFIX = 'RUIMTE_';

interface TargetInput {
    delivery?: 'launch' | 'file' | null;
    launch?: string | null;
    variable?: string | null;
    fields?: readonly { name: string; label: string; placeholder?: string | null; masked?: boolean | null }[] | null | undefined;
}

async function targetOf(input: TargetInput, context: ServerActionContext): Promise<SecretTarget> {
    const delivery = input.delivery ?? (input.launch ? 'launch' : 'file');

    if (delivery === 'file') {
        if (input.launch || input.variable) {
            throw new ToolRefusal('secret-file-launch', 'A file has no launch or variable; leave both out, or ask with delivery launch');
        }

        return input.fields ? { delivery, fields: input.fields.map(fieldOf) } : { delivery };
    }

    if (input.fields) {
        throw new ToolRefusal('secret-launch-fields', 'A launch variable holds one value; ask for several with delivery file');
    }

    if (!input.launch || !input.variable) {
        throw new ToolRefusal('secret-launch-needs', 'A launch secret needs launch and variable, or ask with delivery file for your own commands');
    }

    if (input.variable.toUpperCase().startsWith(RESERVED_PREFIX)) {
        throw new ToolRefusal('reserved-variable', `${input.variable} is one of the variables this machine sets itself; pick another name`);
    }

    const launches = await launchHostOf(context).list(context.place.projectId);
    const launch = named(launches, input.launch);

    if (launch.kind === 'group') {
        throw new ToolRefusal(
            'launch-group',
            `${launch.name} is a group and has no environment of its own; ask for the secret of one of the launches it starts`,
            launchLines(launches.filter((candidate) => launch.members.includes(candidate.launchId)))
        );
    }

    return { delivery, launchId: launch.launchId, launchName: launch.name, variable: input.variable };
}

function fieldOf(field: NonNullable<TargetInput['fields']>[number]): SecretField {
    return {
        name: field.name,
        label: field.label,
        ...(field.placeholder ? { placeholder: field.placeholder } : {}),
        ...(field.masked === false ? { masked: false } : {})
    };
}

export const secretActions: ActionHandlers<ServerActionContext> = {
    'secret.request': async (input, { actor, context }) => {
        const secrets = hostService(context, 'secrets', 'no-secrets', 'This machine keeps no secrets');
        // The card shows in the thread of an AI chat; a terminal's agent asks in its own TUI or in words.
        await requireChatCaller(
            context,
            actor.id,
            (you) =>
                new ToolRefusal('secret-needs-chat', `A secret is asked for in a card of an AI chat, and you are ${you}: ask the person to add it themselves`)
        );

        const target = await targetOf(input, context);
        const { requestId, outcome, files } = await secrets.ask(
            {
                nodeId: actor.id,
                projectId: context.place.projectId,
                target,
                label: input.label,
                reason: input.reason,
                ...(input.placeholder ? { placeholder: input.placeholder } : {}),
                ...(input.url ? { url: input.url } : {})
            },
            input.wait ? input.wait * 1000 : undefined
        );
        const launch = target.delivery === 'launch' ? target : null;

        return {
            output: {
                requestId,
                outcome,
                delivery: target.delivery,
                launchId: launch?.launchId ?? null,
                name: launch?.launchName ?? null,
                variable: launch?.variable ?? null,
                files
            }
        };
    }
};
