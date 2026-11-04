import { UMBRA } from '@extensions/theme-umbra/client/theme';
import { defineBuiltIn, defineTheme } from '@/extensions/internal';
import manifest from '../manifest.json';

defineBuiltIn(manifest, () => [defineTheme(UMBRA)]);
