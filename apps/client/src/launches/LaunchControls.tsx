import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { OctagonX, Play, RotateCw, Square } from 'lucide-react';
import { IconButton, Menu } from '@basmilius/react-ui';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { startLaunch, stopLaunch } from '@/launches/actions';
import type { LaunchView } from '@/launches/model';

/* A task that ended shows how it ended as a ring, so it never reads as a service that runs. */
const dotClass = (view: LaunchView): string => {
    const ended = view.launch.kind === 'task' && (view.phase === 'passed' || view.phase === 'failed');
    if (ended) {
        return clsx('border-2 bg-transparent', view.phase === 'passed' ? 'border-positive' : 'border-status-error');
    }
    switch (view.phase) {
        case 'held':
            return 'bg-status-needs-you';
        case 'starting':
        case 'stopping':
            return 'animate-pulse bg-status-running';
        case 'running':
            return 'bg-positive';
        case 'failed':
            return 'bg-status-error';
        default:
            return 'bg-text-faint';
    }
};

export function LaunchDot({ view }: { view: LaunchView }) {
    const { t } = useTranslation('launches');
    return <span role="img" aria-label={t(`phase.${view.phase}`)} className={clsx('inline-block h-2 w-2 shrink-0 rounded-full', dotClass(view))} />;
}

/*
 * In a menu row each button is an item of its own, so the arrow keys reach it and a press leaves the menu open.
 * `chosen` is the launch on the chip, the one the shortcuts act on.
 */
export function LaunchButtons({ view, inMenu = false, chosen = false }: { view: LaunchView; inMenu?: boolean; chosen?: boolean }) {
    const { t } = useTranslation('launches');
    const { launch, phase } = view;
    const render = inMenu ? <Menu.Item unstyled closeOnClick={false} /> : undefined;
    const runKeys = chosen ? CANVAS_SHORTCUTS.launchRun : undefined;
    const stopKeys = chosen ? CANVAS_SHORTCUTS.launchStop : undefined;
    if (phase === 'stopping') {
        return (
            <IconButton
                icon={OctagonX}
                size="sm"
                label={t('forceStop', { name: launch.name })}
                className="text-status-error"
                render={render}
                onClick={() => void stopLaunch(launch.id, true)}
            />
        );
    }
    if (view.live) {
        return (
            <>
                <IconButton
                    icon={RotateCw}
                    size="sm"
                    label={t('restart', { name: launch.name })}
                    kbd={runKeys}
                    render={render}
                    onClick={() => void startLaunch(launch.id, { restart: true })}
                />
                <IconButton
                    icon={Square}
                    size="sm"
                    label={t('stop', { name: launch.name })}
                    kbd={stopKeys}
                    render={render}
                    onClick={() => void stopLaunch(launch.id)}
                />
            </>
        );
    }
    return (
        <IconButton icon={Play} size="sm" label={t('start', { name: launch.name })} kbd={runKeys} render={render} onClick={() => void startLaunch(launch.id)} />
    );
}
