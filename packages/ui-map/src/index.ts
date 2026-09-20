/**
 * The office you can see.
 *
 * React DOM, built on unitykit, and deliberately not platform-agnostic: this is
 * the package that holds the web-only half, so everything below it can run on a
 * phone. Its components arrive with the stories that build them.
 *
 * Nothing here chooses a colour. Every surface is a kit component with a
 * theme-aware background, because the office background is whatever an author
 * generated and nothing legible can be guaranteed on top of it.
 */
export { ThemeProvider, useTheme, type Theme, type ThemeChoice } from './theme.js'
