import React, { useState, useEffect, useMemo, useRef } from 'react';
import { normalizePn } from '../utils/bomDataParser';
import { bomMasterService, productCodeService, referenceInfoService, materialCodeService, forecastService, itemRevenueService, itemStandardCostService } from '../services/supabaseService';
import fallbackStandardCosts from '../data/standardMaterialCost.json';
import { downloadCSV } from '../utils/csvExport';
import * as XLSX from 'xlsx';

// ============================================================
// Types
// ============================================================

interface IssueItem {
  partNo: string;
  newPartNo: string;
  customer: string;
  model: string;
  partName: string;
  category?: string;
  processType?: string;
  detail?: string;
}

interface IssueSection {
  id: string;
  title: string;
  icon: string;
  severity: 'critical' | 'warning' | 'info';
  programFix: string | null;   // null = 사용자 조치만
  userAction: string[];
  uploadTarget: string;
  csvColumns: string[];
  items: IssueItem[];
  total: number;
  description: string;
  impact: string;
}

// ============================================================
// Main Component
// ============================================================

const DataQualityGuide: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [sections, setSections] = useState<IssueSection[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [revenueCount, setRevenueCount] = useState(0);
  const uploadFileRef = useRef<HTMLInputElement>(null);
  const pendingSectionRef = useRef<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadMsg, setUploadMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  const UPLOADABLE_SECTIONS = ['stdCost', 'refInfo', 'matPrice'];

  useEffect(() => { analyzeData(); }, []);

  const analyzeData = async () => {
    setLoading(true);
    try {
      const [forecastData, masterRecords, productCodes, refInfo, materialCodes, revenueData, dbStdCosts] = await Promise.all([
        forecastService.getItems('current'),
        bomMasterService.getAll(),
        productCodeService.getAll(),
        referenceInfoService.getAll(),
        materialCodeService.getAll(),
        itemRevenueService.getAll(),
        itemStandardCostService.getAll(),
      ]);

      setRevenueCount(revenueData?.length || 0);

      // ── Maps ──
      const bomParentSet = new Set<string>();
      for (const r of masterRecords) bomParentSet.add(normalizePn(r.parentPn));

      const custToInternal = new Map<string, string>();
      for (const pc of productCodes) {
        if (pc.productCode && pc.customerPn)
          custToInternal.set(normalizePn(pc.customerPn), normalizePn(pc.productCode));
      }
      for (const ri of refInfo) {
        if (ri.itemCode && ri.customerPn)
          custToInternal.set(normalizePn(ri.customerPn), normalizePn(ri.itemCode));
      }

      const stdCostSet = new Set<string>();
      for (const sc of fallbackStandardCosts) {
        if (sc.eaCost > 0) {
          stdCostSet.add(normalizePn(sc.productCode));
          if (sc.customerPn) stdCostSet.add(normalizePn(sc.customerPn));
        }
      }
      for (const sc of dbStdCosts) {
        // P/N 매핑 보강
        if (sc.customer_pn && sc.item_code) {
          const cpn = normalizePn(sc.customer_pn);
          const icode = normalizePn(sc.item_code);
          if (!custToInternal.has(cpn)) custToInternal.set(cpn, icode);
        }
        const costVal = (sc as unknown as Record<string, unknown>).material_cost_per_ea as number || 0;
        if (costVal > 0) {
          stdCostSet.add(normalizePn(sc.item_code));
          if (sc.customer_pn) stdCostSet.add(normalizePn(sc.customer_pn));
        }
      }

      const refInfoMap = new Map<string, typeof refInfo[0]>();
      for (const ri of refInfo) {
        refInfoMap.set(normalizePn(ri.itemCode), ri);
        if (ri.customerPn) refInfoMap.set(normalizePn(ri.customerPn), ri);
      }

      const matTypeMap = new Map<string, string>();
      for (const mc of materialCodes) {
        matTypeMap.set(normalizePn(mc.materialCode), mc.materialType || '');
      }

      // ── BOM 체인 Set 구성 (forecast 관련 품목만 필터링용) ──
      const bomForwardMap = new Map<string, string[]>();
      for (const r of masterRecords) {
        const parent = normalizePn(r.parentPn);
        const existing = bomForwardMap.get(parent) || [];
        existing.push(normalizePn(r.childPn));
        bomForwardMap.set(parent, existing);
      }
      const bomChainSet = new Set<string>();
      const walkBom = (pn: string, visited: Set<string>) => {
        if (visited.has(pn)) return;
        visited.add(pn);
        bomChainSet.add(pn);
        for (const child of (bomForwardMap.get(pn) || [])) walkBom(child, visited);
      };
      for (const f of forecastData) {
        const pn = normalizePn(f.newPartNo || f.partNo);
        const internalPn = custToInternal.get(pn) || pn;
        walkBom(pn, new Set());
        if (internalPn !== pn) walkBom(internalPn, new Set());
      }

      // ── Analysis ──
      const missingStdCost: IssueItem[] = [];
      const missingBom: IssueItem[] = [];

      for (const f of forecastData) {
        const pn = normalizePn(f.newPartNo || f.partNo);
        const hasStd = stdCostSet.has(pn) || stdCostSet.has(custToInternal.get(pn) || '');
        const hasBom = bomParentSet.has(pn) || bomParentSet.has(custToInternal.get(pn) || '');

        // BOM이 있으면 BOM원가로 산출 가능 → 표준재료비 없어도 문제 아님
        if (!hasStd && !hasBom) {
          missingStdCost.push({
            partNo: f.partNo, newPartNo: f.newPartNo, customer: f.customer,
            model: f.model, partName: f.partName, category: f.category,
            detail: '재료비 데이터 없음 (BOM도 없음)',
          });
        }
        if (!hasBom) {
          missingBom.push({
            partNo: f.partNo, newPartNo: f.newPartNo, customer: f.customer,
            model: f.model, partName: f.partName,
            detail: hasStd ? '표준재료비 있음' : '재료비 데이터 없음',
          });
        }
      }

      // 기준정보 누락 (forecast BOM 체인에 있는 품목만)
      const missingRefInfo: IssueItem[] = [];
      for (const ri of refInfo) {
        if (!bomChainSet.has(normalizePn(ri.itemCode))) continue;
        const issues: string[] = [];
        const isSelfMade = /자가|사출|도장|도금|인쇄|증착|레이저/i.test(ri.processType || '');
        if (!isSelfMade) continue;

        if (ri.netWeight <= 0 && /사출/i.test(ri.processType || ''))
          issues.push('순중량(NET) 미입력');
        if (!ri.rawMaterialCode1)
          issues.push('원재료코드1 미입력');
        if (/도장/i.test(ri.processType || '') && ri.paintQty1 <= 0 && ri.paintQty2 <= 0)
          issues.push('도장량(paintQty) 미입력');

        if (issues.length > 0) {
          missingRefInfo.push({
            partNo: ri.itemCode, newPartNo: ri.customerPn || '',
            customer: ri.customerName || '', model: '',
            partName: ri.itemName || '', processType: ri.processType,
            detail: issues.join(', '),
          });
        }
      }

      // 사용 중인 원재료코드 Set (forecast BOM 체인 기준)
      const usedMaterialCodes = new Set<string>();
      for (const ri of refInfo) {
        if (!bomChainSet.has(normalizePn(ri.itemCode))) continue;
        for (const raw of [ri.rawMaterialCode1, ri.rawMaterialCode2, ri.rawMaterialCode3, ri.rawMaterialCode4]) {
          if (raw) usedMaterialCodes.add(normalizePn(raw));
        }
      }

      // 재질단가 갱신 필요 (실제 사용 중인 재질만)
      const materialIssues: IssueItem[] = [];
      for (const mc of materialCodes) {
        if (mc.currentPrice <= 0 && usedMaterialCodes.has(normalizePn(mc.materialCode))) {
          materialIssues.push({
            partNo: mc.materialCode, newPartNo: '',
            customer: mc.materialType || '', model: mc.materialCategory || '',
            partName: mc.materialName || '',
            detail: `단가 ₩0 (${mc.unit || '단위불명'})`,
          });
        }
      }

      // ── Build sections ──
      const result: IssueSection[] = [
        {
          id: 'stdCost',
          title: 'BOM+표준재료비 모두 없는 제품',
          icon: '1',
          severity: missingStdCost.length > 0 ? 'critical' : 'info',
          programFix: 'BOM이 있는 제품은 BOM 원가엔진으로 자동 산출됩니다. BOM도 표준재료비도 없는 제품만 표시합니다.',
          description: 'BOM 전개도 불가하고 표준재료비(EA단가)도 없는 제품입니다. 원가를 전혀 산출할 수 없습니다.',
          impact: missingStdCost.length > 0
            ? `${missingStdCost.length}개 제품 원가 산출 불가`
            : '모든 제품이 BOM 또는 표준재료비로 커버됨',
          userAction: [
            '아래 "누락 목록 다운로드" 클릭하여 대상 제품 확인',
            'ERP에서 해당 제품의 EA당 표준재료비(수지비+도장비+구매비) 확인',
            '재료비.xlsx 파일의 "품목별재료비" 시트에 입력',
            '영업현황 > 구매관리 > 표준재료비 탭에서 재료비.xlsx 업로드',
          ],
          uploadTarget: '구매관리 > 표준재료비',
          csvColumns: ['P.N', 'NEW P.N', '거래선', '차종', '품명', '구분', '비고'],
          items: missingStdCost,
          total: forecastData.length,
        },
        {
          id: 'paintCost',
          title: '도장량(paintQty) 미입력 품목',
          icon: '2',
          severity: missingRefInfo.filter(r => r.detail?.includes('도장량')).length > 0 ? 'warning' : 'info',
          programFix: '도장량이 입력된 품목은 배합비율 기반으로 도장재료비를 자동 산출합니다.',
          description: 'Forecast BOM 체인 내 도장 공정 품목 중 도장량(paintQty)이 미입력된 품목입니다. 도장량이 없으면 도장재료비를 산출할 수 없습니다.',
          impact: `${missingRefInfo.filter(r => r.detail?.includes('도장량')).length}개 도장 품목의 도장재료비 산출 불가`,
          userAction: [
            '기준정보에 도장량(paintQty1~4) 값이 입력되어 있는지 확인',
            '아래 "기준정보 누락" 항목에서 확인 후 업데이트',
            '도장량 단위: 개취수량 (EA/kg)',
          ],
          uploadTarget: '구매관리 > 기준정보',
          csvColumns: [],
          items: missingRefInfo.filter(r => r.detail?.includes('도장량')),
          total: refInfo.filter(r => /도장/i.test(r.processType || '') && bomChainSet.has(normalizePn(r.itemCode))).length,
        },
        {
          id: 'bom',
          title: 'BOM 미등록 제품',
          icon: '3',
          severity: 'warning',
          programFix: null,
          description: 'Forecast에 있지만 BOM이 등록되지 않은 제품입니다. BOM 전개가 불가하여 표준재료비에만 의존합니다.',
          impact: `${missingBom.length}개 제품의 BOM 전개 불가 → 자재 소요량 산출 누락`,
          userAction: [
            '아래 "누락 목록 다운로드" 클릭',
            'ERP/MES에서 해당 제품의 BOM(부품표) 추출',
            'BOM 엑셀: 모품번, 자품번, 수량, 자품명, 협력업체, 부품유형 컬럼 필요',
            '영업현황 > 구매관리 > BOM 관리에서 엑셀 업로드',
          ],
          uploadTarget: '구매관리 > BOM 관리',
          csvColumns: ['P.N', 'NEW P.N', '거래선', '차종', '품명', '비고'],
          items: missingBom,
          total: forecastData.length,
        },
        {
          id: 'refInfo',
          title: '기준정보 누락 (순중량/원재료코드/도장량)',
          icon: '4',
          severity: 'warning',
          programFix: null,
          description: 'Forecast BOM 체인 내 자가공정(사출/도장 등) 품목 중 순중량/원재료코드/도장량이 누락된 품목입니다.',
          impact: `${missingRefInfo.length}개 품목의 원재료비 변환 불가 (Forecast 관련 품목만)`,
          userAction: [
            '아래 "누락 목록 다운로드" 클릭',
            'ERP 기준정보에서 순중량(g), 원재료코드, 도장량(g) 확인',
            '기준정보 엑셀: 품목코드, 순중량, 원재료코드1~4, 도장량1~4 컬럼',
            '영업현황 > 구매관리 > 기준정보 관리에서 엑셀 업로드',
          ],
          uploadTarget: '구매관리 > 기준정보',
          csvColumns: ['품목코드', '고객P/N', '품목명', '공정유형', '누락항목'],
          items: missingRefInfo,
          total: refInfo.filter(r => bomChainSet.has(normalizePn(r.itemCode))).length,
        },
        {
          id: 'matPrice',
          title: '재질단가 확인/갱신',
          icon: '5',
          severity: materialIssues.length > 0 ? 'warning' : 'info',
          programFix: null,
          description: 'Forecast BOM 체인에서 실제 사용 중인 재질코드 중 단가가 0원인 항목입니다. 해당 재질을 사용하는 제품의 원가가 과소 산출됩니다.',
          impact: materialIssues.length > 0
            ? `${materialIssues.length}개 사용 중 재질코드 단가 0원 (전체 ${materialCodes.length}개 중 사용 ${usedMaterialCodes.size}개)`
            : `사용 중인 ${usedMaterialCodes.size}개 재질 단가 모두 등록됨`,
          userAction: [
            '구매관리 > 재질단가 관리에서 현재 단가 목록 확인',
            '구매처 견적서/계약서 기반으로 최신 단가와 비교',
            '변동이 있는 재질의 단가를 업데이트',
            '재질단가 엑셀: 재질코드, 재질명, 단위, 현재단가 컬럼',
          ],
          uploadTarget: '구매관리 > 재질단가',
          csvColumns: ['재질코드', '재질분류', '재질명', '비고'],
          items: materialIssues,
          total: usedMaterialCodes.size,
        },
        {
          id: 'revenue',
          title: '매출실적 데이터 업로드',
          icon: '6',
          severity: revenueData.length === 0 ? 'critical' : 'info',
          programFix: null,
          description: '품목별 매출실적이 등록되어 있어야 월별 실적/계획 비교와 정확한 재료비율 분석이 가능합니다.',
          impact: revenueData.length === 0
            ? '매출실적 0건 → 월별 실적 분석 불가, 계획 데이터만으로 산출'
            : `${revenueData.length}건 등록됨`,
          userAction: [
            'ERP에서 월별 품목별 매출실적(수량/금액) 추출',
            'CSV 형식: 기간(YYYY-MM), 거래선, 차종, 품번, 고객P/N, 품명, 수량, 금액',
            '영업현황 > 매출현황 탭에서 "수량 CSV 업로드" 버튼으로 업로드',
          ],
          uploadTarget: '영업현황 > 매출현황',
          csvColumns: [],
          items: [],
          total: 0,
        },
      ];

      setSections(result);
    } catch (err) {
      console.error('데이터 품질 분석 실패:', err);
    } finally {
      setLoading(false);
    }
  };

  // 요약 점수
  const scoreInfo = useMemo(() => {
    if (sections.length === 0) return { score: 0, color: '', label: '' };
    const critical = sections.filter(s => s.severity === 'critical' && s.items.length > 0).length;
    const warning = sections.filter(s => s.severity === 'warning' && s.items.length > 0).length;
    if (critical >= 2) return { score: 30, color: 'text-rose-500', label: '개선 필요' };
    if (critical >= 1) return { score: 50, color: 'text-slate-600', label: '보완 필요' };
    if (warning >= 2) return { score: 70, color: 'text-slate-600', label: '양호' };
    if (warning >= 1) return { score: 85, color: 'text-slate-600', label: '우수' };
    return { score: 95, color: 'text-emerald-600', label: '최상' };
  }, [sections]);

  const handleDownload = (section: IssueSection) => {
    if (section.items.length === 0) return;
    const headers = section.csvColumns.length > 0
      ? section.csvColumns
      : ['P.N', 'NEW P.N', '거래선', '차종', '품명', '비고'];
    const csvRows = section.items.map(item => {
      if (section.id === 'refInfo') {
        return [item.partNo, item.newPartNo, item.partName, item.processType || '', item.detail || ''];
      }
      if (section.id === 'matPrice') {
        return [item.partNo, item.customer, item.partName, item.detail || ''];
      }
      return [item.partNo, item.newPartNo, item.customer, item.model, item.partName, item.detail || ''];
    });
    downloadCSV(`데이터품질_${section.id}_${new Date().toISOString().slice(0, 10)}.csv`, headers, csvRows);
  };

  const handleTemplateDownload = async (section: IssueSection) => {
    if (section.items.length === 0) return;
    const wb = XLSX.utils.book_new();
    const dateSuffix = new Date().toISOString().slice(0, 10);

    if (section.id === 'stdCost') {
      const headers = ['품목코드', '고객P/N', '거래선', '품명', 'EA당재료비(원)'];
      const rows = section.items.map(item => [
        item.partNo, item.newPartNo, item.customer, item.partName, '',
      ]);
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      ws['!cols'] = [{ wch: 20 }, { wch: 20 }, { wch: 15 }, { wch: 30 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, ws, '표준재료비_입력');
    } else if (section.id === 'refInfo') {
      const allRefInfo = await referenceInfoService.getAll();
      const riMap = new Map<string, (typeof allRefInfo)[0]>();
      for (const ri of allRefInfo) riMap.set(normalizePn(ri.itemCode), ri);

      const headers = [
        '품목코드', '고객P/N', '품명', '공정유형',
        '순중량(g)', '원재료코드1', '원재료코드2', '원재료코드3', '원재료코드4',
        '1도도장량(g)', '2도도장량(g)', '3도도장량(g)', '4도도장량(g)',
      ];
      const rows = section.items.map(item => {
        const ri = riMap.get(normalizePn(item.partNo));
        return [
          item.partNo, item.newPartNo, item.partName, item.processType || '',
          ri?.netWeight || '', ri?.rawMaterialCode1 || '', ri?.rawMaterialCode2 || '',
          ri?.rawMaterialCode3 || '', ri?.rawMaterialCode4 || '',
          ri?.paintQty1 || '', ri?.paintQty2 || '', ri?.paintQty3 || '', ri?.paintQty4 || '',
        ];
      });
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      ws['!cols'] = headers.map(() => ({ wch: 15 }));
      XLSX.utils.book_append_sheet(wb, ws, '기준정보_입력');
    } else if (section.id === 'matPrice') {
      const allMat = await materialCodeService.getAll();
      const mcMap = new Map<string, (typeof allMat)[0]>();
      for (const mc of allMat) mcMap.set(normalizePn(mc.materialCode), mc);

      const headers = ['재질코드', '재질명', '재질분류', '단위', '현재단가(원/kg)'];
      const rows = section.items.map(item => {
        const mc = mcMap.get(normalizePn(item.partNo));
        return [item.partNo, item.partName, item.customer, mc?.unit || '', mc?.currentPrice || ''];
      });
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      ws['!cols'] = [{ wch: 20 }, { wch: 25 }, { wch: 15 }, { wch: 10 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, ws, '재질단가_입력');
    }

    XLSX.writeFile(wb, `데이터품질_${section.id}_템플릿_${dateSuffix}.xlsx`);
  };

  const handleUpload = async (sectionId: string, file: File) => {
    setUploadingId(sectionId);
    setUploadMsg(null);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
      const num = (v: unknown) => {
        if (v === null || v === undefined || v === '') return 0;
        const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,\s]/g, ''));
        return isNaN(n) ? 0 : n;
      };
      const str = (v: unknown) => String(v ?? '').trim();

      if (sectionId === 'stdCost') {
        const existing = await itemStandardCostService.getAll();
        const costMap = new Map<string, (typeof existing)[0]>();
        for (const sc of existing) costMap.set(normalizePn(sc.item_code), sc);

        let updated = 0;
        for (const row of rows) {
          const itemCode = normalizePn(str(row['품목코드']));
          const costVal = num(row['EA당재료비(원)']);
          if (!itemCode || costVal <= 0) continue;

          const ex = costMap.get(itemCode);
          if (ex) {
            ex.material_cost_per_ea = costVal;
          } else {
            costMap.set(itemCode, {
              item_code: itemCode, customer_pn: str(row['고객P/N']),
              item_name: str(row['품명']), customer_name: str(row['거래선']),
              variety: '', item_type: '', supply_type: '',
              resin_cost_per_ea: 0, paint_cost_per_ea: 0,
              material_cost_per_ea: costVal,
              purchase_price_per_ea: 0, injection_price_per_ea: 0,
              jan_qty: 0, feb_qty: 0, mar_qty: 0, apr_qty: 0, may_qty: 0, jun_qty: 0,
              jul_qty: 0, aug_qty: 0, sep_qty: 0, oct_qty: 0, nov_qty: 0, dec_qty: 0,
              jan_amt: 0, feb_amt: 0, mar_amt: 0, apr_amt: 0, may_amt: 0, jun_amt: 0,
              jul_amt: 0, aug_amt: 0, sep_amt: 0, oct_amt: 0, nov_amt: 0, dec_amt: 0,
              total_qty: 0, total_amt: 0,
            });
          }
          updated++;
        }
        await itemStandardCostService.saveAll(Array.from(costMap.values()));
        setUploadMsg({ id: sectionId, text: `표준재료비 ${updated}건 업데이트 완료`, ok: true });

      } else if (sectionId === 'refInfo') {
        const allRefInfo = await referenceInfoService.getAll();
        const riMap = new Map<string, (typeof allRefInfo)[0]>();
        for (const ri of allRefInfo) riMap.set(normalizePn(ri.itemCode), ri);

        let updated = 0;
        for (const row of rows) {
          const itemCode = normalizePn(str(row['품목코드']));
          if (!itemCode) continue;
          const ri = riMap.get(itemCode);
          if (!ri) continue;

          let changed = false;
          if (row['순중량(g)'] !== undefined && row['순중량(g)'] !== '') {
            ri.netWeight = num(row['순중량(g)']); changed = true;
          }
          for (const [col, key] of [
            ['원재료코드1', 'rawMaterialCode1'], ['원재료코드2', 'rawMaterialCode2'],
            ['원재료코드3', 'rawMaterialCode3'], ['원재료코드4', 'rawMaterialCode4'],
          ] as const) {
            const v = str(row[col]);
            if (v) { (ri as Record<string, unknown>)[key] = v; changed = true; }
          }
          for (const [col, key] of [
            ['1도도장량(g)', 'paintQty1'], ['2도도장량(g)', 'paintQty2'],
            ['3도도장량(g)', 'paintQty3'], ['4도도장량(g)', 'paintQty4'],
          ] as const) {
            if (row[col] !== undefined && row[col] !== '') {
              (ri as Record<string, unknown>)[key] = num(row[col]); changed = true;
            }
          }
          if (changed) updated++;
        }
        await referenceInfoService.saveAll(Array.from(riMap.values()));
        setUploadMsg({ id: sectionId, text: `기준정보 ${updated}건 업데이트 완료`, ok: true });

      } else if (sectionId === 'matPrice') {
        const allMat = await materialCodeService.getAll();
        const mcMap = new Map<string, (typeof allMat)[0]>();
        for (const mc of allMat) mcMap.set(normalizePn(mc.materialCode), mc);

        let updated = 0;
        for (const row of rows) {
          const code = normalizePn(str(row['재질코드']));
          const price = num(row['현재단가(원/kg)']);
          if (!code || price <= 0) continue;
          const mc = mcMap.get(code);
          if (mc) { mc.currentPrice = price; updated++; }
        }
        await materialCodeService.saveAll(Array.from(mcMap.values()));
        setUploadMsg({ id: sectionId, text: `재질단가 ${updated}건 업데이트 완료`, ok: true });
      }

      window.dispatchEvent(new Event('dashboard-data-updated'));
      await analyzeData();
    } catch (err) {
      console.error('업로드 실패:', err);
      setUploadMsg({ id: sectionId, text: '업로드 실패: ' + (err instanceof Error ? err.message : String(err)), ok: false });
    } finally {
      setUploadingId(null);
    }
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const sectionId = pendingSectionRef.current;
    if (!file || !sectionId) return;
    await handleUpload(sectionId, file);
    e.target.value = '';
  };

  const sevColor = (s: string) =>
    s === 'critical' ? 'border-rose-200 bg-slate-50' :
    s === 'warning' ? 'border-slate-200 bg-slate-50' :
    'border-slate-200 bg-slate-50';

  const sevBadge = (s: string) =>
    s === 'critical' ? 'bg-rose-500 text-white' :
    s === 'warning' ? 'bg-slate-500 text-white' :
    'bg-slate-400 text-white';

  if (loading) {
    return <div className="bg-white rounded-lg shadow p-8 text-center text-slate-500">데이터 품질 분석 중...</div>;
  }

  return (
    <div className="space-y-4">
      <input type="file" ref={uploadFileRef} accept=".xlsx,.xls,.csv" className="hidden" onChange={onFileChange} />
      {/* 총평 카드 */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center gap-6">
          <div className="text-center">
            <div className={`text-4xl font-bold ${scoreInfo.color}`}>{scoreInfo.score}</div>
            <div className="text-xs text-slate-500 mt-1">데이터 품질</div>
          </div>
          <div className="flex-1">
            <div className={`text-lg font-bold ${scoreInfo.color}`}>{scoreInfo.label}</div>
            <div className="text-sm text-slate-500 mt-1">
              {sections.filter(s => s.severity === 'critical' && s.items.length > 0).length > 0 &&
                <span className="text-rose-500 font-semibold mr-3">긴급 {sections.filter(s => s.severity === 'critical' && s.items.length > 0).length}건</span>
              }
              {sections.filter(s => s.severity === 'warning' && s.items.length > 0).length > 0 &&
                <span className="text-slate-500 font-semibold mr-3">주의 {sections.filter(s => s.severity === 'warning' && s.items.length > 0).length}건</span>
              }
              {sections.filter(s => s.items.length === 0 && s.id !== 'revenue').length > 0 &&
                <span className="text-emerald-600 font-semibold">정상 {sections.filter(s => s.items.length === 0 && s.id !== 'revenue').length}건</span>
              }
            </div>
          </div>
          <div className="text-right text-xs text-slate-400">
            <div>분석 기준: {new Date().toLocaleDateString('ko-KR')}</div>
            <div>Forecast {sections[0]?.total || 0}개 제품 기준</div>
          </div>
        </div>
      </div>

      {/* 원인별 섹션 */}
      {sections.map(section => {
        const isExpanded = expandedId === section.id;
        const hasIssues = section.items.length > 0 || (section.id === 'revenue' && revenueCount === 0);
        const coveragePct = section.total > 0
          ? ((section.total - section.items.length) / section.total * 100).toFixed(0)
          : '100';

        return (
          <div key={section.id} className={`rounded-xl border shadow-sm overflow-hidden ${hasIssues ? sevColor(section.severity) : 'border-slate-200 bg-slate-50'}`}>
            {/* 헤더 */}
            <div
              className="p-4 cursor-pointer hover:bg-white/50 transition-colors"
              onClick={() => setExpandedId(isExpanded ? null : section.id)}
            >
              <div className="flex items-center gap-3">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${
                  hasIssues ? sevBadge(section.severity) : 'bg-emerald-500 text-white'
                }`}>{section.icon}</span>
                <div className="flex-1">
                  <div className="font-bold text-slate-800">{section.title}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{section.impact}</div>
                </div>
                {section.total > 0 && (
                  <div className="text-right">
                    <div className={`text-lg font-bold ${hasIssues ? 'text-rose-500' : 'text-emerald-600'}`}>
                      {section.items.length > 0 ? `${section.items.length}건 누락` : '완료'}
                    </div>
                    <div className="text-[10px] text-slate-400">커버리지 {coveragePct}%</div>
                  </div>
                )}
                {section.id === 'revenue' && (
                  <div className="text-right">
                    <div className={`text-lg font-bold ${revenueCount === 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
                      {revenueCount === 0 ? '미등록' : `${revenueCount}건`}
                    </div>
                  </div>
                )}
                <span className="text-slate-400 text-lg">{isExpanded ? '▾' : '▸'}</span>
              </div>
              {section.programFix && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full font-semibold">프로그램 수정 완료</span>
                  <span className="text-slate-500">{section.programFix}</span>
                </div>
              )}
            </div>

            {/* 상세 내용 */}
            {isExpanded && (
              <div className="border-t border-white/60 bg-white p-4 space-y-4">
                {/* 원인 설명 */}
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="text-xs font-semibold text-slate-600 mb-1">원인</div>
                  <div className="text-sm text-slate-700">{section.description}</div>
                </div>

                {/* 사용자 조치방법 */}
                <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                  <div className="text-xs font-semibold text-slate-900 mb-2">조치방법</div>
                  <ol className="space-y-1.5">
                    {section.userAction.map((step, i) => (
                      <li key={i} className="flex gap-2 text-sm text-slate-700">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-100 text-slate-600 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                  <div className="mt-2 text-xs text-slate-500 font-medium">
                    업로드 위치: {section.uploadTarget}
                  </div>
                </div>

                {/* 누락 목록 다운로드 + 업로드 */}
                {section.items.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs font-semibold text-slate-600">누락 목록 ({section.items.length}건)</div>
                      <div className="flex items-center gap-2">
                        {UPLOADABLE_SECTIONS.includes(section.id) ? (
                          <>
                            <button
                              onClick={() => handleTemplateDownload(section)}
                              className="px-3 py-1.5 bg-slate-700 text-white text-xs rounded-lg hover:bg-slate-800 transition-colors font-medium"
                            >
                              1. 입력 템플릿 다운로드
                            </button>
                            <button
                              onClick={() => { pendingSectionRef.current = section.id; uploadFileRef.current?.click(); }}
                              disabled={uploadingId === section.id}
                              className="px-3 py-1.5 bg-emerald-500 text-white text-xs rounded-lg hover:bg-emerald-600 transition-colors font-medium disabled:opacity-50"
                            >
                              {uploadingId === section.id ? '업로드 중...' : '2. 입력완료 업로드'}
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => handleDownload(section)}
                            className="px-3 py-1.5 bg-emerald-500 text-white text-xs rounded-lg hover:bg-emerald-600 transition-colors font-medium"
                          >
                            CSV 다운로드
                          </button>
                        )}
                      </div>
                    </div>
                    {uploadMsg && uploadMsg.id === section.id && (
                      <div className={`mb-2 px-3 py-2 rounded-lg text-xs font-medium ${
                        uploadMsg.ok ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-rose-50 text-rose-500 border border-rose-200'
                      }`}>
                        {uploadMsg.text}
                      </div>
                    )}
                    <div className="overflow-x-auto max-h-[200px] overflow-y-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 sticky top-0">
                          <tr className="text-slate-500">
                            <th className="px-2 py-1.5 text-left">#</th>
                            <th className="px-2 py-1.5 text-left">P.N</th>
                            <th className="px-2 py-1.5 text-left">{section.id === 'matPrice' ? '재질분류' : '거래선'}</th>
                            <th className="px-2 py-1.5 text-left">품명</th>
                            <th className="px-2 py-1.5 text-left">비고</th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.items.slice(0, 20).map((item, i) => (
                            <tr key={i} className="border-t border-slate-100">
                              <td className="px-2 py-1 text-slate-400">{i + 1}</td>
                              <td className="px-2 py-1 font-mono text-[11px]">{item.partNo}</td>
                              <td className="px-2 py-1">{section.id === 'matPrice' ? item.customer : item.customer}</td>
                              <td className="px-2 py-1 max-w-[200px] truncate">{item.partName}</td>
                              <td className="px-2 py-1 text-slate-500">{item.detail || ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {section.items.length > 20 && (
                        <div className="text-center py-1 text-xs text-slate-400 bg-slate-50">
                          ... 외 {section.items.length - 20}건 (CSV 다운로드에서 전체 확인)
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {section.items.length === 0 && section.id !== 'revenue' && (
                  <div className="text-center py-3 text-emerald-600 text-sm font-medium">
                    모든 데이터가 등록되어 있습니다
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default DataQualityGuide;
