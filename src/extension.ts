import * as vscode from 'vscode';
import { ProjectScanner } from './scanner';
import { StyleScoutProvider, ScoutTreeItem } from './treeProvider';
import { StyleFixer } from './fixer';
import { getConfig } from './config';
import { UnusedRule, ScanResult } from './types';

let currentResult: ScanResult | null = null;
let treeProvider: StyleScoutProvider;
let scanDebounceTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext) {
  treeProvider = new StyleScoutProvider();

  const treeView = vscode.window.createTreeView('styleScoutPanel', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // --- Command registrations ---

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

    const config = getConfig();
    const answer = await vscode.window.showWarningMessage(
      `确定要清理 ${currentResult.unusedRules.length} 条未使用规则吗？${
        config.enableBackup ? '将在清理前创建备份文件。' : '未启用备份功能，清理后不可恢复！'
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

  const fixSelectedCommand = vscode.commands.registerCommand(
    'styleScout.fixSelected',
    async (item: ScoutTreeItem) => {
      if (!item || !item.rule) {
        vscode.window.showWarningMessage('请先选择一个未使用规则');
        return;
      }

      const answer = await vscode.window.showWarningMessage(
        `确定删除未使用规则 "${item.rule.selector}" 吗？`,
        { modal: true },
        '确定',
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
    },
  );

  const goToRuleCommand = vscode.commands.registerCommand(
    'styleScout.goToRule',
    async (rule: UnusedRule) => {
      if (!rule || !rule.filePath) {
        vscode.window.showWarningMessage('无法跳转到规则：规则信息不完整');
        return;
      }

      try {
        const uri = vscode.Uri.file(rule.filePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc);

        const line = Math.max(0, Math.min(rule.line - 1, doc.lineCount - 1));
        const endLine = Math.max(line, Math.min(rule.endLine - 1, doc.lineCount - 1));
        const lineLength = doc.lineAt(line).text.length;
        const endLineLength = doc.lineAt(endLine).text.length;

        editor.selection = new vscode.Selection(line, 0, endLine, endLineLength);
        editor.revealRange(
          new vscode.Range(line, 0, endLine, endLineLength),
          vscode.TextEditorRevealType.InCenter,
        );
      } catch (err) {
        vscode.window.showErrorMessage(`无法打开文件: ${rule.filePath}`);
      }
    },
  );

  const configureIgnoreCommand = vscode.commands.registerCommand(
    'styleScout.configureIgnore',
    async () => {
      const config = vscode.workspace.getConfiguration('styleScout');
      const currentPatterns = config.get<string[]>('ignorePatterns', []);

      const action = await vscode.window.showQuickPick(
        [
          { label: '$(add) 添加新的忽略规则', action: 'add' },
          { label: '$(list-flat) 查看当前忽略规则', action: 'view' },
          {
            label: '$(trash) 清空所有忽略规则',
            action: 'clear',
          },
        ],
        { placeHolder: '选择操作' },
      );

      if (!action) {
        return;
      }

      if (action.action === 'add') {
        const pattern = await vscode.window.showInputBox({
          prompt: '输入要忽略的选择器正则表达式（例如: ^\\.el-、^ant-）',
          placeHolder: '例如: ^\\.el-',
        });
        if (pattern) {
          const updated = [...currentPatterns, pattern];
          await config.update('ignorePatterns', updated, vscode.ConfigurationTarget.Workspace);
          vscode.window.showInformationMessage(`已添加忽略规则: ${pattern}`);
        }
      } else if (action.action === 'view') {
        if (currentPatterns.length === 0) {
          vscode.window.showInformationMessage('当前没有配置忽略规则');
        } else {
          const items = currentPatterns.map((p, i) => ({
            label: p,
            description: `规则 ${i + 1}`,
          }));
          await vscode.window.showQuickPick(items, {
            placeHolder: `当前配置了 ${currentPatterns.length} 条忽略规则`,
          });
        }
      } else if (action.action === 'clear') {
        if (currentPatterns.length === 0) {
          vscode.window.showInformationMessage('当前没有忽略规则需要清空');
          return;
        }
        const confirm = await vscode.window.showWarningMessage(
          `确定清空所有 ${currentPatterns.length} 条忽略规则吗？`,
          { modal: true },
          '确定',
        );
        if (confirm === '确定') {
          await config.update('ignorePatterns', [], vscode.ConfigurationTarget.Workspace);
          vscode.window.showInformationMessage('已清空所有忽略规则');
        }
      }
    },
  );

  // --- Push all disposables ---
  context.subscriptions.push(
    treeView,
    scanCommand,
    refreshCommand,
    fixAllCommand,
    fixSelectedCommand,
    goToRuleCommand,
    configureIgnoreCommand,
  );

  // --- Event listeners with debounce ---
  const saveDisposable = vscode.workspace.onDidSaveTextDocument(() => {
    if (scanDebounceTimer) {
      clearTimeout(scanDebounceTimer);
    }
    scanDebounceTimer = setTimeout(() => {
      runScan();
    }, 2000);
  });

  const configDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('styleScout')) {
      runScan();
    }
  });

  context.subscriptions.push(saveDisposable, configDisposable);

  // --- Auto-scan on activation (when the sidebar view is opened) ---
  runScan();
}

async function runScan(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showWarningMessage('Style Scout: 请先打开一个工作区');
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
        if (token.isCancellationRequested) {
          return;
        }

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
            `Style Scout: 发现 ${currentResult.unusedRules.length} 条未使用样式 (共 ${currentResult.totalSelectors} 条规则，${currentResult.scannedFiles} 个文件，${currentResult.duration}ms)`,
          );
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Style Scout 扫描失败: ${err}`);
      }
    },
  );
}

export function deactivate() {
  if (scanDebounceTimer) {
    clearTimeout(scanDebounceTimer);
  }
}
