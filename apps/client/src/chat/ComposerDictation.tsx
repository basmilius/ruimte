import type { ComposerDictationProps } from '@ruimte/agents-react/host';
import { DictationControl } from '@/dictation/DictationControl';
import { captureEditor } from '@/dictation/editor';

/* Dictation beside the composer, its preview drawn inside the editor, which is also where the text goes. */
export function ComposerDictation({ targetRef, buttonContainer, disabled, editor }: ComposerDictationProps) {
    return (
        <DictationControl
            inlinePreview
            buttonContainer={buttonContainer}
            targetRef={targetRef}
            disabled={disabled}
            capture={() => {
                const view = editor();
                return view === null ? null : captureEditor(view);
            }}
        />
    );
}
