import { SECTION_LABEL } from '@/ui/classes';
import { LimitsList } from '@/shell/usage/LimitsList';
import { useMinute, useUsageLimits } from '@/shell/usage/limits';

/*
 * What is left of each plan, asked of the CLIs themselves. Nothing here reads a credential: both
 * CLIs hold their own login and answer the question when the daemon starts one and asks.
 */
export function UsageLimits() {
    const limits = useUsageLimits();
    const now = useMinute();

    if (limits === null) {
        return null;
    }
    return (
        <section className="flex flex-col gap-3">
            <h2 className={SECTION_LABEL}>Limits</h2>
            <p className="text-xs text-text-muted">
                The mark on a bar is how much of its window has passed. A bar that has run past its mark is spending faster than the window gives back.
            </p>
            <LimitsList limits={limits} now={now} />
        </section>
    );
}
