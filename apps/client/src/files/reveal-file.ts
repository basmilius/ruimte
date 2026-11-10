import { messageOf } from '@adecore/ui';
import i18next from 'i18next';
import { useToasts } from '@/state/toasts';
import type { Transport } from '@/transport/index';

export function revealFile(transport: Transport, path: string): void {
    void transport.request('fs.reveal', { path }).catch((error: unknown) => {
        const message = messageOf(error);
        useToasts.getState().show({ kind: 'error', title: i18next.t('panels:file.revealFailed'), description: message, output: message });
    });
}
