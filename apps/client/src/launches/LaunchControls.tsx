import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Circle, CircleAlert, CircleCheck, CircleDot, CircleX, OctagonX, Play, RotateCw, Square, type LucideIcon } from 'lucide-react';
import { Icon, IconButton, Spinner, type IconButtonSize } from '@basmilius/desktop-ui';
import { startLaunch, stopLaunch } from '@/launches/actions';
import type { LaunchHeld } from '@ruimte/contracts';
import type { LaunchPhase, LaunchView } from '@/launches/model';

const STATUS_ICON: Record<Exclude<LaunchPhase, 'starting' | 'stopping'>, { icon: LucideIcon; className: string }> = {
    idle: { icon: Circle, className: 'text-text-faint' },
    held: { icon: CircleAlert, className: 'text-text-faint' },
    running: { icon: CircleDot, className: 'text-positive' },
    passed: { icon: CircleCheck, className: 'text-positive' },
    failed: { icon: CircleX, className: 'text-status-error' }
};

/* A task that ended shows how it ended as a ring, so it never reads as a service that runs. */
function dotClass(view: LaunchView): string {
    const ended = view.launch.kind === 'task' && (view.phase === 'passed' || view.phase === 'failed');
    if (ended) {
        return clsx('border-2 bg-transparent', view.phase === 'passed' ? 'border-positive' : 'border-status-error');
    }
    switch (view.phase) {
        case 'starting':
        case 'stopping':
            return 'bg-status-running animate-pulse';
        case 'running':
            return 'bg-positive';
        case 'failed':
            return 'bg-status-error';
        default:
            return 'bg-text-faint';
    }
}

/* The phase as a dot, small enough to sit on a button's icon. */
/* One launch waiting on approval, with every variable the approval covers, since a change to those alone asks again. */
export function HeldCommand({ held }: { held: LaunchHeld }) {
    return (
        <code className="block rounded-md bg-surface-sunken px-2 py-1.5 font-mono break-all text-text">
            {Object.entries(held.env ?? {}).map(([key, value]) => (
                <span key={key} className="block">
                    <span className="text-text-faint">{key}=</span>
                    {value}
                </span>
            ))}
            <span className="text-text-faint">{held.cwd} $ </span>
            {held.command}
        </code>
    );
}

export function LaunchDot({ view, className }: { view: LaunchView; className?: string }) {
    const { t } = useTranslation('launches');
    return <span role="img" aria-label={t(`phase.${view.phase}`)} className={clsx('inline-block h-2 w-2 shrink-0 rounded-full', dotClass(view), className)} />;
}

/* The phase of a launch as an icon, in the color of its status. */
export function LaunchStatusIcon({ view, size = 12, className }: { view: LaunchView; size?: number; className?: string }) {
    const { t } = useTranslation('launches');
    const label = t(`phase.${view.phase}`);
    if (view.phase === 'starting' || view.phase === 'stopping') {
        return <Spinner size={size} label={label} className={clsx('shrink-0 text-status-running', className)} />;
    }
    const { icon, className: color } = STATUS_ICON[view.phase];
    return (
        <span role="img" aria-label={label} className={clsx('inline-flex shrink-0', color, className)}>
            <Icon icon={icon} size={size} />
        </span>
    );
}

export function LaunchButtons({ view, size = 'sm' }: { view: LaunchView; size?: IconButtonSize }) {
    const { t } = useTranslation('launches');
    const { launch, phase } = view;
    if (phase === 'stopping') {
        return <IconButton icon={OctagonX} size={size} label={t('forceStop', { name: launch.name })} onClick={() => void stopLaunch(launch.id, true)} />;
    }
    if (view.live) {
        return (
            <>
                <IconButton
                    icon={RotateCw}
                    size={size}
                    label={t('restart', { name: launch.name })}
                    onClick={() => void startLaunch(launch.id, { restart: true })}
                />
                <IconButton
                    icon={Square}
                    size={size}
                    iconClassName="fill-current"
                    label={t('stop', { name: launch.name })}
                    onClick={() => void stopLaunch(launch.id)}
                />
            </>
        );
    }
    return (
        <IconButton
            icon={Play}
            size={size}
            iconClassName="fill-current"
            label={t('start', { name: launch.name })}
            onClick={() => void startLaunch(launch.id)}
        />
    );
}
