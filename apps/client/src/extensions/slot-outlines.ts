import { create } from 'zustand';

/* Under `extension dev`: every slot on its spot, with its name and what it tells, so an author sees where things can go. */
export const useSlotOutlines = create<{ on: boolean }>(() => ({ on: false }));
