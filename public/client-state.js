// Only phase changes or our own locked vote replace the room screen.
// Other players voting must not interrupt a selection or keyboard focus.
export function screenKey(state) {
  return [state.code, state.game, state.phase, state.round, state.reveal, state.voted].join(':');
}
export function acceptSnapshot(current, incoming) {
  return !current || (current.code === incoming.code && incoming.revision >= current.revision);
}
export function canSelect(state, id) {
  return state.phase === 'voting' && !state.voted && state.players.some(p => p.id === id) && !state.used.includes(id);
}
export function normalizeCode(value) { return String(value).replace(/\s/g, '').toUpperCase(); }
