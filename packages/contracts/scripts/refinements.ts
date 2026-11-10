import { type z } from 'zod';
import { ACCESS_STATEMENT_LIFETIME_MS, PEER_STATEMENT_LIFETIME_MS } from '../../pulsar/src/address-book.ts';
import { CustomBrokerUrlSchema } from '../../pulsar/src/broker-url.ts';
import { ProjectDesignPathSchema } from '../src/project.ts';
import { RoutineCronScheduleSchema } from '../src/routine.ts';

/*
 * Every zod refinement that reaches the generated JSON Schemas, by name. JSON Schema cannot carry a predicate, so the
 * generator stamps `x-refinements` and `WireSchema` runs the predicate it implements under that name. A refinement
 * that is in no row fails the generator, so a new `.refine` cannot be added without deciding whether the phone checks
 * it. A row names its check by the message the schema gives it, or by the schema when the message is built at run
 * time. `unchecked` rows are rules about data a machine produces or about what only a person's own input meets.
 */
export interface NamedRefinement {
    readonly name: string;
    readonly phone: 'enforced' | 'unchecked';
    readonly message?: string;
    readonly schema?: z.ZodType;
    readonly params?: Record<string, number | string>;
}

export const NAMED_REFINEMENTS: readonly NamedRefinement[] = [
    { name: 'message-content', message: 'A message needs text or an attachment', phone: 'enforced' },
    { name: 'follow-dimensions', message: 'Supply both cols and rows, or follow the existing terminal size', phone: 'enforced' },
    {
        name: 'statement-lifetime',
        message: `A statement is valid for at most ${ACCESS_STATEMENT_LIFETIME_MS} ms`,
        phone: 'enforced',
        params: { lifetimeMs: ACCESS_STATEMENT_LIFETIME_MS }
    },
    { name: 'peer-statement-lifetime', message: `A peer statement is valid for at most ${PEER_STATEMENT_LIFETIME_MS} ms`, phone: 'unchecked' },
    { name: 'voice-stop-target', message: 'Name the session or the start to stop, not both', phone: 'enforced' },
    { name: 'project-id-or-folder', message: 'A project id or folder is required', phone: 'enforced' },
    { name: 'interval-range', message: 'to comes after from', phone: 'unchecked' },
    { name: 'cron-expression', schema: RoutineCronScheduleSchema, phone: 'unchecked' },
    { name: 'design-path', schema: ProjectDesignPathSchema, phone: 'unchecked' },
    { name: 'broker-url', schema: CustomBrokerUrlSchema, phone: 'unchecked' },
    { name: 'shell-command-line', message: 'Expected one visible shell command line', phone: 'unchecked' },
    { name: 'catalog-profiles', message: 'Every model needs a profile the catalog has', phone: 'unchecked' },
    { name: 'catalog-default-model', message: 'The default model has to be one of the models', phone: 'unchecked' },
    { name: 'language-server-id', message: 'Not a language server', phone: 'unchecked' },
    { name: 'language-server-serves', message: 'A server needs a language or a file pattern to serve', phone: 'unchecked' },
    { name: 'show-path-or-url', message: 'A shown document has a path or a url, not both', phone: 'unchecked' },
    { name: 'attachments-total-size', message: 'Attachments must total at most 10 MiB per message', phone: 'unchecked' },
    { name: 'attachment-size', message: 'Attachment exceeds 10 MiB', phone: 'unchecked' },
    { name: 'attachment-base64', message: 'Invalid attachment base64', phone: 'unchecked' },
    { name: 'absolute-path', message: 'must be an absolute path', phone: 'unchecked' }
];

/** The places `refinementsOf` met a custom check no row names; the generator throws with them after its pass. */
export const UNNAMED_REFINEMENTS: string[] = [];

interface CustomCheck {
    readonly _zod: { readonly def: { readonly check: string; readonly error?: (issue: unknown) => unknown } };
}

function customChecksOf(schema: object): CustomCheck[] {
    const checks = (schema as unknown as { _zod: { def: { checks?: CustomCheck[] } } })._zod.def.checks ?? [];

    return checks.filter((check) => check._zod.def.check === 'custom');
}

function messageOf(check: CustomCheck): string | undefined {
    const message = check._zod.def.error?.({});

    return typeof message === 'string' ? message : undefined;
}

/**
 * The `x-refinements` of one zod schema as `toJSONSchema` meets it, or nothing. A custom check that no row names lands
 * in `UNNAMED_REFINEMENTS`.
 */
export function refinementsOf(schema: object, where: string): Record<string, number | string>[] | undefined {
    const stamped: Record<string, number | string>[] = [];

    for (const check of customChecksOf(schema)) {
        const message = messageOf(check);
        const row = NAMED_REFINEMENTS.find((entry) => (entry.schema === undefined ? entry.message === message : entry.schema === schema));

        if (row === undefined) {
            UNNAMED_REFINEMENTS.push(`${where}: ${message ?? 'a check without a message'}`);
        } else if (row.phone === 'enforced') {
            stamped.push({ name: row.name, ...row.params });
        }
    }

    return stamped.length > 0 ? stamped : undefined;
}
