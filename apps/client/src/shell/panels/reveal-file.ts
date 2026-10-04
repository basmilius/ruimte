import i18next from 'i18next';
import type { Transport } from '@/transport';
import { useToasts } from '@/state/toasts';

export function revealFile(transport: Transport, path: string): void {
    void transport.request('fs.reveal', { path }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        useToasts.getState().show({ kind: 'error', title: i18next.t('panels:file.revealFailed'), description: message, output: message });
    });
}
