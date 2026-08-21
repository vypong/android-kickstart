// Colour codes are emitted only when stdout is a real terminal. Piping to a file, a pager,
// or a build log otherwise fills it with literal escape sequences. Honours NO_COLOR
// (https://no-color.org) and FORCE_COLOR.
const enabled =
  !process.env.NO_COLOR &&
  (process.env.FORCE_COLOR === '1' || Boolean(process.stdout.isTTY));

const code = (n) => (enabled ? `\x1b[${n}m` : '');

export const C = {
  dim: code(2),
  red: code(31),
  green: code(32),
  yellow: code(33),
  cyan: code(36),
  bold: code(1),
  off: code(0),
};

export const colorEnabled = enabled;
