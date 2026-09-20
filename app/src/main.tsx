import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './styles.css'

/**
 * The single-office app.
 *
 * One office and nothing else: no header, no navigation, no product identity.
 * The map fills the window and the controls bar sits at the bottom. All of that
 * arrives with the stories that build it; this is the entry point, so the
 * directory is real and the workspace builds.
 */
const root = document.getElementById('root')
if (!root) throw new Error('The page has no #root to mount into.')

createRoot(root).render(<StrictMode />)
