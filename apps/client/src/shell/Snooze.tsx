import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Menu } from '@base-ui-components/react/menu';
import { AlarmClock, AlarmClockOff, ChevronRight } from 'lucide-react';
import { formatClock, formatMoment, formatWeekdayClock } from '@/format/datetime';
import { SNOOZE_CHOICES, snoozeUntil, useSnoozedUntil, useSnoozes, type SnoozeChoice } from '@/state/snooze';
import { MENU_HINT, MENU_SEPARATOR } from '@ruimte/ui/classes';
import { Icon } from '@ruimte/ui/Icon';
import { MenuPopup } from '@ruimte/ui/MenuPopup';
import { Tooltip } from '@ruimte/ui/Tooltip';

/* The moment a choice lands on, beside its name: a clock today, a weekday for tomorrow. */
const choiceHint = (choice: SnoozeChoice, now: number): string => {
    const until = snoozeUntil(choice, now);
    return choice === 'tomorrow' ? formatWeekdayClock(until) : formatClock(until);
};

const snooze = (endpointId: string, nodeId: string, choice: SnoozeChoice): void => {
    useSnoozes.getState().snooze(endpointId, nodeId, snoozeUntil(choice, Date.now()));
};

/* The moment a menu opened, which is what its hints are read from; a render has no business asking the clock. */
const useOpenedAt = (): [number, (open: boolean) => void] => {
    const [openedAt, setOpenedAt] = useState(0);
    const onOpenChange = (open: boolean): void => {
        if (open) {
            setOpenedAt(Date.now());
        }
    };
    return [openedAt, onOpenChange];
};

/* The corner of a "Needs you" row, shown while the pointer is on it. */
export function SnoozeButton({ endpointId, nodeId, tabIndex }: { endpointId: string; nodeId: string; tabIndex?: number }) {
    const { t } = useTranslation('shell');
    const [openedAt, onOpenChange] = useOpenedAt();
    return (
        <Menu.Root onOpenChange={onOpenChange}>
            <Tooltip label={t('snooze.action')} name>
                <Menu.Trigger className="icon-btn icon-btn-xs hover:bg-surface-active" tabIndex={tabIndex}>
                    <Icon icon={AlarmClock} size={12} />
                </Menu.Trigger>
            </Tooltip>
            <MenuPopup align="end" className="min-w-44">
                {SNOOZE_CHOICES.map((choice) => (
                    <Menu.Item key={choice} className="menu-item" onClick={() => snooze(endpointId, nodeId, choice)}>
                        {t(`snooze.choices.${choice}`)}
                        <span className={MENU_HINT}>{choiceHint(choice, openedAt)}</span>
                    </Menu.Item>
                ))}
            </MenuPopup>
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
                <ContextMenu.Item className="menu-item" onClick={() => useSnoozes.getState().unsnooze(endpointId, nodeId)}>
                    <Icon icon={AlarmClockOff} size={14} /> {t('snooze.unsnooze')}
                    <span className={MENU_HINT}>{formatMoment(until)}</span>
                </ContextMenu.Item>
                <ContextMenu.Separator className={MENU_SEPARATOR} />
            </>
        );
    }
    if (!needsYou) {
        return null;
    }
    return (
        <>
            <ContextMenu.SubmenuRoot onOpenChange={onOpenChange}>
                <ContextMenu.SubmenuTrigger className="menu-item">
                    <Icon icon={AlarmClock} size={14} /> {t('snooze.action')}
                    <Icon icon={ChevronRight} size={14} className="ml-auto text-text-faint" />
                </ContextMenu.SubmenuTrigger>
                <ContextMenu.Portal>
                    <ContextMenu.Positioner className="z-(--z-popup)" sideOffset={4} alignOffset={-4}>
                        <ContextMenu.Popup className="menu-popup min-w-44">
                            {SNOOZE_CHOICES.map((choice) => (
                                <ContextMenu.Item key={choice} className="menu-item" onClick={() => snooze(endpointId, nodeId, choice)}>
                                    {t(`snooze.choices.${choice}`)}
                                    <span className={MENU_HINT}>{choiceHint(choice, openedAt)}</span>
                                </ContextMenu.Item>
                            ))}
                        </ContextMenu.Popup>
                    </ContextMenu.Positioner>
                </ContextMenu.Portal>
            </ContextMenu.SubmenuRoot>
            <ContextMenu.Separator className={MENU_SEPARATOR} />
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
