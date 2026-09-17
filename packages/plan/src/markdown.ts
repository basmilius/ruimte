import type { Plan, PlanItem, PlanStep, PlanStepState } from '@ruimte/contracts';
import type { PlanDraft, PlanDraftItem, PlanDraftSection, PlanDraftStep, PlanDraftText } from './apply.ts';
import { PLAN_STATE_MARKERS } from './text.ts';
import { refuse, stepState, type PlanRefusal } from './tree.ts';

const INDENT = '    ';

const MARKER_STATES: Record<string, PlanStepState | undefined> = {
    ' ': undefined,
    x: 'done',
    X: 'done',
    '~': 'active',
    '!': 'failed',
    '-': 'skipped',
    '?': 'blocked',
    w: 'warning',
    W: 'warning',
    i: 'info',
    I: 'info'
};

/*
 * A plan as a GFM task list: `#` the title, `##` a section, `> **Title**` a text block, `- [ ]` a
 * step with its sub-steps indented under it. Beyond `[ ]` and `[x]` a step carries the markers of
 * `plan read`, and a `>` line under a step is its note. Ids, who set a state and the locks stay out.
 */
export const planToMarkdown = (plan: Plan): string => {
    const blocks: string[] = [`# ${plan.meta.title}`];
    if (plan.meta.summary) {
        blocks.push(plan.meta.summary);
    }
    const stepLines = (step: PlanStep, depth: number): string[] => {
        const indent = INDENT.repeat(depth);
        const inner = INDENT.repeat(depth + 1);
        const lines = [`${indent}- ${PLAN_STATE_MARKERS[stepState(step)]} ${step.title}`];
        for (const line of step.description?.split('\n') ?? []) {
            lines.push(`${inner}${line}`);
        }
        for (const line of step.note?.split('\n') ?? []) {
            lines.push(`${inner}> ${line}`);
        }
        for (const child of step.steps ?? []) {
            lines.push(...stepLines(child, depth + 1));
        }
        return lines;
    };
    const textBlock = (item: Extract<PlanItem, { type: 'text' }>): string => {
        const [first = '', ...rest] = item.description?.split('\n') ?? [];
        return [`> **${item.title}**${first ? ` ${first}` : ''}`, ...rest.map((line) => `> ${line}`)].join('\n');
    };
    const itemBlocks = (items: readonly PlanItem[]): string[] => {
        const result: string[] = [];
        let list: string[] = [];
        const flush = (): void => {
            if (list.length > 0) {
                result.push(list.join('\n'));
                list = [];
            }
        };
        for (const item of items) {
            if (item.type === 'step') {
                list.push(...stepLines(item, 0));
            } else if (item.type === 'text') {
                flush();
                result.push(textBlock(item));
            }
        }
        flush();
        return result;
    };
    let inSection = false;
    let loose: PlanItem[] = [];
    const flushLoose = (): void => {
        if (loose.length > 0) {
            // Only a rule brings the items after a section back to the top of the plan.
            if (inSection) {
                blocks.push('---');
                inSection = false;
            }
            blocks.push(...itemBlocks(loose));
            loose = [];
        }
    };
    for (const item of plan.items) {
        if (item.type !== 'section') {
            loose.push(item);
            continue;
        }
        flushLoose();
        blocks.push(`## ${item.title}`);
        if (item.description) {
            blocks.push(item.description);
        }
        blocks.push(...itemBlocks(item.items));
        inSection = true;
    }
    flushLoose();
    return `${blocks.join('\n\n')}\n`;
};

const indentOf = (line: string): number => {
    let width = 0;
    for (const char of line) {
        if (char === ' ') {
            width++;
        } else if (char === '\t') {
            width += 4;
        } else {
            break;
        }
    }
    return width;
};

const appendLine = (value: string | undefined, line: string): string => (value === undefined ? line : `${value}\n${line}`);

/*
 * Reads a GFM task list into a draft for `plan new`. Lenient where Markdown is (a list item without a
 * checkbox is an open step), strict where a line cannot belong to anything.
 */
