import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import '@/state/theme';
import '@/styles.css';

createRoot(document.getElementById('root')!).render(<App />);
