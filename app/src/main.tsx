import { ThemeProvider } from '@unityevolv/ofiskit-ui-map'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App.js'
import './styles.css'

/**
 * The single-office app.
 *
 * One office and nothing else: no header, no navigation, no product identity.
 * The map fills the window and the controls bar sits at the bottom. All of that
 * arrives with the stories that build it; what is here is the entry point and
 * the theme, which every unitykit component follows.
 */
const root = document.getElementById('root')
if (!root) throw new Error('The page has no #root to mount into.')

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
