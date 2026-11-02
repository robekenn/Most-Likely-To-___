import {prompts} from './prompts.js';
import {judgmentalPrompts} from './judgmental-prompts.js';
import {adultsPrompts} from './adults-prompts.js';
export const PROMPT_POOLS = Object.freeze({family:prompts, judgmental:judgmentalPrompts, adults:adultsPrompts});
