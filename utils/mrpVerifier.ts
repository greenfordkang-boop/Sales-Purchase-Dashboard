/**
 * mrpVerifier.ts — MRP 소요량 산출근거 검증 유틸리티
 * 콘솔에서 호출: window.__verifyMRP()
 *
 * 1개 RESIN 자재에 대해 BOM 역전개 → MRP 산출값 비교
 */
import { normalizePn, BomRecord } from './bomDataParser';
import type { ReferenceInfoRecord } from './bomMasterParser';
import type { CostEngineResult, ProductContribution, LeafMaterialRow } from './bomCostEngine';

export interface VerificationReport {
  material: {
    code: string;
    name: string;
    type: string;
    unit: string;
    unitPrice: number;
    totalQty: number;
    totalCost: number;
    monthlyQty: number[];
  };
  breakdown: {
    productPn: string;
    productName: string;
    qtyPerUnit: number;
    monthlyQty: number[];
    totalQty: number;
    pctOfTotal: number;
  }[];
  reverseCheck: {
    productPn: string;
    productName: string;
    bomPath: string[];         // BOM 경로 (루트 → ... → 리프)
    bomQty: number;            // BOM 수량 (경로상 곱)
    refInfo: {
      netWeight: number;
      runnerWeight: number;
      cavity: number;
      lossRate: number;
      rawMaterialCode: string;
    } | null;
    qtyMultiplier: number;     // EA → kg 변환 계수
    qtyPerUnit: number;        // 제품 1EA당 자재 소요량 (kg)
  }[];
  crossCheck: {
    breakdownSum: number;       // productBreakdown 합계
    materialTotal: number;      // leafMaterial.monthlyQty 합계
    match: boolean;
    diff: number;
  };
  productCostCheck: {
    productPn: string;
    productName: string;
    productMaterialCost: number;  // 제품별 재료비에서의 EA당 원가 (제품뷰)
    thisMatContrib: number;       // 이 자재의 EA당 기여분 (단위소요량 × 단가)
    ratio: number;                // 이 자재가 전체 재료비에서 차지하는 비율
  }[];
  issues: string[];
}

/**
 * RESIN 자재 1개에 대한 상세 검증 수행
 */
