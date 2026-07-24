/**
 * Minimal, deterministic boolean-expression evaluator for case-law rule
 * detection tests, e.g.:
 *   "criteria_source_is_proprietary AND NOT aligns_with(ASAM | LOCUS | CALOCUS)"
 *
 * Grammar:
 *   expr   := orE
 *   orE    := andE (OR andE)*
 *   andE   := notE (AND notE)*
 *   notE   := NOT notE | primary
 *   primary:= '(' expr ')' | atom
 *   atom   := IDENT ( '(' IDENT ('|' IDENT)* ')' )?
 *
 * Predicate atoms are evaluated by a caller-supplied function. This is a lookup
 * over registered predicates — an LLM never evaluates a rule.
 */

type Tok =
  | { t: 'and' }
  | { t: 'or' }
  | { t: 'not' }
  | { t: 'lp' }
  | { t: 'rp' }
  | { t: 'pipe' }
  | { t: 'ident'; v: string };

function tokenize(input: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const c = input[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '(') {
      toks.push({ t: 'lp' });
      i++;
      continue;
    }
    if (c === ')') {
      toks.push({ t: 'rp' });
      i++;
      continue;
    }
    if (c === '|') {
      toks.push({ t: 'pipe' });
      i++;
      continue;
    }
    const m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(input.slice(i));
    if (m) {
      const word = m[0];
      const upper = word.toUpperCase();
      if (upper === 'AND') toks.push({ t: 'and' });
      else if (upper === 'OR') toks.push({ t: 'or' });
      else if (upper === 'NOT') toks.push({ t: 'not' });
      else toks.push({ t: 'ident', v: word });
      i += word.length;
      continue;
    }
    throw new Error(`Unexpected character '${c}' in detection expression: ${input}`);
  }
  return toks;
}

export type PredicateEval = (name: string, args: string[]) => boolean;

export function evaluateExpression(input: string, evalPredicate: PredicateEval): boolean {
  const toks = tokenize(input);
  let pos = 0;

  const peek = (): Tok | undefined => toks[pos];
  const next = (): Tok => {
    const t = toks[pos];
    if (!t) throw new Error(`Unexpected end of detection expression: ${input}`);
    pos++;
    return t;
  };

  const parseAtom = (): boolean => {
    const id = next();
    if (id.t !== 'ident') throw new Error(`Expected identifier in expression: ${input}`);
    const args: string[] = [];
    if (peek()?.t === 'lp') {
      next(); // consume '('
      while (peek() && peek()!.t !== 'rp') {
        const a = next();
        if (a.t === 'ident') args.push(a.v);
        else if (a.t === 'pipe') continue;
        else throw new Error(`Unexpected token in argument list: ${input}`);
      }
      if (peek()?.t !== 'rp') throw new Error(`Unclosed '(' in expression: ${input}`);
      next(); // consume ')'
    }
    return evalPredicate(id.v, args);
  };

  const parsePrimary = (): boolean => {
    if (peek()?.t === 'lp') {
      next();
      const v = parseOr();
      if (peek()?.t !== 'rp') throw new Error(`Unclosed '(' in expression: ${input}`);
      next();
      return v;
    }
    return parseAtom();
  };

  const parseNot = (): boolean => {
    if (peek()?.t === 'not') {
      next();
      return !parseNot();
    }
    return parsePrimary();
  };

  function parseAnd(): boolean {
    let v = parseNot();
    while (peek()?.t === 'and') {
      next();
      const r = parseNot();
      v = v && r;
    }
    return v;
  }

  function parseOr(): boolean {
    let v = parseAnd();
    while (peek()?.t === 'or') {
      next();
      const r = parseAnd();
      v = v || r;
    }
    return v;
  }

  const result = parseOr();
  if (pos !== toks.length) throw new Error(`Trailing tokens in detection expression: ${input}`);
  return result;
}
