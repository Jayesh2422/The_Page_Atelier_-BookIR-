import { useLayoutEffect, useRef, useState } from 'react';
import type { SearchMode } from '../../../lib/types';
import { cn } from '@/lib/utils';

/**
 * Two-series palette (validated with the dataviz palette checker against white): a deep
 * sage for the keyword baseline and terracotta for TF-IDF ranking. Every mark also carries a
 * direct value label, a legend and a table view, so identity never relies on colour alone.
 */
export const SERIES: Record<SearchMode, { label: string; color: string }> = {
  keyword: { label: 'Keyword baseline', color: '#4F6B3F' },
  ranked: { label: 'Ranked TF-IDF', color: '#C87555' },
};
const ORDER: SearchMode[] = ['keyword', 'ranked'];

export function Legend({ className }: { className?: string }) {
  return (
    <ul className={cn('flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink', className)} aria-label="Legend">
      {ORDER.map((mode) => (
        <li key={mode} className="inline-flex items-center gap-2">
          <span aria-hidden className="size-3 rounded-sm" style={{ background: SERIES[mode].color }} />
          {SERIES[mode].label}
        </li>
      ))}
    </ul>
  );
}

interface TooltipState {
  x: number;
  y: number;
  title: string;
  lines: string[];
}

function Tooltip({ tip }: { tip: TooltipState | null }) {
  if (!tip) return null;
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 min-w-40 -translate-x-1/2 -translate-y-full rounded-lg border border-linen bg-white px-3 py-2 text-xs shadow-lift"
      style={{ left: tip.x, top: tip.y - 10 }}
    >
      <p className="font-semibold text-olive">{tip.title}</p>
      {tip.lines.map((line) => (
        <p key={line} className="mt-0.5 text-ink">
          {line}
        </p>
      ))}
    </div>
  );
}

const fmt = (v: number) => v.toFixed(3);

