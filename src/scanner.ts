import * as fs from 'fs';
import * as path from 'path';
import { SelectorInfo, ScanResult, UnusedRule } from './types';
import { ClassCollection } from './classCollector';
import { parseCSS, extractUsedNames } from './cssParser';
import {
  collectFromVueFile,
  collectFromReactFile,
  collectFromHtmlFile,
  collectFromTsJsFile,
  getFileType,
} from './classCollector';
import { isSelectorIgnored, isFileIgnored } from './ignoreRules';

const STYLE_EXTENSIONS = new Set(['.css', '.scss']);
const TEMPLATE_EXTENSIONS = new Set(['.vue', '.jsx', '.tsx', '.js', '.ts', '.html', '.htm']);

const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.vscode', '.vscode-test',
  'coverage', '.cache', '.next', '.nuxt', '.output', 'vendor',
]);

export class ProjectScanner {
  private rootPath: string;
  private allSelectors: SelectorInfo[] = [];
  private globalClasses: Set<string> = new Set();
  private globalIds: Set<string> = new Set();
  private globalAttributes: Set<string> = new Set();
  private globalTags: Set<string> = new Set();
  private globalDynamicClasses: Set<string> = new Set();
  private ignorePatterns: string[];
  private ignoreFiles: string[];
  private scanDirectories: string[];
  private scannedFiles: number = 0;

  constructor(
    rootPath: string,
    ignorePatterns: string[] = [],
    ignoreFiles: string[] = [],
    scanDirectories: string[] = [],
  ) {
    this.rootPath = rootPath;
    this.ignorePatterns = ignorePatterns;
    this.ignoreFiles = ignoreFiles;
    this.scanDirectories = scanDirectories;
  }

  async scan(onProgress?: (message: string) => void): Promise<ScanResult> {
    const startTime = Date.now();
    this.allSelectors = [];
    this.globalClasses = new Set();
    this.globalIds = new Set();
    this.globalAttributes = new Set();
    this.globalTags = new Set();
    this.globalDynamicClasses = new Set();
    this.scannedFiles = 0;

    const styleFiles: string[] = [];
    const templateFiles: string[] = [];

    const dirsToScan = this.scanDirectories.length > 0
      ? this.scanDirectories.map(d => path.join(this.rootPath, d))
      : [this.rootPath];

    for (const dir of dirsToScan) {
      if (onProgress) {
        onProgress(`扫描目录: ${dir}`);
      }
      this.collectFiles(dir, styleFiles, templateFiles);
    }

    if (onProgress) {
      onProgress(`发现 ${styleFiles.length} 个样式文件, ${templateFiles.length} 个模板文件`);
    }

    for (const filePath of templateFiles) {
      if (isFileIgnored(filePath, this.ignoreFiles)) {
        continue;
      }
      this.collectUsedNamesFromTemplate(filePath);
      this.scannedFiles++;
    }

    for (const filePath of styleFiles) {
      if (isFileIgnored(filePath, this.ignoreFiles)) {
        continue;
      }
      this.parseStyleFile(filePath);
      this.scannedFiles++;
    }

    const unusedRules = this.detectUnused();

    const duration = Date.now() - startTime;
    return {
      totalSelectors: this.allSelectors.length,
      usedSelectors: this.allSelectors.length - unusedRules.length,
      unusedRules,
      scannedFiles: this.scannedFiles,
      duration,
    };
  }

  private collectFiles(dir: string, styleFiles: string[], templateFiles: string[]): void {
    if (!fs.existsSync(dir)) {
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (DEFAULT_IGNORE_DIRS.has(entry.name)) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        this.collectFiles(fullPath, styleFiles, templateFiles);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (STYLE_EXTENSIONS.has(ext)) {
          styleFiles.push(fullPath);
        } else if (TEMPLATE_EXTENSIONS.has(ext)) {
          templateFiles.push(fullPath);
        }
      }
    }
  }

  private collectUsedNamesFromTemplate(filePath: string): void {
    const fileType = getFileType(filePath);

    let result: { classes: ClassCollection; selectors?: SelectorInfo[] };

    switch (fileType) {
      case 'vue':
        result = collectFromVueFile(filePath);
        break;
      case 'jsx':
      case 'tsx':
        result = collectFromReactFile(filePath);
        break;
      case 'html':
        result = { classes: collectFromHtmlFile(filePath) };
        break;
      case 'js':
      case 'ts':
        result = collectFromTsJsFile(filePath);
        break;
      default:
        return;
    }

    result.classes.classes.forEach((c: string) => this.globalClasses.add(c));
    result.classes.ids.forEach((id: string) => this.globalIds.add(id));
    result.classes.attributes.forEach((attr: string) => this.globalAttributes.add(attr));
    result.classes.tags.forEach((tag: string) => this.globalTags.add(tag));
    result.classes.dynamicClasses.forEach((dc: string) => this.globalDynamicClasses.add(dc));

    if (result.selectors) {
      this.allSelectors.push(...result.selectors);
    }
  }

  private parseStyleFile(filePath: string): void {
    const content = fs.readFileSync(filePath, 'utf-8');
    const ext = path.extname(filePath).toLowerCase();
    const source = ext === '.scss' ? 'scss' : 'css';

    const selectors = parseCSS(content, { filePath, source });
    this.allSelectors.push(...selectors);
  }

  private detectUnused(): UnusedRule[] {
    const unused: UnusedRule[] = [];

    for (const selectorInfo of this.allSelectors) {
      if (isSelectorIgnored(selectorInfo.selector, this.ignorePatterns)) {
        continue;
      }

      if (this.isSelectorUsed(selectorInfo)) {
        continue;
      }

      unused.push({
        ...selectorInfo,
        id: `${selectorInfo.filePath}:${selectorInfo.line}:${selectorInfo.selector}`,
      });
    }

    return unused;
  }

  private isSelectorUsed(info: SelectorInfo): boolean {
    const { classes, ids, attributes, tag } = extractUsedNames(info.selector);

    if (classes.length > 0) {
      const allUsed = classes.every(cls => this.globalClasses.has(cls));
      if (allUsed) {
        return true;
      }
    }

    if (ids.length > 0) {
      const allUsed = ids.every(id => this.globalIds.has(id));
      if (allUsed) {
        return true;
      }
    }

    if (attributes.length > 0) {
      const someUsed = attributes.some(attr => this.globalAttributes.has(attr));
      if (someUsed) {
        return true;
      }
    }

    if (tag && this.globalTags.has(tag)) {
      return true;
    }

    if (classes.length === 0 && ids.length === 0 && attributes.length === 0 && !tag) {
      return true;
    }

    return false;
  }

  getAllSelectors(): SelectorInfo[] {
    return this.allSelectors;
  }
}
