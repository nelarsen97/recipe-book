// Splitting an ingredient string into its leading quantity and fixed text,
// for provision mode (see app/recipe/[id].tsx). Recipes still store plain
// strings — this parsing exists only at display/provision time.

export type ParsedIngredient = {
  /** Leading number as written, e.g. "400" or "1.5"; null when the text doesn't start with one. */
  qty: string | null;
  /** Everything after the number, verbatim (e.g. "g tomato", " onions"); the whole text when qty is null. */
  rest: string;
};

// Fractions are deliberately not special-cased: "1/2 cup" parses as
// qty "1" + rest "/2 cup", which still round-trips through provisionIngredient.
const LEADING_QTY = /^\s*(\d+(?:\.\d+)?)(.*)$/s;

export function parseIngredient(text: string): ParsedIngredient {
  const match = LEADING_QTY.exec(text);
  if (!match) return { qty: null, rest: text };
  return { qty: match[1], rest: match[2] };
}

/**
 * Reduce free keyboard input to a plausible quantity: digits plus at most one
 * decimal point. May return "" or a partial like "." or "200." while the user
 * is mid-edit; provisionIngredient treats those as "no usable override".
 */
export function sanitizeQty(input: string): string {
  const cleaned = input.replace(/[^0-9.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot === -1) return cleaned;
  return cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '');
}

/**
 * Compose the string that actually gets provisioned (copied/posted): the
 * override quantity, when usable, spliced in front of the fixed text. The
 * stored recipe string is never modified.
 */
export function provisionIngredient(text: string, override?: string): string {
  const { qty, rest } = parseIngredient(text);
  if (qty === null) return text;
  const effective = override?.replace(/\.$/, '');
  if (effective === undefined || effective === '' || effective === '.') return qty + rest;
  return effective + rest;
}
