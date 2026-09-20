import { useRef, type ComponentProps } from 'react';
import i18next from 'i18next';
import { DictationControl } from './DictationControl';

// Used by prompt answers: the final insertion goes through the existing change handler.
export function DictationTextarea(props: ComponentProps<'textarea'>) {
    const root = useRef<HTMLDivElement>(null);
    const field = useRef<HTMLTextAreaElement>(null);
    return (
        <div ref={root} className="flex min-h-0 min-w-0 flex-col">
            <textarea
                {...props}
                ref={(element) => {
                    field.current = element;
                    if (typeof props.ref === 'function') {
                        return props.ref(element);
                    }
                    if (props.ref) {
                        props.ref.current = element;
                    }
                }}
            />
            <DictationControl
                targetRef={root}
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
                                throw new Error(i18next.t('voice:dictation.targetChanged'));
                            }
                            element.focus();
                            element.setSelectionRange(from, to);
                            // Chromium records insertText as one native undo step and sends the normal input event.
                            if (!document.execCommand('insertText', false, text)) {
                                throw new Error(i18next.t('voice:dictation.targetChanged'));
                            }
                        }
                    };
                }}
            />
        </div>
    );
}
