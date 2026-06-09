import { SelectorInfo } from './types';

interface ParseContext {
  filePath: string;
  source: 'css' | 'scss' | 'vue' | 'jsx';
}

function isAtRule(selector: string): boolean {
  return selector.startsWith('@');
}

function isKeyframeSelector(selector: string): boolean {
  return /^(from|to|\d+%)$/.test(selector.trim());
}

function isPseudoOnly(selector: string): boolean {
  return /^::?[\w-]+$/.test(selector.trim());
}

function extractClassSelectors(selector: string): string[] {
  const results: string[] = [];
  const classRegex = /\.([a-zA-Z_][\w-]*)/g;
  let match: RegExpExecArray | null;
  while ((match = classRegex.exec(selector)) !== null) {
    results.push(match[1]);
  }
  return results;
}

function extractIdSelectors(selector: string): string[] {
  const results: string[] = [];
  const idRegex = /#([a-zA-Z_][\w-]*)/g;
  let match: RegExpExecArray | null;
  while ((match = idRegex.exec(selector)) !== null) {
    results.push(match[1]);
  }
  return results;
}

function extractAttributeSelectors(selector: string): string[] {
  const results: string[] = [];
  const attrRegex = /\[([^\]]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(selector)) !== null) {
    const attrContent = match[1];
    const eqIndex = attrContent.indexOf('=');
    if (eqIndex > 0) {
      const attrName = attrContent.substring(0, eqIndex).trim();
      results.push(`[${attrName}]`);
    } else {
      results.push(`[${attrContent.trim()}]`);
    }
  }
  return results;
}

function findClosingBrace(content: string, start: number): number {
  let depth = 0;
  for (let i = start; i < content.length; i++) {
    if (content[i] === '{') {
      depth++;
    } else if (content[i] === '}') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function findSelectorStart(content: string, bracePos: number): { selector: string; line: number; column: number } {
  let end = bracePos - 1;
  while (end >= 0 && (content[end] === ' ' || content[end] === '\t' || content[end] === '\n' || content[end] === '\r')) {
    end--;
  }
  if (end < 0) {
    return { selector: '', line: 0, column: 0 };
  }

  let start = end;
  let braceDepth = 0;
  while (start >= 0) {
    const ch = content[start];
    if (ch === ')') {
      braceDepth++;
    } else if (ch === '(') {
      braceDepth--;
    } else if (ch === '}' && braceDepth === 0) {
      break;
    } else if ((ch === '\n' || ch === '\r') && braceDepth === 0) {
      const prevNonSpace = content.substring(0, start).trimEnd();
      if (prevNonSpace.length > 0 && !prevNonSpace.endsWith(',')) {
        break;
      }
    }
    start--;
  }
  start++;

  const selector = content.substring(start, end + 1).trim();

  let line = 1;
  let column = 0;
  for (let i = 0; i <= start; i++) {
    if (content[i] === '\n') {
      line++;
      column = 0;
    } else {
      column++;
    }
  }
  column++;

  return { selector, line, column };
}

export function parseCSS(content: string, ctx: ParseContext): SelectorInfo[] {
  const selectors: SelectorInfo[] = [];
  let i = 0;

  while (i < content.length) {
    if (content[i] === '{') {
      const closingBrace = findClosingBrace(content, i);
      if (closingBrace === -1) {
        break;
      }

      const { selector, line, column } = findSelectorStart(content, i);
      const fullRule = content.substring(
        content.lastIndexOf('\n', i - 1) + 1,
        closingBrace + 1
      );

      const endLine = content.substring(0, closingBrace).split('\n').length;

      if (selector && !isAtRule(selector) && !isPseudoOnly(selector) && !isKeyframeSelector(selector)) {
        const parts = selector.split(',').map(s => s.trim()).filter(Boolean);
        for (const part of parts) {
          if (!isAtRule(part) && !isPseudoOnly(part) && !isKeyframeSelector(part)) {
            selectors.push({
              selector: part,
              filePath: ctx.filePath,
              line,
              endLine,
              column,
              source: ctx.source,
              fullRule,
            });
          }
        }
      }

      i = closingBrace + 1;
    } else {
      i++;
    }
  }

  return selectors;
}

export function extractUsedNames(selector: string): { classes: string[]; ids: string[]; attributes: string[]; tag: string | null } {
  const classes = extractClassSelectors(selector);
  const ids = extractIdSelectors(selector);
  const attributes = extractAttributeSelectors(selector);

  let tag: string | null = null;
  const tagMatch = /^([a-zA-Z][\w-]*)/.exec(selector);
  if (tagMatch) {
    tag = tagMatch[1].toLowerCase();
    const htmlTags = new Set([
      'div', 'span', 'p', 'a', 'img', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'table', 'tr', 'td', 'th', 'form', 'input', 'button', 'select', 'option', 'textarea',
      'label', 'section', 'article', 'aside', 'nav', 'header', 'footer', 'main',
    ]);
    if (htmlTags.has(tag)) {
      tag = null;
    }
  }

  return { classes, ids, attributes, tag };
}
