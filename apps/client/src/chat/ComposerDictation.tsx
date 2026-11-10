import type { ComposerDictationProps } from '@adecore/agents-react';
import { DictationControl } from '@/dictation/DictationControl';
import { captureEditor } from '@/dictation/editor';

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
