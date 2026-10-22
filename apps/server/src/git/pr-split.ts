import { splitChanges, type ChangeSplit, type GitPullRequest } from '@ruimte/contracts';
import { ghOutput, graphql, pagesOf, runGh, type GhRunner } from './github.ts';

// Ten pages of a hundred. A pull request past this is one whose split nobody reads file by file anyway.
export const MAX_SPLIT_FILES = 1000;

// Pull requests whose split is kept; each is four pairs of numbers.
const KEPT = 200;

const FILES_QUERY = `query($owner:String!,$name:String!,$number:Int!,$endCursor:String){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      files(first:100,after:$endCursor){
        nodes{path additions deletions}
        pageInfo{hasNextPage endCursor}}
    }
  }
}`;

interface FilesPage {
    files?: { nodes?: Array<{ path?: string; additions?: number; deletions?: number }> };
}

/*
 * The split of a pull request from GitHub's list of its files, every page of it. Null when the pull
 * request has too many files, or when the list came back shorter than GitHub's own totals, so a split
 * that is shown always adds up to the `+N -N` beside it.
 */
export async function readPrSplit(run: GhRunner, cwd: string, pr: GitPullRequest): Promise<ChangeSplit | null> {
    const [owner, name] = pr.repo.split('/');
    if (owner === undefined || name === undefined || pr.added === undefined || pr.deleted === undefined || pr.changedFiles === undefined) {
        return null;
    }
    if (pr.changedFiles > MAX_SPLIT_FILES) {
        return null;
    }
    const output = await ghOutput(run, graphql(FILES_QUERY, { owner, name, number: pr.number }), cwd, 'pr-not-found');
    const files = pagesOf<FilesPage>(output).flatMap((page) => page.files?.nodes ?? []);
    const read = files.flatMap((file) =>
        typeof file.path === 'string' && typeof file.additions === 'number' && typeof file.deletions === 'number'
            ? [{ path: file.path, added: file.additions, deleted: file.deletions }]
            : []
    );
    if (read.length !== pr.changedFiles) {
        return null;
    }
    const split = splitChanges(read);
    const lines = Object.values(split);
    const added = lines.reduce((total, kind) => total + kind.added, 0);
    const deleted = lines.reduce((total, kind) => total + kind.deleted, 0);
    return added === pr.added && deleted === pr.deleted ? split : null;
}

/*
 * The splits read so far, by the head and the totals they were read at, so asking again for a pull
 * request that did not move asks GitHub nothing. A read that failed is forgotten, so the next ask tries again.
 */
export class PrSplits {
    private readonly known = new Map<string, Promise<ChangeSplit | null>>();
    // The pull requests `git.pr` answered, by folder and number, so the client's ask for the split needs no second read of one.
    private readonly answered = new Map<string, GitPullRequest>();
    private readonly run: GhRunner;

    constructor(run: GhRunner) {
        this.run = run;
    }

    /* Keeps a pull request a client was answered and starts reading its split, which that client asks for next. */
    note(cwd: string, pr: GitPullRequest): void {
        const key = `${cwd}\0${pr.number}`;
        this.answered.delete(key);
        this.answered.set(key, pr);
        for (const oldest of this.answered.keys()) {
            if (this.answered.size <= KEPT) {
                break;
            }
            this.answered.delete(oldest);
        }
        void this.of(cwd, pr);
    }

    /* The split of a pull request at this head, read again from GitHub when it was not answered here; null once it moved. */
    async splitAt(cwd: string, number: number, headSha: string, read: () => Promise<GitPullRequest | null>): Promise<ChangeSplit | null> {
        const noted = this.answered.get(`${cwd}\0${number}`);
        const pr = noted?.headSha === headSha ? noted : await read();
        return pr === null || pr.headSha !== headSha ? null : await this.of(cwd, pr);
    }

    of(cwd: string, pr: GitPullRequest): Promise<ChangeSplit | null> {
        const key = `${pr.repo}#${pr.number}@${pr.headSha}:${pr.added}:${pr.deleted}:${pr.changedFiles}`;
        const kept = this.known.get(key);
        if (kept !== undefined) {
            this.known.delete(key);
            this.known.set(key, kept);
            return kept;
        }
        const reading = readPrSplit(this.run, cwd, pr).catch(() => {
            if (this.known.get(key) === reading) {
                this.known.delete(key);
            }
            return null;
        });
        this.known.set(key, reading);
        for (const oldest of this.known.keys()) {
            if (this.known.size <= KEPT) {
                break;
            }
            this.known.delete(oldest);
        }
        return reading;
    }
}

export const prSplits = new PrSplits(runGh);
