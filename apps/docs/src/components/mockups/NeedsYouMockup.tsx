import clsx from 'clsx';
import { MockStage } from './MockStage';
import { StatusDot } from './parts';

const WAITING: readonly { readonly title: string; readonly ask: string; readonly project: string }[] = [
    { title: 'Saved carts', ask: 'Asks: How long should a saved cart last?', project: 'shop' },
    { title: 'Release', ask: 'Wants to run: git push origin main', project: 'shop' },
    { title: 'Docs agent', ask: 'Wants to edit: README.md', project: 'website' }
];

const CHOICES = ['7 days', '30 days', 'Until the person empties it'];

/* What waits for you, oldest first, and a question answered in place. */
export function NeedsYouMockup() {
    return (
        <MockStage
            width={640}
            height={300}
            caption="The Needs you list, with what each agent asks. The first one is a question, answered in place by picking one of its choices."
        >
            <div className="flex size-full gap-4 p-4">
                <div className="flex w-60 shrink-0 flex-col gap-2">
                    <div className="px-1 text-2xs font-medium tracking-wide text-text-faint uppercase">Needs you</div>
                    {WAITING.map((item, index) => (
                        <div
                            key={item.title}
                            className={clsx('rounded-lg border bg-surface px-3 py-2', index === 0 ? 'border-status-needs-you/50' : 'border-border')}
                        >
                            <div className="flex items-center gap-1.5 text-2xs font-medium text-text">
                                <StatusDot status="needs-you" pulse={index === 0} />
                                <span className="grow truncate">{item.title}</span>
                                <span className="font-normal text-text-faint">{item.project}</span>
                            </div>
                            <div className="mt-1 truncate text-2xs text-text-muted">{item.ask}</div>
                        </div>
                    ))}
                </div>
                <div className="flex grow flex-col rounded-xl border border-border bg-surface px-4 py-3">
                    <div className="text-2xs font-medium text-status-needs-you">Question</div>
                    <div className="mt-1 text-xs text-text">How long should a saved cart last?</div>
                    <div className="mt-3 space-y-1.5">
                        {CHOICES.map((choice, index) => (
                            <div
                                key={choice}
                                className={clsx(
                                    'rounded-md border px-3 py-1.5 text-2xs',
                                    index === 1 ? 'border-accent bg-accent/10 text-text' : 'border-border text-text-muted'
                                )}
                            >
                                {choice}
                            </div>
                        ))}
                        <div className="rounded-md border border-dashed border-border px-3 py-1.5 text-2xs text-text-faint">Something else…</div>
                    </div>
                    <div className="mt-auto flex justify-end">
                        <span className="rounded-md bg-text px-3 py-1 text-2xs font-medium text-bg">Answer</span>
                    </div>
                </div>
            </div>
        </MockStage>
    );
}
