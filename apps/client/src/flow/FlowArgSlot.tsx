import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Popover } from '@base-ui-components/react/popover';
import type { FlowArgDefinition, FlowCard, FlowContent } from '@ruimte/contracts';
import { textArg, type FlowArgProblem } from '@ruimte/flow';
import { FlowArgControl } from '@/flow/FlowArgControl';
import { argLabel } from '@/flow/labels';
import { useFlow, useFlowStore } from '@/state/flow';

interface FlowArgSlotProps {
    id: string;
    card: FlowCard;
    content: FlowContent;
    arg: FlowArgDefinition;
    /* What the sentence reads here: the value in the words a person picked it with. */
    text: string;
    problem?: FlowArgProblem;
}

/*
 * A field where it belongs: in the sentence of the card, as the words it stands for. Pressing it
 * opens the control its type asks for, so filling a card in is reading the line and answering the
 * part that is still open, rather than walking to a form somewhere else and back.
 *
 * A field that is asked for and empty reads as a place waiting for an answer and not as blank space,
 * because a card nobody finished is the one thing a worksheet has to say out loud.
 */
export function FlowArgSlot({ id, card, content, arg, text, problem }: FlowArgSlotProps) {
    const { t } = useTranslation('flow');
    const store = useFlowStore();
    const editing = useFlow((s) => s.editing);
    const open = editing?.cardId === id && editing.arg === arg.name;
    const empty = textArg(card, arg.name).trim() === '';

    return (
        <Popover.Root open={open} onOpenChange={(next) => store.getState().edit(next ? { cardId: id, arg: arg.name } : null)}>
            <Popover.Trigger
                /* The worksheet pans on a press it does not recognize, and this one is a control. */
                data-flow-chrome
                className={clsx(
                    'cursor-default rounded-md px-1 align-baseline hover:bg-surface-hover data-[popup-open]:bg-surface-active',
                    empty && 'border border-dashed border-border-strong',
                    problem === 'invalid' ? 'text-status-error' : empty ? 'text-text-faint' : 'font-medium text-text'
                )}
            >
                {empty ? argLabel(t, card, arg.name) : text}
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Positioner className="z-(--z-popup)" side="bottom" sideOffset={6} align="start">
                    <Popover.Popup className="menu-popup min-w-0 p-0">
                        <FlowArgControl id={id} card={card} content={content} arg={arg} problem={problem} onDone={() => store.getState().edit(null)} />
                    </Popover.Popup>
                </Popover.Positioner>
            </Popover.Portal>
        </Popover.Root>
    );
}
