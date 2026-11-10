import { isFileView } from '@ruimte/contracts';
import { FileViewKindBody } from '@/files/FileViewKindBody';
import { viewKind } from '@/registry/view-kinds';

export const FILE_VIEW_KIND = viewKind({ id: 'file', owns: isFileView, body: FileViewKindBody });