export const parsePlanMarkdown = (markdown: string): { ok: true; draft: PlanDraft } | PlanRefusal => {
    const draft: PlanDraft = { items: [] };
    let section: PlanDraftSection | null = null;
    let stack: { indent: number; step: PlanDraftStep }[] = [];
    let text: PlanDraftText | null = null;
    const container = (): PlanDraftItem[] => (section ? section.items : draft.items) as PlanDraftItem[];
    const popTo = (indent: number): void => {
        while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) {
            stack.pop();
        }
    };
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    for (let index = 0; index < lines.length; index++) {
        const raw = lines[index]!.trimEnd();
        const content = raw.trim();
        const indent = indentOf(raw);
        const invalid = (message: string): PlanRefusal => refuse('plan-invalid', `Line ${index + 1}: ${message}`);
        if (content === '') {
            text = null;
            continue;
        }
        const heading = /^(#{1,6})\s+(.*)$/.exec(content);
        if (heading && indent < 4) {
            text = null;
            stack = [];
            const title = heading[2]!.trim();
            if (heading[1] === '#' && draft.meta?.title === undefined && draft.items.length === 0 && !section) {
                draft.meta = { ...draft.meta, title };
            } else if (heading[1] === '##') {
                section = { type: 'section', title, items: [] };
                draft.items.push(section);
            } else {
                return invalid('only one "#" title before everything else and "##" sections are headings in a plan');
            }
            continue;
        }
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(content) && indent < 4) {
            section = null;
            stack = [];
            text = null;
            continue;
        }
        const item = /^[-*+]\s+(?:\[(.)\]\s+)?(.*)$/.exec(content);
        if (item) {
            text = null;
            const marker = item[1];
            if (marker !== undefined && !(marker in MARKER_STATES)) {
                return invalid(`"[${marker}]" is not a step marker`);
            }
            const title = item[2]!.trim();
            if (title === '') {
                return invalid('a step needs a title');
            }
            const state = marker === undefined ? undefined : MARKER_STATES[marker];
            const step: PlanDraftStep = { type: 'step', title, ...(state ? { state } : {}) };
            popTo(indent);
            const parent = stack[stack.length - 1]?.step;
            if (parent) {
                parent.steps ??= [];
                parent.steps.push(step);
            } else {
                container().push(step);
            }
            stack.push({ indent, step });
            continue;
        }
        const quote = /^>\s?(.*)$/.exec(content);
        popTo(indent);
        const owner = stack[stack.length - 1]?.step;
        if (owner && indent > 0) {
            if (quote) {
                owner.note = appendLine(owner.note, quote[1]!);
            } else {
                owner.description = appendLine(owner.description, content);
            }
            continue;
        }
        stack = [];
        if (quote) {
            const titled = /^\*\*(.+?)\*\*\s*(.*)$/.exec(quote[1]!.trim());
            if (titled) {
                text = { type: 'text', title: titled[1]!.trim(), ...(titled[2] ? { description: titled[2] } : {}) };
                container().push(text);
            } else if (text) {
                text.description = appendLine(text.description, quote[1]!);
            } else {
                return invalid('a text block starts with a bold title: > **Title** description');
            }
            continue;
        }
        if (!section && draft.items.length === 0) {
            draft.meta = { ...draft.meta, summary: appendLine(draft.meta?.summary, content) };
            continue;
        }
        if (section && section.items.length === 0) {
            section.description = appendLine(section.description, content);
            continue;
        }
        return invalid('this line is not a step, a section, a text block or a description');
    }
    // A parent's state follows from its children, so a marker on it says nothing.
    const clearParents = (items: readonly PlanDraftItem[]): void => {
        for (const entry of items) {
            if (entry.type === 'section') {
                clearParents(entry.items);
            } else if (entry.type === 'step' && entry.steps) {
                delete entry.state;
                clearParents(entry.steps);
            }
        }
    };
    clearParents(draft.items);
    return { ok: true, draft };
};
