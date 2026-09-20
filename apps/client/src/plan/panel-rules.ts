import type { PlanAnchor } from '@/state/ui';

/* How long the anchor's chat stays out of sight before the panel closes. A pan past it leaves the panel up. */
export const PLAN_CLOSE_DELAY_MS = 250;

export interface PlanPanelState {
    anchor: PlanAnchor | null;
    open: boolean;
}

/* The timer the close waits on, injected so a test decides when time passes. */
export interface PlanClock {
    setTimeout(run: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
}

export interface PlanPanelIo {
    get(): PlanPanelState;
    set(state: PlanPanelState): void;
    clock: PlanClock;
}

/*
 * When the plan panel opens and closes, and which plan it shows. The anchor moves on a new plan from
 * a chat on screen, on a press of a pill, and goes when its chat or plan goes; nothing else moves it,
 * so a busy canvas never makes the panel jump. Open follows from the anchor: open while its chat is
 * in sight, closed a moment after it left, and closed for good once a person closed it, until the
 * pill or a new plan of that chat asks again.
 */
export class PlanPanelRules {
    private inSight: ReadonlySet<string> = new Set();
    private timer: unknown = null;
    private readonly io: PlanPanelIo;

    constructor(io: PlanPanelIo) {
        this.io = io;
    }

    /* The chats on screen now, as `chatsInSight` measured them. */
    sight(chatIds: ReadonlySet<string>): void {
        this.inSight = chatIds;
        this.settle();
    }

    /* A new plan. Only a chat on screen takes the panel; true when it did. */
    created(chatId: string, planId: string): boolean {
        if (!this.inSight.has(chatId)) {
            return false;
        }
        this.anchorOn(chatId, planId);
        return true;
    }

    /* A person pressed the pill, which opens the panel even when they closed it before. */
    pill(chatId: string, planId: string): void {
        this.anchorOn(chatId, planId);
    }

    /* A plan picked in the panel's own header is the same chat, so nothing about open or closed changes. */
    pick(planId: string): void {
        const { anchor, open } = this.io.get();
        if (anchor !== null && anchor.planId !== planId) {
            this.io.set({ anchor: { ...anchor, planId }, open });
        }
    }

    close(): void {
        const { anchor } = this.io.get();
        this.cancel();
        this.io.set({ anchor: anchor === null ? null : { ...anchor, dismissed: true }, open: false });
    }

    gone(): void {
        this.cancel();
        this.io.set({ anchor: null, open: false });
    }

    /* Puts open back in line with the anchor and the chats in sight; also after the anchor was restored from a file. */
    settle(): void {
        const { anchor, open } = this.io.get();
        if (anchor === null || anchor.dismissed) {
            this.cancel();
            if (open) {
                this.io.set({ anchor, open: false });
            }
            return;
        }
        if (this.inSight.has(anchor.chatId)) {
            this.cancel();
            if (!open) {
                this.io.set({ anchor, open: true });
            }
            return;
        }
        if (!open) {
            this.cancel();
            return;
        }
        if (this.timer !== null) {
            return;
        }
        this.timer = this.io.clock.setTimeout(() => {
            this.timer = null;
            const current = this.io.get();
            if (current.open && current.anchor !== null && !this.inSight.has(current.anchor.chatId)) {
                this.io.set({ anchor: current.anchor, open: false });
            }
        }, PLAN_CLOSE_DELAY_MS);
    }

    dispose(): void {
        this.cancel();
    }

    private anchorOn(chatId: string, planId: string): void {
        this.cancel();
        this.io.set({ anchor: { chatId, planId, dismissed: false }, open: true });
    }

    private cancel(): void {
        if (this.timer !== null) {
            this.io.clock.clearTimeout(this.timer);
            this.timer = null;
        }
    }
}
