// 引擎单测：从 index.html 提取 /*__ENGINE_START__*/ 与 /*__ENGINE_END__*/ 之间的代码执行，
// 保证测试对象与页面实际使用的代码完全一致。
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const m = html.match(/\/\*__ENGINE_START__\*\/([\s\S]*?)\/\*__ENGINE_END__\*\//);
if (!m) {
  console.error('FAIL: 未在 index.html 中找到引擎标记');
  process.exit(1);
}
const E = new Function(m[1] + '\nreturn TaxEngine;')();

let pass = 0, fail = 0;
function eq(name, actual, expected, tol = 0.011) {
  const ok = typeof expected === 'number'
    ? Math.abs(actual - expected) <= tol
    : actual === expected;
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`  FAIL ${name}: 期望 ${expected}, 实际 ${actual}`); }
}
function truthy(name, v) {
  if (v) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`  FAIL ${name}: 应为真`); }
}
function falsy(name, v) {
  if (!v) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`  FAIL ${name}: 应为假`); }
}

function months(salary, ins, ded, n = 12) {
  return Array.from({ length: 12 }, (_, i) =>
    i < n ? { salary, ins, ded } : { salary: 0, ins: 0, ded: 0 });
}
function mixed(list) { // list: [{s,i,d} 或 0=空月]
  return Array.from({ length: 12 }, (_, i) => {
    const v = list[i] || 0;
    return v === 0 ? { salary: 0, ins: 0, ded: 0 } : { salary: v.s, ins: v.i, ded: v.d };
  });
}

console.log('T1 固定月薪 10000 / 五险一金 1500 / 专项附加 1000 × 12 月');
{
  const r = E.computeMonthly(months(10000, 1500, 1000));
  eq('每月预扣 75', r.rows[0].monthTax, 75);
  eq('12 月预扣仍为 75（累计 30000 未跳档）', r.rows[11].monthTax, 75);
  eq('全年预缴 900', r.totalWithheld, 900);
  const a = E.computeAnnual(months(10000, 1500, 1000), { bonus: 0, bonusMode: 'auto' });
  eq('年度应纳税额 900', a.finalTax, 900);
  eq('汇算补退 0', a.settle, 0);
}

console.log('T2 中途涨薪：1-6 月 10000，7-12 月 20000（扣除同上）');
{
  const list = [];
  for (let i = 0; i < 6; i++) list.push({ s: 10000, i: 1500, d: 1000 });
  for (let i = 6; i < 12; i++) list.push({ s: 20000, i: 1500, d: 1000 });
  const r = E.computeMonthly(mixed(list));
  eq('7 月仍 3% 档，应税 12500 → 当月 375', r.rows[6].monthTax, 375);
  eq('8 月累计 40000 跳 10% 档，当月 655', r.rows[7].monthTax, 655);
  eq('9 月 1250', r.rows[8].monthTax, 1250);
  eq('12 月 1250', r.rows[11].monthTax, 1250);
  eq('全年预缴 6480', r.totalWithheld, 6480);
  const a = E.computeAnnual(mixed(list), { bonus: 0, bonusMode: 'auto' });
  eq('年度应纳 6480', a.finalTax, 6480);
  eq('汇算补退 0', a.settle, 0);
}

console.log('T3 年终奖单独计税与盲区');
{
  eq('36000 → 1080', E.bonusSeparateTax(36000), 1080);
  eq('36001 → 3390.1', E.bonusSeparateTax(36001), 3390.1);
  const zones = E.bonusBlindZones();
  const z1 = zones.find(z => z.from === 36000);
  truthy('盲区表含 36000 起点', z1);
  eq('盲区上界 38566.67', z1 ? z1.to : 0, 38566.67);
  const z2 = zones.find(z => z.from === 144000);
  eq('第二盲区上界 160500', z2 ? z2.to : 0, 160500);
  truthy('37000 在盲区内', E.inBonusBlindZone(37000));
  falsy('36000 恰在盲区外（起点）', E.inBonusBlindZone(36000));
  falsy('39000 在盲区外', E.inBonusBlindZone(39000));
  falsy('0 元奖金无盲区', E.inBonusBlindZone(0));
}

