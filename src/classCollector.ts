import * as fs from 'fs';
import * as path from 'path';
import { SelectorInfo } from './types';
import { parseCSS } from './cssParser';

export interface ClassCollection {
  classes: Set<string>;
  ids: Set<string>;
  attributes: Set<string>;
  tags: Set<string>;
  dynamicClasses: Set<string>;
}

function extractClassesFromHtmlAttr(content: string): string[] {
  const results: string[] = [];
  const classAttrRegex = /class\s*=\s*["']([^"']*)["']/g;
  let match: RegExpExecArray | null;
  while ((match = classAttrRegex.exec(content)) !== null) {
    const classNames = match[1].split(/\s+/).filter(Boolean);
    results.push(...classNames);
  }
  return results;
}

function extractClassesFromJsxClassName(content: string): string[] {
  const results: string[] = [];
  const classNameRegex = /className\s*=\s*["']([^"']*)["']/g;
  let match: RegExpExecArray | null;
  while ((match = classNameRegex.exec(content)) !== null) {
    const classNames = match[1].split(/\s+/).filter(Boolean);
    results.push(...classNames);
  }
  return results;
}

function extractDynamicClassNames(content: string): { staticNames: string[]; dynamicPatterns: string[] } {
  const staticNames: string[] = [];
  const dynamicPatterns: string[] = [];

  const templateLiteralRegex = /className\s*=\s*{`([^`]*)`}/g;
  let match: RegExpExecArray | null;
  while ((match = templateLiteralRegex.exec(content)) !== null) {
    const parts = match[1].split(/\s+/).filter(Boolean);
    for (const part of parts) {
      if (part.startsWith('${')) {
        const inner = part.slice(2, -1);
        dynamicPatterns.push(inner);
      } else {
        staticNames.push(part);
      }
    }
  }

  const arrayJoinRegex = /className\s*=\s*{\[([^\]]*)\]\s*\.join\(/g;
  while ((match = arrayJoinRegex.exec(content)) !== null) {
    const inner = match[1];
    const strMatches = inner.match(/["']([^"']*)["']/g);
    if (strMatches) {
      for (const s of strMatches) {
        staticNames.push(s.replace(/["']/g, ''));
      }
    }
  }

  const conditionalRegex = /className\s*=\s*{[^}]*\?\s*["']([^"']*)["']/g;
  while ((match = conditionalRegex.exec(content)) !== null) {
    staticNames.push(...match[1].split(/\s+/).filter(Boolean));
  }

  return { staticNames, dynamicPatterns };
}

function extractIdsFromContent(content: string): string[] {
  const results: string[] = [];
  const idAttrRegex = /id\s*=\s*["']([^"']*)["']/g;
  let match: RegExpExecArray | null;
  while ((match = idAttrRegex.exec(content)) !== null) {
    results.push(match[1]);
  }
  return results;
}

function extractVueTemplateClasses(content: string): string[] {
  const templateMatch = content.match(/<template>([\s\S]*?)<\/template>/);
  if (!templateMatch) {
    return extractClassesFromHtmlAttr(content);
  }
  return extractClassesFromHtmlAttr(templateMatch[1]);
}

function extractVueScriptSetupClasses(content: string): string[] {
  const results: string[] = [];
  const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  if (!scriptMatch) {
    return results;
  }
  const scriptContent = scriptMatch[1];

  const classBindings = scriptContent.match(/class:\s*["']([^"']*)["']/g);
  if (classBindings) {
    for (const binding of classBindings) {
      const names = binding.replace(/class:\s*["']/, '').replace(/["']$/, '').split(/\s+/).filter(Boolean);
      results.push(...names);
    }
  }

  const refClassRegex = /classList\.add\(\s*["']([^"']*)["']/g;
  let match: RegExpExecArray | null;
  while ((match = refClassRegex.exec(scriptContent)) !== null) {
    results.push(...match[1].split(/\s+/).filter(Boolean));
  }

  return results;
}

function extractVueStyleSelectors(content: string, filePath: string): SelectorInfo[] {
  const styleRegex = /<style\s+([^>]*)>([\s\S]*?)<\/style>/g;
  const selectors: SelectorInfo[] = [];
  let styleMatch: RegExpExecArray | null;

  while ((styleMatch = styleRegex.exec(content)) !== null) {
    const attrs = styleMatch[1];
    const styleContent = styleMatch[2];
    const isScoped = attrs.includes('scoped');
    const lang = attrs.match(/lang\s*=\s*["'](\w+)["']/);
    const source = lang && lang[1] === 'scss' ? 'scss' : 'css';

    const templateStart = content.indexOf('<template>');
    const offset = templateStart >= 0 ? templateStart : 0;
    const styleBlockOffset = content.indexOf(styleMatch[0]);
    const linesBefore = content.substring(0, styleBlockOffset).split('\n').length - 1;

    const parsed = parseCSS(styleContent, { filePath, source });
    for (const sel of parsed) {
      sel.line += linesBefore;
      sel.endLine += linesBefore;
      sel.source = isScoped ? 'vue' : sel.source;
      selectors.push(sel);
    }
  }

  return selectors;
}

function extractCssInJsSelectors(content: string, filePath: string): SelectorInfo[] {
  const selectors: SelectorInfo[] = [];
  const styledRegex = /(?:css|styled(?:\.\w+)?|createStyles|makeStyles)\s*(?:\.\w+)?\s*(?:<[^>]*>)?\s*\((?:\s*(?:\([^)]*\)|=>))?\s*\s*`([\s\S]*?)`/g;
  let match: RegExpExecArray | null;

  while ((match = styledRegex.exec(content)) !== null) {
    const cssContent = match[1];
    const blockOffset = content.indexOf(match[0]);
    const linesBefore = content.substring(0, blockOffset).split('\n').length - 1;

    const parsed = parseCSS(cssContent, { filePath, source: 'jsx' });
    for (const sel of parsed) {
      sel.line += linesBefore;
      sel.endLine += linesBefore;
      selectors.push(sel);
    }
  }

  const objectStyleRegex = /(?:styles|style)\s*[:=]\s*\{([\s\S]*?)\}/g;
  while ((match = objectStyleRegex.exec(content)) !== null) {
    const styleObj = match[1];
    const classRegex = /["']([.#][\w-]+)["']/g;
    let classMatch: RegExpExecArray | null;
    while ((classMatch = classRegex.exec(styleObj)) !== null) {
      const blockOffset = content.indexOf(match[0]);
      const linesBefore = content.substring(0, blockOffset).split('\n').length;
      selectors.push({
        selector: classMatch[1],
        filePath,
        line: linesBefore,
        endLine: linesBefore,
        column: 0,
        source: 'jsx',
        fullRule: classMatch[0],
      });
    }
  }

  return selectors;
}

export function collectFromVueFile(filePath: string): { classes: ClassCollection; selectors: SelectorInfo[] } {
  const content = fs.readFileSync(filePath, 'utf-8');
  const classes = new Set<string>();
  const ids = new Set<string>();
  const tags = new Set<string>();
  const dynamicClasses = new Set<string>();

  const templateClasses = extractVueTemplateClasses(content);
  templateClasses.forEach(c => classes.add(c));

  const scriptClasses = extractVueScriptSetupClasses(content);
  scriptClasses.forEach(c => classes.add(c));

  const fileIds = extractIdsFromContent(content);
  fileIds.forEach(id => ids.add(id));

  const tagRegex = /<([a-z][\w-]*)/g;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRegex.exec(content)) !== null) {
    tags.add(tagMatch[1].toLowerCase());
  }

  const selectors = extractVueStyleSelectors(content, filePath);

  return {
    classes: { classes, ids, attributes: new Set(), tags, dynamicClasses },
    selectors,
  };
}

export function collectFromReactFile(filePath: string): { classes: ClassCollection; selectors: SelectorInfo[] } {
  const content = fs.readFileSync(filePath, 'utf-8');
  const classes = new Set<string>();
  const ids = new Set<string>();
  const tags = new Set<string>();
  const dynamicClasses = new Set<string>();

  const jsxClasses = extractClassesFromJsxClassName(content);
  jsxClasses.forEach(c => classes.add(c));

  const htmlClasses = extractClassesFromHtmlAttr(content);
  htmlClasses.forEach(c => classes.add(c));

  const { staticNames, dynamicPatterns } = extractDynamicClassNames(content);
  staticNames.forEach(c => classes.add(c));
  dynamicPatterns.forEach(p => dynamicClasses.add(p));

  const fileIds = extractIdsFromContent(content);
  fileIds.forEach(id => ids.add(id));

  const tagRegex = /<([a-z][\w-]*)/g;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRegex.exec(content)) !== null) {
    tags.add(tagMatch[1].toLowerCase());
  }

  const selectors = extractCssInJsSelectors(content, filePath);

  return {
    classes: { classes, ids, attributes: new Set(), tags, dynamicClasses },
    selectors,
  };
}

export function collectFromHtmlFile(filePath: string): ClassCollection {
  const content = fs.readFileSync(filePath, 'utf-8');
  const classes = new Set<string>();
  const ids = new Set<string>();
  const tags = new Set<string>();

  const htmlClasses = extractClassesFromHtmlAttr(content);
  htmlClasses.forEach(c => classes.add(c));

  const fileIds = extractIdsFromContent(content);
  fileIds.forEach(id => ids.add(id));

  const tagRegex = /<([a-z][\w-]*)/g;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRegex.exec(content)) !== null) {
    tags.add(tagMatch[1].toLowerCase());
  }

  return { classes, ids, attributes: new Set(), tags, dynamicClasses: new Set() };
}

export function collectFromTsJsFile(filePath: string): { classes: ClassCollection; selectors: SelectorInfo[] } {
  const content = fs.readFileSync(filePath, 'utf-8');
  const classes = new Set<string>();
  const ids = new Set<string>();
  const tags = new Set<string>();
  const dynamicClasses = new Set<string>();

  const { staticNames, dynamicPatterns } = extractDynamicClassNames(content);
  staticNames.forEach(c => classes.add(c));
  dynamicPatterns.forEach(p => dynamicClasses.add(p));

  const jsxClasses = extractClassesFromJsxClassName(content);
  jsxClasses.forEach(c => classes.add(c));

  const htmlClasses = extractClassesFromHtmlAttr(content);
  htmlClasses.forEach(c => classes.add(c));

  const selectors = extractCssInJsSelectors(content, filePath);

  return {
    classes: { classes, ids, attributes: new Set(), tags, dynamicClasses },
    selectors,
  };
}

export function getFileType(filePath: string): 'css' | 'scss' | 'vue' | 'jsx' | 'tsx' | 'html' | 'js' | 'ts' | 'unknown' {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.css': return 'css';
    case '.scss': return 'scss';
    case '.vue': return 'vue';
    case '.jsx': return 'jsx';
    case '.tsx': return 'tsx';
    case '.html': return 'html';
    case '.htm': return 'html';
    case '.js': return 'js';
    case '.ts': return 'ts';
    default: return 'unknown';
  }
}
