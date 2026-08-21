// Minimal, deterministic template engine. Supports {{var}}, {{#if flag}}...{{else}}...{{/if}}
// and {{#unless flag}}. No dependencies, no eval. Conditionals are line-oriented: a line that
// contains only a tag is removed entirely rather than left as a blank line.

const TAG = /\{\{\s*(#if|#unless|else|\/if|\/unless)?\s*([A-Za-z0-9_.]*)\s*\}\}/;

function truthy(ctx, key) {
  const v = key.split('.').reduce((o, k) => (o == null ? o : o[k]), ctx);
  return Array.isArray(v) ? v.length > 0 : Boolean(v);
}

function lookup(ctx, key) {
  const v = key.split('.').reduce((o, k) => (o == null ? o : o[k]), ctx);
  return v == null ? '' : String(v);
}

export function render(template, ctx) {
  const lines = template.split('\n');
  const out = [];
  // stack of { active, taken } - taken tracks whether a branch already emitted
  const stack = [{ active: true, taken: true }];

  for (const line of lines) {
    const m = line.match(TAG);
    const isBlockTag = m && m[1];
    const aloneOnLine = isBlockTag && line.trim() === m[0].trim();

    if (isBlockTag && aloneOnLine) {
      const [, kind, key] = m;
      const parentActive = stack[stack.length - 1].active;
      if (kind === '#if' || kind === '#unless') {
        const val = kind === '#if' ? truthy(ctx, key) : !truthy(ctx, key);
        stack.push({ active: parentActive && val, taken: val });
      } else if (kind === 'else') {
        const top = stack[stack.length - 1];
        const grandparent = stack[stack.length - 2]?.active ?? true;
        top.active = grandparent && !top.taken;
        top.taken = true;
      } else {
        stack.pop();
      }
      continue;
    }

    if (!stack[stack.length - 1].active) continue;
    out.push(line.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (_, key) => lookup(ctx, key)));
  }

  if (stack.length !== 1) throw new Error('unbalanced {{#if}} / {{/if}} in template');
  // collapse 3+ blank lines left behind by stripped blocks
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}
