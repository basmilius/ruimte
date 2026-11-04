'use client';

import { Input } from '@adecore/ui';
import { FilePlus, FileText, FolderPlus, MoreHorizontal, Search } from 'lucide-react';
import { IconButton } from '../../app/primitives.tsx';
import { Stage } from '../../film/Stage.tsx';
import { CodeView, F, K, S } from './CodeView.tsx';
import { GuideWindow, SidePanel, TreeRow } from './parts.tsx';

const LINES = [
    {
        code: (
            <>
                <K>import</K> {'{ db }'} <K>from</K> <S>'./db'</S>;
            </>
        )
    },
    { code: '' },
    {
        code: (
            <>
                <K>const</K> DAYS_30 = <F>30</F> * <F>86_400_000</F>;
            </>
        )
    },
    { code: '' },
    {
        code: (
            <>
                <K>export function</K> <F>expiresAt</F>(cart: Cart): <F>number</F> {'{'}
            </>
        )
    },
    {
        code: (
            <>
                {' '}
                <K>return</K> cart.savedAt + DAYS_30;
            </>
        )
    },
    { code: '}' },
    { code: '' },
    {
        code: (
            <>
                <K>export async function</K> <F>restoreCart</F>(userId: <F>string</F>) {'{'}
            </>
        )
    },
    {
        code: (
            <>
                {' '}
                <K>const</K> cart = <K>await</K> db.carts.<F>find</F>(userId);
            </>
        )
    },
    {
        code: (
            <>
                {' '}
                <K>return</K> cart && <F>expiresAt</F>(cart) {'>'} Date.<F>now</F>() ? cart : <K>null</K>;
            </>
        )
    },
    { code: '}' }
];

/* The Files panel from the rail beside a file in the editor. */
export function FilesEditor() {
    return (
        <Stage
            width={1040}
            height={540}
            label="The Files panel at the right shows the project as a tree, with a filter above it. The file cart.ts is open in the editor, with line numbers and the status bar under it."
        >
            <GuideWindow
                view={{ icon: FileText, name: 'cart.ts' }}
                selected="cart"
                panel="files"
                sidePanel={
                    <SidePanel
                        title="Files"
                        actions={
                            <>
                                <IconButton icon={FilePlus} size="sm" />
                                <IconButton icon={FolderPlus} size="sm" />
                                <IconButton icon={MoreHorizontal} size="sm" />
                            </>
                        }
                    >
                        <div className="flex shrink-0 px-2 pt-2">
                            <Input icon={Search} className="min-w-0 grow" placeholder="Filter files" readOnly />
                        </div>
                        <div className="flex flex-col gap-px p-2">
                            <TreeRow name=".ruimte" folder="closed" />
                            <TreeRow name="src" folder="open" />
                            <TreeRow name="cart.test.ts" depth={1} />
                            <TreeRow name="cart.ts" depth={1} selected />
                            <TreeRow name="db.ts" depth={1} />
                            <TreeRow name="session.ts" depth={1} />
                            <TreeRow name="package.json" />
                            <TreeRow name="README.md" />
                            <TreeRow name="tsconfig.json" />
                        </div>
                    </SidePanel>
                }
            >
                <CodeView lines={LINES} symbol="restoreCart" caret="Ln 11, Col 45" />
            </GuideWindow>
        </Stage>
    );
}
