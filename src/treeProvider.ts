import * as vscode from 'vscode';
import { UnusedRule } from './types';

export class StyleScoutProvider implements vscode.TreeDataProvider<ScoutTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ScoutTreeItem | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private unusedRules: UnusedRule[] = [];
  private groupByFile: boolean = true;

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
      return this.getRuleItems(element.label as string);
    }

    return [];
  }

  private getRootItems(): ScoutTreeItem[] {
    if (this.unusedRules.length === 0) {
      return [new ScoutTreeItem('未发现未使用样式 ✓', vscode.TreeItemCollapsibleState.None, 'empty')];
    }

    if (!this.groupByFile) {
      return this.unusedRules.map(rule =>
        new ScoutTreeItem(
          rule.selector,
          vscode.TreeItemCollapsibleState.None,
          'rule',
          rule,
        )
      );
    }

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
        vscode.TreeItemCollapsibleState.Collapsed,
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
    const fileName = filePath.split(/[/\\]/).pop() || '';
    const rules = this.unusedRules.filter(r => {
      const ruleFileName = r.filePath.split(/[/\\]/).pop() || '';
      return ruleFileName === fileName || r.filePath === filePath;
    });

    return rules.map(rule =>
      new ScoutTreeItem(
        `L${rule.line}: ${rule.selector}`,
        vscode.TreeItemCollapsibleState.None,
        'rule',
        rule,
      )
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
      this.tooltip = `${rule.selector}\n文件: ${rule.filePath}\n行: ${rule.line}`;
      this.command = {
        command: 'styleScout.goToRule',
        title: '跳转到规则',
        arguments: [rule],
      };
    } else if (contextValue === 'file') {
      this.iconPath = vscode.ThemeIcon.File;
    } else if (contextValue === 'empty') {
      this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
    }
  }
}
