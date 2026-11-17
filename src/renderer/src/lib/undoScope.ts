/**
 * Where Undo and Redo go right now.
 *
 * The Windows menu catches Ctrl+Z and Ctrl+Y before a popup sees them, so a
 * popup with its own history (the table editor) registers here while it is
 * open, and the app's Undo and Redo use it instead of the document's.
 */
export const undoScope: { current: ((dir: 'undo' | 'redo') => boolean) | null } = { current: null }