console.log('T4 年中离职退税：1-6 月 20000 / 五险一金 2000 / 无附加，7-12 月空');
{
  const list = [];
  for (let i = 0; i < 6; i++) list.push({ s: 20000, i: 2000, d: 0 });
  const r = E.computeMonthly(mixed(list));
  eq('全年预缴 5280', r.totalWithheld, 5280);
  eq('已填月数 6', r.filledCount, 6);
  const a = E.computeAnnual(mixed(list), { bonus: 0, bonusMode: 'auto' });
  eq('年度应纳税所得额 48000（减除费用按全年 60000）', a.combined.taxable, 48000);
  eq('年度应纳 2280', a.finalTax, 2280);
  eq('退税 3000', a.settle, -3000);
  truthy('给出退税提示', a.tips.some(t => t.includes('退税')));
}

console.log('T5 年终奖自动择优');
{
  // 低收入：并入更省
  const low = months(6000, 1000, 0);
  const aLow = E.computeAnnual(low, { bonus: 50000, bonusMode: 'auto' });
  eq('单独计税合计 4790', aLow.separate.total, 4790);
  eq('并入合计 2480', aLow.combined.total, 2480);
  eq('自动选择并入', aLow.chosenMode, 'combined');
  eq('最终税额 2480', aLow.finalTax, 2480);

  // 高收入：单独更省
  const high = months(30000, 3000, 1000);
  const aHigh = E.computeAnnual(high, { bonus: 120000, bonusMode: 'auto' });
  eq('单独计税合计 45270', aHigh.separate.total, 45270);
  eq('并入合计 61080', aHigh.combined.total, 61080);
  eq('自动选择单独', aHigh.chosenMode, 'separate');

  // 手动锁定
  const locked = E.computeAnnual(low, { bonus: 50000, bonusMode: 'separate' });
  eq('锁定单独计税', locked.chosenMode, 'separate');
  eq('锁定后税额 4790', locked.finalTax, 4790);
}

console.log('T6 大病医疗扣除');
{
  eq('自付 10 万 → 扣 80000（封顶）', E.medicalDeductible(100000), 80000);
  eq('自付 6 万 → 扣 45000', E.medicalDeductible(60000), 45000);
  eq('自付 1 万 → 扣 0（未超起扣线）', E.medicalDeductible(10000), 0);
  const a = E.computeAnnual(months(10000, 1500, 1000), { bonus: 0, bonusMode: 'auto', medicalSpent: 60000 });
  eq('汇算口径扣除大病医疗 45000（年度税 0）', a.finalTax, 0);
  eq('预缴 900 → 退税 900', a.settle, -900);
}

console.log('T7 边界与非法输入');
{
  const r = E.computeMonthly(months(0, 0, 0));
  eq('全空已填月数 0', r.filledCount, 0);
  eq('全空预缴 0', r.totalWithheld, 0);
  const a = E.computeAnnual(months(0, 0, 0), { bonus: 0, bonusMode: 'auto' });
  eq('全空汇算 0', a.settle, 0);

  // 0 工资但有五险一金 → 视为已填月份（停薪留职/病假场景）
  const r2 = E.computeMonthly(mixed([{ s: 10000, i: 1500, d: 0 }, { s: 0, i: 800, d: 0 }]));
  eq('0 工资月计入累计（已填 2 个月）', r2.filledCount, 2);

  // 负数被钳为 0
  const r3 = E.computeMonthly(mixed([{ s: -5000, i: -100, d: 0 }]));
  eq('负工资钳为 0 → 该月未填', r3.filledCount, 0);

  // 字符串数字可解析
  const r4 = E.computeMonthly([{ salary: '10000', ins: '1500', ded: '1000' }]);
  eq('字符串输入正常计算', r4.rows[0].monthTax, 75);

  // 负数补税不出现：累计应纳下降时当月预扣 0（留抵）
  const r5 = E.computeMonthly(mixed([{ s: 30000, i: 3000, d: 0 }, { s: 3000, i: 500, d: 0 }]));
  eq('次月收入骤降当月预扣 0（留抵）', r5.rows[1].monthTax, 0);
}

