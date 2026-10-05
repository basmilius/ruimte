import type { CompletionItem } from '@ruimte/smart-editor-lsp';
import { CLASS_KIND, CONSTRUCTOR_KIND, FUNCTION_KIND, METHOD_KIND, SNIPPET_FORMAT, type Insertion } from './completion-model';

/* What the platform's editors send to ask for parameter info once an item is in; the card is ours to open. */
export const PARAMETER_HINTS_COMMAND = 'editor.action.triggerParameterHints';

const CALL_LANGUAGES = new Set(['typescript', 'typescriptreact', 'javascript', 'javascriptreact', 'vue', 'php', 'python']);
const MARKUP_LANGUAGES = new Set(['typescriptreact', 'javascriptreact', 'vue']);

const IMPORT_BRACE = /\b(?:import|export)(?:\s+type)?(?:\s+[\w$]+\s*,)?\s*$/;
const PHP_USE_BRACE = /\buse(?:\s+(?:function|const))?\s+[\w\\]*\\\s*$/;
const TYPE_OPERATOR = /\b(?:typeof|keyof|instanceof|implements|satisfies|as)\s+[\w$.?]*$/;
const AFTER_NEW = /\bnew\s+[\w$.\\]*$/;
const EXISTING_CALL = /^\s*\(/;
const SIGNATURE_KIND_PREFIX = /^\([a-z]+(?: [a-z]+)*\)\s+(?!=>)/;
const SOURCE_LINE = /^(?:use\s|Auto import from\b)/;

/*
 * What accepting an item does about the call it names: nothing, parentheses added with the caret inside or
 * after them, or the parenthesis that is already there, which the caret goes into on Tab and stays out of on Enter.
 */
export type CallPlan =
    | { readonly action: 'none' }
    | { readonly action: 'add'; readonly inside: boolean }
    | { readonly action: 'enter'; readonly shift: number };

export interface CallSite {
    readonly item: CompletionItem;
    readonly languageId: string;
    readonly insertion: Insertion;
    /* The text before the insertion, from some lines up, so a list that spans lines is still seen whole. */
    readonly before: string;
    /* The rest of the line after what the insertion replaces. */
    readonly rest: string;
    readonly replace: boolean;
}

/* Whether the item is something that is called where it stands: a function, a method, a constructor, or a class after `new`. */
export function isCallItem(item: CompletionItem, lineBefore: string): boolean {
    if (item.kind === METHOD_KIND || item.kind === FUNCTION_KIND || item.kind === CONSTRUCTOR_KIND) {
        return true;
    }
    return item.kind === CLASS_KIND && AFTER_NEW.test(lineBefore);
}

/* Whether the parameter list in a signature has anything in it; null when the text names no list. */
function listedParameters(signature: string): boolean | null {
    const text = signature.replace(SIGNATURE_KIND_PREFIX, '');
    const open = text.indexOf('(');
    if (open < 0) {
        return null;
    }
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === '(') {
            depth++;
        } else if (text[i] === ')' && --depth === 0) {
            return text.slice(open + 1, i).trim() !== '';
        }
    }
    return null;
}

/* From what the server says of the item: `(method) Box.open(flag: boolean): void` has parameters and `(): void` has none. Null when it says nothing about them. */
export function hasParameters(item: CompletionItem): boolean | null {
    const lines = (item.detail ?? '').split('\n').filter((line) => !SOURCE_LINE.test(line.trim()));
    for (const signature of [item.labelDetails?.detail ?? '', ...lines]) {
        const listed = listedParameters(signature);
        if (listed !== null) {
            return listed;
        }
    }
    return null;
}

/* The text before the innermost brace that is still open, which says whether the caret is in an import or export list. */
function beforeOpenBrace(before: string): string | null {
    let depth = 0;
    for (let i = before.length - 1; i >= 0; i--) {
        if (before[i] === '}') {
            depth++;
        } else if (before[i] === '{' && depth-- === 0) {
            return before.slice(0, i);
        }
    }
    return null;
}

/* Where a name is not called: in an import or export list, a `use`, a type operator's operand, an attribute or a tag. */
function isNameOnly(languageId: string, before: string): boolean {
    const lineBefore = before.slice(before.lastIndexOf('\n') + 1);
    const brace = beforeOpenBrace(before);
    if (brace !== null && (IMPORT_BRACE.test(brace) || (languageId === 'php' && PHP_USE_BRACE.test(brace)))) {
        return true;
    }
    if (TYPE_OPERATOR.test(lineBefore) || /^\s*export\s+default\s+[\w$]*$/.test(lineBefore)) {
        return true;
    }
    switch (languageId) {
        case 'php':
            return /^\s*use\s/.test(lineBefore) || /#\[[^\]]*$/.test(lineBefore);
        case 'python':
            return /^\s*(?:from\s+\S+\s+)?import\b/.test(lineBefore);
        default:
            return /^\s*import\b/.test(lineBefore) || (MARKUP_LANGUAGES.has(languageId) && /<\/?[\w$.:-]*$/.test(lineBefore));
    }
}

/*
 * Decides what accepting `item` does about a call, as the platform's parentheses handler does: a callable
 * gets `()` with the caret inside when it has parameters (or when that is not known) and behind when it has
 * none, and one that already has a parenthesis after it gets none. A snippet, or text that already holds a
 * parenthesis, carries its own call and wins.
 */
export function planCall(site: CallSite): CallPlan {
    const { item, languageId, insertion, before, rest, replace } = site;
    const lineBefore = before.slice(before.lastIndexOf('\n') + 1);
    if (!CALL_LANGUAGES.has(languageId) || !isCallItem(item, lineBefore) || item.insertTextFormat === SNIPPET_FORMAT || insertion.text.includes('(')) {
        return { action: 'none' };
    }
    if (isNameOnly(languageId, before)) {
        return { action: 'none' };
    }
    const existing = EXISTING_CALL.exec(rest);
    if (existing !== null) {
        return replace ? { action: 'enter', shift: existing[0].length } : { action: 'none' };
    }
    if (rest.startsWith('<')) {
        return { action: 'none' };
    }
    return { action: 'add', inside: hasParameters(item) !== false };
}

/* The insertion with its parentheses, and the one tab stop that puts the caret where the plan says. */
export function withParentheses(insertion: Insertion, inside: boolean): Insertion {
    const text = `${insertion.text}()`;
    const caret = inside ? text.length - 1 : text.length;
    return { range: insertion.range, text, stops: [{ index: 0, start: caret, end: caret }] };
}
