// Shared labels only. Actual prompt pools stay on the server.
export const GAME_MODES = Object.freeze({
 family: {label:'Family Friendly', symbol:'♡', count:250, ageRestricted:false, description:'All-ages fun. Warm, silly questions for friends and family.'},
 judgmental: {label:'Extra Judgmental', symbol:'✳', count:250, ageRestricted:false, description:'Clean but merciless. Petty habits, dramatic friends, and everyday roasts.'},
 adults: {label:'Adults Only', symbol:'18+', count:250, ageRestricted:true, description:'Explicit, 18+ only. Profanity, drinking, dating, and non-graphic sexual humor.'}
});
export function getGameMode(id) { return Object.hasOwn(GAME_MODES,id) ? GAME_MODES[id] : undefined; }
