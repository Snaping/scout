import * as vscode from 'vscode';
import { ProjectScanner } from './scanner';
import { StyleScoutProvider, ScoutTreeItem } from './treeProvider';
import { StyleFixer } from './fixer';
import { getConfig } from './config';
import { UnusedRule, ScanResult } from './types';

let currentResult: ScanResult | null = null;
let treeProvider: StyleScoutProvider;

export function activate(context: vscode.ExtensionContext) {
  treeProvider = new StyleScoutProvider();

  const treeView = vscode.window.createTreeView('styleScoutPanel', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  const scanCommand = vscode.commands.registerCommand('styleScout.scan', async () => {
    await runScan();
  });

  const refreshCommand = vscode.commands.registerCommand('styleScout.refresh', async () => {
    await runScan();
  });

  const fixAllCommand = vscode.commands.registerCommand('styleScout.fixAll', async () => {
    if (!currentResult || currentResult.unusedRules.length === 0) {
      vscode.window.showInformationMessage('没有需要清理的未使用规则');
      return;
    }

    const answer = await vscode.window.showWarningMessage(
      `确定要清理 ${currentResult.unusedRules.length} 条未使用规则吗？${
        getConfig().enableBackup ? '将在清理前创建备份文件。' : '未启用备份功能，清理后不可恢复！'
      }`,
      { modal: true },
      '确定清理',
    );

    if (answer !== '确定清理') {
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Style Scout: 清理未使用规则...',
        cancellable: false,
      },
      async () => {
        const fixer = new StyleFixer();
        const result = await fixer.fixAll(currentResult!.unusedRules);
        vscode.window.showInformationMessage(
          `已清理 ${result.fixed} 条未使用规则${result.backups.length > 0 ? `，备份文件: ${result.backups.length} 个` : ''}`,
        );
        await runScan();
      },
    );
  });

  const fixSelectedCommand = vscode.commands.registerCommand('styleScout.fixSelected', async (item: ScoutTreeItem) => {
    if (!item.rule) {
      return;
    }

    const answer = await vscode.window.showWarningMessage(
      `确定删除未使用规则 "${item.rule.selector}" 吗？`,
      '确定',
      '取消',
    );

    if (answer !== '确定') {
      return;
    }

    const fixer = new StyleFixer();
    const result = await fixer.fixSelected(item.rule);

    if (result.fixed) {
      vscode.window.showInformationMessage(`已删除规则 "${item.rule.selector}"`);
      await runScan();
    } else {
      vscode.window.showErrorMessage('删除规则失败');
    }
  });

  const goToRuleCommand = vscode.commands.registerCommand('styleScout.goToRule', async (rule: UnusedRule) => {
    if (!rule) {
      return;
    }

    const doc = await vscode.workspace.openTextDocument(rule.filePath);
    const editor = await vscode.window.showTextDocument(doc);

    const line = rule.line - 1;
    const lineLength = doc.lineAt(line).text.length;
    editor.selection = new vscode.Selection(line, 0, line, lineLength);
    editor.revealRange(
      new vscode.Range(line, 0, line, lineLength),
      vscode.TextEditorRevealType.InCenter,
    );
  });

  context.subscriptions.push(
    treeView,
    scanCommand,
    refreshCommand,
    fixAllCommand,
    fixSelectedCommand,
    goToRuleCommand,
  );

  vscode.workspace.onDidSaveTextDocument(() => {
    runScan();
  });

  vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('styleScout')) {
      runScan();
    }
  });
}

async function runScan(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showWarningMessage('请先打开一个工作区');
    return;
  }

  const config = getConfig();

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Style Scout: 扫描中...',
      cancellable: true,
    },
    async (progress, token) => {
      const rootPath = workspaceFolders[0].uri.fsPath;
      const scanner = new ProjectScanner(
        rootPath,
        config.ignorePatterns,
        config.ignoreFiles,
        config.scanDirectories,
      );

      try {
        currentResult = await scanner.scan((message) => {
          progress.report({ message });
        });

        treeProvider.refresh(currentResult.unusedRules);

        if (currentResult.unusedRules.length === 0) {
          vscode.window.showInformationMessage(
            `Style Scout: 扫描完成，未发现未使用样式 (${currentResult.scannedFiles} 个文件，${currentResult.duration}ms)`,
          );
        } else {
          vscode.window.showWarningMessage(
            `Style Scout: 发现 ${currentResult.unusedRules.length} 条未使用样式 (${currentResult.totalSelectors} 条中，${currentResult.scannedFiles} 个文件，${currentResult.duration}ms)`,
          );
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Style Scout 扫描失败: ${err}`);
      }
    },
  );
}

export function deactivate() {}
