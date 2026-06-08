import React from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Bar,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MonthlyCashLedgerSummary } from '../utils/cashLedger';

interface ReportsMonthlyChartProps {
  data: MonthlyCashLedgerSummary;
}

const ReportsMonthlyChart: React.FC<ReportsMonthlyChartProps> = ({ data }) => (
  <div className="mt-8 h-[350px] w-full bg-[#000000]/40 p-6 rounded-[2rem] border border-zinc-900/50">
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={[{
        ...data,
        entradas: data.totalEntries,
        saidas: data.totalExits,
        reversals: data.totalReversals,
        ajustes: data.totalAdjustments,
        fechamento: data.closingBalance,
      }]} margin={{ top: 30, right: 30, left: 20, bottom: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} opacity={0.5} />
        <XAxis
          dataKey="monthLabel"
          axisLine={false}
          tickLine={false}
          tick={{ fill: '#52525b', fontSize: 10, fontWeight: 900 }}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fill: '#52525b', fontSize: 10, fontWeight: 900 }}
          tickFormatter={(value) => `R$ ${value >= 1000 ? `${(value / 1000).toFixed(0)}k` : value}`}
        />
        <Tooltip
          cursor={{ fill: 'transparent' }}
          contentStyle={{
            backgroundColor: '#050505',
            border: '1px solid #27272a',
            borderRadius: '1.5rem',
            padding: '12px 16px',
            boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
          }}
          itemStyle={{ fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', padding: '2px 0' }}
          formatter={(value: number) => [`R$ ${value.toLocaleString('pt-BR')}`, '']}
        />
        <Legend
          verticalAlign="top"
          align="right"
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ paddingBottom: '20px', fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em' }}
        />
        <Bar dataKey="totalEntries" name="Entradas" fill="#10b981" radius={[6, 6, 0, 0]} barSize={42}>
          <LabelList
            dataKey="totalEntries"
            position="top"
            formatter={(value: number) => (value > 0 ? `R$ ${value.toLocaleString('pt-BR')}` : '')}
            style={{ fill: '#10b981', fontSize: '9px', fontWeight: 900 }}
          />
        </Bar>
        <Bar dataKey="totalExits" name="Saidas" fill="#ef4444" radius={[6, 6, 0, 0]} barSize={42}>
          <LabelList
            dataKey="totalExits"
            position="top"
            formatter={(value: number) => (value > 0 ? `R$ ${value.toLocaleString('pt-BR')}` : '')}
            style={{ fill: '#ef4444', fontSize: '9px', fontWeight: 900 }}
          />
        </Bar>
        <Bar dataKey="totalReversals" name="Estornos" fill="#7c3aed" radius={[6, 6, 0, 0]} barSize={42}>
          <LabelList
            dataKey="totalReversals"
            position="top"
            formatter={(value: number) => (value > 0 ? `R$ ${value.toLocaleString('pt-BR')}` : '')}
            style={{ fill: '#7c3aed', fontSize: '9px', fontWeight: 900 }}
          />
        </Bar>
        <Bar dataKey="totalAdjustments" name="Ajustes" fill="#f59e0b" radius={[6, 6, 0, 0]} barSize={42}>
          <LabelList
            dataKey="totalAdjustments"
            position="top"
            formatter={(value: number) => (value > 0 ? `R$ ${value.toLocaleString('pt-BR')}` : '')}
            style={{ fill: '#f59e0b', fontSize: '9px', fontWeight: 900 }}
          />
        </Bar>
        <Line
          type="monotone"
          dataKey="closingBalance"
          name="Saldo Final"
          stroke="#BF953F"
          strokeWidth={3}
          dot={{ r: 3, fill: '#BF953F' }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  </div>
);

export default ReportsMonthlyChart;
