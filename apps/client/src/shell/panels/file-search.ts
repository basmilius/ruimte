export type FileSearchResult = { kind: 'ready'; files: readonly string[] } | { kind: 'error'; message: string };

export class FileSearch {
    private generation = 0;

    async search(run: () => Promise<{ files: readonly string[] }>): Promise<FileSearchResult | null> {
        const generation = ++this.generation;
        let result: FileSearchResult;
        try {
            result = { kind: 'ready', files: (await run()).files };
        } catch (error) {
            result = { kind: 'error', message: error instanceof Error ? error.message : String(error) };
        }
        return generation === this.generation ? result : null;
    }

    invalidate(): void {
        this.generation++;
    }
}
