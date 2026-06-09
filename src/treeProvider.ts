import * as vscode from 'vscode';
import * as path from 'path';
import { UnusedRule, ScanResult, SelectorUsageEntry, StyleScoutConfig } from './types';

type NodeType = 'section' | 'file' | 'rule' | 'dir' | 'usage' | 'usageFile' | 'styleType' | 'ignorePattern' | 'empty';

export class StyleScoutProvider implements vscode.TreeDataProvider<ScoutTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ScoutTreeItem | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private scanResult: ScanResult | null = null;
  private config: StyleScoutConfig | null = null;

  refresh(result: ScanResult | null, config?: StyleScoutConfig): void {
    this.scanResult = result;
    if (config) {
      this.config = config;
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ScoutTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ScoutTreeItem): ScoutTreeItem[] {
    if (!element) {
      return this.getRootSections();
    }

    switch (element.sectionType) {
      case 'unusedRules':
        return this.getUnusedRulesChildren(element);
      case 'scanDirs':
        return this.getScanDirItems();
      case 'usageMap':
        return this.getUsageMapChildren(element);
      case 'supportedStyles':
        return this.getSupportedStyleItems();
      case 'ignoreRules':
        return this.getIgnoreRuleItems();
      default:
        return [];
    }
  }

  private getRootSections(): ScoutTreeItem[] {
    if (!this.scanResult) {
      return [ScoutTreeItem.createEmpty('点击刷新按钮开始扫描')];
    }

    const sections: ScoutTreeItem[] = [];

    // 1. 未使用规则
    const unusedCount = this.scanResult.unusedRules.length;
    const unusedItem = ScoutTreeItem.createSection(
      'unusedRules',
      `未使用规则 (${unusedCount}条)`,
      unusedCount > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
    );
    unusedItem.iconPath = unusedCount > 0
      ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'))
      : new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
    unusedItem.description = `共 ${this.scanResult.totalSelectors} 条选择器`;
    sections.push(unusedItem);

    // 2. 扫描目录
    const dirItem = ScoutTreeItem.createSection(
      'scanDirs',
      `扫描目录 (${this.scanResult.scannedDirectories.length})`,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    dirItem.iconPath = new vscode.ThemeIcon('folder-opened');
    dirItem.description = `${this.scanResult.scannedFiles} 个文件`;
    sections.push(dirItem);

    // 3. 选择器使用图谱
    const usageItem = ScoutTreeItem.createSection(
      'usageMap',
      `选择器使用图谱 (${this.scanResult.selectorUsageMap.length})`,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    usageItem.iconPath = new vscode.ThemeIcon('references');
    usageItem.description = '选择器 → 引用文件';
    sections.push(usageItem);

    // 4. 支持的样式
    const styleItem = ScoutTreeItem.createSection(
      'supportedStyles',
      '支持的样式',
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    styleItem.iconPath = new vscode.ThemeIcon('symbol-color');
    const styleCount = this.scanResult.styleFiles.length;
    const templateCount = this.scanResult.templateFiles.length;
    styleItem.description = `${styleCount} 样式 / ${templateCount} 模板`;
    sections.push(styleItem);

    // 5. 忽略规则
    const ignoreItem = ScoutTreeItem.createSection(
      'ignoreRules',
      '忽略规则',
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    ignoreItem.iconPath = new vscode.ThemeIcon('eye-closed');
    const patternCount = (this.config?.ignorePatterns.length || 0) + (this.config?.ignoreFiles.length || 0);
    ignoreItem.description = patternCount > 0 ? `${patternCount} 条规则` : '未配置';
    sections.push(ignoreItem);

    return sections;
  }

  // --- 未使用规则 ---
  private getUnusedRulesChildren(element: ScoutTreeItem): ScoutTreeItem[] {
    if (!this.scanResult) {
      return [];
    }

    // 根节点 -> 文件分组
    if (element.sectionType === 'unusedRules' && element.nodeType === 'section') {
      if (this.scanResult.unusedRules.length === 0) {
        return [ScoutTreeItem.createEmpty('所有样式均在使用中')];
      }

      const fileMap = new Map<string, UnusedRule[]>();
      for (const rule of this.scanResult.unusedRules) {
        const existing = fileMap.get(rule.filePath) || [];
        existing.push(rule);
        fileMap.set(rule.filePath, existing);
      }

      const items: ScoutTreeItem[] = [];
      for (const [filePath, rules] of fileMap) {
        const fileName = path.basename(filePath);
        const item = new ScoutTreeItem(
          `${fileName} (${rules.length})`,
          vscode.TreeItemCollapsibleState.Expanded,
          'file',
        );
        item.sectionType = 'unusedRules';
        item.filePath = filePath;
        item.resourceUri = vscode.Uri.file(filePath);
        item.tooltip = filePath;
        item.iconPath = vscode.ThemeIcon.File;
        items.push(item);
      }
      return items;
    }

    // 文件节点 -> 规则列表
    if (element.nodeType === 'file' && element.filePath) {
      const rules = this.scanResult.unusedRules.filter(r => r.filePath === element.filePath);
      return rules.map(rule => {
        const item = new ScoutTreeItem(
          `L${rule.line}: ${rule.selector}`,
          vscode.TreeItemCollapsibleState.None,
          'rule',
        );
        item.rule = rule;
        item.iconPath = new vscode.ThemeIcon('trash', new vscode.ThemeColor('errorForeground'));
        item.tooltip = `${rule.selector}\n文件: ${rule.filePath}\n行: ${rule.line}\n来源: ${rule.source}`;
        item.command = {
          command: 'styleScout.goToRule',
          title: '跳转到规则',
          arguments: [rule],
        };
        return item;
      });
    }

    return [];
  }

  // --- 扫描目录 ---
  private getScanDirItems(): ScoutTreeItem[] {
    if (!this.scanResult) {
      return [];
    }

    const items: ScoutTreeItem[] = [];

    for (const dir of this.scanResult.scannedDirectories) {
      const dirName = path.basename(dir) || dir;
      const item = new ScoutTreeItem(dirName, vscode.TreeItemCollapsibleState.None, 'dir');
      item.tooltip = dir;
      item.description = dir;
      item.iconPath = new vscode.ThemeIcon('folder');
      items.push(item);
    }

    // 统计信息
    const statsItem = new ScoutTreeItem(
      `样式文件: ${this.scanResult.styleFiles.length} | 模板文件: ${this.scanResult.templateFiles.length}`,
      vscode.TreeItemCollapsibleState.None,
      'empty',
    );
    statsItem.iconPath = new vscode.ThemeIcon('info');
    items.push(statsItem);

    const durationItem = new ScoutTreeItem(
      `扫描耗时: ${this.scanResult.duration}ms`,
      vscode.TreeItemCollapsibleState.None,
      'empty',
    );
    durationItem.iconPath = new vscode.ThemeIcon('clock');
    items.push(durationItem);

    return items;
  }

  // --- 选择器使用图谱 ---
  private getUsageMapChildren(element: ScoutTreeItem): ScoutTreeItem[] {
    if (!this.scanResult) {
      return [];
    }

    // 根节点 -> 按定义文件分组
    if (element.nodeType === 'section') {
      if (this.scanResult.selectorUsageMap.length === 0) {
        return [ScoutTreeItem.createEmpty('未发现选择器使用关系')];
      }

      // 按定义文件分组
      const fileMap = new Map<string, SelectorUsageEntry[]>();
      for (const entry of this.scanResult.selectorUsageMap) {
        const existing = fileMap.get(entry.definedIn) || [];
        existing.push(entry);
        fileMap.set(entry.definedIn, existing);
      }

      const items: ScoutTreeItem[] = [];
      for (const [filePath, entries] of fileMap) {
        const fileName = path.basename(filePath);
        const item = new ScoutTreeItem(
          `${fileName} (${entries.length})`,
          vscode.TreeItemCollapsibleState.Collapsed,
          'file',
        );
        item.sectionType = 'usageMap';
        item.filePath = filePath;
        item.iconPath = vscode.ThemeIcon.File;
        item.tooltip = filePath;
        items.push(item);
      }
      return items;
    }

    // 文件节点 -> 选择器列表
    if (element.nodeType === 'file' && element.filePath) {
      const entries = this.scanResult.selectorUsageMap.filter(e => e.definedIn === element.filePath);
      return entries.map(entry => {
        const item = new ScoutTreeItem(
          entry.selector,
          vscode.TreeItemCollapsibleState.Collapsed,
          'usage',
        );
        item.sectionType = 'usageMap';
        item.usageEntry = entry;
        item.iconPath = new vscode.ThemeIcon('symbol-class');
        item.description = `被 ${entry.usedInFiles.length} 个文件引用`;
        item.tooltip = `定义于 ${path.basename(entry.definedIn)}:${entry.line}`;
        return item;
      });
    }

    // 选择器节点 -> 引用文件列表
    if (element.nodeType === 'usage' && element.usageEntry) {
      return element.usageEntry.usedInFiles.map(filePath => {
        const item = new ScoutTreeItem(
          path.basename(filePath),
          vscode.TreeItemCollapsibleState.None,
          'usageFile',
        );
        item.tooltip = filePath;
        item.description = path.dirname(filePath);
        item.iconPath = vscode.ThemeIcon.File;
        item.resourceUri = vscode.Uri.file(filePath);
        item.command = {
          command: 'vscode.open',
          title: '打开文件',
          arguments: [vscode.Uri.file(filePath)],
        };
        return item;
      });
    }

    return [];
  }

  // --- 支持的样式 ---
  private getSupportedStyleItems(): ScoutTreeItem[] {
    const types = [
      { label: 'CSS (.css)', icon: 'symbol-color', desc: '标准CSS样式表' },
      { label: 'SCSS (.scss)', icon: 'symbol-color', desc: 'Sass预处理器样式' },
      { label: 'Vue SFC (.vue)', icon: 'symbol-misc', desc: 'Vue单文件组件 <style> 块' },
      { label: 'JSX (.jsx)', icon: 'symbol-misc', desc: 'React JSX / CSS-in-JS' },
      { label: 'TSX (.tsx)', icon: 'symbol-misc', desc: 'React TSX / CSS-in-JS' },
      { label: 'HTML (.html/.htm)', icon: 'symbol-misc', desc: 'HTML内联样式引用' },
      { label: 'JavaScript (.js)', icon: 'symbol-misc', desc: 'JS className / CSS-in-JS' },
      { label: 'TypeScript (.ts)', icon: 'symbol-misc', desc: 'TS className / CSS-in-JS' },
    ];

    return types.map(t => {
      const item = new ScoutTreeItem(t.label, vscode.TreeItemCollapsibleState.None, 'styleType');
      item.iconPath = new vscode.ThemeIcon(t.icon);
      item.description = t.desc;
      return item;
    });
  }

  // --- 忽略规则 ---
  private getIgnoreRuleItems(): ScoutTreeItem[] {
    const items: ScoutTreeItem[] = [];

    if (this.config) {
      if (this.config.ignorePatterns.length > 0) {
        const header = new ScoutTreeItem(
          '选择器忽略模式',
          vscode.TreeItemCollapsibleState.None,
          'empty',
        );
        header.iconPath = new vscode.ThemeIcon('regex');
        header.description = `${this.config.ignorePatterns.length} 条`;
        items.push(header);

        for (const pattern of this.config.ignorePatterns) {
          const item = new ScoutTreeItem(pattern, vscode.TreeItemCollapsibleState.None, 'ignorePattern');
          item.iconPath = new vscode.ThemeIcon('circle-outline');
          item.description = '选择器模式';
          items.push(item);
        }
      }

      if (this.config.ignoreFiles.length > 0) {
        const header = new ScoutTreeItem(
          '文件忽略模式',
          vscode.TreeItemCollapsibleState.None,
          'empty',
        );
        header.iconPath = new vscode.ThemeIcon('file-binary');
        header.description = `${this.config.ignoreFiles.length} 条`;
        items.push(header);

        for (const pattern of this.config.ignoreFiles) {
          const item = new ScoutTreeItem(pattern, vscode.TreeItemCollapsibleState.None, 'ignorePattern');
          item.iconPath = new vscode.ThemeIcon('circle-outline');
          item.description = '文件模式';
          items.push(item);
        }
      }
    }

    if (items.length === 0) {
      items.push(ScoutTreeItem.createEmpty('未配置忽略规则，点击设置按钮配置'));
    }

    // 打开设置入口
    const openSettings = new ScoutTreeItem(
      '打开忽略规则设置...',
      vscode.TreeItemCollapsibleState.None,
      'empty',
    );
    openSettings.iconPath = new vscode.ThemeIcon('gear');
    openSettings.command = {
      command: 'styleScout.openSettings',
      title: '打开设置',
    };
    items.push(openSettings);

    return items;
  }
}

export type SectionType = 'unusedRules' | 'scanDirs' | 'usageMap' | 'supportedStyles' | 'ignoreRules';

export class ScoutTreeItem extends vscode.TreeItem {
  public rule?: UnusedRule;
  public filePath?: string;
  public nodeType: NodeType;
  public sectionType?: SectionType;
  public usageEntry?: SelectorUsageEntry;

  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    nodeType: NodeType,
  ) {
    super(label, collapsibleState);
    this.nodeType = nodeType;
    this.contextValue = nodeType;
  }

  static createSection(
    sectionType: SectionType,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ): ScoutTreeItem {
    const item = new ScoutTreeItem(label, collapsibleState, 'section');
    item.sectionType = sectionType;
    return item;
  }

  static createEmpty(message: string): ScoutTreeItem {
    const item = new ScoutTreeItem(message, vscode.TreeItemCollapsibleState.None, 'empty');
    item.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
    return item;
  }
}