export function verifyResinMaterial(
  materialCode: string,
  costResult: CostEngineResult,
  bomRecords: BomRecord[],
  refInfoMap: Map<string, ReferenceInfoRecord>,
  matPriceMap: Map<string, number>,
  materialTypeMap: Map<string, string>,
): VerificationReport {
  const issues: string[] = [];

  // 1. 대상 자재 찾기
  const mat = costResult.leafMaterials.find(
    m => normalizePn(m.materialCode) === normalizePn(materialCode)
  );
  if (!mat) {
    return {
      material: { code: materialCode, name: '(미발견)', type: '', unit: '', unitPrice: 0, totalQty: 0, totalCost: 0, monthlyQty: [] },
      breakdown: [], reverseCheck: [], crossCheck: { breakdownSum: 0, materialTotal: 0, match: false, diff: 0 },
      productCostCheck: [], issues: [`자재코드 ${materialCode}를 leafMaterials에서 찾을 수 없음`],
    };
  }

  // 2. productBreakdown 정리
  const breakdown = (mat.productBreakdown || []).map(c => ({
    productPn: c.productPn,
    productName: c.productName,
    qtyPerUnit: c.qtyPerUnit,
    monthlyQty: [...c.monthlyQty],
    totalQty: c.totalQty,
    pctOfTotal: mat.monthlyQty.reduce((s, q) => s + q, 0) > 0
      ? (c.totalQty / mat.monthlyQty.reduce((s, q) => s + q, 0)) * 100
      : 0,
  }));

  // 3. BOM 역전개 (forwardMap을 사용하여 각 제품에서 이 자재로의 경로 추적)
  const forwardMap = new Map<string, BomRecord[]>();
  const seen = new Set<string>();
  for (const rec of bomRecords) {
    const key = normalizePn(rec.parentPn);
    const dedupKey = `${key}|${normalizePn(rec.childPn)}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    const list = forwardMap.get(key) || [];
    list.push(rec);
    forwardMap.set(key, list);
  }

  const targetCode = normalizePn(materialCode);
  const reverseCheck: VerificationReport['reverseCheck'] = [];

  // 각 제품에서 타겟 자재까지의 경로 찾기
  for (const contrib of (mat.productBreakdown || [])) {
    const rootPn = normalizePn(contrib.productPn);
    const paths: { path: string[]; bomQty: number }[] = [];

    function findPaths(pn: string, currentPath: string[], accQty: number, visited: Set<string>) {
      const code = normalizePn(pn);
      if (visited.has(code)) return;
      visited.add(code);

      // 이 노드의 refInfo에서 rawMaterialCode 확인
      const ri = refInfoMap.get(code);
      const rawCodes = ri
        ? [ri.rawMaterialCode1, ri.rawMaterialCode2, ri.rawMaterialCode3, ri.rawMaterialCode4]
            .filter(Boolean).map(r => normalizePn(r as string))
        : [];

      // 현재 노드 자체가 타겟이거나, rawMaterialCode가 타겟인 경우
      if (code === targetCode || rawCodes.includes(targetCode)) {
        paths.push({ path: [...currentPath, code], bomQty: accQty });
      }

      // 자식 탐색
      const children = forwardMap.get(code) || [];
      for (const child of children) {
        findPaths(child.childPn, [...currentPath, code], accQty * child.qty, visited);
      }
      visited.delete(code);
    }

    // 루트의 자식부터 탐색
    const rootChildren = forwardMap.get(rootPn) || [];
    for (const child of rootChildren) {
      findPaths(child.childPn, [rootPn], child.qty, new Set());
    }

    for (const { path, bomQty } of paths) {
      // 경로의 마지막 노드 (= 자재를 사용하는 BOM 부품)의 refInfo
      const leafCode = path[path.length - 1];
      const ri = refInfoMap.get(normalizePn(leafCode));
      let qtyMultiplier = 1;
      let refData = null;

      if (ri && ri.netWeight) {
        const cavity = (ri.cavity && ri.cavity > 0) ? ri.cavity : 1;
        const wpe = ri.netWeight + (ri.runnerWeight || 0) / cavity;
        qtyMultiplier = wpe * (1 + (ri.lossRate || 0) / 100) / 1000;
        refData = {
          netWeight: ri.netWeight,
          runnerWeight: ri.runnerWeight || 0,
          cavity,
          lossRate: ri.lossRate || 0,
          rawMaterialCode: targetCode,
        };
      }

      reverseCheck.push({
        productPn: contrib.productPn,
        productName: contrib.productName,
        bomPath: path,
        bomQty,
        refInfo: refData,
        qtyMultiplier,
        qtyPerUnit: bomQty * qtyMultiplier,
      });
    }
  }

  // 4. 교차 검증: productBreakdown 합계 vs materialAgg 합계
  const breakdownSum = breakdown.reduce((s, c) => s + c.totalQty, 0);
  const materialTotal = mat.monthlyQty.reduce((s, q) => s + q, 0);
  const diff = Math.abs(breakdownSum - materialTotal);
  const match = diff < 0.01;

  if (!match) {
    issues.push(`산출근거 합계(${breakdownSum.toFixed(2)}) ≠ 자재 총소요량(${materialTotal.toFixed(2)}), 차이: ${diff.toFixed(4)}`);
  }

  // 5. 제품별 원가 교차 검증
  const productCostCheck: VerificationReport['productCostCheck'] = [];
  for (const contrib of (mat.productBreakdown || [])) {
    const product = costResult.products.find(
      p => normalizePn(p.pn) === normalizePn(contrib.productPn)
    );
    if (product) {
      const thisMatCostPerEa = contrib.qtyPerUnit * mat.unitPrice;
      productCostCheck.push({
        productPn: contrib.productPn,
        productName: contrib.productName,
        productMaterialCost: product.materialCost,
        thisMatContrib: thisMatCostPerEa,
        ratio: product.materialCost > 0 ? (thisMatCostPerEa / product.materialCost) * 100 : 0,
      });
    }
  }

  // 6. BOM 역전개 vs productBreakdown qtyPerUnit 비교
  for (const rev of reverseCheck) {
    const contrib = breakdown.find(c => c.productPn === rev.productPn);
    if (contrib) {
      const revTotal = reverseCheck
        .filter(r => r.productPn === rev.productPn)
        .reduce((s, r) => s + r.qtyPerUnit, 0);

      if (Math.abs(revTotal - contrib.qtyPerUnit) > 0.0001) {
        issues.push(
          `[${rev.productPn}] BOM역전개 qtyPerUnit(${revTotal.toFixed(6)}) ≠ productBreakdown(${contrib.qtyPerUnit.toFixed(6)})`
        );
      }
    }
  }

  return {
    material: {
      code: mat.materialCode,
      name: mat.materialName,
      type: mat.materialType,
      unit: mat.unit,
      unitPrice: mat.unitPrice,
      totalQty: materialTotal,
      totalCost: mat.totalCost,
      monthlyQty: [...mat.monthlyQty],
    },
    breakdown,
    reverseCheck,
    crossCheck: { breakdownSum, materialTotal, match, diff },
    productCostCheck,
    issues,
  };
}

/**
 * 콘솔 출력용 포맷터
 */
export function printVerificationReport(report: VerificationReport): void {
  console.log('='.repeat(80));
  console.log('MRP 소요량 산출근거 검증 보고서');
  console.log('='.repeat(80));

  const m = report.material;
  console.log(`\n[대상 자재]`);
  console.log(`  코드: ${m.code}`);
  console.log(`  명칭: ${m.name}`);
  console.log(`  유형: ${m.type} | 단위: ${m.unit} | 단가: ₩${Math.round(m.unitPrice).toLocaleString()}/${m.unit}`);
  console.log(`  총소요량: ${m.totalQty.toFixed(2)} ${m.unit}`);
  console.log(`  총소요금액: ₩${Math.round(m.totalCost).toLocaleString()}`);
  console.log(`  월별: ${m.monthlyQty.map((q, i) => `${i + 1}월=${Math.round(q)}`).join(', ')}`);

  console.log(`\n[제품별 산출근거] (${report.breakdown.length}건)`);
  console.log('-'.repeat(80));
  for (const c of report.breakdown) {
    console.log(`  ${c.productPn} (${c.productName})`);
    console.log(`    단위소요량: ${c.qtyPerUnit.toFixed(6)} ${m.unit}/EA`);
    console.log(`    연간소요량: ${c.totalQty.toFixed(2)} ${m.unit} (${c.pctOfTotal.toFixed(1)}%)`);
    console.log(`    월별: ${c.monthlyQty.map((q, i) => q > 0 ? `${i + 1}월=${Math.round(q)}` : '').filter(Boolean).join(', ')}`);
  }

  console.log(`\n[BOM 역전개 경로]`);
  console.log('-'.repeat(80));
  for (const r of report.reverseCheck) {
    console.log(`  ${r.productPn} → ${r.bomPath.join(' → ')}`);
    console.log(`    BOM수량: ${r.bomQty} | 변환계수: ${r.qtyMultiplier.toFixed(6)} | qtyPerUnit: ${r.qtyPerUnit.toFixed(6)}`);
    if (r.refInfo) {
      console.log(`    refInfo: NET=${r.refInfo.netWeight}g, Runner=${r.refInfo.runnerWeight}g, Cavity=${r.refInfo.cavity}, Loss=${r.refInfo.lossRate}%`);
    }
  }

  console.log(`\n[교차 검증]`);
  console.log('-'.repeat(80));
  console.log(`  산출근거 합계: ${report.crossCheck.breakdownSum.toFixed(4)}`);
  console.log(`  자재 총소요량: ${report.crossCheck.materialTotal.toFixed(4)}`);
  console.log(`  일치 여부: ${report.crossCheck.match ? '✅ 일치' : `❌ 불일치 (차이: ${report.crossCheck.diff.toFixed(4)})`}`);

  if (report.productCostCheck.length > 0) {
    console.log(`\n[제품 원가 내 비중]`);
    console.log('-'.repeat(80));
    for (const p of report.productCostCheck) {
      console.log(`  ${p.productPn}: 전체재료비 ₩${Math.round(p.productMaterialCost)} | 이 자재 기여분 ₩${p.thisMatContrib.toFixed(2)} (${p.ratio.toFixed(1)}%)`);
    }
  }

  if (report.issues.length > 0) {
    console.log(`\n⚠️ [발견된 이슈] (${report.issues.length}건)`);
    console.log('-'.repeat(80));
    for (const issue of report.issues) {
      console.log(`  ❌ ${issue}`);
    }
  } else {
    console.log(`\n✅ 이슈 없음 — 산출근거가 BOM 역전개와 일치합니다.`);
  }

  console.log('\n' + '='.repeat(80));
}
