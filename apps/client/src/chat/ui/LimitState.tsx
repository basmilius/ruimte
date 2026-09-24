import { useTranslation } from 'react-i18next';
import { Hourglass } from 'lucide-react';
import type { ChatInfo } from '@ruimte/contracts';
import { performAsPerson } from '@/actions/client-actions';
import { limitView } from '@/chat/logic/limit';
import { useFormatLocale } from '@/format/locale';
import { Toggle } from '@/shell/settings/controls';
import { useChats } from '@/state/chats';
import { endpointKey, useEndpointId } from '@/state/keys';
import { useServers } from '@/state/server';
import { Icon } from '@/ui/Icon';
import { Pill } from '@/ui/Pill';
import { Tooltip } from '@/ui/Tooltip';
import { useNow } from '@/ui/useNow';

// A time a limit names reads as a clock today and with its day after that, so the words follow the minute.
const MINUTE_MS = 60_000;

/*
 * The chat's own "Resume at reset". It only counts while the machine allows it, so with the machine's
 * switch off it stands off and says where that switch is.
 */
function ResumeAtResetToggle({ chatId, info }: { chatId: string; info: ChatInfo }) {
    const { t } = useTranslation('chat');
    const endpointId = useEndpointId();
    const machineAllows = useServers((s) => s.byEndpoint[endpointId]?.resumeAtReset === true);
    const set = (on: boolean): void => {
        void performAsPerson('chat.configure', { chatId, model: null, option: null, resumeAtReset: on }).catch(() => undefined);
    };
    return (
        <Tooltip label={machineAllows ? t('limit.toggle') : t('limit.machineOff')}>
            {/* A disabled switch does not take the pointer, so the tooltip hangs on a wrapper. */}
            <span className="inline-flex shrink-0">
                <Toggle checked={machineAllows && info.resumeAtReset !== false} onChange={set} label={t('limit.toggle')} disabled={!machineAllows} />
            </span>
        </Tooltip>
    );
}

/* At the top of the composer while the last turn stopped on a limit: what stopped it, when it goes on, and the switch. */
export function LimitDock({ chatId, info }: { chatId: string; info: ChatInfo }) {
    const { t } = useTranslation('chat');
    useFormatLocale();
    const now = useNow(MINUTE_MS, info.limit !== undefined);
    const view = limitView(info, now);
    if (view === null) {
        return null;
    }
    return (
        <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
            <Icon icon={Hourglass} size={16} className="shrink-0 text-text-faint" />
            <span className="flex min-w-0 grow flex-col">
                <span className="truncate text-sm text-text">{view.title}</span>
                {view.detail !== null && <span className="truncate text-xs tabular-nums text-text-faint">{view.detail}</span>}
            </span>
            <span className="shrink-0 text-xs text-text-muted">{t('limit.toggle')}</span>
            <ResumeAtResetToggle chatId={chatId} info={info} />
        </div>
    );
}

/* The same state in a chat node's header, read from the status every client gets, so a node nobody opened says it too. */
export function LimitPill({ chatId }: { chatId: string }) {
    const endpointId = useEndpointId();
    const info = useChats((s) => s.statusByKey[endpointKey(endpointId, chatId)]?.info);
    useFormatLocale();
    const now = useNow(MINUTE_MS, info?.limit !== undefined);
    const view = info === undefined ? null : limitView(info, now);
    if (info === undefined || view === null) {
        return null;
    }
    return (
        <>
            <Tooltip label={view.detail === null ? view.title : `${view.title}. ${view.detail}`}>
                <Pill className="tabular-nums" icon={<Icon icon={Hourglass} size={12} />}>
                    {view.pill}
                </Pill>
            </Tooltip>
            <ResumeAtResetToggle chatId={chatId} info={info} />
        </>
    );
}
