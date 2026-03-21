
import React from 'react';

interface MetricCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  trend?: 'up' | 'down' | 'neutral';
  percentage?: number;
  color?: 'blue' | 'emerald' | 'rose' | 'amber' | 'slate';
}

const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  subValue,
  trend,
  percentage,
  color = 'slate'
}) => {
  return (
    <div className="bg-white p-7 rounded-2xl border border-gray-100 hover:border-gray-200 transition-all duration-300">
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-[0.08em] mb-4">{label}</p>
      <div className="flex items-end justify-between">
        <div>
          <h3 className="text-[28px] font-bold text-gray-900 tracking-tight leading-none">{value}</h3>
          {subValue && <p className="text-[11px] text-gray-400 mt-2 font-medium">{subValue}</p>}
        </div>
        {percentage !== undefined && (
          <div className="flex flex-col items-end">
            <span className={`text-xs font-semibold flex items-center gap-0.5 ${
              trend === 'up' ? 'text-emerald-600' : trend === 'down' ? 'text-rose-500' : 'text-gray-400'
            }`}>
              {trend === 'up' && (
                <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none"><path d="M6 2.5v7M6 2.5L3 5.5M6 2.5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              )}
              {trend === 'down' && (
                <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none"><path d="M6 9.5v-7M6 9.5L3 6.5M6 9.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              )}
              {Math.abs(percentage).toFixed(1)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default MetricCard;
