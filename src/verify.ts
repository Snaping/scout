import * as path from 'path';
import * as fs from 'fs';
import { ProjectScanner } from './scanner';

const testFixture = path.join(__dirname, '..', 'test-fixture');

async function main() {
  console.log('=== Style Scout 验证测试 ===\n');
  console.log(`测试项目目录: ${testFixture}\n`);

  if (!fs.existsSync(testFixture)) {
    console.error('测试目录不存在！');
    process.exit(1);
  }

  const scanner = new ProjectScanner(testFixture, [], []);

  console.log('开始扫描...\n');

  const result = await scanner.scan((msg) => {
    console.log(`  [进度] ${msg}`);
  });

  console.log('\n=== 扫描结果 ===');
  console.log(`扫描文件数: ${result.scannedFiles}`);
  console.log(`总选择器数: ${result.totalSelectors}`);
  console.log(`已使用选择器: ${result.usedSelectors}`);
  console.log(`未使用选择器: ${result.unusedRules.length}`);
  console.log(`耗时: ${result.duration}ms\n`);

  if (result.unusedRules.length > 0) {
    console.log('=== 未使用规则列表 ===');
    for (const rule of result.unusedRules) {
      const relativePath = path.relative(testFixture, rule.filePath);
      console.log(`  [${relativePath}:${rule.line}] ${rule.selector}`);
    }
  } else {
    console.log('✓ 未发现未使用样式');
  }

  console.log('\n=== 验证预期结果 ===');

  const expectedUnused = ['.unused-class', '.another-unused', '#unused-id', '.nested-unused .child-unused', '.scoped-unused', '.scoped-used'];
  const actualSelectors = result.unusedRules.map(r => r.selector);

  let passCount = 0;
  for (const expected of expectedUnused) {
    const found = actualSelectors.some(s => s === expected);
    if (found) {
      console.log(`  ✓ 正确检测到未使用: ${expected}`);
      passCount++;
    } else {
      console.log(`  ✗ 未能检测到未使用: ${expected}`);
    }
  }

  const expectedUsed = ['.used-class', '.another-used', '#used-id', '.nested-used .child-used'];
  for (const expected of expectedUsed) {
    const notInUnused = !actualSelectors.some(s => s === expected);
    if (notInUnused) {
      console.log(`  ✓ 正确识别为已使用: ${expected}`);
      passCount++;
    } else {
      console.log(`  ✗ 错误标记为未使用: ${expected}`);
    }
  }

  console.log(`\n通过: ${passCount}/${expectedUnused.length + expectedUsed.length}`);

  if (passCount === expectedUnused.length + expectedUsed.length) {
    console.log('\n🎉 所有验证测试通过！');
  } else {
    console.log('\n⚠️ 部分验证测试未通过，请检查逻辑。');
  }
}

main().catch(err => {
  console.error('验证脚本执行失败:', err);
  process.exit(1);
});
