import { z } from 'zod';
import { ToolRefusal } from '@adecore/agents/context';
import { jsonLines, runAction } from './action-tool.ts';
import { defineTool, defineToolkit, type ToolCall } from './tool.ts';
import { field, orNote } from './host.ts';

const PERSON_INSTALLS =
    "person\tInstalling, updating and removing stay a person's, in Settings, Providers: no tool downloads or runs an installer. Name what you would install or update and why, and ask the person";

const READS = ['catalog', 'versions', 'limits'] as const;

/* The fields each read takes besides action; a field another read takes is refused by name. */
const FIELDS_OF: Readonly<Record<(typeof READS)[number], readonly string[]>> = {
    catalog: ['search', 'refresh', 'json'],
    versions: ['refresh', 'json'],
    limits: ['json']
};

function when(at: number | null): string {
    return at === null ? '-' : new Date(at).toISOString();
}

async function catalogLines(call: ToolCall, search: string | undefined, refresh: boolean, json: boolean): Promise<string[]> {
    const catalog = await runAction(call, 'provider.catalog', { search: search ?? null, refresh });

    if (json) {
        return jsonLines(catalog);
    }

    return [
        `registry\t${catalog.source}\t${when(catalog.fetchedAt)}${catalog.error === undefined ? '' : `\t${field(catalog.error)}`}`,
        ...orNote(
            catalog.agents.map((agent) =>
                [
                    'agent',
                    agent.kind,
                    field(agent.name),
                    field(agent.version),
                    agent.distribution,
                    agent.installed === null ? '-' : field(agent.installed),
                    agent.state,
                    field(agent.description)
                ].join('\t')
            ),
            search === undefined ? 'The registry lists no agent this machine can run' : 'No agent of the registry matches that search'
        ),
        PERSON_INSTALLS
    ];
}

async function versionLines(call: ToolCall, refresh: boolean, json: boolean): Promise<string[]> {
    const { versions } = await runAction(call, 'provider.versions', { refresh });

    if (json) {
        return jsonLines({ versions });
    }

    return [
        ...versions.map((version) =>
            [
                'cli',
                version.provider,
                version.version === null ? '-' : field(version.version),
                version.method,
                version.package === null ? '-' : field(version.package),
                version.latest === null ? '-' : field(version.latest),
                version.updatable ? 'yes' : 'no',
                ...(version.error === undefined ? [] : [field(version.error)])
            ].join('\t')
        ),
        PERSON_INSTALLS
    ];
}

async function limitLines(call: ToolCall, json: boolean): Promise<string[]> {
    const limits = await runAction(call, 'provider.limits', {});

    if (json) {
        return jsonLines(limits);
    }

    const windows = limits.windows.map((window) =>
        [
            'window',
            field(window.label),
            window.kind,
            `${window.usedPercent}%`,
            window.resetsAt ?? '-',
            window.evenPacePercent === null ? '-' : `${window.evenPacePercent}%`,
            window.pace ?? '-'
        ].join('\t')
    );

    return [
        [
            'plan',
            limits.provider,
            limits.account === null ? '-' : field(limits.account),
            limits.plan === null ? '-' : field(limits.plan),
            limits.checkedAt ?? '-'
        ].join('\t'),
        ...(limits.unavailable === null
            ? orNote(windows, 'The CLI reported no plan windows for this account yet')
            : [...windows, `unavailable\t${field(limits.unavailable)}`])
    ];
}

/* Three reads with the same fields and no risk, so one tool picks among them. */
const providerInfo = defineTool('provider', {
    name: 'provider_info',
    description: "Reads the agent CLIs a person can install, their versions, or your plan's limits.",
    annotations: { readOnly: true },
    input: z.object({
        action: z.enum(READS, { error: `provider_info needs action, one of ${READS.join(', ')}` }),
        search: z.string().min(1, 'search needs words to look for').optional(),
        refresh: z.boolean().optional(),
        json: z.boolean().optional()
    }),
    async run(input, call) {
        const own = FIELDS_OF[input.action];
        const stray = (['search', 'refresh', 'json'] as const).filter((name) => input[name] !== undefined && !own.includes(name));

        if (stray.length > 0) {
            throw new ToolRefusal('bad-arguments', `provider_info ${input.action} takes no ${stray.join(', ')}`, [`fields\t${own.join('\t')}`]);
        }

        const json = input.json === true;

        switch (input.action) {
            case 'catalog':
                return catalogLines(call, input.search, input.refresh === true, json);

            case 'versions':
                return versionLines(call, input.refresh === true, json);

            case 'limits':
                return limitLines(call, json);
        }
    }
});

export const providerToolkit = defineToolkit('provider', [providerInfo]);
