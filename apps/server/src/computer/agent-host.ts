import type { ComputerUse } from './computer-use.ts';

export type ComputerHost = Pick<ComputerUse, 'enabled' | 'apps' | 'operate' | 'treeView'>;
