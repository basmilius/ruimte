import { isValidConfig } from '@adecore/database';
import type { DatabaseConnection } from '@ruimte/contracts';
import { asViewConnections } from '@/database/connections';

/* What can be saved, rather than a draft a person is still filling in: a new SQLite connection without a whole path, or a host cleared to type another. */
export function isSavable(connection: DatabaseConnection): boolean {
    const [view] = asViewConnections([connection]);
    return connection.id !== '' && view !== undefined && isValidConfig(view.config);
}
