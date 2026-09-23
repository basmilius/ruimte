import { NOTE_COLOR_NAMES, type NoteColor } from '@ruimte/contracts';

/* Every color is a token in styles.css with a light and a dark value. The name a person reads is
   `noteColors.<id>` in the canvas namespace, fetched where it is drawn. */
const NOTE_COLOR_CLASSES: Record<NoteColor, string> = {
    yellow: 'bg-note-yellow',
    green: 'bg-note-green',
    blue: 'bg-note-blue',
    pink: 'bg-note-pink',
    gray: 'bg-note-gray'
};

export const NOTE_COLORS: readonly { id: NoteColor; className: string }[] = NOTE_COLOR_NAMES.map((id) => ({ id, className: NOTE_COLOR_CLASSES[id] }));

export const DEFAULT_NOTE_COLOR: NoteColor = NOTE_COLOR_NAMES[0];

const isNoteColor = (color: string | undefined): color is NoteColor => (NOTE_COLOR_NAMES as readonly (string | undefined)[]).includes(color);

export const noteColorClass = (color: string | undefined): string => NOTE_COLOR_CLASSES[isNoteColor(color) ? color : DEFAULT_NOTE_COLOR];
