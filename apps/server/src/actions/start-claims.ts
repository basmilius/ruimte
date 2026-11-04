import { join } from 'node:path';
import { RecordDirectory, KeyedSerializer } from '@adecore/agents';
import { ToolRefusal } from '@adecore/agents/context';
import { ActionRefusal } from '@ruimte/actions';
import { z } from 'zod';
import { sha256 } from '../artifacts/artifact-fs.ts';

// How long a request id answers a retry; a claim older than this is forgotten at load and ignored after.
const CLAIM_TTL_MS = 24 * 60 * 60 * 1000;

const ClaimSchema = z.object({
    key: z.string().min(1),
    state: z.enum(['pending', 'done']),
    inputHash: z.string().min(1),
    result: z.unknown().optional(),
    at: z.number()
});

type Claim = z.infer<typeof ClaimSchema>;

export interface StartClaim {
    actor: { kind: string; id: string };
    requestId: string;
    inputHash: string;
}

/* The same command is the same hash: the project and every field of the start except the request id. */
export function startInputHash(projectId: string, input: Record<string, unknown>): string {
    const { requestId: _requestId, ...rest } = input;
    return sha256(JSON.stringify([projectId, rest]));
}

/*
 * What a retried start answers with. A caller that repeats `request_id R` with the same command gets
 * the node, task and worktree the first call made, also after the machine restarted. Under
 * `$RUIMTE_HOME` and not in the project, since an agent with a shell can rewrite the project file and
 * the claim is what keeps a retry from opening a second agent.
 */
export class StartClaims {
    private readonly claims: RecordDirectory<Claim>;
    private readonly queue = new KeyedSerializer();
    private readonly now: () => number;

    constructor(home: string, now: () => number = Date.now) {
        this.now = now;
        this.claims = new RecordDirectory({
            dir: join(home, 'start-claims'),
            schema: ClaimSchema,
            idOf: (claim) => claim.key,
            keep: (claim) => (now() - claim.at > CLAIM_TTL_MS ? null : claim)
        });
    }

    /* Reads the claims an earlier run wrote down. Call before any start can ask. */
    load(): Promise<void> {
        return this.claims.load();
    }

    /*
     * Runs `work` once per request id. A call that finds the first still running waits for it and then
     * reads its outcome. A refusal makes nothing, so it frees the id; any other failure may have made
     * something, so the id stays pending and a retry is told the start was cut off.
     */
    run<T>(claim: StartClaim, work: () => Promise<T>): Promise<T> {
        const key = sha256(JSON.stringify([claim.actor.kind, claim.actor.id, claim.requestId]));
        return this.queue.run(key, async () => {
            const known = this.claims.get(key);
            if (known !== undefined && this.now() - known.at <= CLAIM_TTL_MS) {
                if (known.inputHash !== claim.inputHash) {
                    throw new ToolRefusal(
                        'request-id-reused',
                        `Request id ${claim.requestId} was already used for a different start; a retry repeats the same command, a new start needs a new id`
                    );
                }
                if (known.state === 'done') {
                    return known.result as T;
                }
                throw new ToolRefusal(
                    'request-unsettled',
                    `The start with request id ${claim.requestId} was cut off before it answered; node_list shows whether its agent is there. Start again with a new id if it is not`
                );
            }
            await this.claims.write({ key, state: 'pending', inputHash: claim.inputHash, at: this.now() });
            let result: T;
            try {
                result = await work();
            } catch (e) {
                if (e instanceof ToolRefusal || e instanceof ActionRefusal) {
                    await this.claims.remove(key);
                }
                throw e;
            }
            await this.claims.write({ key, state: 'done', inputHash: claim.inputHash, result, at: this.now() });
            return result;
        });
    }
}
