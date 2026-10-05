import { useEffect, useId, useMemo, useState } from 'react';
import clsx from 'clsx';
import { ArrowRight, Check, Info, PanelsTopLeft, Server, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ChatScopeContext } from '@ruimte/agents-react/scope';
import { useProviderAccounts } from '@ruimte/agents-react/state/provider-accounts';
import { useProviders } from '@ruimte/agents-react/state/providers';
import { computerSetupOf } from '@/computer/setup';
import { useComputerMachine } from '@/computer/use-computer-machine';
import { closeOnboarding } from '@/onboarding/open';
import { ComputerTask } from '@/onboarding/ComputerTask';
import { ProvidersTask } from '@/onboarding/ProvidersTask';
import { RowTile, TaskPane } from '@/onboarding/TaskPane';
import {
    cliRowsOf,
    doneCount,
    factsOf,
    firstPlace,
    isDone,
    missingClisOf,
    placeAfter,
    summaryOf,
    taskLine,
    tasksOf,
    type OnboardingFacts,
    type OnboardingPlace,
    type OnboardingTask
} from '@/onboarding/tasks';
import { useComputer } from '@/state/computer';
import { LOCAL_ENDPOINT_ID, useEndpoints, type Endpoint } from '@/state/endpoints';
import { useServers } from '@/state/server';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { chatScopeOf } from '@/transport/chat-scope';
import { machineFor } from '@/transport/connections';
import { useMachineHold } from '@/transport/status';
import { BrandSymbol } from '@/ui/Brand';
import { Eclipse, type EclipseOrbit } from '@/ui/Eclipse';
import { SettingsRow, SettingsSection } from '@adecore/ui/settings';
import { Button, CloseButton, Dialog, Icon, Meter } from '@adecore/ui';

const WELCOME_ORBITS: readonly EclipseOrbit[] = [
    { size: 300, alpha: 0.1 },
    { size: 460, alpha: 0.07, spin: 140, moon: { tone: 'cool', left: 88, top: 24 } },
    { size: 680, alpha: 0.05 }
];

/*
 * The machine this window runs beside, held for as long as the onboarding is up. Its clients are
 * built too, so its providers and accounts reach the stores in a window that points at another machine.
 */
function useLocalMachine(): Endpoint | null {
    const endpoint = useEndpoints((s) => s.endpoints.find((entry) => entry.id === LOCAL_ENDPOINT_ID) ?? null);
    useMachineHold(endpoint);
    useEffect(() => {
        machineFor(LOCAL_ENDPOINT_ID);
    }, []);
    return endpoint;
}

/*
 * The first start of a desktop client: a welcome, then a few short tasks in any order, each with what
 * it asks right beside it. It is about the machine this window runs beside, whatever machine the
 * window has open, and every way out of it counts as having met it.
 */
export function OnboardingDialog() {
    const { t } = useTranslation('onboarding');
    const step = useUi((s) => s.onboarding);
    // What the popup keeps showing while it animates closed, after the step is gone.
    const [shown, setShown] = useState(step);
    const titleId = useId();
    const descriptionId = useId();
    if (step !== null && step !== shown) {
        setShown(step);
    }

    return (
        <Dialog.Root open={step !== null} onOpenChange={(next) => (next ? undefined : closeOnboarding())}>
            <Dialog.Popup
                className={clsx('flex h-[580px] w-[944px]', shown === 'hub' && 'bg-bg')}
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
                onKeyDown={(e) => {
                    // Every open dialog root listens for Escape on the document, so without this one press would close the settings under it too.
                    if (e.key === 'Escape') {
                        e.stopPropagation();
                        closeOnboarding();
                    }
                }}
            >
                <ChatScopeContext.Provider value={chatScopeOf(LOCAL_ENDPOINT_ID)}>
                    {shown === 'hub' ? <Hub titleId={titleId} /> : <Welcome titleId={titleId} />}
                </ChatScopeContext.Provider>
                <p id={descriptionId} className="sr-only">
                    {t('description')}
                </p>
            </Dialog.Popup>
        </Dialog.Root>
    );
}

