import {
    canvas,
    defineAction,
    defineCanvasOverlay,
    defineDiffViewer,
    defineFileIcon,
    defineFileViewer,
    defineMarkdownBlock,
    defineMenu,
    defineNode,
    defineOverlay,
    defineTemplate,
    defineView,
    files,
    getServer,
    host,
    views,
    type NodeInfo,
    type NodeRef,
    type Result
} from '@ruimte/extension/client';
import type { BoardwalkServer } from '../server/index';
import { boardOf, boardText, CARD_NODE, migrateCard, NEW_CARD, type CardData } from './board';

const BOARD_FILE = 'boardwalk.board';
const server = getServer<BoardwalkServer>();

/* An action that throws shows the person why, so a refusal ends one that way. */
function valueOf<Value>(result: Result<Value>): Value {
    if (!result.ok) {
        throw new Error(result.error.message);
    }

    return result.value;
}

function isCard(node: NodeInfo): boolean {
    return node.extension?.type === CARD_NODE;
}

function addCard(card: CardData, near?: NodeRef[]): NodeRef {
    return valueOf(canvas.createNode(CARD_NODE, { data: card, title: card.title, ...(near === undefined ? {} : { near }) }));
}

defineNode<CardData>({
    id: CARD_NODE,
    title: 'Boardwalk card',
    icon: 'sticky-note',
    size: { width: 240, height: 120 },
    initialData: NEW_CARD,
    dataVersion: 2,
    migrate: migrateCard,
    component: () => import('./CardNode')
});

const board = defineView<{ board: string }>({ id: 'board', title: 'Boardwalk board', icon: 'kanban', component: () => import('./BoardView') });
const newCard = defineOverlay<{ after: string | null }, CardData>({ id: 'new-card', title: 'New card', size: 'sm', component: () => import('./NewCard') });

defineCanvasOverlay({ id: 'count', component: () => import('./CardCount') });

defineTemplate({
    id: 'sprint',
    title: 'Sprint board',
    icon: 'kanban',
    create: async ({ at }) => {
        const sprint = valueOf(await server.board());
        const cards = sprint.cards.map((card) => addCard(card));
        const [first] = cards;

        if (first === undefined) {
            return;
        }

        // The grid grows from its first card, so that one goes to the spot a person clicked.
        valueOf(canvas.update(first, { x: at.x, y: at.y }));
        valueOf(canvas.arrange(cards, 'grid'));
    }
});

const add = defineAction({
    id: 'add-card',
    title: 'Add a card',
    icon: 'plus',
    shortcut: 'mod+alt+b',
    slots: { emptyCanvas: true },
    run: async () => {
        const card = await newCard.open({ after: null });

        if (card !== null) {
            canvas.reveal(addCard(card));
        }
    }
});

defineAction({
    id: 'follow-up',
    title: 'Add a card that follows this one',
    icon: 'corner-down-right',
    slots: { nodeHeader: ({ node }) => isCard(node) && { title: 'Follow-up' }, nodeMenu: ({ node }) => isCard(node) },
    run: async ({ node }) => {
        const card = await newCard.open({ after: node.title });

        if (card === null) {
            return;
        }

        const next = addCard(card, [node]);

        valueOf(canvas.link(node, next));
        canvas.reveal(next);
    }
});

defineAction({
    id: 'stack',
    title: 'Stack as a column',
    icon: 'rows-3',
    slots: { selectionBar: ({ nodes }) => nodes.length > 1 && nodes.every(isCard) },
    run: ({ nodes }) => {
        valueOf(canvas.arrange(nodes, 'column'));
        valueOf(canvas.group(nodes));
    }
});

defineAction({
    id: 'unblock',
    title: 'These cards no longer follow each other',
    icon: 'unlink',
    slots: { lineMenu: ({ from, to }) => isCard(from) && isCard(to) },
    run: ({ from, to }) => void valueOf(canvas.unlink(from, to))
});

defineAction({
    id: 'to-card',
    title: 'Turn into a card',
    icon: 'sticky-note',
    slots: { noteToolbar: true },
    run: ({ node }) => canvas.reveal(addCard({ ...NEW_CARD, title: node.title }, [node]))
});

const openBoard = defineAction({
    id: 'open-board',
    title: 'Open the board',
    icon: 'kanban',
    slots: { viewToolbar: ({ view }) => view?.kind === 'canvas' },
    run: () => board.open()
});

const newBoard = defineAction({
    id: 'new-board',
    title: 'New board on a canvas of its own',
    run: async () => {
        const name = await host.prompt({ title: 'Name the board', initial: 'Board' });

        if (name === null || name.trim() === '') {
            return;
        }

        views.open(valueOf(views.createCanvas(name.trim())));
    }
});

defineAction({
    id: 'rename-board',
    title: 'Rename this board',
    icon: 'pencil',
    slots: { viewMenu: ({ target }) => target.kind === 'canvas' },
    run: async ({ target }) => {
        const name = await host.prompt({ title: 'Rename the board' });

        if (name !== null && name.trim() !== '') {
            valueOf(views.rename(target, name.trim()));
        }
    }
});

const exportBoard = defineAction({
    id: 'export',
    title: `Write the board to ${BOARD_FILE}`,
    run: async () => {
        const sprint = valueOf(await server.board());

        if (!(await host.confirm({ title: 'Write the board to a file', body: `Writes ${sprint.name} to ${BOARD_FILE} in the project folder.` }))) {
            return;
        }

        valueOf(await files.write(BOARD_FILE, boardText(boardOf(sprint.name, sprint.columns, sprint.cards))));
        files.open(BOARD_FILE);
    }
});

defineMenu({
    id: 'menu',
    title: 'Boardwalk',
    icon: 'kanban',
    slots: { canvasMenu: true },
    items: [add, openBoard, 'separator', newBoard, exportBoard]
});

defineMarkdownBlock({ language: 'board', component: () => import('./BoardBlock') });
defineFileViewer({ id: 'board', title: 'Board', extensions: ['board'], component: () => import('./BoardFile') });
defineFileIcon({ extensions: ['board'], path: 'assets/board-file.svg' });
defineDiffViewer({ id: 'cards', title: 'Cards', extensions: ['board'], component: () => import('./BoardDiff') });