/** Width of an element in CSS pixels, so charts draw at 1:1 scale and text stays legible. */
function useWidth<T extends HTMLElement>(fallback: number): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(Math.max(280, Math.round(element.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export interface MetricGroup {
  key: string;
  label: string;
  values: Record<SearchMode, number>;
}

/** Grouped bars: one group per metric, one bar per retrieval mode. Scale fixed at 0–1. */
export function MetricBarChart({ groups, title }: { groups: MetricGroup[]; title: string }) {
  const [tip, setTip] = useState<TooltipState | null>(null);
  const [ref, width] = useWidth<HTMLElement>(640);
  const height = 280;
  const margin = { top: 24, right: 8, bottom: 36, left: 36 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const groupW = plotW / groups.length;
  const barW = Math.min(56, groupW / 3.4);
  const gap = 2;
  const y = (v: number) => margin.top + plotH * (1 - v);

  return (
    <figure ref={ref} className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block" role="img" aria-label={title} onMouseLeave={() => setTip(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={margin.left} x2={width - margin.right} y1={y(t)} y2={y(t)} stroke="#E9E3D8" strokeWidth={1} />
            <text x={margin.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px]">
              {t.toFixed(2)}
            </text>
          </g>
        ))}
        {groups.map((group, gi) => {
          const cx = margin.left + groupW * gi + groupW / 2;
          return (
            <g key={group.key}>
              {ORDER.map((mode, i) => {
                const value = group.values[mode];
                const x = cx + (i === 0 ? -barW - gap / 2 : gap / 2);
                const top = y(value);
                const h = Math.max(0, margin.top + plotH - top);
                const show = (event: React.MouseEvent | React.FocusEvent) => {
                  const svg = (event.currentTarget as SVGElement).ownerSVGElement!;
                  const rect = svg.getBoundingClientRect();
                  const scale = rect.width / width || 1;
                  setTip({ x: (x + barW / 2) * scale, y: top * scale, title: `${group.label} — ${SERIES[mode].label}`, lines: [fmt(value)] });
                };
                return (
                  <g key={mode}>
                    <path
                      d={roundedTopBar(x, top, barW, h, 4)}
                      fill={SERIES[mode].color}
                      tabIndex={0}
                      aria-label={`${group.label}, ${SERIES[mode].label}: ${fmt(value)}`}
                      onMouseEnter={show}
                      onFocus={show}
                      onBlur={() => setTip(null)}
                      className="outline-none focus-visible:opacity-80"
                    />
                    <text x={x + barW / 2} y={top - 6} textAnchor="middle" className="fill-ink text-[11px] font-medium">
                      {value.toFixed(2)}
                    </text>
                  </g>
                );
              })}
              <text x={cx} y={height - 12} textAnchor="middle" className="fill-ink text-[12px] font-medium">
                {group.label}
              </text>
            </g>
          );
        })}
        <line x1={margin.left} x2={width - margin.right} y1={y(0)} y2={y(0)} stroke="#6B7064" strokeWidth={1} />
      </svg>
      <Tooltip tip={tip} />
    </figure>
  );
}

function roundedTopBar(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return '';
  const radius = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + radius} Q${x},${y} ${x + radius},${y} H${x + w - radius} Q${x + w},${y} ${x + w},${y + radius} V${y + h} Z`;
}

export interface QueryPoint {
  id: string;
  label: string;
  values: Record<SearchMode, number>;
}

/**
 * Dumbbell plot: one row per query, a dot per mode on a shared 0–1 axis, joined by a line
 * so the size and direction of each difference is visible at a glance.
 */
export function QueryDumbbellChart({ rows, metricLabel }: { rows: QueryPoint[]; metricLabel: string }) {
  const [tip, setTip] = useState<TooltipState | null>(null);
  const [ref, width] = useWidth<HTMLElement>(640);
  const rowH = 30;
  const labelW = Math.min(190, Math.round(width * 0.36));
  const maxChars = Math.floor(labelW / 7);
  const margin = { top: 28, right: 24, bottom: 8 };
  const height = margin.top + rows.length * rowH + margin.bottom;
  const plotW = width - labelW - margin.right;
  const x = (v: number) => labelW + plotW * v;

  return (
    <figure ref={ref} className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block" role="img" aria-label={`${metricLabel} per query for both retrieval modes`} onMouseLeave={() => setTip(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={margin.top - 6} y2={height - margin.bottom} stroke="#E9E3D8" />
            <text x={x(t)} y={14} textAnchor="middle" className="fill-muted text-[11px]">
              {t.toFixed(2)}
            </text>
          </g>
        ))}
        {rows.map((row, i) => {
          const cy = margin.top + i * rowH + rowH / 2;
          const kw = row.values.keyword;
          const rk = row.values.ranked;
          const show = (event: React.MouseEvent | React.FocusEvent) => {
            const svg = (event.currentTarget as SVGElement).ownerSVGElement!;
            const scale = svg.getBoundingClientRect().width / width;
            setTip({
              x: x(Math.max(kw, rk)) * scale,
              y: (cy - 6) * scale,
              title: row.label,
              lines: [`${SERIES.keyword.label}: ${fmt(kw)}`, `${SERIES.ranked.label}: ${fmt(rk)}`],
            });
          };
          return (
            <g
              key={row.id}
              tabIndex={0}
              aria-label={`${row.label}: keyword ${fmt(kw)}, ranked ${fmt(rk)}`}
              onMouseEnter={show}
              onFocus={show}
              onBlur={() => setTip(null)}
              className="outline-none [&:focus-visible_rect]:fill-sage-soft"
            >
              <rect x={0} y={cy - rowH / 2} width={width} height={rowH} fill="transparent" rx={6} />
              <text x={labelW - 12} y={cy} dy="0.32em" textAnchor="end" className="fill-ink text-[12px]">
                {row.label.length > maxChars ? `${row.label.slice(0, maxChars - 1)}…` : row.label}
              </text>
              <line x1={x(Math.min(kw, rk))} x2={x(Math.max(kw, rk))} y1={cy} y2={cy} stroke="#6B7064" strokeWidth={2} />
              <circle cx={x(kw)} cy={cy} r={6} fill={SERIES.keyword.color} stroke="#FFFFFF" strokeWidth={2} />
              <circle cx={x(rk)} cy={cy} r={6} fill={SERIES.ranked.color} stroke="#FFFFFF" strokeWidth={2} />
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </figure>
  );
}
