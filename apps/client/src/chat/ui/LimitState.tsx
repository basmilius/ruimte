import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Hourglass } from 'lucide-react';
import type { ChatInfo } from '@ruimte/contracts';
import { performAsPerson } from '@/actions/client-actions';
import { AccountDot } from '@/agents/AccountDot';
import { continueTarget, hasUnreadAccount } from '@/agents/account-limits';
import { useAccountChoice, type AccountChoice } from '@/chat/account-choice';
import { limitView } from '@/chat/logic/limit';
import { useFormatLocale } from '@ruimte/ui/format/locale';
import { Toggle } from '@/shell/settings/controls';
import { useUsageLimits } from '@/shell/usage/limits';
import { useChats } from '@/state/chats';
import { endpointKey, useEndpointId } from '@/state/keys';
import { useServers } from '@/state/server';
import { useToasts } from '@/state/toasts';
import { useUsageStore } from '@/state/usage';
import { transportFor } from '@/transport';
import { Button } from '@ruimte/ui/Button';
import { Icon } from '@ruimte/ui/Icon';
import { Pill } from '@ruimte/ui/Pill';
import { Tooltip } from '@ruimte/ui/Tooltip';
import { useNow } from '@ruimte/ui/useNow';

// A time a limit names reads as a clock today and with its day after that, so the words follow the minute.
const MINUTE_MS = 60_000;

// Reading an account's plan starts its CLI, so an account nobody used yet is read at most this often per machine.
const UNREAD_REFRESH_MS = 5 * MINUTE_MS;
const refreshedAt = new Map<string, number>();

/*
 * The machine reads the plan of an account other than a CLI's default one only while it is in use,
 * so an account that could take the chat over may have no numbers yet. The dock asks for them.
 */
const readUnreadAccounts = (endpointId: string): void => {
    const last = refreshedAt.get(endpointId);
    if (last !== undefined && Date.now() - last < UNREAD_REFRESH_MS) {
        return;
    }
    refreshedAt.set(endpointId, Date.now());
    void transportFor(endpointId)
        ?.request('usage.refreshLimits', {})
        .then((snapshot) => useUsageStore.getState().setLimits(endpointId, snapshot))
        .catch(() => undefined);
};

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

/*
 * Another account of the chat's CLI that has room: the one with the least of its session spent. Only
 * ever offered, since going on there spends someone's other plan. An account that reads the chat's
 * conversation takes it over; any other goes on in a fork, which then opens the way a fork does.
 */
function ContinueOn({ chatId, info, choice }: { chatId: string; info: ChatInfo; choice: AccountChoice }) {
    const { t } = useTranslation('chat');
    const endpointId = useEndpointId();
    const limits = useUsageLimits();
    const [busy, setBusy] = useState(false);
    const target = continueTarget(choice.accounts, limits, info.provider, info.account);
    const unread = limits !== null && hasUnreadAccount(choice.accounts, limits, info.provider, info.account);

    useEffect(() => {
        if (unread) {
            readUnreadAccounts(endpointId);
        }
    }, [endpointId, unread]);

    if (target === null) {
        return null;
    }
    const name = choice.nameOf(target);
    const go = (): void => {
        setBusy(true);
        performAsPerson('chat.continueOn', { chatId, account: target.id })
            .catch((e: unknown) =>
                useToasts.getState().show({
                    kind: 'error',
                    title: t('limit.continueFailed', { account: name }),
                    description: e instanceof Error ? e.message : String(e)
                })
            )
            .finally(() => setBusy(false));
    };
    return (
        <Tooltip label={t('limit.continueOnTip', { account: name })}>
            <Button
                variant="secondary"
                size="sm"
                className="shrink-0 gap-1.5 whitespace-nowrap"
                disabled={busy}
                aria-label={t('limit.continueOnAria', { account: name })}
                onClick={go}
            >
                {t('limit.continueOn')}
                <AccountDot color={target.account.color} className="size-1.75" />
                {name}
            </Button>
        </Tooltip>
    );
}

/* At the top of the composer while the last turn stopped on a limit: what stopped it, when it goes on, and the switch. */
export function LimitDock({ chatId, info }: { chatId: string; info: ChatInfo }) {
    const { t } = useTranslation('chat');
    useFormatLocale();
    const now = useNow(MINUTE_MS, info.limit !== undefined);
    const choice = useAccountChoice(info.provider, info.account);
    const view = limitView(info, now);
    if (view === null) {
        return null;
    }
    // With a choice of accounts the line names the one that ran into the limit.
    const account = choice === null ? null : choice.current === null ? choice.currentId : choice.nameOf(choice.current);
    const detail = account === null ? view.detail : view.detail === null ? account : `${account} · ${view.detail}`;
    return (
        <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
            <Icon icon={Hourglass} size={16} className="shrink-0 text-text-faint" />
            <span className="flex min-w-0 grow flex-col">
                <span className="truncate text-sm text-text">{view.title}</span>
                {detail !== null && <span className="truncate text-xs tabular-nums text-text-faint">{detail}</span>}
            </span>
            {choice !== null && info.limit?.kind === 'usage' && <ContinueOn chatId={chatId} info={info} choice={choice} />}
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
