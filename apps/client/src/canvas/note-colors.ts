/* The colors a note can take; every one is a token in styles.css with a light and a dark value. */
export const NOTE_COLORS = [
    { id: 'yellow', label: 'Yellow', className: 'bg-note-yellow' },
    { id: 'green', label: 'Green', className: 'bg-note-green' },
    { id: 'blue', label: 'Blue', className: 'bg-note-blue' },
    { id: 'pink', label: 'Pink', className: 'bg-note-pink' },
    { id: 'gray', label: 'Gray', className: 'bg-note-gray' }
] as const;

export const DEFAULT_NOTE_COLOR = NOTE_COLORS[0].id;

export const noteColorClass = (color: string | undefined): string => (NOTE_COLORS.find((entry) => entry.id === color) ?? NOTE_COLORS[0]).className;
