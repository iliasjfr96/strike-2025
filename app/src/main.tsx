import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Pas de <React.StrictMode> : il double les effets du canvas moteur (react-dev.md).
createRoot(document.getElementById('root')!).render(<App />)
