import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import type { FlowCard, FlowContent } from '@ruimte/contracts';
import { tokenSegments, type FlowVisibleToken } from '@ruimte/flow';
import { tokenLabel } from '@/flow/labels';

interface FlowTokenFieldProps {
    value: string;
    /* The tokens this field may stand a reference to, which is the intersection and nothing wider. */
    tokens: readonly FlowVisibleToken[];
    content: FlowContent;
    /* Whether a new line is a line break here or the end of typing. */
    multiline: boolean;
    label: string;
    placeholder?: string;
    onChange(next: string): void;
    /* Enter on a single line field, which is what closes the control it sits in. */
    onDone(): void;
}

/* The blocks a browser wraps a new line in while a person types inside an editable. */
const BLOCK_TAGS = new Set(['DIV', 'P']);

/*
 * The text in the editable, read back in the notation it is stored in. A chip is one reference and
 * the words around it are themselves, so what comes out is what a person typed with the plumbing
 * back where the chips were.
 */
const serialize = (node: Node, first: boolean): string => {
    if (node.nodeType === Node.TEXT_NODE) {
        return node.nodeValue ?? '';
    }
    if (!(node instanceof HTMLElement)) {
        return '';
    }
    if (node.tagName === 'BR') {
        return '\n';
    }
    const held = node.dataset.token;
    if (held !== undefined) {
        return `@[${held}]`;
    }
    let text = '';
    let at = 0;
    for (const child of node.childNodes) {
        text += serialize(child, at === 0);
        at += 1;
    }
    /* A block a browser opened for a new line is that new line; the first one is the text itself. */
    return BLOCK_TAGS.has(node.tagName) && !first ? `\n${text}` : text;
};

const readValue = (root: HTMLElement): string => serialize(root, true);

/* The chip one reference is drawn as: one node the caret steps over rather than into. */
const chipFor = (cardId: string, token: string, text: string): HTMLSpanElement => {
    const chip = document.createElement('span');
    chip.dataset.token = `${cardId}.${token}`;
    chip.contentEditable = 'false';
    chip.className = 'flow-token-chip';
    chip.textContent = text;
    return chip;
};

/* Whether the caret sits right after or right before a chip, and which one. */
const chipBeside = (root: HTMLElement, where: 'before' | 'after'): HTMLElement | null => {
    const selection = window.getSelection();
    const range = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (range === null || !range.collapsed || !root.contains(range.startContainer)) {
        return null;
    }
    const node = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) {
        const at = range.startOffset;
        if (where === 'before' && at > 0) {
            return null;
        }
        if (where === 'after' && at < (node.nodeValue?.length ?? 0)) {
            return null;
        }
        const beside = where === 'before' ? node.previousSibling : node.nextSibling;
        return beside instanceof HTMLElement && beside.dataset.token !== undefined ? beside : null;
    }
    const children = [...node.childNodes];
    const beside = where === 'before' ? children[range.startOffset - 1] : children[range.startOffset];
    return beside instanceof HTMLElement && beside.dataset.token !== undefined ? beside : null;
};

/*
 * A text field where a token is a chip. The notation a reference is stored in never reaches the
 * screen: a person reads the name the publishing card gives it, and the chip is one node, so there
 * is no way to type half a reference away and be left with something that no longer parses.
 */
export function FlowTokenField({ value, tokens, content, multiline, label, placeholder, onChange, onDone }: FlowTokenFieldProps) {
    const { t } = useTranslation('flow');
    const fieldRef = useRef<HTMLDivElement>(null);
    /* What this field last handed up. A redraw from the same string would move the caret to the
       front on every keystroke, so it only draws what came from somewhere else. */
    const written = useRef<string | null>(null);

    useEffect(() => {
        const field = fieldRef.current;
        if (field === null || written.current === value) {
            return;
        }
        written.current = value;
        field.replaceChildren();
        for (const segment of tokenSegments(value)) {
            if (segment.kind === 'text') {
                field.append(document.createTextNode(segment.text));
            } else {
                const card = content.cards[segment.cardId];
                field.append(chipFor(segment.cardId, segment.token, card === undefined ? t('inspector.brokenToken') : tokenLabel(t, card, segment.token)));
            }
        }
    }, [value, content, t]);

    const publish = (): void => {
        const field = fieldRef.current;
        if (field === null) {
            return;
        }
        const next = readValue(field);
        written.current = next;
        onChange(next);
    };

    const insert = (cardId: string, token: string): void => {
        const field = fieldRef.current;
        const selection = window.getSelection();
        const range = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null;
        if (field === null) {
            return;
        }
        const card = content.cards[cardId];
        const chip = chipFor(cardId, token, card === undefined ? t('inspector.brokenToken') : tokenLabel(t, card, token));
        if (range !== null && field.contains(range.startContainer)) {
            range.deleteContents();
            range.insertNode(chip);
            range.setStartAfter(chip);
            range.collapse(true);
            selection?.removeAllRanges();
            selection?.addRange(range);
        } else {
            field.append(chip);
        }
        field.focus();
        publish();
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
        // The worksheet and the window listen on their own keys, and a text may hold any of them.
        e.stopPropagation();
        if (e.key === 'Enter' && !multiline) {
            e.preventDefault();
            onDone();
            return;
        }
        if (e.key !== 'Backspace' && e.key !== 'Delete') {
            return;
        }
        /* One key takes a whole chip. Left to the browser a chip is selected first and only gone on
           the second press, which reads as a key that did nothing. */
        const chip = chipBeside(fieldRef.current as HTMLElement, e.key === 'Backspace' ? 'before' : 'after');
        if (chip !== null) {
            e.preventDefault();
            chip.remove();
            publish();
        }
    };

    return (
        <div className="flex flex-col gap-2">
            <div
                ref={fieldRef}
                role="textbox"
                aria-multiline={multiline}
                aria-label={label}
                data-placeholder={placeholder}
                contentEditable
                suppressContentEditableWarning
                spellCheck={false}
                className={clsx('flow-token-field', multiline && 'min-h-20')}
                onInput={publish}
                onKeyDown={onKeyDown}
                onPaste={(e) => {
                    /* Pasted markup would bring styling and elements of its own into a field whose
                       every element means something here. */
                    e.preventDefault();
                    const text = e.clipboardData.getData('text/plain');
                    document
                        .getSelection()
                        ?.getRangeAt(0)
                        .insertNode(document.createTextNode(multiline ? text : text.replace(/\n/g, ' ')));
                    document.getSelection()?.collapseToEnd();
                    publish();
                }}
            />
            {tokens.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {tokens.map((entry) => (
                        <button
                            key={`${entry.cardId}.${entry.token.name}`}
                            type="button"
                            className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs/[inherit] text-text-muted hover:text-text"
                            // The caret stays where it was, which is where the chip belongs.
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => insert(entry.cardId, entry.token.name)}
                        >
                            {tokenLabel(t, content.cards[entry.cardId] as FlowCard, entry.token.name)}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
