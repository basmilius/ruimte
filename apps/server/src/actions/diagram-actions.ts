import type { ActionHandlers } from '@ruimte/actions';
import { DiagramEdgeSchema, DiagramGroupSchema, DiagramMetaSchema, DiagramNodeSchema, diagramProblemIn, isDiagramView } from '@ruimte/contracts';
import { z } from 'zod';
import { VerbRefusal, orNote } from '../canvas/verb.ts';
import { viewLines } from '../canvas/views.ts';
import { DiagramError } from '../projects/diagram-store.ts';
import type { ServerActionContext } from './context.ts';

/*
 * The document as an agent hands it in. Strict at every level, unlike the schema a save reads: a
 * field an agent misspelled would otherwise be dropped without a word and the diagram written
 * without it. `version` and `rev` are the daemon's, and allowed only because a file read back from
 * disk carries them.
 */
const DocumentSchema = z.strictObject({
    version: z.unknown().optional(),
    rev: z.unknown().optional(),
    meta: z.strictObject(DiagramMetaSchema.shape),
    nodes: z.array(z.strictObject(DiagramNodeSchema.shape)),
    groups: z.array(z.strictObject(DiagramGroupSchema.shape)),
    edges: z.array(z.strictObject(DiagramEdgeSchema.shape))
});

const pathOf = (path: readonly PropertyKey[]): string =>
    path.reduce<string>((text, key) => (typeof key === 'number' ? `${text}[${key}]` : text === '' ? String(key) : `${text}.${String(key)}`), '');

const valueAt = (value: unknown, path: readonly PropertyKey[]): unknown =>
    path.reduce<unknown>(
        (current, key) => (current !== null && typeof current === 'object' ? (current as Record<PropertyKey, unknown>)[key] : undefined),
        value
    );

/* The item a path is inside, by what names it, so an agent finds the node without counting to index 17. */
const whoseLabel = (json: unknown, path: readonly PropertyKey[]): string => {
    const [list, index] = path;
    if (typeof index !== 'number') {
        return '';
    }
    const item = valueAt(json, [list!, index]) as Record<string, unknown> | undefined;
    if (list === 'edges' && typeof item?.from === 'string' && typeof item.to === 'string') {
        return ` (the edge from "${item.from}" to "${item.to}")`;
    }
    if (typeof item?.id === 'string') {
        return ` (${list === 'groups' ? 'group' : 'node'} "${item.id}")`;
    }
    return '';
};

/* Zod's own sentences ("Invalid input: expected string, received undefined") name the rule and not the repair. */
const issueText = (issue: z.core.$ZodIssue, json: unknown): string => {
    switch (issue.code) {
        case 'invalid_type':
            if (issue.path.length === 0) {
                return 'needs to be one JSON object with meta, nodes, groups and edges';
            }
            return `${valueAt(json, issue.path) === undefined ? 'is missing and needs' : 'needs'} ${/^[aeiou]/.test(issue.expected) ? 'an' : 'a'} ${issue.expected}`;
        case 'invalid_value':
            return `takes one of ${issue.values.map(String).join(', ')}`;
        case 'unrecognized_keys':
            return `has no field ${issue.keys.join(', ')}`;
        case 'too_small':
        case 'too_big':
            // Only an id and a pos have a length in the schema.
            return issue.origin === 'string' ? 'may not be empty' : 'needs two numbers, [x, y]';
        default:
            return issue.message;
    }
};

// Enough to repair a document in one pass, few enough that a broken one does not fill the window.
const MAX_PROBLEMS = 20;

const HELP_LINE = 'detail\truimte-context help view diagram';

const documentProblems = (error: z.ZodError, json: unknown): VerbRefusal => {
    const problems = error.issues.map((issue) => {
        const path = pathOf(issue.path) || 'document';
        return { path, text: `${issueText(issue, json)}${whoseLabel(json, issue.path)}` };
    });
    const [first] = problems;
    return new VerbRefusal('bad-document', `${first!.path} ${first!.text}`, [
        ...problems.slice(0, MAX_PROBLEMS).map((problem) => `problem\t${problem.path}\t${problem.text}`),
        ...(problems.length > MAX_PROBLEMS ? [`note\t${problems.length - MAX_PROBLEMS} more past these`] : []),
        HELP_LINE
    ]);
};

export const diagramActions: ActionHandlers<ServerActionContext> = {
    'diagram.replaceContent': async ({ viewId, document }, { context }) => {
        const { host, place } = context;
        const content = await host.read(place.projectId);
        const view = content.views.find((candidate) => candidate.id === viewId);
        if (!view || !isDiagramView(view)) {
            throw new VerbRefusal(
                'not-a-diagram',
                `${viewId} is not a diagram view of this project`,
                orNote(
                    viewLines(content.views.filter(isDiagramView)),
                    'This project has no diagram view; ruimte-context view new <name> --kind diagram makes one'
                )
            );
        }
        if (document.trim() === '') {
            throw new VerbRefusal(
                'no-document',
                "view diagram reads the document on stdin and got nothing: ruimte-context view diagram <viewId> <<'EOF' ... EOF",
                [HELP_LINE]
            );
        }
        let json: unknown;
        try {
            json = JSON.parse(document);
        } catch (e) {
            throw new VerbRefusal('bad-json', `The document is not JSON: ${e instanceof Error ? e.message : 'it does not parse'}`, [HELP_LINE]);
        }
        const parsed = DocumentSchema.safeParse(json);
        if (!parsed.success) {
            throw documentProblems(parsed.error, json);
        }
        const { meta, nodes, groups, edges } = parsed.data;
        const problem = diagramProblemIn({ nodes, groups, edges });
        if (problem) {
            throw new VerbRefusal('diagram-invalid', problem, [HELP_LINE]);
        }
        let rev: number;
        try {
            rev = await host.writeDiagram(place.projectId, viewId, { meta, nodes, groups, edges });
        } catch (e) {
            if (e instanceof DiagramError) {
                throw new VerbRefusal(e.code, e.message);
            }
            throw e;
        }
        return { output: { viewId, rev, nodes: nodes.length, groups: groups.length, edges: edges.length } };
    }
};
