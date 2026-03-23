/**
 * UserGuideModal — 대시보드 사용설명서 모달
 * 표준재료비 산출 시스템 중심 운영 가이드
 */
import React, { useState } from 'react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type Section = 'overview' | 'standard' | 'data' | 'faq';

const UserGuideModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [activeSection, setActiveSection] = useState<Section>('overview');

  if (!isOpen) return null;

  const sections: { id: Section; label: string }[] = [
    { id: 'overview', label: '시스템 개요' },
    { id: 'standard', label: '표준재료비 산출' },
    { id: 'data', label: '데이터 관리' },
    { id: 'faq', label: 'FAQ' },
  ];

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-[960px] max-h-[85vh] flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-56 bg-slate-50 border-r border-slate-200 p-4 flex-shrink-0">
          <h2 className="text-lg font-bold text-slate-800 mb-1">사용설명서</h2>
          <p className="text-[11px] text-slate-400 mb-4">v2.1 | 2026.02</p>
          <nav className="space-y-1">
            {sections.map(s => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeSection === s.id
                    ? 'bg-slate-700 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-200'
                }`}
              >
                {s.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 text-xl font-bold"
          >
            &times;
          </button>

          {activeSection === 'overview' && <OverviewSection />}
          {activeSection === 'standard' && <StandardSection />}
          {activeSection === 'data' && <DataSection />}
          {activeSection === 'faq' && <FaqSection />}
        </div>
      </div>
    </div>
  );
};

/* ─── Sections ─── */

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="text-xl font-bold text-slate-800 mb-4 pb-2 border-b border-slate-200">{children}</h3>
);

const SubTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 className="text-base font-semibold text-slate-700 mt-6 mb-2">{children}</h4>
);

const Pill: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${color}`}>{children}</span>
);

