
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import MetricCard from './MetricCard';
import { safeSetItem } from '../utils/safeStorage';
import {
  parseBomMasterExcel,
  BomMasterParseResult,
  BomMasterRecord,
  ProductCodeRecord,
  ReferenceInfoRecord,
  EquipmentRecord,
  MaterialCodeRecord,
  DataQualityIssue,
  assembleBomInfo,
  AssembledBomInfo,
} from '../utils/bomMasterParser';
import { downloadCSV } from '../utils/csvExport';
import {
  bomMasterService,
  productCodeService,
  referenceInfoService,
  equipmentService,
  materialCodeService,
  dataQualityService,
} from '../services/supabaseService';

// ============================================================
// Types
// ============================================================

interface UploadStatus {
  bom: { count: number; lastUpload: string };
  productCode: { count: number; lastUpload: string };
  referenceInfo: { count: number; lastUpload: string };
  equipment: { count: number; lastUpload: string };
  materialCode: { count: number; lastUpload: string };
}

const INITIAL_STATUS: UploadStatus = {
  bom: { count: 0, lastUpload: '-' },
  productCode: { count: 0, lastUpload: '-' },
  referenceInfo: { count: 0, lastUpload: '-' },
  equipment: { count: 0, lastUpload: '-' },
  materialCode: { count: 0, lastUpload: '-' },
};

// ============================================================
// Component
// ============================================================

interface GapRow {
  name: string;
  parsed: number;
  saved: number;
  gap: number;
  status: 'match' | 'mismatch' | 'pending';
}

