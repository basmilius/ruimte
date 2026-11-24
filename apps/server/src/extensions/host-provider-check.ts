/*
 * What Ruimte asks of every host provider, as one check any of them runs in its own tests: `checkHostProvider` of
 * `@ruimte/extension/testing`. It reads through a test server's `hostProvider`, so every answer has already been cut
 * and checked as the machine does it, and what is left to hold is how the parts agree with each other. A provider on
 * a fake service and one on a real host's recorded answers pass the same rules.
 */
import { HOST_CHECK_STATES } from '@ruimte/contracts/host';
import type * as PublicTesting from '../../../../packages/extension/testing';

type Provider = PublicTesting.TestHostProvider;
type Known = NonNullable<Parameters<typeof PublicTesting.checkHostProvider>[1]>;

const NOWHERE = 'https://nowhere.invalid/nobody/nothing.git';
const NO_SUCH = 'no-such-thing-0000';
// Enough pages to see a cursor move on, few enough that a provider whose cursor never ends is found out.
const PAGES = 5;

async function everyPage<Item extends { ref: string }>(
    what: string,
    read: (cursor: string | undefined) => Promise<{ items: Item[]; cursor?: string }>,
    broke: (rule: string) => void
): Promise<Item[]> {
    const all: Item[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < PAGES; page++) {
        const { items, cursor: next } = await read(cursor);

        for (const item of items) {
            if (seen.has(item.ref)) {
                broke(`${what} listed ${item.ref} twice across its pages`);
            }

            seen.add(item.ref);
            all.push(item);
        }

        if (next === undefined) {
            return all;
        }

        if (next === cursor) {
            broke(`${what} answered the cursor it was asked with, so its pages never end`);

            return all;
        }

        cursor = next;
    }

    return all;
}

function idOf(ref: string): string {
    return ref.slice(ref.indexOf(':') + 1);
}

async function checkIssues(provider: Provider, known: Known, broke: (rule: string) => void): Promise<void> {
    const open = await everyPage(
        'issues',
        async (cursor) => {
            const page = await provider.issues({ state: 'open', ...(cursor === undefined ? {} : { cursor }) }, known.scope);

            return { items: page.issues, ...(page.cursor === undefined ? {} : { cursor: page.cursor }) };
        },
        broke
    );
    const closed = (await provider.issues({ state: 'closed' }, known.scope)).issues;

    for (const issue of open.filter((candidate) => candidate.state !== 'open')) {
        broke(`issues listed ${issue.ref} as open while its state is ${issue.state}`);
    }

    for (const issue of closed.filter((candidate) => candidate.state !== 'closed')) {
        broke(`issues listed ${issue.ref} as closed while its state is ${issue.state}`);
    }

    const listed = open[0] ?? closed[0];

    if (listed === undefined) {
        broke('issues listed nothing, open or closed, so nothing else of them could be held');

        return;
    }

    const read = await provider.issue(idOf(listed.ref), known.scope);

    if (read === null) {
        broke(`issues listed ${listed.ref} and then read it as an issue the host does not have`);
    } else if (read.ref !== listed.ref || read.title !== listed.title) {
        broke(`issues read ${listed.ref} as ${read.ref} ${JSON.stringify(read.title)}, which is not what it listed`);
    }

    if ((await provider.issue(NO_SUCH, known.scope)) !== null) {
        broke('issues read an issue that does not exist as one; answer null for it');
    }

    if (!provider.capabilities.parses) {
        return;
    }

    if (listed.url !== undefined && (await provider.parse(listed.url, known.scope)) !== idOf(listed.ref)) {
        broke(`parse did not read the address of ${listed.ref} as that issue`);
    }

    if ((await provider.parse('nothing a tracker would name', known.scope)) !== null) {
        broke('parse read text that names no issue as one; answer null for it');
    }
}

async function checkChanges(provider: Provider, known: Known, broke: (rule: string) => void): Promise<void> {
    const changes = await everyPage(
        'changes',
        async (cursor) => {
            const page = await provider.changes({ state: 'all', ...(cursor === undefined ? {} : { cursor }) }, known.scope);

            return { items: page.changes, ...(page.cursor === undefined ? {} : { cursor: page.cursor }) };
        },
        broke
    );
    const listed = changes.find((change) => change.state === 'open') ?? changes[0];

    if (listed === undefined) {
        broke('changes listed nothing, so nothing else of them could be held');

        return;
    }

    const read = await provider.change(idOf(listed.ref), known.scope);

    if (read === null) {
        broke(`changes listed ${listed.ref} and then read it as a change the host does not have`);

        return;
    }

    if (read.ref !== listed.ref || read.title !== listed.title) {
        broke(`changes read ${listed.ref} as ${read.ref} ${JSON.stringify(read.title)}, which is not what it listed`);
    }

    for (const check of read.checks.filter((candidate) => !HOST_CHECK_STATES.includes(candidate.state))) {
        broke(`the check ${check.name} of ${read.ref} has the state ${String(check.state)}`);
    }

    if (read.state === 'open' && read.branch !== undefined && (await provider.changeOfBranch(read.branch, known.scope)) !== idOf(read.ref)) {
        broke(`forBranch did not find ${read.ref} from its own branch ${read.branch}`);
    }

    if ((await provider.changeOfBranch(`${NO_SUCH}/branch`, known.scope)) !== null) {
        broke('forBranch found a change for a branch that has none; answer null for it');
    }

    if ((await provider.change(NO_SUCH, known.scope)) !== null) {
        broke('changes read a change that does not exist as one; answer null for it');
    }

    if (provider.capabilities.checks && (await provider.checkLog(idOf(read.ref), `${NO_SUCH} check`, known.scope)) !== null) {
        broke('checks gave a log for a check the change does not have; answer null for it');
    }
}

/* Runs every rule against the parts the provider has, and rejects with all it broke at once. */
export async function checkHostProvider(provider: Provider, known: Known = {}): Promise<void> {
    const broken: string[] = [];
    const broke = (rule: string): void => void broken.push(rule);
    const status = await provider.status(known.scope);

    if (status.state !== 'ready') {
        broke(
            `status is ${status.state}${status.reason === undefined ? '' : ` (${status.reason})`}; run the check signed in, on a project the provider applies to`
        );
    }

    if (provider.kind === 'code-host') {
        if (known.scope?.remote === undefined || !(await provider.match(known.scope.remote))) {
            broke('match did not take the remote of the scope; a code host is checked with scope.remote set to one of its own');
        }

        if (await provider.match(NOWHERE)) {
            broke(`match took ${NOWHERE} as its own`);
        }
    }

    if (provider.capabilities.issues) {
        await checkIssues(provider, known, broke);
    }

    if (provider.capabilities.changes) {
        await checkChanges(provider, known, broke);
    }

    if (broken.length > 0) {
        throw new Error(
            `The host provider broke ${broken.length === 1 ? 'a rule' : `${broken.length} rules`}:\n${broken.map((rule) => `- ${rule}`).join('\n')}`
        );
    }
}
