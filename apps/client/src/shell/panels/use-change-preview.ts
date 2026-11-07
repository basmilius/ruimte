import type { Editor } from '@adecore/editor';
import { createHolder } from '@adecore/editor-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createChangePreview } from './change-preview';

const EMPTY = { preview: null };

function noSubscription(): () => void {
    return () => undefined;
}

export function useChangePreview(editor: Editor | null, base: string | null, path: string) {
    const [holder] = useState(() => createHolder<ReturnType<typeof createChangePreview>>());

    useEffect(() => {
        if (editor === null || base === null) {
            return;
        }

        const preview = createChangePreview(editor, base);

        holder.set(preview);

        return () => {
            preview.dispose();
            holder.set(null);
        };
    }, [editor, base, path, holder]);

    const model = useSyncExternalStore(holder.subscribe, holder.get);
    const state = useSyncExternalStore(model?.subscribe ?? noSubscription, model?.getState ?? (() => EMPTY));

    return { ...state, hold: (inside: boolean) => model?.hold(inside), revert: () => model?.revert() };
}
