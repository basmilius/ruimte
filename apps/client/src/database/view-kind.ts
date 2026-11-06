import { isDatabaseView } from '@ruimte/contracts';
import { DatabaseViewKindBody } from '@/database/DatabaseViewKindBody';
import { viewKind } from '@/registry/view-kinds';

export const DATABASE_VIEW_KIND = viewKind({ id: 'database', owns: isDatabaseView, body: DatabaseViewKindBody });
