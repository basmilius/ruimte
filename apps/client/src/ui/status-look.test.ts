import { describe, expect, test } from 'bun:test';
import { CircleCheck, CircleSlash, CircleX, Hourglass, LoaderCircle } from 'lucide-react';
import { statusLookOf, taskStatusWord } from '@/ui/status-look';

describe('how a state looks', () => {
    test('every state has one icon and one tone, and only running spins', () => {
        expect(statusLookOf('running')).toEqual({ icon: LoaderCircle, tone: 'text-status-running', spins: true });
        expect(statusLookOf('paused')).toEqual({ icon: Hourglass, tone: 'text-text-faint', spins: false });
        expect(statusLookOf('done')).toEqual({ icon: CircleCheck, tone: 'text-status-idle', spins: false });
        expect(statusLookOf('failed')).toEqual({ icon: CircleX, tone: 'text-status-error', spins: false });
        expect(statusLookOf('cancelled')).toEqual({ icon: CircleSlash, tone: 'text-text-faint', spins: false });
    });

    test("a task's open state is the running one everything else draws, and paused while its child waits out a limit", () => {
        expect(taskStatusWord({ status: 'open' })).toBe('running');
        expect(taskStatusWord({ status: 'open', paused: { kind: 'usage', until: 1 } })).toBe('paused');
        expect(taskStatusWord({ status: 'cancelled' })).toBe('cancelled');
        // A task that settled after its pause says how it settled.
        expect(taskStatusWord({ status: 'done', paused: { kind: 'overload' } })).toBe('done');
    });
});
