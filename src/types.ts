export interface SelectorInfo {
  selector: string;
  filePath: string;
  line: number;
  endLine: number;
  column: number;
  source: 'css' | 'scss' | 'vue' | 'jsx' | 'tsx';
  fullRule: string;
}

export interface UnusedRule extends SelectorInfo {
  id: string;
}

export interface ScanResult {
  totalSelectors: number;
  usedSelectors: number;
  unusedRules: UnusedRule[];
  scannedFiles: number;
  duration: number;
}

export interface ClassUsageMap {
  className: string;
  files: string[];
}

export interface StyleScoutConfig {
  ignorePatterns: string[];
  ignoreFiles: string[];
  scanDirectories: string[];
  enableBackup: boolean;
  frameworks: string[];
}
