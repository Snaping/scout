import * as vscode from 'vscode';
import { StyleScoutConfig } from './types';

const SECTION = 'styleScout';

export function getConfig(): StyleScoutConfig {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  return {
    ignorePatterns: cfg.get<string[]>('ignorePatterns', []),
    ignoreFiles: cfg.get<string[]>('ignoreFiles', []),
    scanDirectories: cfg.get<string[]>('scanDirectories', []),
    enableBackup: cfg.get<boolean>('enableBackup', true),
    frameworks: cfg.get<string[]>('frameworks', ['vue', 'react']),
  };
}
