import * as fs from 'fs';
import * as path from 'path';
import { UnusedRule } from './types';
import { getConfig } from './config';

export class StyleFixer {
  async fixAll(rules: UnusedRule[]): Promise<{ fixed: number; backups: string[] }> {
    const config = getConfig();
    const fileRules = this.groupByFile(rules);
    let fixedCount = 0;
    const backups: string[] = [];

    for (const [filePath, fileUnusedRules] of fileRules) {
      try {
        let content = fs.readFileSync(filePath, 'utf-8');

        if (config.enableBackup) {
          const backupPath = filePath + '.bak';
          fs.writeFileSync(backupPath, content, 'utf-8');
          backups.push(backupPath);
        }

        const lines = content.split('\n');
        const lineRanges = fileUnusedRules
          .map(r => ({ start: r.line, end: r.endLine }))
          .sort((a, b) => b.start - a.start);

        for (const range of lineRanges) {
          lines.splice(range.start - 1, range.end - range.start + 1);
        }

        content = lines.join('\n');
        content = content.replace(/\n{3,}/g, '\n\n');

        fs.writeFileSync(filePath, content, 'utf-8');
        fixedCount += fileUnusedRules.length;
      } catch (err) {
        console.error(`修复文件失败 ${filePath}:`, err);
      }
    }

    return { fixed: fixedCount, backups };
  }

  async fixSelected(rule: UnusedRule): Promise<{ fixed: boolean; backup?: string }> {
    const config = getConfig();

    try {
      let content = fs.readFileSync(rule.filePath, 'utf-8');

      if (config.enableBackup) {
        const backupPath = rule.filePath + '.bak';
        fs.writeFileSync(backupPath, content, 'utf-8');
      }

      const lines = content.split('\n');
      lines.splice(rule.line - 1, rule.endLine - rule.line + 1);

      content = lines.join('\n');
      content = content.replace(/\n{3,}/g, '\n\n');

      fs.writeFileSync(rule.filePath, content, 'utf-8');

      return {
        fixed: true,
        backup: config.enableBackup ? rule.filePath + '.bak' : undefined,
      };
    } catch (err) {
      console.error(`修复规则失败:`, err);
      return { fixed: false };
    }
  }

  private groupByFile(rules: UnusedRule[]): Map<string, UnusedRule[]> {
    const map = new Map<string, UnusedRule[]>();
    for (const rule of rules) {
      const existing = map.get(rule.filePath) || [];
      existing.push(rule);
      map.set(rule.filePath, existing);
    }
    return map;
  }
}