/* The sky, the icon and two ways on. */
function Welcome({ titleId }: { titleId: string }) {
    const { t } = useTranslation('onboarding');
    // Held from the welcome on, so the list opens on what the machine already said.
    useLocalMachine();
    const platform = useServers((s) => s.byEndpoint[LOCAL_ENDPOINT_ID]?.platform ?? null);
    const status = useComputer((s) => s.statuses[LOCAL_ENDPOINT_ID] ?? null);
    const total = tasksOf(computerSetupOf(status, platform).phase).length;

    return (
        <div className="relative flex min-w-0 grow items-center justify-center">
            <Eclipse center={202} glows={[380, 200]} rings={[150, 190]} orbits={WELCOME_ORBITS} stars={{ count: 46, seed: 202 }} className="h-full" />
            <div className="relative flex flex-col items-center gap-4 px-8 text-center">
                <BrandSymbol size={96} className="rounded-[22px] shadow-float" />
                <h2 id={titleId} className="text-4xl font-semibold tracking-tight text-text">
                    {t('welcome.title')}
                </h2>
                <p className="max-w-[420px] text-base text-text-muted">{t(total === 2 ? 'welcome.bodyTwo' : 'welcome.bodyThree')}</p>
                <div className="mt-2 flex items-center gap-2.5">
                    <Button variant="primary" onClick={() => useUi.getState().setOnboarding('hub')}>
                        {t('welcome.start')}
                    </Button>
                    <Button onClick={closeOnboarding}>{t('welcome.notNow')}</Button>
                </div>
            </div>
        </div>
    );
}

/* The tasks on the left with how far each is, and the one picked on the right. */
function Hub({ titleId }: { titleId: string }) {
    const { t } = useTranslation('onboarding');
    const endpoint = useLocalMachine();
    const machine = endpoint?.label ?? '';
    const introSeen = useSettings((s) => s.onboardingIntroSeen);
    const providers = useProviders((s) => s.providers);
    const accounts = useProviderAccounts((s) => s.accounts);
    // Here and not in the task, so the list sees computer use change while another task is open.
    const computer = useComputerMachine(LOCAL_ENDPOINT_ID);
    const phase = computer.setup.phase;
    const rows = useMemo(() => cliRowsOf(providers, accounts), [providers, accounts]);
    const missing = useMemo(() => missingClisOf(providers), [providers]);
    const facts = useMemo(() => factsOf(introSeen, rows, phase), [introSeen, rows, phase]);
    const tasks = useMemo(() => tasksOf(phase), [phase]);
    const [picked, setPicked] = useState<OnboardingPlace | null>(null);
    // Until a person picks one, the list stands on the first task not done; a task that went away gives way the same.
    const place = picked !== null && (picked === 'done' || tasks.includes(picked)) ? picked : firstPlace(tasks, facts);

    const nextFrom = (task: OnboardingTask): { label: string; go(): void } => {
        const next = placeAfter(tasks, task, facts);
        return {
            label: next === 'done' ? t('hub.finish') : t('hub.next', { task: t(`tasks.${next}.title`) }),
            go: () => setPicked(next)
        };
    };

    const readIntro = (): void => {
        useSettings.getState().update({ onboardingIntroSeen: true });
        setPicked(placeAfter(tasks, 'intro', { ...facts, introSeen: true }));
    };

    return (
        <div className="flex min-w-0 grow">
            <Sidebar titleId={titleId} tasks={tasks} facts={facts} place={place} onPick={setPicked} />
            {place === 'intro' && <IntroTask onRead={readIntro} />}
            {place === 'providers' && (
                <ProvidersTask machine={machine} rows={rows} missing={missing} done={isDone('providers', facts)} next={nextFrom('providers')} />
            )}
            {place === 'computer' && <ComputerTask machine={machine} computer={computer} next={nextFrom('computer')} />}
            {place === 'done' && <DonePane tasks={tasks} facts={facts} />}
        </div>
    );
}

interface SidebarProps {
    titleId: string;
    tasks: readonly OnboardingTask[];
    facts: OnboardingFacts;
    place: OnboardingPlace;
    onPick(task: OnboardingTask): void;
}

