export function isSelectorIgnored(selector: string, ignorePatterns: string[]): boolean {
  for (const pattern of ignorePatterns) {
    try {
      const re = new RegExp(pattern);
      if (re.test(selector)) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

export function isFileIgnored(filePath: string, ignoreFiles: string[]): boolean {
  for (const pattern of ignoreFiles) {
    try {
      const re = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
      if (re.test(filePath)) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}
