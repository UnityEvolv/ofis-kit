import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/**
 * Unmount what a test rendered, before the next one runs.
 *
 * Testing Library does this by itself when `afterEach` is a global, and this
 * repository does not turn Vitest's globals on — so without this, every render
 * piles up in the same document and the second test to query by role finds two
 * of everything. The failure reads as "found multiple elements", which sounds
 * like a bug in the component and is not.
 */
afterEach(cleanup)
