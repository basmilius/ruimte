import { EXTERNAL_PROJECT_TOOLS } from '../tools/external-project-tools.ts';
import type { CanvasHost } from '../tools/host.ts';
import type { ExternalCaller } from './caller.ts';
import { catalog, listed, type InputSchema, type Tool } from './catalog.ts';
import { APPROVAL_TOOLS, MACHINE_WIDE_TOOLS, tierHas } from './external-tiers.ts';

const PROJECT_FIELD = { type: 'string', description: 'The id of the project to work in; project_list lists them' } as const;

/* A tool as a client elsewhere sees it: `project` is required, since it stands in no project of its own. */
function withProject(tool: Tool): Tool {
    if (MACHINE_WIDE_TOOLS.has(tool.name)) {
        return tool;
    }

    const schema = tool.inputSchema as InputSchema & { properties?: Record<string, unknown>; required?: string[] };
    const required = [...new Set(['project', ...(schema.required ?? [])])];

    return { ...tool, inputSchema: { ...schema, properties: { project: PROJECT_FIELD, ...schema.properties }, required } as InputSchema };
}

let built: readonly Tool[] | null = null;

/* Every tool a client elsewhere can ever be offered, in catalog order. The tiers and the box choose among them. */
export function externalCatalog(): readonly Tool[] {
    if (built === null) {
        const replaced = new Map(EXTERNAL_PROJECT_TOOLS.map((tool) => [tool.name, listed(tool)] as const));
        built = catalog().map((tool) => withProject(replaced.get(tool.name) ?? tool));
    }

    return built;
}

/*
 * The tools this credential sees: those of its tier, the approval tools only under the box, and computer use only
 * while it is on. A tool outside the list does not exist for it, so a call answers `unknown-tool`.
 */
export function visibleExternalTools(caller: ExternalCaller, host: Pick<CanvasHost, 'computer'>, extra: readonly Tool[] = []): Tool[] {
    const { tier, approvals } = caller.grant;

    return [...externalCatalog(), ...extra].filter((tool) => {
        if (APPROVAL_TOOLS.includes(tool.name)) {
            return approvals;
        }

        if (!tierHas(tier, tool.name)) {
            return false;
        }

        return tool.audience !== 'computer' || host.computer?.enabled === true;
    });
}
