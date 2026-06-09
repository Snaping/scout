import * as vscode from 'vscode';
import { UnusedRule } from './types';

export class StyleScoutProvider implements vscode.TreeDataProvider<ScoutTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ScoutTreeItem | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private unusedRules: UnusedRule[] = [];

  refresh(rules: UnusedRule[]): void {
    this.unusedRules = rules;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ScoutTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ScoutTreeItem): ScoutTreeItem[] {
    if (!element) {
      return this.getRootItems();
    }

    if (element.contextValue === 'file') {
      return this.getRuleItems(element.filePath!);
    }

    return [];
  }

  private getRootItems(): ScoutTreeItem[] {
    // Empty state: show instructions when no scan has been run or no unused rules found
    if (this.unusedRules.length === 0) {
      return [
        new ScoutTreeItem(
          '未发现未使用样式 ✓',
          vscode.TreeItemCollapsibleState.None,
          'empty',
        ),
        new ScoutTreeItem(
          '点击标题栏 🔍 按钮开始扫描',
          vscode.TreeItemCollapsibleState.None,
          'info',
        ),
        new ScoutTreeItem(
          '支持 CSS / SCSS / Vue / React',
          vscode.TreeItemCollapsibleState.None,
          'info',
        ),
      ];
    }

    // Group unused rules by file path
    const fileMap = new Map<string, UnusedRule[]>();
    for (const rule of this.unusedRules) {
      const existing = fileMap.get(rule.filePath) || [];
      existing.push(rule);
      fileMap.set(rule.filePath, existing);
    }

    const items: ScoutTreeItem[] = [];
    for (const [filePath, rules] of fileMap) {
      const fileName = filePath.split(/[/\\]/).pop() || filePath;
      const item = new ScoutTreeItem(
        `${fileName} (${rules.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
        'file',
      );
      item.resourceUri = vscode.Uri.file(filePath);
      item.tooltip = filePath;
      item.filePath = filePath;
      items.push(item);
    }

    return items;
  }

  private getRuleItems(filePath: string): ScoutTreeItem[] {
    // Filter rules by exact file path (fixes the previous filename-only matching bug)
    const rules = this.unusedRules.filter(r => r.filePath === filePath);

    return rules.map(rule =>
      new ScoutTreeItem(
        `L${rule.line}: ${rule.selector}`,
        vscode.TreeItemCollapsibleState.None,
        'rule',
        rule,
      ),
    );
  }
}

export class ScoutTreeItem extends vscode.TreeItem {
  public rule?: UnusedRule;
  public filePath?: string;

  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    contextValue: string,
    rule?: UnusedRule,
  ) {
    super(label, collapsibleState);
    this.contextValue = contextValue;
    this.rule = rule;

    if (contextValue === 'rule' && rule) {
      this.iconPath = new vscode.ThemeIcon('trash', new vscode.ThemeColor('errorForeground'));
      this.tooltip = `${rule.selector}\n文件: ${rule.filePath}\n行: ${rule.line} - ${rule.endLine}`;
      this.command = {
        command: 'styleScout.goToRule',
        title: '跳转到规则',
        arguments: [rule],
      };
    } else if (contextValue === 'file') {
      // Let VS Code use the resourceUri to determine the file icon
      // (don't set iconPath, so the file icon theme is used)
    } else if (contextValue === 'empty') {
      this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
    }
    // 'info' contextValue: no icon (plain informational text)
  }
}
