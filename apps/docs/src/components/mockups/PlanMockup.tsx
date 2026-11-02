import clsx from 'clsx';
import { MockStage } from './MockStage';

type StepState = 'done' | 'active' | 'open';

const STEPS: readonly { readonly title: string; readonly state: StepState; readonly note?: string }[] = [
    { title: 'Add a carts table', state: 'done' },
    { title: 'Save the cart on every change', state: 'done', note: 'Your note: also on sign-out' },
    { title: 'Restore the cart after sign-in', state: 'active' },
    { title: 'Expire carts after 30 days', state: 'open' },
    { title: 'Test on a phone', state: 'open' }
];

function StepMark({ state }: { readonly state: StepState }) {
    if (state === 'done') {
        return (
            <svg viewBox="0 0 16 16" width={16} height={16} className="shrink-0">
                <circle cx="8" cy="8" r="7" className="fill-status-idle/20" />
                <path d="M5 8.2l2 2 4-4.2" fill="none" className="stroke-status-idle" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        );
    }

    return (
        <span
            className={clsx(
                'inline-block size-4 shrink-0 rounded-full border-2',
                state === 'active' ? 'mock-pulse border-status-running bg-status-running/25' : 'border-border-strong'
            )}
        />
    );
}

/* A chat's plan: steps the agent checks off while it works, with a note a person left on one of them. */
export function PlanMockup() {
    return (
        <MockStage width={560} height={300} caption="A plan beside a chat. Two steps are done, one with a note from you; the agent works on the third.">
            <div className="flex size-full flex-col bg-surface">
                <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4 text-xs">
                    <span className="grow font-medium text-text">Steps</span>
                    <span className="text-text-muted">2 of 5 done</span>
                </div>
                <div className="space-y-1 p-3">
                    {STEPS.map((step) => (
                        <div key={step.title} className={clsx('flex items-start gap-3 rounded-lg px-3 py-2', step.state === 'active' && 'bg-surface-active')}>
                            <StepMark state={step.state} />
                            <div className="min-w-0 grow text-xs">
                                <div className={step.state === 'done' ? 'text-text-muted' : 'text-text'}>{step.title}</div>
                                {step.note !== undefined && <div className="mt-0.5 text-2xs text-text-faint">{step.note}</div>}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </MockStage>
    );
}
