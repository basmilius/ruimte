import type { OutboxClock } from '@adecore/agents/coordination';
import { quietState, type PushNotifyKind, type QuietHours } from '@ruimte/contracts';
import type { PushAlertContent } from '@ruimte/pulsar';
import { wakefulClock } from '../outbox/wakeful-clock.ts';

/* An alert a device in quiet hours did not get, kept to announce when they end. */
export interface WithheldAlert {
    content: PushAlertContent;
    issuedAt: number;
    preference: PushNotifyKind;
    ledger: boolean;

    /* A wait's alert, whose body says what the node asks when it goes out rather than when it was raised. */
    wait?: boolean;

    /* The `limitKey` of a usage limit this alert raises, so the release sends one alert per limit of an account. */
    limit?: string;
}

export interface QuietRelease {
    alerts: WithheldAlert[];

    /* Whether an activity push was skipped, so the machine's counts are sent again. */
    activities: boolean;
}

interface QuietHoldOptions {
    clock?: OutboxClock;
    now: () => number;
    subscriptions(): Promise<Array<{ sessionId: string; quietHours?: QuietHours }>>;
    release(sessionId: string, released: QuietRelease): void;
    track(work: Promise<void>): void;
}

interface Held {
    hours: QuietHours;
    alerts: Map<string, WithheldAlert>;
    activities: boolean;
}

function keyOf(content: PushAlertContent): string {
    return content.kind === 'approval' ? `approval:${content.nodeId}:${content.requestId ?? ''}` : `node:${content.nodeId}`;
}

/*
 * What each device in quiet hours missed, in memory only: one alert per node and one per approval request. One
 * timer waits for the soonest end while anything is held, and none runs otherwise. A restart forgets what was
 * held, the way a snooze that ran out while the daemon was down wakes nobody.
 */
export class QuietHold {
    private readonly sessions = new Map<string, Held>();
    private readonly clock: OutboxClock;
    private readonly options: QuietHoldOptions;
    private timer: unknown = null;

    constructor(options: QuietHoldOptions) {
        this.options = options;
        this.clock = wakefulClock(options.clock);
    }

    withhold(sessionId: string, hours: QuietHours, alert: WithheldAlert): void {
        this.heldOf(sessionId, hours).alerts.set(keyOf(alert.content), alert);
        this.arm();
    }

    withholdActivity(sessionId: string, hours: QuietHours): void {
        this.heldOf(sessionId, hours).activities = true;
        this.arm();
    }

    /* Releases what a device no longer is quiet for: hours that ended or changed, or a subscription that is gone. */
    async look(): Promise<void> {
        const subscriptions = await this.options.subscriptions();
        const now = this.options.now();

        for (const [sessionId, held] of [...this.sessions]) {
            const subscription = subscriptions.find((entry) => entry.sessionId === sessionId);

            if (subscription === undefined) {
                this.sessions.delete(sessionId);

                continue;
            }

            if (subscription.quietHours !== undefined) {
                held.hours = subscription.quietHours;

                if (quietState(held.hours, now).quiet) {
                    continue;
                }
            }

            this.sessions.delete(sessionId);
            this.options.release(sessionId, { alerts: [...held.alerts.values()], activities: held.activities });
        }

        this.arm();
    }

    stop(): void {
        if (this.timer !== null) {
            this.clock.clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private heldOf(sessionId: string, hours: QuietHours): Held {
        const held = this.sessions.get(sessionId) ?? { hours, alerts: new Map<string, WithheldAlert>(), activities: false };

        held.hours = hours;
        this.sessions.set(sessionId, held);

        return held;
    }

    private arm(): void {
        this.stop();

        const now = this.options.now();
        const ends = [...this.sessions.values()].flatMap((held) => quietState(held.hours, now).changesAt ?? []);

        if (ends.length === 0) {
            return;
        }

        this.timer = this.clock.setTimeout(
            () => {
                this.timer = null;
                this.options.track(this.look());
            },
            Math.max(0, Math.min(...ends) - now)
        );
    }
}
