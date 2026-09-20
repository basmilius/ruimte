import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Check } from 'lucide-react';
import type { FlowArgDefinition, FlowCard, FlowContent } from '@ruimte/contracts';
import { textArg, tokensForArg } from '@ruimte/flow';
import { chatChoices } from '@/flow/chats';
import { FlowTokenField } from '@/flow/FlowTokenField';
import { argLabel, choiceLabel, countOf } from '@/flow/labels';
import { useDocument } from '@/state/document';
import { useFlowStore } from '@/state/flow';
import { SECTION_LABEL } from '@/ui/classes';
import { Icon } from '@/ui/Icon';

interface FlowArgControlProps {
    id: string;
    card: FlowCard;
    content: FlowContent;
    arg: FlowArgDefinition;
    /* Closes the control, which is what Enter on a one line field means. */
    onDone(): void;
}

/* One row of a list of answers, with a tick on the one that stands. */
function Pick({ picked, label, onPick }: { picked: boolean; label: string; onPick(): void }) {
    return (
        <button type="button" className="menu-item w-full text-left" onClick={onPick}>
            <span className="grid h-4 w-4 shrink-0 place-items-center">{picked && <Icon icon={Check} size={14} />}</span>
            <span className="min-w-0 truncate">{label}</span>
        </button>
    );
}

/*
 * What a person answers one field with, in the shape its type asks for. It is built from the type in
 * the catalog, so a card added to the schemas is fillable in without a line of interface behind it,
 * and every type here is one a card really uses.
 */
export function FlowArgControl({ id, card, content, arg, onDone }: FlowArgControlProps) {
    const { t } = useTranslation('flow');
    const store = useFlowStore();
    const rootRef = useRef<HTMLDivElement>(null);
    const views = useDocument((s) => s.views);
    const value = textArg(card, arg.name);
    const label = argLabel(t, card, arg.name);

    const set = (next: string | number | boolean): void => store.getState().setArg(id, arg.name, next);

    /* A card is put down and filled in with the same hand, so what it opens on already has the
       keyboard. A list answers its arrows once it is focused, a field is typed in straight away. */
    useEffect(() => {
        const first = rootRef.current?.querySelector<HTMLElement>('input, textarea, [contenteditable], button');
        first?.focus();
    }, []);

    /* The worksheet and the window listen on their own keys, and a value may hold any of them. */
    const onKeyDown = (e: React.KeyboardEvent): void => {
        e.stopPropagation();
        if (e.key === 'Enter') {
            onDone();
        }
    };

    if (arg.type === 'choice') {
        return (
            <div ref={rootRef} className="flex flex-col">
                {(arg.choices ?? []).map((choice) => (
                    <Pick
                        key={choice}
                        picked={choice === value}
                        label={choiceLabel(t, card, choice, countOf(card))}
                        onPick={() => {
                            set(choice);
                            onDone();
                        }}
                    />
                ))}
            </div>
        );
    }

    if (arg.type === 'chat') {
        const chats = chatChoices(views);
        return (
            <div ref={rootRef} className="flex max-h-64 flex-col overflow-y-auto">
                {chats.length === 0 && <p className="px-2.5 py-2 text-xs/[inherit] text-text-faint">{t('inspector.noChats')}</p>}
                {chats.map((chat) => (
                    <Pick
                        key={chat.id}
                        picked={chat.id === value}
                        label={chat.name}
                        onPick={() => {
                            set(chat.id);
                            onDone();
                        }}
                    />
                ))}
            </div>
        );
    }

    if (arg.type === 'boolean') {
        return (
            <div ref={rootRef} className="flex flex-col">
                {[true, false].map((answer) => (
                    <Pick
                        key={String(answer)}
                        picked={card.args[arg.name] === answer}
                        label={t(`inspector.boolean.${answer ? 'yes' : 'no'}`)}
                        onPick={() => {
                            set(answer);
                            onDone();
                        }}
                    />
                ))}
            </div>
        );
    }

    const body =
        arg.tokens === true ? (
            <FlowTokenField
                value={value}
                tokens={tokensForArg(content, id, arg)}
                content={content}
                multiline={arg.type === 'longText'}
                label={label}
                onChange={set}
                onDone={onDone}
            />
        ) : arg.type === 'longText' ? (
            <textarea
                className="field min-h-20 py-1.5"
                aria-label={label}
                value={value}
                onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) => set(e.target.value)}
            />
        ) : arg.type === 'number' ? (
            <input
                type="number"
                className="field"
                aria-label={label}
                value={value}
                onKeyDown={onKeyDown}
                onChange={(e) => set(e.target.value === '' ? '' : Number(e.target.value))}
            />
        ) : (
            <input
                type={arg.type === 'time' ? 'time' : 'text'}
                className="field"
                aria-label={label}
                value={value}
                onKeyDown={onKeyDown}
                onChange={(e) => set(e.target.value)}
            />
        );

    return (
        <div ref={rootRef} className={clsx('flex flex-col gap-1.5 p-2', arg.type === 'longText' ? 'w-80' : 'w-64')}>
            <span className={SECTION_LABEL}>{label}</span>
            {body}
        </div>
    );
}
