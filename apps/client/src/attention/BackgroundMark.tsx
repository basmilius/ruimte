import { useChats } from '@adecore/agents-react/state';
import { Icon, Tooltip } from '@adecore/ui';
import { Activity, SquareTerminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWaitingOn } from '@/chat/waiting-on';
import { useEndpointId } from '@/state/current-endpoint';
import { endpointKey } from '@/state/keys';

/*
 * A chat between turns that left a command or a monitor running, which wakes it once that ends. The
 * icons are those of the background chip above the composer, never the hourglass of a wait on a person.
 */
export function BackgroundMark({ chatId, endpointId }: { chatId?: string; endpointId?: string }) {
    const { t } = useTranslation('canvas');
    const scope = useEndpointId();
    const key = chatId === undefined ? null : endpointKey(endpointId || scope, chatId);
    const shells = useChats((s) => (key === null ? false : (s.statusByKey[key]?.info.background ?? []).some((task) => task.kind === 'shell')));
    const label = useWaitingOn(chatId ?? null, endpointId) ?? t('status.delegating');

    return (
        <Tooltip label={label}>
            <span role="img" aria-label={label} className="inline-flex shrink-0 text-text-faint">
                <Icon icon={shells ? SquareTerminal : Activity} size={12} />
            </span>
        </Tooltip>
    );
}