console.log('T8 下月预测');
{
  // 1-8 月已填，当前 9 月 → 预测 10 月（按 8 月估算）
  const list = [];
  for (let i = 0; i < 8; i++) list.push({ s: 10000, i: 1500, d: 1000 });
  const p = E.predictNextMonth(mixed(list), 9);
  truthy('可预测', p.available);
  eq('预测 10 月', p.month, 10);
  eq('估算税额 75', p.tax, 75);
  eq('来源为估算', p.source, 'estimate');
  eq('基准月 8 月', p.baseMonth, 8);

  // 10 月已填 → 直接用录入数据
  list.push({ s: 10000, i: 1500, d: 1000 }, { s: 12000, i: 1500, d: 1000 });
  const p2 = E.predictNextMonth(mixed(list), 9);
  eq('已填月来源', p2.source, 'filled');
  eq('10 月按录入数据 135（累计 27000×3% − 已缴 675）', p2.tax, 135);

  // 12 月 → 无下月
  const p3 = E.predictNextMonth(months(10000, 1500, 1000), 12);
  falsy('12 月无预测', p3.available);

  // 无数据
  const p4 = E.predictNextMonth(months(0, 0, 0), 9);
  falsy('无数据不可预测', p4.available);
}

console.log('T9 汇算口径的专项附加：已申报（月度）与仅汇算补充分离');
{
  // 工资 10000/五险 1500，月度 ded=0（未申报），年度汇算口径扣除 12000 + 补充 4000
  const a = E.computeAnnual(months(10000, 1500, 0), {
    bonus: 0, bonusMode: 'auto', annualDeduction: 12000, extraDeduction: 4000
  });
  eq('年度应纳税所得额 26,000', a.combined.taxable, 26000);
  eq('年度应纳税额 780（3% 档）', a.finalTax, 780);
  eq('返回已申报扣除额', a.annualDeduction, 12000);
  eq('返回仅汇算扣除额', a.extraDeduction, 4000);
  // 月度预缴不受年度扣除影响：累计 42,000 → 1,680（10% 档部分）
  eq('月度预缴仍按 ded=0 计算 1,680', a.monthly.totalWithheld, 1680);
  eq('汇算退税 900', a.settle, -900);

  // 未提供 annualDeduction 时回退到月度累计值（向后兼容）
  const b = E.computeAnnual(months(10000, 1500, 1000), { bonus: 0, bonusMode: 'auto' });
  eq('回退口径年度税 900（与 T1 一致）', b.finalTax, 900);
}

console.log('T10 奖金已预扣个税（bonusWithheld）');
{
  // 月薪 10000/1500/1000 ×12：工资预缴 900；奖金 36000 单独计税预扣 1080
  const a = E.computeAnnual(months(10000, 1500, 1000), {
    bonus: 36000, bonusMode: 'separate', bonusWithheld: 1080
  });
  eq('年度总税 1,980（工资 900 ＋ 奖金 1,080）', a.finalTax, 1980);
  eq('总预缴 1,980（工资 900 ＋ 奖金已预扣 1,080）', a.totalPrepaid, 1980);
  eq('汇算补退 0（不再重复计成补税）', a.settle, 0);

  // 不填已预扣时，同样场景会显示补税 1080（旧口径），验证差异来源
  const c = E.computeAnnual(months(10000, 1500, 1000), {
    bonus: 36000, bonusMode: 'separate'
  });
  eq('未填已预扣 → 显示补税 1,080', c.settle, 1080);
}

console.log('');
console.log(`结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
