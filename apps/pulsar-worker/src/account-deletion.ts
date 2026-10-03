import { AccountDeletePayloadSchema, accountConfirmationName, confirmsAccountDeletion } from '@ruimte/pulsar';
import type { Env } from './env.ts';
import { clientIp, failure, noContent, readBody } from './http.ts';
import { LIMITS, overAnyLimit } from './rate-limit.ts';
import { authenticate } from './sessions.ts';

const PUSH_HANDLES = 'SELECT handle FROM push_device WHERE account_id = ?1';

/*
 * Every row bound to an account, children before the rows they reference, so the batch holds whether or
 * not D1 enforces the foreign keys. A machine leaves by its row going, the way `DELETE /v1/machines/<id>`
 * takes one off without a `removed_machine` note: nothing is left to note it on. The rate limit windows
 * keyed on the account or its sessions go with the daily cleanup.
 */
const ACCOUNT_DELETION = [
    `DELETE FROM push_activity WHERE handle IN (${PUSH_HANDLES})`,
    `DELETE FROM push_activity_start WHERE handle IN (${PUSH_HANDLES})`,
    `DELETE FROM push_receipt WHERE handle IN (${PUSH_HANDLES})`,
    'DELETE FROM push_device WHERE account_id = ?1',
    'DELETE FROM identity_link_code WHERE account_id = ?1',
    'DELETE FROM identity_link_request WHERE account_id = ?1',
    'DELETE FROM login_attempt WHERE link_account_id = ?1',
    'DELETE FROM login_code WHERE account_id = ?1',
    'DELETE FROM device_link WHERE account_id = ?1',
    'DELETE FROM statement_log WHERE account_id = ?1',
    'DELETE FROM device WHERE account_id = ?1',
    'DELETE FROM removed_machine WHERE account_id = ?1',
    'DELETE FROM machine WHERE account_id = ?1',
    'DELETE FROM identity WHERE account_id = ?1',
    'DELETE FROM session WHERE account_id = ?1',
    'DELETE FROM account WHERE id = ?1'
];

/*
 * `DELETE /v1/account`. Besides a live access token the body carries the name the person typed, compared
 * with the account as it stands now. One batch, so an account is either all there or all gone; a sign-in
 * with one of its identities afterwards opens a new account.
 */
export const deleteAccount = async (request: Request, env: Env): Promise<Response> => {
    const session = await authenticate(request, env.DB);
    if (!session) {
        return failure('unauthorized', 'Sign in again');
    }
    const limited = await overAnyLimit(env.DB, [
        [`account:${session.account.id}:delete`, LIMITS.deleteAccount],
        [`ip:${clientIp(request)}:session`, LIMITS.sessionIp]
    ]);
    if (limited) {
        return limited;
    }
    const body = await readBody(request, AccountDeletePayloadSchema);
    if ('response' in body) {
        return body.response;
    }
    if (!confirmsAccountDeletion(session.account, body.value.confirmation)) {
        return failure('confirmation-mismatch', `Type ${accountConfirmationName(session.account)} to delete this account`);
    }
    await env.DB.batch(ACCOUNT_DELETION.map((query) => env.DB.prepare(query).bind(session.account.id)));
    return noContent();
};
