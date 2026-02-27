
import React, { useState, useEffect, useMemo } from 'react';
import MetricCard from './MetricCard';
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

const BomMasterUploadView: React.FC = () => {
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>(INITIAL_STATUS);
  const [qualityIssues, setQualityIssues] = useState<DataQualityIssue[]>([]);
  const [assembledBom, setAssembledBom] = useState<AssembledBomInfo[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');
  const [activeView, setActiveView] = useState<'status' | 'quality' | 'bom'>('status');
  const [filterIssueType, setFilterIssueType] = useState<string>('All');
  const [bomFilter, setBomFilter] = useState('');

  // --- 초기 로드: localStorage에서 마스터 현황 로드 ---
  useEffect(() => {
    const loadStatus = () => {
      const status = { ...INITIAL_STATUS };
      const ts = localStorage.getItem('dashboard_bomMaster_uploadTimestamp');
      const uploadDate = ts || '-';

      const bomData = localStorage.getItem('dashboard_bomMasterData');
      if (bomData) {
        try { status.bom = { count: JSON.parse(bomData).length, lastUpload: uploadDate }; } catch { /* */ }
      }
      const pcData = localStorage.getItem('dashboard_productCodeMaster');
      if (pcData) {
        try { status.productCode = { count: JSON.parse(pcData).length, lastUpload: uploadDate }; } catch { /* */ }
      }
      const riData = localStorage.getItem('dashboard_referenceInfoMaster');
      if (riData) {
        try { status.referenceInfo = { count: JSON.parse(riData).length, lastUpload: uploadDate }; } catch { /* */ }
      }
      const eqData = localStorage.getItem('dashboard_equipmentMaster');
      if (eqData) {
        try { status.equipment = { count: JSON.parse(eqData).length, lastUpload: uploadDate }; } catch { /* */ }
      }
      const mcData = localStorage.getItem('dashboard_materialCodeMaster');
      if (mcData) {
        try { status.materialCode = { count: JSON.parse(mcData).length, lastUpload: uploadDate }; } catch { /* */ }
      }
      setUploadStatus(status);
    };

    const loadQuality = () => {
      const stored = localStorage.getItem('dashboard_dataQualityIssues');
      if (stored) {
        try { setQualityIssues(JSON.parse(stored)); } catch { /* */ }
      }
    };

    loadStatus();
    loadQuality();
    rebuildAssembledBom();
  }, []);

  // --- BOM정보 조립 ---
  const rebuildAssembledBom = () => {
    try {
      const bomData: BomMasterRecord[] = JSON.parse(localStorage.getItem('dashboard_bomMasterData') || '[]');
      const refInfo: ReferenceInfoRecord[] = JSON.parse(localStorage.getItem('dashboard_referenceInfoMaster') || '[]');
      const matCodes: MaterialCodeRecord[] = JSON.parse(localStorage.getItem('dashboard_materialCodeMaster') || '[]');
      if (bomData.length > 0) {
        const assembled = assembleBomInfo(bomData, refInfo, matCodes);
        setAssembledBom(assembled);
      }
    } catch { /* ignore */ }
  };

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
      localStorage.setItem('dashboard_bomMaster_uploadTimestamp', now);

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
      rebuildAssembledBom();

      // 크로스 컴포넌트 이벤트
      window.dispatchEvent(new CustomEvent('dashboard-data-updated', { detail: { type: 'bomMaster' } }));

      const totalRows = result.sheetStats.reduce((s, st) => s + st.rows, 0);
      setUploadMessage(`업로드 완료! ${result.sheetStats.length}개 시트, ${totalRows.toLocaleString()}건 저장. 품질이슈: ${result.qualityIssues.length}건`);
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

      {/* 업로드 현황 테이블 */}
      {activeView === 'status' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-gray-600 font-medium">시트명</th>
                <th className="px-4 py-2 text-right text-gray-600 font-medium">행수</th>
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
              ].map(row => (
                <tr key={row.name} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium text-gray-700">{row.name}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{row.count.toLocaleString()}</td>
                  <td className="px-4 py-2 text-gray-500">{row.lastUpload}</td>
                </tr>
              ))}
              <tr className="bg-blue-50 font-semibold">
                <td className="px-4 py-2 text-blue-700">합계</td>
                <td className="px-4 py-2 text-right text-blue-700">{totalDataRows.toLocaleString()}</td>
                <td className="px-4 py-2"></td>
              </tr>
            </tbody>
          </table>
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
                      {row.netWeight > 0 ? row.netWeight.toFixed(1) : '-'}
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
