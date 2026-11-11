/* Lucide ships types only for its ES build; the CommonJS build exports the same names (`extensions/host/named-icon.tsx`). */
declare module 'lucide-react/dist/cjs/lucide-react.js' {
    export const icons: typeof import('lucide-react').icons;
}