const BomMasterUploadView: React.FC = () => {
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>(INITIAL_STATUS);
  const [qualityIssues, setQualityIssues] = useState<DataQualityIssue[]>([]);
  const [assembledBom, setAssembledBom] = useState<AssembledBomInfo[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');
  const [activeView, setActiveView] = useState<'status' | 'quality' | 'bom'>('status');
  const [filterIssueType, setFilterIssueType] = useState<string>('All');
  const [gapAnalysis, setGapAnalysis] = useState<GapRow[]>([]);
  const [bomFilter, setBomFilter] = useState('');

  // --- 초기 로드: Supabase 우선, localStorage 폴백 ---
  useEffect(() => {
    const loadAll = async () => {
      const ts = localStorage.getItem('dashboard_bomMaster_uploadTimestamp');
      const uploadDate = ts || '-';

      // Supabase에서 로드 (localStorage 폴백)
      const [bomData, pcData, riData, eqData, mcData, dqData] = await Promise.all([
        bomMasterService.getAll(),
        productCodeService.getAll(),
        referenceInfoService.getAll(),
        equipmentService.getAll(),
        materialCodeService.getAll(),
        dataQualityService.getAll(),
      ]);

      setUploadStatus({
        bom: { count: bomData.length, lastUpload: bomData.length > 0 ? uploadDate : '-' },
        productCode: { count: pcData.length, lastUpload: pcData.length > 0 ? uploadDate : '-' },
        referenceInfo: { count: riData.length, lastUpload: riData.length > 0 ? uploadDate : '-' },
        equipment: { count: eqData.length, lastUpload: eqData.length > 0 ? uploadDate : '-' },
        materialCode: { count: mcData.length, lastUpload: mcData.length > 0 ? uploadDate : '-' },
      });

      if (dqData.length > 0) setQualityIssues(dqData);

      // BOM정보 조립
      if (bomData.length > 0) {
        try {
          const assembled = assembleBomInfo(bomData, riData, mcData);
          setAssembledBom(assembled);
        } catch { /* ignore */ }
      }
    };

    loadAll();
  }, []);

  // --- Excel 업로드 핸들러 ---
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadMessage('파싱 중...');

    try {
      const buffer = await file.arrayBuffer();
      const result: BomMasterParseResult = parseBomMasterExcel(buffer);

      setUploadMessage('Supabase 저장 중...');

      // 병렬 저장
      const saves: Promise<void>[] = [];
      if (result.bom.length > 0) saves.push(bomMasterService.saveAll(result.bom));
      if (result.productCodes.length > 0) saves.push(productCodeService.saveAll(result.productCodes));
      if (result.referenceInfo.length > 0) saves.push(referenceInfoService.saveAll(result.referenceInfo));
      if (result.equipment.length > 0) saves.push(equipmentService.saveAll(result.equipment));
      if (result.materialCodes.length > 0) saves.push(materialCodeService.saveAll(result.materialCodes));
      if (result.qualityIssues.length > 0) saves.push(dataQualityService.saveAll(result.qualityIssues));

      await Promise.all(saves);

      // 업로드 시각 저장
      const now = new Date().toLocaleString('ko-KR');
      safeSetItem('dashboard_bomMaster_uploadTimestamp', now);

      // 상태 갱신
      setUploadStatus({
        bom: { count: result.bom.length, lastUpload: now },
        productCode: { count: result.productCodes.length, lastUpload: now },
        referenceInfo: { count: result.referenceInfo.length, lastUpload: now },
        equipment: { count: result.equipment.length, lastUpload: now },
        materialCode: { count: result.materialCodes.length, lastUpload: now },
      });
      setQualityIssues(result.qualityIssues);

      // BOM정보 재조립
      try {
        const assembled = assembleBomInfo(result.bom, result.referenceInfo, result.materialCodes);
        setAssembledBom(assembled);
      } catch { /* ignore */ }

      // Gap 분석: 파싱 결과 vs Supabase 저장 결과 비교
      const [savedBom, savedPc, savedRi, savedEq, savedMc] = await Promise.all([
        bomMasterService.getAll(),
        productCodeService.getAll(),
        referenceInfoService.getAll(),
        equipmentService.getAll(),
        materialCodeService.getAll(),
      ]);
      const parsedCounts = [
        { name: 'BOM', parsed: result.bom.length, saved: savedBom.length },
        { name: '제품코드', parsed: result.productCodes.length, saved: savedPc.length },
        { name: '기준정보', parsed: result.referenceInfo.length, saved: savedRi.length },
        { name: '설비코드', parsed: result.equipment.length, saved: savedEq.length },
        { name: '재질코드', parsed: result.materialCodes.length, saved: savedMc.length },
      ];
      setGapAnalysis(parsedCounts.map(r => ({
        ...r,
        gap: r.saved - r.parsed,
        status: r.saved === r.parsed ? 'match' : 'mismatch',
      })));

      // 저장 결과로 상태 갱신 (정확한 수치)
      setUploadStatus({
        bom: { count: savedBom.length, lastUpload: now },
        productCode: { count: savedPc.length, lastUpload: now },
        referenceInfo: { count: savedRi.length, lastUpload: now },
        equipment: { count: savedEq.length, lastUpload: now },
        materialCode: { count: savedMc.length, lastUpload: now },
      });

      // 크로스 컴포넌트 이벤트
      window.dispatchEvent(new CustomEvent('dashboard-data-updated', { detail: { type: 'bomMaster' } }));

      const totalRows = result.sheetStats.reduce((s, st) => s + st.rows, 0);
      setUploadMessage(`업로드 완료! ${result.sheetStats.length}개 시트, ${totalRows.toLocaleString()}건 파싱. 품질이슈: ${result.qualityIssues.length}건`);
    } catch (err: any) {
      console.error('BOM 마스터 업로드 실패:', err);
      setUploadMessage(`업로드 실패: ${err.message}`);
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  // --- 품질 이슈 통계 ---
  const issueStats = useMemo(() => {
    const types = new Map<string, number>();
    const severities = { error: 0, warning: 0, info: 0 };
    for (const issue of qualityIssues) {
      types.set(issue.issueType, (types.get(issue.issueType) || 0) + 1);
      severities[issue.severity] = (severities[issue.severity] || 0) + 1;
    }
    return { types, severities, total: qualityIssues.length };
  }, [qualityIssues]);

  const filteredIssues = useMemo(() => {
    if (filterIssueType === 'All') return qualityIssues;
    return qualityIssues.filter(i => i.issueType === filterIssueType);
  }, [qualityIssues, filterIssueType]);

  const filteredBom = useMemo(() => {
    if (!bomFilter) return assembledBom.slice(0, 200);
    const f = bomFilter.toLowerCase();
    return assembledBom.filter(b =>
      b.parentPn.toLowerCase().includes(f) ||
      b.childPn.toLowerCase().includes(f) ||
      b.childName.toLowerCase().includes(f)
    ).slice(0, 200);
  }, [assembledBom, bomFilter]);

  const totalDataRows = uploadStatus.bom.count + uploadStatus.productCode.count +
    uploadStatus.referenceInfo.count + uploadStatus.equipment.count + uploadStatus.materialCode.count;

  const ISSUE_TYPE_LABELS: Record<string, string> = {
    injection_missing: '사출 누락 (중량=0)',
    paint_missing: '도장 누락 (Paint량=0)',
    raw_material_missing: '원재료코드 누락',
    material_code_not_found: '재질코드 미존재',
  };

  const ISSUE_FIX_GUIDE: Record<string, { sheet: string; field: string; action: string }> = {
    injection_missing: {
      sheet: '기준정보',
      field: 'NET중량(g)',
      action: '해당 품목코드의 NET중량 값을 입력하세요. 사출 품목의 실제 제품 중량(g)을 금형도면 또는 실측에서 확인합니다.',
    },
    paint_missing: {
      sheet: '기준정보',
      field: '1도Paint량 / 2도Paint량 / 3도Paint량',
      action: '도장 품목의 도료 사용량(g)을 입력하세요. 도장 사양서에서 1도/2도/3도별 Paint량을 확인합니다.',
    },
    raw_material_missing: {
      sheet: '기준정보',
      field: '원재료코드1',
      action: '사출 원재료(RESIN) 코드를 입력하세요. 재질코드 시트에 등록된 코드여야 합니다. (예: PP, ABS, PC 등)',
    },
    material_code_not_found: {
      sheet: '재질코드',
      field: '재질코드 (신규 등록)',
      action: '기준정보에 입력된 원재료코드가 재질코드 시트에 없습니다. 재질코드 시트에 해당 코드/단가를 추가 등록하세요.',
    },
  };

  const handleBomExcelDownload = useCallback(async () => {
    if (assembledBom.length === 0) return;

    const [bomData, pcData, riData, eqData, mcData] = await Promise.all([
      bomMasterService.getAll(),
      productCodeService.getAll(),
      referenceInfoService.getAll(),
      equipmentService.getAll(),
      materialCodeService.getAll(),
    ]);

    const normalizePn = (pn: string) => pn.trim().toUpperCase().replace(/[\s\-_\.]+/g, '');

    const refMap = new Map<string, ReferenceInfoRecord>();
    for (const ri of riData) {
      refMap.set(normalizePn(ri.itemCode), ri);
      if (ri.customerPn) refMap.set(normalizePn(ri.customerPn), ri);
    }

    const priceMap = new Map<string, number>();
    const matNameMap = new Map<string, string>();
    for (const mc of mcData) {
      const key = normalizePn(mc.materialCode);
      if (mc.currentPrice > 0) priceMap.set(key, mc.currentPrice);
      if (mc.materialName) matNameMap.set(key, mc.materialName);
    }

    // 제품코드 맵 (제품번호 → 제품정보)
    const pcMap = new Map<string, ProductCodeRecord>();
    for (const pc of pcData) pcMap.set(normalizePn(pc.productCode), pc);

    const wb = XLSX.utils.book_new();
    const v = (val: unknown) => (val === 0 || val === '' || val == null) ? '' : val;
    const g2 = (val: number) => val > 0 ? Math.round(val * 100) / 100 : '';
    const matName = (code: string) => code ? (matNameMap.get(normalizePn(code)) || '') : '';

    // --- Sheet 1: BOM (원본: 전체 행 포함, 원재료 포함) ---
    {
      const hdr = ['No', '제품번호', '레벨', '모품번', '자품번', '고객사 P/N', '자품명', '규격', '부품유형', '단위', '소요량', '협력업체'];
      const rows: unknown[][] = [hdr];
      let prevProduct = '';
      let curProduct = '';
      bomData.forEach((b, i) => {
        if (b.level === 1) curProduct = b.parentPn;
        const showProduct = curProduct !== prevProduct;
        if (showProduct) prevProduct = curProduct;
        const ref = refMap.get(normalizePn(b.childPn));
        rows.push([
          i + 1,
          showProduct ? curProduct : '',
          b.level, b.parentPn, b.childPn,
          ref?.customerPn || '',
          b.childName, '',
          b.partType || '', 'EA', b.qty, b.supplier || '',
        ]);
      });
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [
        { wch: 6 }, { wch: 18 }, { wch: 5 }, { wch: 18 }, { wch: 18 },
        { wch: 16 }, { wch: 35 }, { wch: 10 }, { wch: 8 }, { wch: 5 }, { wch: 8 }, { wch: 14 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, 'BOM');
    }

    // --- Sheet 2: 제품코드 ---
    {
      const hdr = ['No', '제품코드', '고객사 PART NO', '제품명', '고객사', '품목유형', '사용여부'];
      const rows: unknown[][] = [hdr];
      pcData.forEach((p, i) => {
        rows.push([i + 1, p.productCode, p.customerPn, p.productName, p.customer, p.model, 'Y']);
      });
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [
        { wch: 6 }, { wch: 18 }, { wch: 16 }, { wch: 35 }, { wch: 14 }, { wch: 10 }, { wch: 8 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, '제품코드');
    }

    // --- Sheet 3: 기준정보 (원본 46컬럼 전체) ---
    {
      const hdr = [
        'No', '품목코드', '고객사 P/N', '품목명', '규격', '고객사명',
        '품종', '품목상태', '품목구분', '품목유형', '검사유형', '제품군분류',
        '조달구분', '협력업체',
        '우선배정라인1', '우선배정라인2', '우선배정라인3', '우선배정라인4',
        '안전재고', '안전재고일수', 'LOT수량', '시간당생산수량',
        '불량허용기준', '투입인원(명)', '가공시간', '표준C/T', '표준공수', 'BOX당수량',
        '원재료코드1', '원재료코드2', '원재료코드3', '원재료코드4',
        'NET중량1', 'Runner중량1', 'NET중량2', 'Runner중량2',
        '1도 표준 Paint량', '2도 표준 Paint량', '3도 표준 Paint량', '4도 표준 Paint량',
        '재료 Loss율', '금형Cavity', '사용Cavity',
        '제품크기종류', '광택종류', '사용여부',
      ];
      const rows: unknown[][] = [hdr];
      riData.forEach((ri, i) => {
        rows.push([
          i + 1, ri.itemCode, ri.customerPn, ri.itemName, ri.spec, ri.customerName,
          ri.variety, ri.itemStatus, ri.itemCategory, ri.processType, ri.inspectionType, ri.productGroup,
          ri.supplyType, ri.supplier,
          ri.priorityLine1, ri.priorityLine2, ri.priorityLine3, ri.priorityLine4,
          v(ri.safetyStock), v(ri.safetyStockDays), v(ri.lotQty), v(ri.productionPerHour),
          v(ri.defectAllowance), v(ri.workers), ri.processingTime, v(ri.standardCT), v(ri.standardManHours), v(ri.qtyPerBox),
          ri.rawMaterialCode1, ri.rawMaterialCode2, ri.rawMaterialCode3, ri.rawMaterialCode4 || '',
          g2(ri.netWeight), g2(ri.runnerWeight), g2(ri.netWeight2), g2(ri.runnerWeight2),
          g2(ri.paintQty1), g2(ri.paintQty2), g2(ri.paintQty3), g2(ri.paintQty4),
          v(ri.lossRate), v(ri.cavity), v(ri.useCavity),
          ri.productSizeType, ri.glossType, ri.useYn,
        ]);
      });
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [
        { wch: 6 }, { wch: 18 }, { wch: 16 }, { wch: 30 }, { wch: 14 }, { wch: 14 },
        { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 10 },
        { wch: 8 }, { wch: 14 },
        { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
        { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 14 },
        { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 10 },
        { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
        { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 12 },
        { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
        { wch: 10 }, { wch: 10 }, { wch: 10 },
        { wch: 12 }, { wch: 10 }, { wch: 8 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, '기준정보');
    }

    // --- Sheet 4: 설비코드 (원본 15컬럼 전체) ---
    {
      const hdr = [
        'No', '설비코드', '설비명', '사업장', '업종', '품종', 'LINE',
        '직/간접구분', '설비톤수', '일가동시간(HR)', '일가동시간(분)', '일가동시간(초)',
        '설비관리번호', '설비번호', '사용여부',
      ];
      const rows: unknown[][] = [hdr];
      eqData.forEach((eq, i) => {
        rows.push([
          i + 1, eq.equipmentCode, eq.equipmentName, eq.site, eq.industry, eq.variety, eq.line,
          eq.directIndirect, eq.tonnage, v(eq.dailyHours), v(eq.dailyMinutes), v(eq.dailySeconds),
          eq.managementNo, eq.equipmentNo, eq.useYn,
        ]);
      });
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [
        { wch: 6 }, { wch: 14 }, { wch: 24 }, { wch: 16 }, { wch: 8 }, { wch: 14 }, { wch: 14 },
        { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
        { wch: 14 }, { wch: 10 }, { wch: 8 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, '설비코드');
    }

    // --- Sheet 5: 재질코드 (원본 16컬럼 전체) ---
    {
      const hdr = [
        'No', '업종코드', '업종명', '재질코드', '재질명', '재질분류',
        '도료구분', '색상', '단위', '안전재고량', '일평균사용량',
        'Loss율(%)', '유효기간(일)', '발주 SIZE', '사용여부', '보호항목', '현재단가',
      ];
      const rows: unknown[][] = [hdr];
      mcData.forEach((mc, i) => {
        rows.push([
          i + 1, mc.industryCode, mc.materialType, mc.materialCode, mc.materialName, mc.materialCategory,
          mc.paintCategory, mc.color, mc.unit, v(mc.safetyStock), v(mc.dailyAvgUsage),
          v(mc.lossRate), v(mc.validDays), mc.orderSize, mc.useYn, mc.protectedItem,
          mc.currentPrice > 0 ? mc.currentPrice : '',
        ]);
      });
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [
        { wch: 6 }, { wch: 10 }, { wch: 8 }, { wch: 16 }, { wch: 28 }, { wch: 14 },
        { wch: 8 }, { wch: 8 }, { wch: 6 }, { wch: 10 }, { wch: 12 },
        { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 12 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, '재질코드');
    }

    // --- Sheet 6: BOM정보 (원본형식: 원재료행 제외, 제품정보 병합, 원재료명, +재질단가) ---
    {
      const hdr = [
        'No', '제품번호', '고객사', '제품코드', '고객사 P/N(제품)', '제품명', '제품유형',
        '레벨', '모품번', '자품번', '고객사 P/N', '자품명', '규격',
        '부품유형', '단위', '소요량', '협력업체', '조달구분',
        '적용설비명', '표준C/T',
        '원재료명1', '원재료명2', '원재료명3',
        'NET중량1', 'Runner중량1', 'NET중량2', 'Runner중량2',
        '1도 표준 Paint량', '2도 표준 Paint량', '3도 표준 Paint량',
        '재질단가',
      ];
      const rows: unknown[][] = [hdr];
      let curProductCode = '';
      let prevProductCode = '';
      let curPc: ProductCodeRecord | undefined;
      let curProductType = '';
      let no = 0;

      for (const b of bomData) {
        // 원재료 행 제외 (원본 BOM정보와 동일)
        if (b.partType === '원재료') continue;

        // 제품번호 추적
        if (b.level === 1) {
          curProductCode = b.parentPn;
          curPc = pcMap.get(normalizePn(b.parentPn));
          const prodRef = refMap.get(normalizePn(b.parentPn));
          curProductType = prodRef?.processType || '';
        }

        // 제품번호: 제품이 변경될 때만 표시 (원본과 동일)
        const showProduct = curProductCode !== prevProductCode;
        if (showProduct) prevProductCode = curProductCode;

        const ref = refMap.get(normalizePn(b.childPn)) || refMap.get(normalizePn(b.parentPn));
        const price = ref?.rawMaterialCode1
          ? (priceMap.get(normalizePn(ref.rawMaterialCode1)) || 0) : 0;

        no++;
        rows.push([
          no,
          showProduct ? curProductCode : '',
          curPc?.customer || '',
          curProductCode,
          curPc?.customerPn || '',
          curPc?.productName || '',
          curProductType,
          b.level, b.parentPn, b.childPn,
          ref?.customerPn || '',
          b.childName || ref?.itemName || '',
          ref?.spec || '',
          b.partType || '', 'EA', b.qty,
          b.supplier || '',
          ref?.supplyType || '',
          ref?.priorityLine1 || '', v(ref?.standardCT),
          matName(ref?.rawMaterialCode1 || ''),
          matName(ref?.rawMaterialCode2 || ''),
          matName(ref?.rawMaterialCode3 || ''),
          g2(ref?.netWeight || 0), g2(ref?.runnerWeight || 0),
          g2(ref?.netWeight2 || 0), g2(ref?.runnerWeight2 || 0),
          g2(ref?.paintQty1 || 0), g2(ref?.paintQty2 || 0), g2(ref?.paintQty3 || 0),
          price > 0 ? price : '',
        ]);
      }

      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [
        { wch: 6 }, { wch: 18 }, { wch: 12 }, { wch: 18 }, { wch: 16 }, { wch: 35 }, { wch: 8 },
        { wch: 5 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 35 }, { wch: 10 },
        { wch: 8 }, { wch: 5 }, { wch: 8 }, { wch: 14 }, { wch: 8 },
        { wch: 16 }, { wch: 8 },
        { wch: 28 }, { wch: 28 }, { wch: 28 },
        { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 12 },
        { wch: 14 }, { wch: 14 }, { wch: 14 },
        { wch: 10 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, 'BOM정보');
    }

    // --- Sheet 7: Cavity2이상_사출 ---
    {
      const hdr = ['품목코드', '고객사 P/N', '품목명', '사용Cavity', 'NET중량1(g)', 'Runner중량1(g)', 'Runner/Cavity(g)', '재료Loss율(%)', '소요량(Kg)'];
      const rows: unknown[][] = [hdr];
      for (const ri of riData) {
        const cav = ri.useCavity || ri.cavity;
        if (cav >= 2 && (ri.processType === '사출' || ri.processType?.includes('사출'))) {
          const runnerPerCav = cav > 0 ? ri.runnerWeight / cav : 0;
          const usage = ((ri.netWeight + runnerPerCav) * (1 + ri.lossRate / 100)) / 1000;
          rows.push([
            ri.itemCode, ri.customerPn, ri.itemName, cav,
            g2(ri.netWeight), g2(ri.runnerWeight),
            runnerPerCav > 0 ? Math.round(runnerPerCav * 100) / 100 : '',
            v(ri.lossRate),
            usage > 0 ? Math.round(usage * 10000) / 10000 : '',
          ]);
        }
      }
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [
        { wch: 18 }, { wch: 16 }, { wch: 30 }, { wch: 10 }, { wch: 12 },
        { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, 'Cavity2이상_사출');
    }

    // --- Sheet 8: 사출_누락정보 ---
    {
      const hdr = ['품목코드', '고객사 P/N', '품목명', '원재료명1', 'NET중량1(g)', 'Runner중량1(g)', '누락사유'];
      const rows: unknown[][] = [hdr];
      for (const ri of riData) {
        if (ri.processType !== '사출' && !ri.processType?.includes('사출')) continue;
        if (ri.supplyType?.includes('외주') || ri.supplyType?.includes('구매')) continue;
        const reasons: string[] = [];
        if (ri.netWeight <= 0 && ri.runnerWeight <= 0) reasons.push('NET/Runner 중량 모두 0');
        else if (ri.netWeight <= 0) reasons.push('NET중량 0');
        if (!ri.rawMaterialCode1) reasons.push('원재료코드 없음');
        if (reasons.length === 0) continue;
        rows.push([
          ri.itemCode, ri.customerPn, ri.itemName,
          matName(ri.rawMaterialCode1),
          g2(ri.netWeight), g2(ri.runnerWeight), reasons.join(', '),
        ]);
      }
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [
        { wch: 18 }, { wch: 16 }, { wch: 30 }, { wch: 28 }, { wch: 12 }, { wch: 14 }, { wch: 30 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, '사출_누락정보');
    }

    // --- Sheet 9: 도장_누락정보 ---
    {
      const hdr = ['품목코드', '고객사 P/N', '품목명', '1도 원재료명', '2도 원재료명', '3도 원재료명', '1도Paint량(g)', '2도Paint량(g)', '3도Paint량(g)', '누락사유'];
      const rows: unknown[][] = [hdr];
      for (const ri of riData) {
        if (ri.processType !== '도장' && !ri.processType?.includes('도장')) continue;
        const reasons: string[] = [];
        if (ri.paintQty1 <= 0 && ri.paintQty2 <= 0 && ri.paintQty3 <= 0) reasons.push('Paint량 모두 0');
        if (!ri.rawMaterialCode1 && !ri.rawMaterialCode2 && !ri.rawMaterialCode3) reasons.push('원재료 전체 없음');
        if (reasons.length === 0) continue;
        rows.push([
          ri.itemCode, ri.customerPn, ri.itemName,
          matName(ri.rawMaterialCode1), matName(ri.rawMaterialCode2), matName(ri.rawMaterialCode3),
          g2(ri.paintQty1), g2(ri.paintQty2), g2(ri.paintQty3), reasons.join(', '),
        ]);
      }
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [
        { wch: 18 }, { wch: 16 }, { wch: 30 },
        { wch: 28 }, { wch: 28 }, { wch: 28 },
        { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 30 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, '도장_누락정보');
    }

    XLSX.writeFile(wb, `BOM마스터_통합_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, [assembledBom]);

  const handleDownloadQualityExcel = () => {
    const target = filterIssueType === 'All' ? qualityIssues : filteredIssues;
    if (target.length === 0) return;
    const headers = ['유형', '품목코드', '품목명', '심각도', '설명', '수정 대상 시트', '수정 대상 필드', '처리방법'];
    const rows = target.map(issue => [
      ISSUE_TYPE_LABELS[issue.issueType] || issue.issueType,
      issue.itemCode,
      issue.itemName,
      issue.severity,
      issue.description,
      ISSUE_FIX_GUIDE[issue.issueType]?.sheet || '',
      ISSUE_FIX_GUIDE[issue.issueType]?.field || '',
      ISSUE_FIX_GUIDE[issue.issueType]?.action || '',
    ]);
    downloadCSV(`데이터품질_이슈_${filterIssueType === 'All' ? '전체' : filterIssueType}_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  return (
    <div className="space-y-4">
      {/* 메트릭 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricCard label="BOM" value={uploadStatus.bom.count.toLocaleString()} suffix="건" />
        <MetricCard label="제품코드" value={uploadStatus.productCode.count.toLocaleString()} suffix="건" />
        <MetricCard label="기준정보" value={uploadStatus.referenceInfo.count.toLocaleString()} suffix="건" />
        <MetricCard label="설비코드" value={uploadStatus.equipment.count.toLocaleString()} suffix="건" />
        <MetricCard label="재질코드" value={uploadStatus.materialCode.count.toLocaleString()} suffix="건" />
      </div>

      {/* 업로드 영역 */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">BOM 마스터 Excel 업로드</h3>
          <span className="text-xs text-gray-400">
            최종 업로드: {uploadStatus.bom.lastUpload}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <label className={`px-4 py-2 rounded text-sm font-medium cursor-pointer transition-colors ${
            isUploading
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}>
            {isUploading ? '업로드 중...' : 'bom_개정.xlsx 업로드'}
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFileUpload}
              disabled={isUploading}
            />
          </label>
          <button
            onClick={handleBomExcelDownload}
            disabled={assembledBom.length === 0}
            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Excel 다운로드
          </button>
          <span className="text-xs text-gray-500">
            파란색 5개 시트 (BOM, 제품코드, 기준정보, 설비코드, 재질코드) 자동 감지
          </span>
        </div>
        {uploadMessage && (
          <div className={`mt-2 text-xs px-3 py-2 rounded ${
            uploadMessage.includes('실패') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'
          }`}>
            {uploadMessage}
          </div>
        )}
      </div>

      {/* 뷰 전환 탭 */}
      <div className="flex gap-2">
        {[
          { id: 'status' as const, label: '업로드 현황' },
          { id: 'quality' as const, label: `데이터 품질 (${issueStats.total})` },
          { id: 'bom' as const, label: `BOM정보 (${assembledBom.length.toLocaleString()})` },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveView(tab.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
              activeView === tab.id
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 업로드 현황 + Gap 분석 테이블 */}
      {activeView === 'status' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-gray-600 font-medium">시트명</th>
                <th className="px-4 py-2 text-right text-gray-600 font-medium">
                  {gapAnalysis.length > 0 ? 'Excel 파싱' : '행수'}
                </th>
                {gapAnalysis.length > 0 && (
                  <>
                    <th className="px-4 py-2 text-right text-gray-600 font-medium">DB 저장</th>
                    <th className="px-4 py-2 text-right text-gray-600 font-medium">차이</th>
                    <th className="px-4 py-2 text-center text-gray-600 font-medium">상태</th>
                  </>
                )}
                <th className="px-4 py-2 text-left text-gray-600 font-medium">최종 업로드</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[
                { name: 'BOM', ...uploadStatus.bom },
                { name: '제품코드', ...uploadStatus.productCode },
                { name: '기준정보', ...uploadStatus.referenceInfo },
                { name: '설비코드', ...uploadStatus.equipment },
                { name: '재질코드', ...uploadStatus.materialCode },
              ].map(row => {
                const gap = gapAnalysis.find(g => g.name === row.name);
                return (
                  <tr key={row.name} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-700">{row.name}</td>
                    <td className="px-4 py-2 text-right text-gray-600">
                      {gap ? gap.parsed.toLocaleString() : row.count.toLocaleString()}
                    </td>
                    {gapAnalysis.length > 0 && (
                      <>
                        <td className="px-4 py-2 text-right text-gray-600">
                          {gap ? gap.saved.toLocaleString() : '-'}
                        </td>
                        <td className={`px-4 py-2 text-right font-mono ${
                          gap && gap.gap !== 0 ? 'text-red-600 font-semibold' : 'text-gray-400'
                        }`}>
                          {gap ? (gap.gap === 0 ? '0' : (gap.gap > 0 ? `+${gap.gap}` : gap.gap)) : '-'}
                        </td>
                        <td className="px-4 py-2 text-center">
                          {gap ? (
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              gap.status === 'match'
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-red-100 text-red-700'
                            }`}>
                              {gap.status === 'match' ? 'MATCH' : 'GAP'}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-400">-</span>
                          )}
                        </td>
                      </>
                    )}
                    <td className="px-4 py-2 text-gray-500">{row.lastUpload}</td>
                  </tr>
                );
              })}
              <tr className="bg-blue-50 font-semibold">
                <td className="px-4 py-2 text-blue-700">합계</td>
                <td className="px-4 py-2 text-right text-blue-700">
                  {gapAnalysis.length > 0
                    ? gapAnalysis.reduce((s, g) => s + g.parsed, 0).toLocaleString()
                    : totalDataRows.toLocaleString()
                  }
                </td>
                {gapAnalysis.length > 0 && (
                  <>
                    <td className="px-4 py-2 text-right text-blue-700">
                      {gapAnalysis.reduce((s, g) => s + g.saved, 0).toLocaleString()}
                    </td>
                    <td className={`px-4 py-2 text-right font-mono ${
                      gapAnalysis.some(g => g.gap !== 0) ? 'text-red-600' : 'text-emerald-600'
                    }`}>
                      {(() => {
                        const total = gapAnalysis.reduce((s, g) => s + g.gap, 0);
                        return total === 0 ? '0' : (total > 0 ? `+${total}` : total);
                      })()}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        gapAnalysis.every(g => g.status === 'match')
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-red-100 text-red-700'
                      }`}>
                        {gapAnalysis.every(g => g.status === 'match') ? 'ALL MATCH' : 'HAS GAP'}
                      </span>
                    </td>
                  </>
                )}
                <td className="px-4 py-2"></td>
              </tr>
            </tbody>
          </table>
          {gapAnalysis.length > 0 && gapAnalysis.some(g => g.status === 'mismatch') && (
            <div className="px-4 py-2 bg-red-50 text-xs text-red-600">
              Gap이 있는 시트가 있습니다. UNIQUE 제약조건 중복 또는 저장 오류를 확인하세요. 재업로드하면 해결될 수 있습니다.
            </div>
          )}
          {gapAnalysis.length > 0 && gapAnalysis.every(g => g.status === 'match') && (
            <div className="px-4 py-2 bg-emerald-50 text-xs text-emerald-600">
              모든 시트가 정확하게 일치합니다. Excel 파싱 → DB 저장 무결성 확인 완료.
            </div>
          )}
        </div>
      )}

      {/* 데이터 품질 패널 */}
      {activeView === 'quality' && (
        <div className="space-y-3">
          {/* 이슈 유형별 요약 + 다운로드 */}
          <div className="flex items-center justify-between">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 flex-1">
              {Array.from(issueStats.types.entries()).map(([type, count]) => (
                <div
                  key={type}
                  onClick={() => setFilterIssueType(filterIssueType === type ? 'All' : type)}
                  className={`p-3 rounded-lg cursor-pointer transition-colors ${
                    filterIssueType === type ? 'bg-orange-100 border border-orange-300' : 'bg-white border border-gray-200'
                  }`}
                >
                  <div className="text-xs text-gray-500">{ISSUE_TYPE_LABELS[type] || type}</div>
                  <div className="text-lg font-bold text-orange-600">{count}건</div>
                </div>
              ))}
            </div>
            <button
              onClick={handleDownloadQualityExcel}
              disabled={filteredIssues.length === 0}
              className="ml-3 px-3 py-2 bg-green-600 text-white text-xs font-medium rounded hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              CSV 다운로드 ({filteredIssues.length}건)
            </button>
          </div>

          {/* 처리방법 가이드 */}
          {filterIssueType !== 'All' && ISSUE_FIX_GUIDE[filterIssueType] && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="text-xs font-semibold text-blue-800 mb-1">처리방법 — {ISSUE_TYPE_LABELS[filterIssueType]}</div>
              <div className="text-xs text-blue-700 space-y-1">
                <div><span className="font-medium">수정 시트:</span> <span className="font-mono bg-blue-100 px-1 rounded">{ISSUE_FIX_GUIDE[filterIssueType].sheet}</span></div>
                <div><span className="font-medium">수정 필드:</span> <span className="font-mono bg-blue-100 px-1 rounded">{ISSUE_FIX_GUIDE[filterIssueType].field}</span></div>
                <div><span className="font-medium">조치:</span> {ISSUE_FIX_GUIDE[filterIssueType].action}</div>
              </div>
            </div>
          )}
          {filterIssueType === 'All' && issueStats.total > 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <div className="text-xs font-semibold text-gray-700 mb-2">이슈 유형별 처리방법</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {Object.entries(ISSUE_FIX_GUIDE).map(([type, guide]) => (
                  <div key={type} className="text-xs bg-white rounded p-2 border border-gray-100">
                    <div className="font-semibold text-gray-700 mb-0.5">{ISSUE_TYPE_LABELS[type]}</div>
                    <div className="text-gray-500">
                      <span className="font-mono text-blue-600">{guide.sheet}</span> 시트의 <span className="font-mono text-blue-600">{guide.field}</span> 수정
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 이슈 테이블 */}
          <div className="bg-white rounded-lg shadow overflow-hidden max-h-96 overflow-y-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-gray-600 font-medium">유형</th>
                  <th className="px-3 py-2 text-left text-gray-600 font-medium">품목코드</th>
                  <th className="px-3 py-2 text-left text-gray-600 font-medium">품목명</th>
                  <th className="px-3 py-2 text-left text-gray-600 font-medium">심각도</th>
                  <th className="px-3 py-2 text-left text-gray-600 font-medium">설명</th>
                  <th className="px-3 py-2 text-left text-gray-600 font-medium">수정위치</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredIssues.slice(0, 200).map((issue, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5 text-gray-600">
                      {ISSUE_TYPE_LABELS[issue.issueType] || issue.issueType}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-gray-700">{issue.itemCode}</td>
                    <td className="px-3 py-1.5 text-gray-600 max-w-40 truncate">{issue.itemName}</td>
                    <td className="px-3 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        issue.severity === 'error' ? 'bg-red-100 text-red-700' :
                        issue.severity === 'warning' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {issue.severity}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-gray-500 max-w-60 truncate">{issue.description}</td>
                    <td className="px-3 py-1.5 text-blue-600 font-mono text-[10px]">
                      {ISSUE_FIX_GUIDE[issue.issueType]?.sheet} &gt; {ISSUE_FIX_GUIDE[issue.issueType]?.field}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredIssues.length > 200 && (
              <div className="px-3 py-2 text-xs text-gray-400 bg-gray-50">
                {filteredIssues.length - 200}건 더 있음 (200건까지 표시)
              </div>
            )}
          </div>
        </div>
      )}

      {/* BOM정보 미리보기 */}
      {activeView === 'bom' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="품번/품명 검색..."
              value={bomFilter}
              onChange={e => setBomFilter(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded text-xs w-60"
            />
            <span className="text-xs text-gray-400">
              {assembledBom.length.toLocaleString()}건 중 {filteredBom.length}건 표시
            </span>
            <span className="ml-auto text-xs text-gray-400">
              상단에서 Excel 다운로드 가능
            </span>
          </div>

          <div className="bg-white rounded-lg shadow overflow-hidden max-h-96 overflow-y-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-gray-600 font-medium">모품번</th>
                  <th className="px-3 py-2 text-left text-gray-600 font-medium">자품번</th>
                  <th className="px-3 py-2 text-left text-gray-600 font-medium">자품명</th>
                  <th className="px-3 py-2 text-right text-gray-600 font-medium">Lv</th>
                  <th className="px-3 py-2 text-right text-gray-600 font-medium">소요량</th>
                  <th className="px-3 py-2 text-left text-gray-600 font-medium">공정</th>
                  <th className="px-3 py-2 text-left text-gray-600 font-medium">조달</th>
                  <th className="px-3 py-2 text-right text-gray-600 font-medium">NET중량</th>
                  <th className="px-3 py-2 text-right text-gray-600 font-medium">재질단가</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredBom.map((row, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5 font-mono text-gray-700 max-w-28 truncate">{row.parentPn}</td>
                    <td className="px-3 py-1.5 font-mono text-gray-700 max-w-28 truncate">{row.childPn}</td>
                    <td className="px-3 py-1.5 text-gray-600 max-w-32 truncate">{row.childName}</td>
                    <td className="px-3 py-1.5 text-right text-gray-500">{row.level}</td>
                    <td className="px-3 py-1.5 text-right text-gray-600">{row.qty}</td>
                    <td className="px-3 py-1.5 text-gray-500">{row.processType || '-'}</td>
                    <td className="px-3 py-1.5 text-gray-500">{row.supplyType || '-'}</td>
                    <td className="px-3 py-1.5 text-right text-gray-600">
                      {row.netWeight > 0 ? row.netWeight.toFixed(2) : '-'}
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-600">
                      {row.materialPrice > 0 ? row.materialPrice.toLocaleString() : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default BomMasterUploadView;
