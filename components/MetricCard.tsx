
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
  const colorMap = {
    blue: 'text-blue-600',
    emerald: 'text-emerald-600',
    rose: 'text-rose-600',
    amber: 'text-amber-600',
    slate: 'text-slate-800'
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{label}</p>
      <div className="flex items-end justify-between">
        <div>
          <h3 className={`text-3xl font-black ${colorMap[color]}`}>{value}</h3>
          {subValue && <p className="text-xs text-slate-400 mt-1 font-medium">{subValue}</p>}
        </div>
        {percentage !== undefined && (
          <div className="flex flex-col items-end">
            <span className={`text-sm font-bold flex items-center ${trend === 'up' ? 'text-emerald-500' : trend === 'down' ? 'text-rose-500' : 'text-slate-400'}`}>
              {trend === 'up' && '▲'}
              {trend === 'down' && '▼'}
              {Math.abs(percentage)}%
            </span>
            <div className="w-20 h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
              <div 
                className={`h-full rounded-full ${trend === 'up' ? 'bg-emerald-500' : 'bg-rose-500'}`} 
                style={{ width: `${Math.min(100, Math.abs(percentage))}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MetricCard;
