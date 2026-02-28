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

      // ── Analysis ──
      const missingStdCost: IssueItem[] = [];
      const missingBom: IssueItem[] = [];

      for (const f of forecastData) {
        const pn = normalizePn(f.newPartNo || f.partNo);
        const hasStd = stdCostSet.has(pn) || stdCostSet.has(custToInternal.get(pn) || '');
        const hasBom = bomParentSet.has(pn) || bomParentSet.has(custToInternal.get(pn) || '');

        if (!hasStd) {
          missingStdCost.push({
            partNo: f.partNo, newPartNo: f.newPartNo, customer: f.customer,
            model: f.model, partName: f.partName, category: f.category,
            detail: hasBom ? 'BOM 있음 (BOM 원가만 반영)' : 'BOM도 없음 (원가 산출 불가)',
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

      // 기준정보 누락 (순중량/원재료코드)
      const missingRefInfo: IssueItem[] = [];
      for (const ri of refInfo) {
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

      // 재질단가 갱신 필요
      const materialIssues: IssueItem[] = [];
      for (const mc of materialCodes) {
        if (mc.currentPrice <= 0) {
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
          title: '표준재료비(EA단가) 미등록 제품',
          icon: '1',
          severity: 'critical',
          programFix: 'DB item_standard_cost 자동 반영 로직 추가 완료. 재료비.xlsx 업로드 시 자동 적용됩니다.',
          description: '표준재료비가 등록되지 않은 제품은 BOM 전개 기반 원재료비만 반영되어 도장/도금/인쇄 가공비가 누락됩니다.',
          impact: `${missingStdCost.length}개 제품이 정확한 재료비 산출 불가 → 실제보다 30~70% 과소 산출`,
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
          title: '도장재료비 미산입 (프로그램 수정 완료)',
          icon: '2',
          severity: 'warning',
          programFix: '기준정보의 paintQty(도장량) + 재질단가를 이용해 도장재료비를 자동 산입하도록 수정 완료.',
          description: '도장 공정 제품의 BOM에는 사출 원재료만 포함되어, 도장재료비(PAINT)가 누락되었습니다. 프로그램 수정으로 기준정보의 도장량 데이터를 활용해 자동 계산합니다.',
          impact: '도장 제품의 재료비가 실제보다 50~90% 과소 산출되던 문제 해소',
          userAction: [
            '기준정보에 도장량(paintQty1~4) 값이 입력되어 있는지 확인',
            '미입력 품목은 아래 "원인 4: 기준정보 누락" 항목에서 확인 후 업데이트',
            '도장량 단위: g (그램) 기준',
          ],
          uploadTarget: '구매관리 > 기준정보',
          csvColumns: [],
          items: missingRefInfo.filter(r => r.detail?.includes('도장량')),
          total: refInfo.filter(r => /도장/i.test(r.processType || '')).length,
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
          description: '순중량(NET중량)이 0이거나 원재료코드가 미등록인 품목입니다. ₩/kg 단가를 EA 단가로 변환할 수 없어 재료비 산출이 실패합니다.',
          impact: `${missingRefInfo.length}개 품목의 원재료비 변환 불가`,
          userAction: [
            '아래 "누락 목록 다운로드" 클릭',
            'ERP 기준정보에서 순중량(g), 원재료코드, 도장량(g) 확인',
            '기준정보 엑셀: 품목코드, 순중량, 원재료코드1~4, 도장량1~4 컬럼',
            '영업현황 > 구매관리 > 기준정보 관리에서 엑셀 업로드',
          ],
          uploadTarget: '구매관리 > 기준정보',
          csvColumns: ['품목코드', '고객P/N', '품목명', '공정유형', '누락항목'],
          items: missingRefInfo,
          total: refInfo.length,
        },
        {
          id: 'matPrice',
          title: '재질단가 확인/갱신',
          icon: '5',
          severity: materialIssues.length > 0 ? 'warning' : 'info',
          programFix: null,
          description: '재질코드(RESIN/PAINT)의 현재 단가가 최신인지 확인이 필요합니다. 단가가 0원인 재질은 해당 자재를 사용하는 모든 제품의 원가가 과소 산출됩니다.',
          impact: materialIssues.length > 0
            ? `${materialIssues.length}개 재질코드 단가 0원`
            : `전체 ${materialCodes.length}개 재질코드 단가 등록 완료 (최신 여부 확인 필요)`,
          userAction: [
            '구매관리 > 재질단가 관리에서 현재 단가 목록 확인',
            '구매처 견적서/계약서 기반으로 최신 단가와 비교',
            '변동이 있는 재질의 단가를 업데이트',
            '재질단가 엑셀: 재질코드, 재질명, 단위, 현재단가 컬럼',
          ],
          uploadTarget: '구매관리 > 재질단가',
          csvColumns: ['재질코드', '재질분류', '재질명', '비고'],
          items: materialIssues,
          total: materialCodes.length,
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
    if (critical >= 2) return { score: 30, color: 'text-red-600', label: '개선 필요' };
    if (critical >= 1) return { score: 50, color: 'text-orange-600', label: '보완 필요' };
    if (warning >= 2) return { score: 70, color: 'text-amber-600', label: '양호' };
    if (warning >= 1) return { score: 85, color: 'text-blue-600', label: '우수' };
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
    s === 'critical' ? 'border-red-300 bg-red-50' :
    s === 'warning' ? 'border-amber-300 bg-amber-50' :
    'border-blue-200 bg-blue-50';

  const sevBadge = (s: string) =>
    s === 'critical' ? 'bg-red-500 text-white' :
    s === 'warning' ? 'bg-amber-500 text-white' :
    'bg-blue-500 text-white';

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
            <div className={`text-4xl font-black ${scoreInfo.color}`}>{scoreInfo.score}</div>
            <div className="text-xs text-slate-500 mt-1">데이터 품질</div>
          </div>
          <div className="flex-1">
            <div className={`text-lg font-bold ${scoreInfo.color}`}>{scoreInfo.label}</div>
            <div className="text-sm text-slate-500 mt-1">
              {sections.filter(s => s.severity === 'critical' && s.items.length > 0).length > 0 &&
                <span className="text-red-600 font-semibold mr-3">긴급 {sections.filter(s => s.severity === 'critical' && s.items.length > 0).length}건</span>
              }
              {sections.filter(s => s.severity === 'warning' && s.items.length > 0).length > 0 &&
                <span className="text-amber-600 font-semibold mr-3">주의 {sections.filter(s => s.severity === 'warning' && s.items.length > 0).length}건</span>
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
          <div key={section.id} className={`rounded-xl border shadow-sm overflow-hidden ${hasIssues ? sevColor(section.severity) : 'border-emerald-200 bg-emerald-50'}`}>
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
                    <div className={`text-lg font-bold ${hasIssues ? 'text-red-600' : 'text-emerald-600'}`}>
                      {section.items.length > 0 ? `${section.items.length}건 누락` : '완료'}
                    </div>
                    <div className="text-[10px] text-slate-400">커버리지 {coveragePct}%</div>
                  </div>
                )}
                {section.id === 'revenue' && (
                  <div className="text-right">
                    <div className={`text-lg font-bold ${revenueCount === 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {revenueCount === 0 ? '미등록' : `${revenueCount}건`}
                    </div>
                  </div>
                )}
                <span className="text-slate-400 text-lg">{isExpanded ? '▾' : '▸'}</span>
              </div>
              {section.programFix && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-semibold">프로그램 수정 완료</span>
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
                <div className="bg-blue-50 rounded-lg p-3">
                  <div className="text-xs font-semibold text-blue-700 mb-2">조치방법</div>
                  <ol className="space-y-1.5">
                    {section.userAction.map((step, i) => (
                      <li key={i} className="flex gap-2 text-sm text-slate-700">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                  <div className="mt-2 text-xs text-blue-600 font-medium">
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
                              className="px-3 py-1.5 bg-blue-500 text-white text-xs rounded-lg hover:bg-blue-600 transition-colors font-medium"
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
                        uploadMsg.ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
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