function Sidebar({ titleId, tasks, facts, place, onPick }: SidebarProps) {
    const { t } = useTranslation('onboarding');
    const done = doneCount(tasks, facts);
    const count = t('hub.count', { done, total: tasks.length });
    return (
        <nav aria-label={t('hub.tasks')} className="flex w-[322px] shrink-0 flex-col border-r border-border bg-surface bg-clip-padding">
            <div className="px-5 pt-5.5 pb-4">
                <h2 id={titleId} className="text-lg font-semibold text-text">
                    {t('hub.title')}
                </h2>
                <p className="mt-0.5 text-xs text-text-muted">{count}</p>
                <Meter value={done} max={tasks.length} label={t('hub.progress')} valueText={count} className="mt-3" />
            </div>
            <ol className="flex flex-col gap-0.5 px-2.5">
                {tasks.map((task, index) => {
                    const finished = isDone(task, facts);
                    return (
                        <li key={task}>
                            <button
                                type="button"
                                aria-current={place === task ? 'step' : undefined}
                                className={clsx(
                                    'flex min-h-15 w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left',
                                    place === task ? 'bg-text/7' : 'hover:bg-surface-hover'
                                )}
                                onClick={() => onPick(task)}
                            >
                                <span
                                    className={clsx(
                                        'grid size-5.5 shrink-0 place-items-center rounded-full text-xs font-semibold',
                                        finished ? 'bg-status-idle/15 text-status-idle' : 'border border-border-strong text-text-muted'
                                    )}
                                >
                                    {finished ? <Icon icon={Check} size={12} /> : index + 1}
                                </span>
                                <span className="flex min-w-0 grow flex-col">
                                    <span className="truncate text-sm text-text">{t(`tasks.${task}.title`)}</span>
                                    <span className="truncate text-xs text-text-muted">{taskLine(task, facts)}</span>
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ol>
            <p className="mt-auto px-5 py-4 text-xs text-text-faint">{t('hub.closeNote')}</p>
        </nav>
    );
}

const INTRO_ROWS = [
    { id: 'views', icon: PanelsTopLeft },
    { id: 'agents', icon: Terminal },
    { id: 'machines', icon: Server }
] as const;

/* Three things about Ruimte that the rest of the app takes for granted. */
function IntroTask({ onRead }: { onRead(): void }) {
    const { t } = useTranslation('onboarding');
    return (
        <TaskPane
            icon={Info}
            title={t('tasks.intro.title')}
            subtitle={t('tasks.intro.header')}
            footer={
                <>
                    <span className="grow" />
                    <Button variant="primary" onClick={onRead}>
                        {t('intro.gotIt')} <Icon icon={ArrowRight} size={14} />
                    </Button>
                </>
            }
        >
            <SettingsSection>
                {INTRO_ROWS.map((row) => (
                    <SettingsRow
                        key={row.id}
                        leading={
                            <RowTile size="sm">
                                <Icon icon={row.icon} size={14} className="text-text-muted" />
                            </RowTile>
                        }
                        label={t(`intro.${row.id}.title`)}
                        description={t(`intro.${row.id}.body`)}
                    />
                ))}
            </SettingsSection>
        </TaskPane>
    );
}

/* The end of the walk: what is done, what is left and where it waits, and the way into the app. */
function DonePane({ tasks, facts }: { tasks: readonly OnboardingTask[]; facts: OnboardingFacts }) {
    const { t } = useTranslation(['onboarding', 'common']);
    const summary = summaryOf(tasks, facts);
    return (
        <section className="relative flex min-w-0 grow flex-col items-center justify-center gap-3 px-12 text-center" aria-label={t('done.title')}>
            <CloseButton label={t('common:action.close')} dialog className="absolute top-5 right-6" />
            <span className="grid size-13 place-items-center rounded-full bg-status-idle/15 text-status-idle">
                <Icon icon={Check} size={20} />
            </span>
            <h3 className="text-lg font-semibold text-text">{t('done.title')}</h3>
            <p className="max-w-[360px] text-sm text-text-muted">{summary}</p>
            <Button variant="primary" className="mt-2.5" onClick={closeOnboarding}>
                {t('done.start')}
            </Button>
            <p className="mt-2 text-xs text-text-faint">{t('done.reopen')}</p>
        </section>
    );
}
