import { createRoot } from 'react-dom/client';
import { connectFormat } from '@/format/source';
import { initI18n } from '@/i18n';
import { BenchPage } from '@/bench/BenchPage';
import '@/state/theme';
import '@/state/settings';
import '@/styles.css';

connectFormat();
await initI18n();

createRoot(document.getElementById('root')!).render(<BenchPage />);
