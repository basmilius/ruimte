import { rm } from 'node:fs/promises';
import { join } from 'node:path';

/*
 * What an earlier Ruimte wrote under the machine's home and nothing reads any more. The grants of port
 * sharing go at the first start without it: left in place, an older Ruimte started on this home would
 * share those ports again with the account's other clients, long after a person stopped seeing them.
 */
export async function removeRetiredFiles(home: string): Promise<void> {
    await rm(join(home, 'ports', 'grants.json'), { force: true });
}
