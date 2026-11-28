import type { MachineStepRun, RunMachineStep } from '../extensions/machine-steps.ts';

interface Outcome {
    /* What it writes on its output. */
    lines?: readonly string[];
    /* What it writes beside its output, as a program says why it failed. */
    errors?: readonly string[];
    /* 0 without one. */
    code?: number | null;
    /* Stays up until `finish` is called or a person stops it, as a build that takes long does. */
    stays?: boolean;
}

/* What runs the programs of a machine start in a test: nothing. It keeps what was asked and answers what a test scripted. */
export class FakeMachineSteps {
    /* Every program asked for, oldest first. */
    readonly ran: MachineStepRun[] = [];
    private readonly outcomes = new Map<string, Outcome>();
    private readonly staying = new Map<string, (code: number | null) => void>();

    /* What the program with this command line writes and ends with. */
    script(commandLine: string, outcome: Outcome): void {
        this.outcomes.set(commandLine, outcome);
    }

    /* Ends a program that stays up. */
    finish(commandLine: string, code: number | null = 0): void {
        this.staying.get(commandLine)?.(code);
    }

    readonly run: RunMachineStep = (step, hooks) => {
        const commandLine = [step.command, ...step.args].join(' ');
        const outcome = this.outcomes.get(commandLine) ?? {};

        this.ran.push(step);

        for (const line of outcome.lines ?? []) {
            hooks.line(line, 'out');
        }

        for (const line of outcome.errors ?? []) {
            hooks.line(line, 'err');
        }

        if (outcome.stays !== true) {
            return Promise.resolve(outcome.code ?? 0);
        }

        return new Promise((resolve) => {
            const end = (code: number | null): void => {
                this.staying.delete(commandLine);
                resolve(code);
            };

            this.staying.set(commandLine, end);
            // A stop asks the program to end, and this one does, by the signal.
            hooks.signal.addEventListener('abort', () => end(null), { once: true });
        });
    };
}
