// @ts-check
/**
 * Bracket styles for the clan and role components of a nametag.
 *
 * Kept as data rather than a switch statement so the settings UI can enumerate
 * the options, and so adding a style is one line rather than an edit in three
 * places.
 */

/**
 * @typedef {object} BracketStyle
 * @property {string} id
 * @property {string} label  shown in the settings dropdown
 * @property {string} open
 * @property {string} close
 */

/** @type {BracketStyle[]} */
export const BRACKET_STYLES = [
  { id: 'off', label: 'None', open: '', close: '' },
  { id: 'square', label: 'Square  [ ]', open: '[', close: ']' },
  { id: 'angled', label: 'Angled  < >', open: '<', close: '>' },
  { id: 'curly', label: 'Curly  { }', open: '{', close: '}' },
  { id: 'bar', label: 'Bar  | |', open: '|', close: '|' },
  { id: 'star', label: 'Star  * *', open: '*', close: '*' },
  { id: 'dash', label: 'Dash  - -', open: '-', close: '-' },
];

/**
 * @param {string} id
 * @returns {BracketStyle}
 */
export function bracketStyle(id) {
  return BRACKET_STYLES.find((style) => style.id === id) ?? BRACKET_STYLES[0];
}

/**
 * Wraps text in a bracket style. The brackets take the surrounding colour and
 * the text its own, so a coloured tag still reads as one unit.
 *
 * @param {string} text
 * @param {string} styleId
 * @param {string} bracketColor
 * @param {string} textColor
 * @returns {string}
 */
export function wrap(text, styleId, bracketColor, textColor) {
  const style = bracketStyle(styleId);
  if (style.open === '') return `${textColor}${text}`;
  return `${bracketColor}${style.open}${textColor}${text}${bracketColor}${style.close}`;
}

/**
 * The dropdown index of a style id, for pre-selecting the current value.
 *
 * @param {string} id
 * @returns {number}
 */
export function bracketIndex(id) {
  const index = BRACKET_STYLES.findIndex((style) => style.id === id);
  return index < 0 ? 0 : index;
}
