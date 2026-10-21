import { SlidersHorizontal, X } from 'lucide-react';
import { useId, useState } from 'react';
import type { FacetValue } from '../../../lib/types';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { SearchState } from '@/lib/search-params';
import { cn, formatNumber } from '@/lib/utils';

interface SearchFiltersProps {
  state: SearchState;
  authors: FacetValue[];
  publishers: FacetValue[];
  years: { min: number; max: number } | null;
  /** Explains where facet values come from. */
  facetNote: string;
  onChange: (patch: Partial<SearchState>) => void;
}

function withCurrent(values: FacetValue[], current: string): FacetValue[] {
  if (!current || values.some((v) => v.value.toLowerCase() === current.toLowerCase())) return values;
  return [{ value: current, count: 0 }, ...values];
}

export function activeFilterCount(state: SearchState): number {
  return [state.author, state.publisher, state.yearFrom, state.yearTo].filter(Boolean).length;
}

export function SearchFilters({ state, authors, publishers, years, facetNote, onChange }: SearchFiltersProps) {
  const ids = { author: useId(), publisher: useId(), from: useId(), to: useId(), panel: useId() };
  const [yearFrom, setYearFrom] = useState(state.yearFrom);
  const [yearTo, setYearTo] = useState(state.yearTo);
  const [synced, setSynced] = useState(`${state.yearFrom}|${state.yearTo}`);
  const [yearError, setYearError] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  if (synced !== `${state.yearFrom}|${state.yearTo}`) {
    setSynced(`${state.yearFrom}|${state.yearTo}`);
    setYearFrom(state.yearFrom);
    setYearTo(state.yearTo);
  }
  const count = activeFilterCount(state);
  const maxYear = new Date().getFullYear();

  function applyYears(event: React.FormEvent) {
    event.preventDefault();
    const from = yearFrom.trim();
    const to = yearTo.trim();
    const valid = (v: string) => v === '' || (/^\d{4}$/.test(v) && Number(v) >= 1000 && Number(v) <= maxYear + 1);
    if (!valid(from) || !valid(to)) return setYearError(`Use four-digit years between 1000 and ${maxYear + 1}.`);
    if (from && to && Number(from) > Number(to)) return setYearError('“From” must not be later than “to”.');
    setYearError(null);
    onChange({ yearFrom: from, yearTo: to });
  }

  const panel = (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor={ids.author}>Author</Label>
        <Select id={ids.author} value={state.author} onChange={(e) => onChange({ author: e.target.value })}>
          <option value="">All authors</option>
          {withCurrent(authors, state.author).map((a) => (
            <option key={a.value} value={a.value}>
              {a.value}
              {a.count ? ` (${formatNumber(a.count)})` : ''}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={ids.publisher}>Publisher</Label>
        <Select id={ids.publisher} value={state.publisher} onChange={(e) => onChange({ publisher: e.target.value })}>
          <option value="">All publishers</option>
          {withCurrent(publishers, state.publisher).map((p) => (
            <option key={p.value} value={p.value}>
              {p.value}
              {p.count ? ` (${formatNumber(p.count)})` : ''}
            </option>
          ))}
        </Select>
      </div>
      <form onSubmit={applyYears} className="space-y-2" noValidate>
        <fieldset>
          <legend className="text-xs font-semibold tracking-wide text-olive uppercase">Publication year</legend>
          <div className="mt-2 flex items-center gap-2">
            <label htmlFor={ids.from} className="sr-only">
              From year
            </label>
            <Input id={ids.from} inputMode="numeric" placeholder={years ? String(years.min) : 'From'} value={yearFrom} onChange={(e) => setYearFrom(e.target.value)} aria-invalid={yearError ? true : undefined} />
            <span aria-hidden className="text-muted">
              –
            </span>
            <label htmlFor={ids.to} className="sr-only">
              To year
            </label>
            <Input id={ids.to} inputMode="numeric" placeholder={years ? String(years.max) : 'To'} value={yearTo} onChange={(e) => setYearTo(e.target.value)} aria-invalid={yearError ? true : undefined} />
          </div>
        </fieldset>
        {yearError && (
          <p role="alert" className="text-xs text-terracotta-dark">
            {yearError}
          </p>
        )}
        <Button type="submit" variant="secondary" size="sm" className="w-full">
          Apply years
        </Button>
      </form>
      {count > 0 && (
        <Button variant="ghost" size="sm" className="w-full" onClick={() => onChange({ author: '', publisher: '', yearFrom: '', yearTo: '' })}>
          <X /> Clear all filters
        </Button>
      )}
      <p className="text-xs leading-relaxed text-muted">{facetNote}</p>
    </div>
  );

  // One panel for all widths: a toggle on small screens, a sidebar from lg upwards.
  return (
    <aside aria-label="Filters">
      <Button variant="secondary" size="sm" className="lg:hidden" aria-expanded={mobileOpen} aria-controls={ids.panel} onClick={() => setMobileOpen((v) => !v)}>
        <SlidersHorizontal /> Filters{count > 0 ? ` (${count})` : ''}
      </Button>
      <div
        id={ids.panel}
        className={cn(
          'mt-4 rounded-[var(--radius-card)] border border-linen bg-white p-5 lg:mt-0 lg:block lg:border-0 lg:bg-transparent lg:p-0',
          mobileOpen ? 'block' : 'hidden',
        )}
      >
        <h2 className="font-display mb-5 hidden text-xl lg:block">Refine</h2>
        {panel}
      </div>
    </aside>
  );
}
