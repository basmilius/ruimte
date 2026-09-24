import { useRef, useState, type ComponentProps } from 'react';
import clsx from 'clsx';
import { DictationControl } from './DictationControl';
import { DictationError } from './engine';

interface DictationTextareaProps extends ComponentProps<'textarea'> {
    /* Where the button sits beside the field, e.g. a negative margin so it does not make a one-line row taller. */
    buttonClassName?: string;
}

// Used by prompt answers: the final insertion goes through the existing change handler.
export function DictationTextarea({ buttonClassName, ref, ...props }: DictationTextareaProps) {
    const root = useRef<HTMLDivElement>(null);
    const field = useRef<HTMLTextAreaElement>(null);
    const [slot, setSlot] = useState<HTMLSpanElement | null>(null);
    return (
        <div ref={root} className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex min-w-0 items-start gap-1">
                <textarea
                    {...props}
                    ref={(element) => {
                        field.current = element;
                        if (typeof ref === 'function') {
                            return ref(element);
                        }
                        if (ref) {
                            ref.current = element;
                        }
                    }}
                />
                <span ref={setSlot} className={clsx('flex shrink-0 empty:hidden', buttonClassName)} />
            </div>
            <DictationControl
                targetRef={root}
                buttonContainer={slot}
                disabled={props.disabled || props.readOnly}
                capture={() => {
                    const element = field.current;
                    if (!element) {
                        return null;
                    }
                    const before = element.value;
                    const from = element.selectionStart;
                    const to = element.selectionEnd;
                    return {
                        insert: (text) => {
                            if (field.current !== element || element.value !== before || !element.isConnected) {
                                throw new DictationError('targetChanged');
                            }
                            element.focus();
                            element.setSelectionRange(from, to);
                            // Chromium records insertText as one native undo step and sends the normal input event.
                            if (!document.execCommand('insertText', false, text)) {
                                throw new DictationError('targetChanged');
                            }
                        }
                    };
                }}
            />
        </div>
    );
}
