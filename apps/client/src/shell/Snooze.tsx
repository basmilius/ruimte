import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlarmClock, AlarmClockOff } from 'lucide-react';
import { formatClock, formatMoment, formatWeekdayClock } from '@adecore/ui/format';
import { Icon, IconButton, Menu, Tooltip, ContextMenu } from '@adecore/ui';
import { SNOOZE_CHOICES, snoozeUntil, useSnoozedUntil, useSnoozes, type SnoozeChoice } from '@/state/snooze';

/* The moment a choice lands on, beside its name: a clock today, a weekday for tomorrow. */
function choiceHint(choice: SnoozeChoice, now: number): string {
    const until = snoozeUntil(choice, now);
    return choice === 'tomorrow' ? formatWeekdayClock(until) : formatClock(until);
}

function snooze(endpointId: string, nodeId: string, choice: SnoozeChoice): void {
    useSnoozes.getState().snooze(endpointId, nodeId, snoozeUntil(choice, Date.now()));
}

/* The moment a menu opened, which is what its hints are read from; a render has no business asking the clock. */
function useOpenedAt(): [number, (open: boolean) => void] {
    const [openedAt, setOpenedAt] = useState(0);
    const onOpenChange = (open: boolean): void => {
        if (open) {
            setOpenedAt(Date.now());
        }
    };
    return [openedAt, onOpenChange];
}

/* The corner of a "Needs you" row, shown while the pointer is on it. */
export function SnoozeButton({ endpointId, nodeId, tabIndex }: { endpointId: string; nodeId: string; tabIndex?: number }) {
    const { t } = useTranslation('shell');
    const [openedAt, onOpenChange] = useOpenedAt();
    return (
        <Menu.Root onOpenChange={onOpenChange}>
            <IconButton
                icon={AlarmClock}
                size="xs"
                label={t('snooze.action')}
                className="hover:bg-surface-active"
                tabIndex={tabIndex}
                render={<Menu.Trigger />}
            />
            <Menu.Popup align="end" className="min-w-44">
                {SNOOZE_CHOICES.map((choice) => (
                    <Menu.Item key={choice} onClick={() => snooze(endpointId, nodeId, choice)}>
                        {t(`snooze.choices.${choice}`)}
                        <Menu.Hint>{choiceHint(choice, openedAt)}</Menu.Hint>
                    </Menu.Item>
                ))}
            </Menu.Popup>
        </Menu.Root>
    );
}

/*
 * The rows a context menu of a waiting node starts with: Snooze while it waits, Unsnooze once it is
 * snoozed, and nothing at all for a node that is neither.
 */
export function SnoozeMenuItems({ endpointId, nodeId, needsYou }: { endpointId: string; nodeId: string; needsYou: boolean }) {
    const { t } = useTranslation('shell');
    const until = useSnoozedUntil(endpointId, nodeId);
    const [openedAt, onOpenChange] = useOpenedAt();
    if (until !== null) {
        return (
            <>
                <ContextMenu.Item onClick={() => useSnoozes.getState().unsnooze(endpointId, nodeId)}>
                    <Icon icon={AlarmClockOff} size={14} /> {t('snooze.unsnooze')}
                    <ContextMenu.Hint>{formatMoment(until)}</ContextMenu.Hint>
                </ContextMenu.Item>
                <ContextMenu.Separator />
            </>
        );
    }
    if (!needsYou) {
        return null;
    }
    return (
        <>
            <ContextMenu.SubmenuRoot onOpenChange={onOpenChange}>
                <ContextMenu.SubmenuTrigger>
                    <Icon icon={AlarmClock} size={14} /> {t('snooze.action')}
                </ContextMenu.SubmenuTrigger>
                <ContextMenu.Popup className="min-w-44">
                    {SNOOZE_CHOICES.map((choice) => (
                        <ContextMenu.Item key={choice} onClick={() => snooze(endpointId, nodeId, choice)}>
                            {t(`snooze.choices.${choice}`)}
                            <ContextMenu.Hint>{choiceHint(choice, openedAt)}</ContextMenu.Hint>
                        </ContextMenu.Item>
                    ))}
                </ContextMenu.Popup>
            </ContextMenu.SubmenuRoot>
            <ContextMenu.Separator />
        </>
    );
}

/* Says a node is snoozed and until when; the context menu of its row is where it ends. */
export function SnoozedMark({ until }: { until: number }) {
    const { t } = useTranslation('shell');
    return (
        <Tooltip label={t('snooze.until', { time: formatMoment(until) })}>
            <span className="inline-flex shrink-0 items-center text-text-faint">
                <Icon icon={AlarmClock} size={12} />
            </span>
        </Tooltip>
    );
}
