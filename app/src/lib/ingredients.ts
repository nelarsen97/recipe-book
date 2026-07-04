// Splitting an ingredient string into its leading quantity and fixed text,
// for provision mode (see app/recipe/[id].tsx). Recipes still store plain
// strings — this parsing exists only at display/provision time.

export type ParsedIngredient = {
  /** Leading quantity as written, e.g. "400", "1.5", "1/2", "1 1/2"; null when the text doesn't start with one. */
  qty: string | null;
  /** Everything after the quantity, verbatim (e.g. "g tomato", " onions"); the whole text when qty is null. */
  rest: string;
};

// A quantity is a mixed number ("1 1/2"), a fraction ("1/2"), or a plain
// integer/decimal ("3", "1.5"), tried in that order so the longest form wins.
const LEADING_QTY = /^\s*(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)(.*)$/s;

export function parseIngredient(text: string): ParsedIngredient {
  const match = LEADING_QTY.exec(text);
  if (!match) return { qty: null, rest: text };
  return { qty: match[1], rest: match[2] };
}

/** Keep only the first occurrence of `ch` in `s`, dropping the rest. */
function keepFirst(s: string, ch: string): string {
  const [head, ...tail] = s.split(ch);
  return tail.length === 0 ? s : head + ch + tail.join('');
}

/**
 * Reduce free keyboard input to a plausible quantity: digits, at most one
 * decimal point, at most one fraction slash, and single spaces (for mixed
 * numbers like "1 1/2"). May return "" or a partial like "." or "1/" while
 * the user is mid-edit; provisionIngredient treats anything without a digit
 * as "no usable override".
 */
export function sanitizeQty(input: string): string {
  const cleaned = input.replace(/[^0-9./ ]/g, '').replace(/ {2,}/g, ' ');
  return keepFirst(keepFirst(cleaned, '.'), '/');
}

/**
 * Compose the string that actually gets provisioned (copied/posted): the
 * override quantity, when usable, spliced in front of the fixed text. The
 * stored recipe string is never modified.
 */
export function provisionIngredient(text: string, override?: string): string {
  const { qty, rest } = parseIngredient(text);
  if (qty === null) return text;
  // Drop mid-edit leftovers ("200." -> "200", "1/" -> "1"); an override
  // without any digit left means "nothing typed", so keep the original.
  const effective = override?.trim().replace(/[./ ]+$/, '');
  if (!effective || !/\d/.test(effective)) return qty + rest;
  return effective + rest;
}
