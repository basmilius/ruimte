/* The colors a note can take; every one is a token in styles.css with a light and a dark value. The
   name a person reads is `noteColors.<id>` in the canvas namespace, fetched where it is drawn. */
export const NOTE_COLORS = [
    { id: 'yellow', className: 'bg-note-yellow' },
    { id: 'green', className: 'bg-note-green' },
    { id: 'blue', className: 'bg-note-blue' },
    { id: 'pink', className: 'bg-note-pink' },
    { id: 'gray', className: 'bg-note-gray' }
] as const;

export const DEFAULT_NOTE_COLOR = NOTE_COLORS[0].id;

export const noteColorClass = (color: string | undefined): string => (NOTE_COLORS.find((entry) => entry.id === color) ?? NOTE_COLORS[0]).className;