function OverviewSection() {
  return (
    <div className="space-y-4 text-sm text-slate-600 leading-relaxed">
      <SectionTitle>시스템 개요</SectionTitle>
      <p>
        신성오토텍 영업/구매 대시보드는 매출계획, BOM, 입고현황, 기준정보를 통합하여
        <strong> 표준재료비를 자동 산출</strong>하는 시스템입니다.
      </p>

      <SubTitle>메뉴 구성</SubTitle>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50">
            <th className="border border-slate-200 px-3 py-2 text-left font-semibold">메뉴</th>
            <th className="border border-slate-200 px-3 py-2 text-left font-semibold">주요 기능</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['종합현황', '매출/구매 KPI 요약, 월별 추이 차트'],
            ['영업현황', '매출계획 업로드/관리, 매출실적, 거래선별 분석'],
            ['구매현황', '입고현황, BOM 마스터, 소요량(MRP), 표준재료비 등 10개 서브탭'],
            ['재고관리', '재고 수불 현황'],
            ['협력사관리', '협력사별 거래 현황'],
          ].map(([menu, desc]) => (
            <tr key={menu}>
              <td className="border border-slate-200 px-3 py-2 font-medium text-slate-700">{menu}</td>
              <td className="border border-slate-200 px-3 py-2">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <SubTitle>데이터 흐름</SubTitle>
      <div className="bg-slate-50 rounded-xl p-4 font-mono text-xs text-slate-600 space-y-1">
        <p>영업현황 &gt; <strong>매출계획 Excel</strong> 업로드</p>
        <p className="pl-4">↓ 품목별 월 수량 + 단가</p>
        <p>구매현황 &gt; BOM 마스터 + 기준정보 + 재질코드</p>
        <p className="pl-4">↓ BOM 전개 → 자재 소요량 산출</p>
        <p>구매현황 &gt; <strong>표준재료비</strong></p>
        <p className="pl-4">↓ 소요량 × 단가 = 표준재료비 자동 계산</p>
        <p>구매현황 &gt; 입고현황</p>
        <p className="pl-4">↓ 실적 매입재료비 → 표준 vs 매입 비교</p>
      </div>

      <SubTitle>Supabase 데이터 현황</SubTitle>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50">
            <th className="border border-slate-200 px-3 py-2 text-left font-semibold">테이블</th>
            <th className="border border-slate-200 px-3 py-2 text-right font-semibold">건수</th>
            <th className="border border-slate-200 px-3 py-2 text-left font-semibold">설명</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['item_standard_cost', '2,872', '품목별 월 원가 (핵심)'],
            ['reference_info_master', '4,660', 'P/N 브릿지 + 조달구분'],
            ['material_code_master', '587', '재질코드 + 재질단가'],
            ['purchase_price_master', '1,016', '구매 단가'],
            ['outsource_injection_price', '251', '외주사출 판매가'],
            ['paint_mix_ratio_master', '185', '도료 배합비율'],
            ['bom_master', '11,791', 'BOM 모자관계'],
          ].map(([table, count, desc]) => (
            <tr key={table}>
              <td className="border border-slate-200 px-3 py-2 font-mono text-xs">{table}</td>
              <td className="border border-slate-200 px-3 py-2 text-right">{count}</td>
              <td className="border border-slate-200 px-3 py-2">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StandardSection() {
  return (
    <div className="space-y-4 text-sm text-slate-600 leading-relaxed">
      <SectionTitle>표준재료비 산출</SectionTitle>

      <SubTitle>산출 기준</SubTitle>
      <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
        <p className="font-semibold text-slate-800 mb-2">매출계획 기준 산출</p>
        <p>
          <strong>영업현황 &gt; 매출계획</strong>에 업로드된 품목별 월 계획수량을 기준으로
          표준재료비를 산출합니다. 매출계획이 없으면 매출실적(item_revenue)으로 보완합니다.
        </p>
      </div>

      <SubTitle>계산 방식 (2가지 모드)</SubTitle>
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-slate-50 rounded-xl p-4 border">
          <p className="font-semibold text-slate-800 mb-2">
            <Pill color="bg-slate-100 text-slate-600">자동 산출</Pill>
          </p>
          <p className="text-xs">BOM 전개 + 구매입고 실적 avgPrice 역산</p>
          <p className="text-xs mt-1 text-slate-400">구매입고 데이터 필요</p>
        </div>
        <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
          <p className="font-semibold text-slate-800 mb-2">
            <Pill color="bg-slate-100 text-slate-600">마스터 기준</Pill> (권장)
          </p>
          <p className="text-xs">item_standard_cost 테이블 기반 정방향 산출</p>
          <p className="text-xs mt-1 text-emerald-600 font-semibold">Excel 12개월 검증 완료 (0.0% 오차)</p>
        </div>
      </div>

      <SubTitle>마스터 기준 산출 공식</SubTitle>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50">
            <th className="border border-slate-200 px-3 py-2 text-left font-semibold">조달구분</th>
            <th className="border border-slate-200 px-3 py-2 text-left font-semibold">산출 공식</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['자작 (RESIN)', 'BOM소요량 × (1+Loss율) × 재질단가 합계'],
            ['자작 (PAINT)', '도료배합비율 × 각 성분 재질단가 × 소요량'],
            ['구매', '구매단가 × 월 계획수량'],
            ['외주', '외주사출판매가 × (1+Loss율) × 월 계획수량'],
          ].map(([type, formula]) => (
            <tr key={type}>
              <td className="border border-slate-200 px-3 py-2 font-medium">{type}</td>
              <td className="border border-slate-200 px-3 py-2 font-mono text-xs">{formula}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-slate-400">
        NET재료비 = (사출 + 도장 + 구매) - 외주사출비
      </p>

      <SubTitle>표준재료비 구성 비율 (연간 기준)</SubTitle>
      <div className="flex gap-3">
        {[
          { label: 'RESIN', pct: '18.6%', amt: '13.7억', color: 'bg-slate-50 text-slate-800 border border-slate-100' },
          { label: 'PAINT', pct: '8.1%', amt: '5.9억', color: 'bg-slate-50 text-slate-800 border border-slate-100' },
          { label: '구매', pct: '28.7%', amt: '21.0억', color: 'bg-slate-50 text-slate-800 border border-slate-100' },
          { label: '외주', pct: '44.6%', amt: '32.7억', color: 'bg-slate-50 text-slate-800 border border-slate-100' },
        ].map(item => (
          <div key={item.label} className={`flex-1 rounded-lg p-3 ${item.color}`}>
            <p className="font-bold text-lg">{item.pct}</p>
            <p className="text-xs font-semibold">{item.label}</p>
            <p className="text-xs opacity-75">{item.amt}</p>
          </div>
        ))}
      </div>

      <SubTitle>5개 서브탭</SubTitle>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50">
            <th className="border border-slate-200 px-3 py-2 text-left font-semibold">탭</th>
            <th className="border border-slate-200 px-3 py-2 text-left font-semibold">내용</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['종합현황', '매출계획/표준재료비/매입재료비 KPI + 월별 추이 차트 + 비율 테이블'],
            ['자재별 상세', '자재 품번별 표준소요량, 평균단가, 표준재료비, 실적재료비, 차이'],
            ['표준vs매입', '품목별 표준금액 vs 실적금액 직접 비교, 차이금액/차이율 정렬'],
            ['BOM진단', '품목별 BOM 보유, 단가 보유, 매칭 상태 진단 + 미등록 안내'],
            ['분석', '자동산출 vs 마스터 기준 Gap 분석, 정확도 추적'],
          ].map(([tab, desc]) => (
            <tr key={tab}>
              <td className="border border-slate-200 px-3 py-2 font-medium text-slate-700">{tab}</td>
              <td className="border border-slate-200 px-3 py-2">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DataSection() {
  return (
    <div className="space-y-4 text-sm text-slate-600 leading-relaxed">
      <SectionTitle>데이터 관리</SectionTitle>

      <SubTitle>매월 필수 작업</SubTitle>
      <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
        <p className="font-bold text-slate-800 mb-2">매출계획 Excel 업로드</p>
        <p><strong>영업현황</strong> 탭 &gt; 매출계획 업로드</p>
        <p className="text-xs text-slate-500 mt-1">
          이 데이터가 표준재료비 산출의 기준 수량이 됩니다.
        </p>
      </div>

      <SubTitle>변경 시 업데이트</SubTitle>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50">
            <th className="border border-slate-200 px-3 py-2 text-left font-semibold">변경 사항</th>
            <th className="border border-slate-200 px-3 py-2 text-left font-semibold">작업</th>
            <th className="border border-slate-200 px-3 py-2 text-left font-semibold">위치</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['신규 품목 / 단가 변경', '재료비.xlsx 재업로드', '구매현황 > 표준재료비 > "재료고침"'],
            ['BOM 변경', 'BOM Excel 재업로드', '구매현황 > BOM 마스터'],
            ['입고 실적 갱신', '입고현황 Excel 업로드', '구매현황 > 입고현황'],
            ['기준정보 변경', '자재마스터 Excel 업로드', '구매현황 > 표준재료비 > "재료고침"'],
          ].map(([change, action, location], i) => (
            <tr key={i}>
              <td className="border border-slate-200 px-3 py-2 font-medium">{change}</td>
              <td className="border border-slate-200 px-3 py-2">{action}</td>
              <td className="border border-slate-200 px-3 py-2 text-xs text-slate-500">{location}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="bg-slate-50 border rounded-xl p-4 mt-4">
        <p className="font-semibold text-slate-700 mb-2">재료비.xlsx 업로드 시 자동 갱신 테이블</p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {[
            ['item_standard_cost', '품목별 월 원가 (전체 교체)'],
            ['purchase_price_master', '구매단가 (전체 교체)'],
            ['outsource_injection_price', '외주사출판매가 (전체 교체)'],
            ['paint_mix_ratio_master', '도료배합비율 (전체 교체)'],
          ].map(([table, desc]) => (
            <div key={table} className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              <span className="font-mono">{table}</span>
              <span className="text-slate-400">— {desc}</span>
            </div>
          ))}
        </div>
      </div>

      <SubTitle>Excel 파일 형식</SubTitle>
      <div className="space-y-3">
        <div className="border rounded-lg p-3">
          <p className="font-semibold text-slate-700">재료비.xlsx (필수 시트)</p>
          <div className="text-xs text-slate-500 mt-1 space-y-0.5">
            <p>- <strong>NET재료비 현황</strong>: 품목별 12개월 수량/금액 + RESIN/PAINT/구매/외주 분류</p>
            <p>- <strong>구매단가</strong>: 품목코드, 품명, 협력업체, 현행단가</p>
            <p>- <strong>외주사출 판매가</strong>: 품목코드, 품명, 사출단가</p>
            <p>- <strong>도료배합비율</strong>: 도료코드, 주제/경화제/신나 비율 및 코드</p>
          </div>
        </div>
        <div className="border rounded-lg p-3">
          <p className="font-semibold text-slate-700">매출계획 Excel</p>
          <div className="text-xs text-slate-500 mt-1">
            <p>- 거래선, 차종, P/N, 변경단가, 1~12월 계획수량</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function FaqSection() {
  const faqs = [
    {
      q: '표준재료비율이 너무 높거나 낮게 나옵니다',
      a: '마스터 기준 모드인지 확인하세요. "자동 산출"은 구매입고 데이터 기반이라 입고가 없는 월은 과소 산출됩니다. "마스터 기준" 버튼을 클릭하면 item_standard_cost 기반으로 정확한 값이 나옵니다.',
    },
    {
      q: '특정 월의 매출액이 0으로 나옵니다',
      a: '영업현황에서 해당 연도 매출계획 Excel이 업로드되어 있는지 확인하세요.',
    },
    {
      q: 'BOM 매칭율이 낮습니다',
      a: 'BOM 마스터에 해당 품목의 모자관계가 등록되어 있는지 확인하세요. P/N 브릿지(기준정보)에 고객P/N ↔ 사내코드 매핑이 누락된 경우에도 매칭이 안 됩니다.',
    },
    {
      q: '재료비.xlsx를 업로드했는데 변화가 없습니다',
      a: '"재료고침" 버튼으로 업로드 후 페이지를 새로고침하세요. Supabase에 저장된 데이터가 자동으로 로드됩니다.',
    },
    {
      q: '마스터 기준과 자동 산출 수치가 다릅니다',
      a: '정상입니다. 자동 산출은 BOM×구매입고avgPrice 역산, 마스터 기준은 BOM×재질단가 정방향 적산으로 계산 공식이 다릅니다. "분석" 탭에서 Gap을 확인할 수 있습니다.',
    },
    {
      q: '데이터를 잘못 올렸습니다. 되돌릴 수 있나요?',
      a: '재료비.xlsx를 올바른 파일로 다시 업로드하면 됩니다. 기존 데이터는 DELETE 후 INSERT로 완전 교체됩니다.',
    },
  ];

  return (
    <div className="space-y-4 text-sm text-slate-600 leading-relaxed">
      <SectionTitle>자주 묻는 질문 (FAQ)</SectionTitle>
      <div className="space-y-3">
        {faqs.map((faq, i) => (
          <details key={i} className="border rounded-lg overflow-hidden group">
            <summary className="px-4 py-3 bg-slate-50 cursor-pointer font-medium text-slate-700 hover:bg-slate-100 transition-colors">
              Q. {faq.q}
            </summary>
            <div className="px-4 py-3 text-slate-600 bg-white">
              A. {faq.a}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

export default UserGuideModal;
