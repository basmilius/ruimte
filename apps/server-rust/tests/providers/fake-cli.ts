export interface FakeIo {
    readonly argv: string[];
    readonly cwd: string;
    out(frame: unknown): void;
    exit(code: number): void;
    later(work: () => void): void;
}

export interface FakeProgram {
    onLine(line: string): void;
}

export type FakeCli = (io: FakeIo) => FakeProgram;

export const runOverStdio = async (cli: FakeCli): Promise<void> => {
    const program = cli({
        argv: process.argv.slice(2),
        cwd: process.cwd(),
        out: (frame) => {
            process.stdout.write(`${JSON.stringify(frame)}\n`);
        },
        exit: (code) => process.exit(code),
        later: (work) => {
            setImmediate(work);
        }
    });
    const decoder = new TextDecoder();
    let buffered = '';
    for await (const chunk of Bun.stdin.stream()) {
        buffered += decoder.decode(chunk, { stream: true });
        let newline = buffered.indexOf('\n');
        while (newline >= 0) {
            const line = buffered.slice(0, newline);
            buffered = buffered.slice(newline + 1);
            newline = buffered.indexOf('\n');
            if (line.trim() !== '') {
                program.onLine(line);
            }
        }
    }
    process.exit(0);
};
