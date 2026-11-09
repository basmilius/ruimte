import { Spinner, Tooltip } from '@adecore/ui';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useWaitingOn } from '@/chat/waiting-on';

/*
 * An agent in the middle of a turn, or in gray one between turns whose background work goes on. `plain` drops the tooltip for a row
 * that already names itself; with `chatId` the tooltip says what the chat waits on, which a plain mark shows too.
 */
export function WorkingMark({
    delegating = false,
    plain = false,
    chatId,
    endpointId
}: {
    delegating?: boolean;
    plain?: boolean;
    chatId?: string;
    endpointId?: string;
}) {
    const { t } = useTranslation('canvas');
    const label = t(delegating ? 'status.delegating' : 'status.running');
    const waitingOn = useWaitingOn(chatId ?? null, endpointId);
    const mark = <Spinner size={12} label={label} className={clsx('shrink-0', delegating ? 'text-text-faint' : 'text-status-running')} />;

    if (waitingOn !== null) {
        return <Tooltip label={waitingOn}>{mark}</Tooltip>;
    }

    return plain ? mark : <Tooltip label={label}>{mark}</Tooltip>;
}
