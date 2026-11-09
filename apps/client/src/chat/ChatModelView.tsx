import type { UiModelViewProps } from '@adecore/agents-react';
import { LazyBoundary, lazyNamed } from '@adecore/ui';

// three.js comes with the view, so neither the start screen nor a thread without a model loads it.
const ModelAttachmentView = lazyNamed(() => import('@/chat/ModelAttachmentView'), 'ModelAttachmentView');

export function ChatModelView(props: UiModelViewProps) {
    return (
        <LazyBoundary>
            <ModelAttachmentView {...props} />
        </LazyBoundary>
    );
}
