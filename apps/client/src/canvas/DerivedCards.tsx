import { useTranslation } from 'react-i18next';
import { ErrorBoundary, LazyBoundary, lazyNamed } from '@adecore/ui';
import { useCanvas } from '@/state/canvas';

const RoutineBeside = lazyNamed(() => import('@/routines/RoutineBeside'), 'RoutineBeside');
const DesignBeside = lazyNamed(() => import('@/design/DesignNode'), 'DesignBeside');

/*
 * What the canvas draws beside a node from that node's data, never stored and never a node in the
 * store: a routine's runs and its Output, and the pages of a design. They follow the node, so selection, lines a person draws
 * and layouts never see them (`DerivedSet`, `derivedOwnerOf`); the minimap, the resize handles and
 * the keys know them only through `derivedCards`.
 */
export function DerivedCards({ stacking }: { stacking: Readonly<Record<string, number>> }) {
    const { t } = useTranslation('canvas');
    const nodes = useCanvas((s) => s.nodes);
    const hidden = useCanvas((s) => s.hidden);
    const owners = Object.values(nodes).filter((node) => (node.kind === 'routine' || node.kind === 'design') && !hidden.has(node.id));
    return owners.map((node) => (
        <ErrorBoundary key={node.id} label={t('node.failed')} compact>
            <LazyBoundary>
                {node.kind === 'routine' ? <RoutineBeside id={node.id} z={stacking[node.id] ?? 1} /> : <DesignBeside id={node.id} z={stacking[node.id] ?? 1} />}
            </LazyBoundary>
        </ErrorBoundary>
    ));
}
