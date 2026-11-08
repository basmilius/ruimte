import type { CloudflaredProcess, CloudflaredRunner } from './cloudflared-runner.ts';

export interface FakeAnswer {
    code?: number;
    lines?: string[];
}

/*
 * A `cloudflared` that runs nothing. Each call is answered by `answer`, keyed on the subcommand; `run` stays
 * alive until it is stopped, like the real child.
 */
export class FakeCloudflared implements CloudflaredRunner {
    readonly calls: string[][] = [];
    readonly answers = new Map<string, FakeAnswer>();
    running = 0;
    private readonly ends: Array<(code: number) => void> = [];

    answer(key: string, answer: FakeAnswer): void {
        this.answers.set(key, answer);
    }

    /* Ends the child the way a crash does. */
    crash(code = 1): void {
        this.ends.splice(0).forEach((end) => end(code));
    }

    start(_binary: string, args: readonly string[], onLine: (line: string) => void): CloudflaredProcess {
        this.calls.push([...args]);

        const key = args.includes('run')
            ? 'run'
            : args.includes('validate')
              ? 'validate'
              : args
                    .filter((arg) => !arg.startsWith('-'))
                    .slice(0, 3)
                    .join(' ');
        const answer = this.answers.get(key) ?? this.answers.get(key.split(' ').slice(0, 2).join(' ')) ?? {};

        if (key === 'run') {
            this.running += 1;
            answer.lines?.forEach(onLine);

            let end: (code: number) => void = () => undefined;
            const exited = new Promise<number>((resolve) => {
                end = resolve;
                this.ends.push(resolve);
            });
            void exited.then(() => {
                this.running -= 1;
            });

            return { exited, stop: () => end(0) };
        }

        answer.lines?.forEach(onLine);

        return { exited: Promise.resolve(answer.code ?? 0), stop: () => undefined };
    }

    /* The calls whose first words are these. */
    called(...words: string[]): string[][] {
        return this.calls.filter((call) => words.every((word) => call.includes(word)));
    }
}
