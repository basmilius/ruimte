interface CommitDraft {
    key: string;
    message: string;
    version?: number;
    source: string;
}

interface SuggestionRequest extends CommitDraft {
    generation: number;
    revision: number;
}

// A late suggestion may be offered beside an edited draft, but cannot belong to a different commit.
export class CommitSuggestion {
    private generation = 0;
    private revision = 0;
    private draft: CommitDraft | null = null;

    observe(draft: CommitDraft): void {
        if (this.draft?.key !== draft.key || this.draft?.source !== draft.source) {
            this.cancel();
        }
        if (this.draft?.message !== draft.message || this.draft?.version !== draft.version) {
            this.revision++;
        }
        this.draft = draft;
    }

    begin(): SuggestionRequest {
        if (this.draft === null) {
            throw new Error('No commit draft');
        }
        return { ...this.draft, generation: ++this.generation, revision: this.revision };
    }

    finish(request: SuggestionRequest, latest?: { message: string; version: number }): 'apply' | 'offer' | 'stale' {
        if (request.generation !== this.generation || request.key !== this.draft?.key || request.source !== this.draft.source) {
            return 'stale';
        }
        if (latest !== undefined) {
            this.observe({ ...this.draft, ...latest });
        }
        return request.revision === this.revision ? 'apply' : 'offer';
    }

    cancel(): void {
        this.generation++;
    }
}
