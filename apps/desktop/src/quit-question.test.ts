import { describe, expect, test } from 'bun:test';
import { quitQuestion } from './quit-question';

const NO_WINDOW_WORK = { working: 0, attention: 0 };

describe('quitQuestion', () => {
    test('with every window closed, the machine says what a quit would end', () => {
        const question = quitQuestion({ survives: false, windows: NO_WINDOW_WORK, machine: { terminals: 0, agents: 2 } });
        expect(question).toMatchObject({ buttons: ['Quit anyway', 'Keep working'], defaultId: 1, cancelId: 1, message: '2 agents are still working.' });
        expect(question?.detail).toBe('Quitting ends their sessions on this machine.');
    });

    test('a terminal running something counts as well when the quit ends it', () => {
        expect(quitQuestion({ survives: false, windows: NO_WINDOW_WORK, machine: { terminals: 1, agents: 0 } })?.message).toBe(
            'A terminal is still running something.'
        );
        expect(quitQuestion({ survives: false, windows: NO_WINDOW_WORK, machine: { terminals: 3, agents: 1 } })?.message).toBe(
            'An agent and 3 terminals are still running.'
        );
    });

    test('the windows count when the machine cannot say, and the larger count wins when both do', () => {
        expect(quitQuestion({ survives: false, windows: { working: 1, attention: 0 }, machine: null })?.message).toBe('An agent is still working.');
        expect(quitQuestion({ survives: false, windows: { working: 3, attention: 0 }, machine: { terminals: 0, agents: 1 } })?.message).toBe(
            '3 agents are still working.'
        );
    });

    test('nothing to ask when nothing runs', () => {
        expect(quitQuestion({ survives: false, windows: NO_WINDOW_WORK, machine: { terminals: 0, agents: 0 } })).toBeNull();
        expect(quitQuestion({ survives: false, windows: NO_WINDOW_WORK, machine: null })).toBeNull();
    });

    test('where the work outlives the quit, only the agents the windows count are mentioned, and quitting is the default', () => {
        expect(quitQuestion({ survives: true, windows: NO_WINDOW_WORK, machine: null })).toBeNull();
        expect(quitQuestion({ survives: true, windows: { working: 1, attention: 0 }, machine: null })).toMatchObject({
            buttons: ['Quit', 'Cancel'],
            defaultId: 0,
            message: 'An agent is still working.',
            detail: 'They keep running on this machine after Ruimte quits, and you can pick them up from any client.'
        });
    });
});

test('the quit question follows the app language, including after its windows close', () => {
    const stopped = quitQuestion({ language: 'nl', survives: false, windows: NO_WINDOW_WORK, machine: { agents: 1, terminals: 2 } });
    expect(stopped?.buttons).toEqual(['Toch afsluiten', 'Verder werken']);
    expect(stopped?.message).toBe('Een agent en 2 terminals zijn nog actief.');
    expect(stopped?.defaultId).toBe(1);
    const service = quitQuestion({ language: 'nl-NL', survives: true, windows: { working: 1, attention: 0 }, machine: null });
    expect(service?.message).toBe('Er is nog een agent aan het werk.');
    expect(service?.detail).toContain('blijven');
});
