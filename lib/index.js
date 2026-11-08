// Host half. The folder-drop loader requires a real entry exporting `apply`, even when
// all the work happens in the browser half (declared by dsh.client + exports "./client").
// Keeping this a no-op means the plugin registers no host services, no routes and no patches.
export const name = 'dsh-bubble-quote-ink'
export function apply() {}
