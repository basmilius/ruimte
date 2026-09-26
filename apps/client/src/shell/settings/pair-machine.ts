import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { pairEndpoint } from '@/endpoint';
import { messageOf } from '@ruimte/ui/error-message';
import { reclaimAfterPairing } from '@/pulsar/machines';
import { useToasts } from '@/state/toasts';

export const PAIRING_PLACEHOLDER = 'http://machine:4210/pair#token';

/* A pairing link typed into a field, and pairing with it. `onPaired` runs once the machine is in the list. */
export const usePairMachine = (onPaired?: () => void) => {
    const { t } = useTranslation('settings');
    const [link, setLink] = useState('');
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);

    const pair = async (): Promise<void> => {
        setBusy(true);
        setFailure(null);
        try {
            const record = await pairEndpoint(link);
            setLink('');
            onPaired?.();
            reclaimAfterPairing(record).catch((e: unknown) => {
                useToasts.getState().show({
                    id: `machine-reclaim-${record.id}`,
                    kind: 'error',
                    title: t('machines.add.reclaimFailed', { machine: record.label }),
                    description: messageOf(e)
                });
            });
        } catch (e) {
            setFailure(e instanceof Error ? e.message : t('machines.add.failed'));
        } finally {
            setBusy(false);
        }
    };

    return { link, setLink, busy, failure, pair, canPair: !busy && link.trim() !== '' };
};
