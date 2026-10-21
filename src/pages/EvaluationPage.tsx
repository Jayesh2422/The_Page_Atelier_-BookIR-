import { Check, ChevronDown, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { EvaluationQueryResult, EvaluationResponse, FieldName, SearchMode } from '../../lib/types';
import { Legend, MetricBarChart, QueryDumbbellChart, SERIES } from '@/components/evaluation/Charts';
import { PageContainer } from '@/components/layout/Layout';
import { ErrorState } from '@/components/states/States';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api, getJson } from '@/lib/api';
import { searchUrl } from '@/lib/search-params';
import { cn, formatNumber } from '@/lib/utils';

const MODES: SearchMode[] = ['keyword', 'ranked'];
const f3 = (v: number) => v.toFixed(3);

function Metric({ name, formula, children }: { name: string; formula: string; children: React.ReactNode }) {
  return (
    <Card className="p-6">
      <h3 className="font-display text-xl">{name}</h3>
      <p className="mt-3 rounded-md bg-cream px-3 py-2 font-mono text-[0.8rem] text-olive">{formula}</p>
      <p className="mt-3 text-sm leading-relaxed text-muted">{children}</p>
    </Card>
  );
}

function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card className="p-5">
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</p>
      <p className="font-display mt-2 text-4xl text-olive">{value}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </Card>
  );
}

function QueryRow({ q, k }: { q: EvaluationQueryResult; k: number }) {
  const [open, setOpen] = useState(false);
  const cell = (mode: SearchMode, key: 'precisionAtK' | 'recallAtK' | 'reciprocalRank') => {
    const value = q.metrics[mode][key];
    const other = q.metrics[mode === 'ranked' ? 'keyword' : 'ranked'][key];
    return <td className={cn('px-3 py-3 text-right tabular-nums', value > other ? 'font-semibold text-olive' : 'text-ink')}>{q.skipped ? '—' : f3(value)}</td>;
  };
  return (
    <>
      <tr className="border-t border-linen align-top">
        <td className="py-3 pr-3 pl-4">
          <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex items-start gap-2 text-left">
            <ChevronDown aria-hidden className={cn('mt-0.5 size-4 shrink-0 text-muted transition-transform', open && 'rotate-180')} />
            <span>
              <span className="font-medium text-olive">“{q.query}”</span>
              <span className="mt-0.5 block text-xs text-muted">{q.informationNeed}</span>
            </span>
          </button>
        </td>
        <td className="px-3 py-3 text-right text-muted tabular-nums">{q.relevantInCatalogue}</td>
        {cell('keyword', 'precisionAtK')}
        {cell('keyword', 'recallAtK')}
        {cell('keyword', 'reciprocalRank')}
        {cell('ranked', 'precisionAtK')}
        {cell('ranked', 'recallAtK')}
        {cell('ranked', 'reciprocalRank')}
      </tr>
      {open && (
        <tr className="bg-cream/60">
          <td colSpan={8} className="px-4 pt-1 pb-5">
            <div className="grid gap-6 md:grid-cols-2">
              {MODES.map((mode) => (
                <div key={mode}>
                  <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
                    Top {q.topResults[mode].length} — {SERIES[mode].label}
                    {!q.skipped && q.metrics[mode].firstRelevantRank && ` · first relevant at rank ${q.metrics[mode].firstRelevantRank}`}
                  </p>
                  <ol className="space-y-1.5 text-sm">
                    {q.topResults[mode].map((r, i) => (
                      <li key={r.id} className="flex gap-2">
                        <span className="w-4 shrink-0 text-right text-muted tabular-nums">{i + 1}</span>
                        {r.relevant ? (
                          <Check aria-label="judged relevant" className="mt-0.5 size-4 shrink-0 text-sage-dark" />
                        ) : (
                          <span aria-label="not judged relevant" className="mt-0.5 inline-block size-4 shrink-0 text-center text-muted">
                            ·
                          </span>
                        )}
                        <Link to={`/books/${encodeURIComponent(r.id)}`} className="min-w-0 text-ink hover:text-olive hover:underline">
                          {r.title}
                          {r.author && <span className="text-muted"> — {r.author}</span>}
                        </Link>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
            <Link to={searchUrl(q.query)} className="mt-4 inline-block text-sm font-medium text-olive underline underline-offset-2">
              Run this query in the search
            </Link>
            <p className="mt-2 text-xs text-muted">
              {q.relevantJudged} books judged relevant, {q.relevantInCatalogue} of them in the current catalogue. Precision and recall use the top {k}.
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

function Dashboard({ data }: { data: EvaluationResponse }) {
  const { k } = data;
  const evaluated = data.queries.filter((q) => !q.skipped);
  const s = data.summary;
  const groups = [
    { key: 'p', label: `Precision@${k}`, values: { keyword: s.keyword.meanPrecisionAtK, ranked: s.ranked.meanPrecisionAtK } },
    { key: 'r', label: `Recall@${k}`, values: { keyword: s.keyword.meanRecallAtK, ranked: s.ranked.meanRecallAtK } },
    { key: 'm', label: 'MRR', values: { keyword: s.keyword.mrr, ranked: s.ranked.mrr } },
  ];
  const wins = (key: 'precisionAtK' | 'reciprocalRank') => ({
    ranked: evaluated.filter((q) => q.metrics.ranked[key] > q.metrics.keyword[key]).length,
    keyword: evaluated.filter((q) => q.metrics.keyword[key] > q.metrics.ranked[key]).length,
  });
  const pWins = wins('precisionAtK');
  const ties = evaluated.length - pWins.ranked - pWins.keyword;
  const diff = (a: number, b: number) => {
    const d = a - b;
    return `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d).toFixed(3)}`;
  };

  return (
    <div className="space-y-14">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Queries evaluated" value={String(data.queriesEvaluated)} note={data.queriesTotal > data.queriesEvaluated ? `${data.queriesTotal - data.queriesEvaluated} skipped (no relevant book imported)` : 'all configured queries'} />
        <StatTile label="Books in index" value={formatNumber(data.index.books)} note={`indexed ${new Date(data.index.builtAt).toLocaleDateString('en-GB')}`} />
        <StatTile label={`Mean P@${k}, ranked`} value={f3(s.ranked.meanPrecisionAtK)} note={`keyword baseline ${f3(s.keyword.meanPrecisionAtK)}`} />
        <StatTile label="MRR, ranked" value={f3(s.ranked.mrr)} note={`keyword baseline ${f3(s.keyword.mrr)}`} />
      </div>

      <section aria-labelledby="summary-heading" className="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
        <Card className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="summary-heading" className="font-display text-2xl">
                Mean scores by retrieval mode
              </h2>
              <p className="mt-1 text-sm text-muted">Averages over {data.queriesEvaluated} queries; higher is better. MRR counts the first relevant book within the top {data.mrrDepth}.</p>
            </div>
            <Legend />
          </div>
          <div className="mt-6">
            <MetricBarChart groups={groups} title={`Mean Precision@${k}, Recall@${k} and MRR for both modes`} />
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="font-display text-2xl">Comparison</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Mean metrics for each retrieval mode</caption>
              <thead>
                <tr className="text-left text-xs tracking-wide text-muted uppercase">
                  <th scope="col" className="py-2 pr-3 font-semibold">Metric</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Keyword</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Ranked</th>
                  <th scope="col" className="py-2 pl-3 text-right font-semibold">Difference</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.key} className="border-t border-linen">
                    <th scope="row" className="py-3 pr-3 text-left font-medium text-olive">{g.label}</th>
                    <td className="px-3 py-3 text-right tabular-nums">{f3(g.values.keyword)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{f3(g.values.ranked)}</td>
                    <td className="py-3 pl-3 text-right font-medium tabular-nums">{diff(g.values.ranked, g.values.keyword)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-5 text-sm leading-relaxed text-ink">
            On this test set, ranked retrieval had the higher Precision@{k} for {pWins.ranked} {pWins.ranked === 1 ? 'query' : 'queries'}, the keyword baseline for {pWins.keyword}, and {ties} tied.
          </p>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            Both modes rank the same candidate set, so the differences come only from the ranking function. With {data.queriesEvaluated} queries and incomplete judgments, small differences
            should not be read as significant.
          </p>
        </Card>
      </section>

      <section aria-labelledby="per-query-heading">
        <Card className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="per-query-heading" className="font-display text-2xl">
                Precision@{k} per query
              </h2>
              <p className="mt-1 text-sm text-muted">Each row joins the two modes; a longer line means a larger difference.</p>
            </div>
            <Legend />
          </div>
          <div className="mt-6">
            <QueryDumbbellChart
              metricLabel={`Precision@${k}`}
              rows={evaluated.map((q) => ({ id: q.id, label: q.query, values: { keyword: q.metrics.keyword.precisionAtK, ranked: q.metrics.ranked.precisionAtK } }))}
            />
          </div>
        </Card>
      </section>

      <section aria-labelledby="table-heading">
        <h2 id="table-heading" className="font-display text-3xl">
          Per-query results
        </h2>
        <p className="mt-2 text-sm text-muted">Open a query to see the top results of each mode; ✓ marks books judged relevant. The better value of each pair is emphasised.</p>
        <div className="mt-6 overflow-x-auto rounded-[var(--radius-card)] border border-linen bg-white">
          <table className="w-full min-w-[52rem] text-sm">
            <caption className="sr-only">Precision, recall and reciprocal rank for each evaluation query and mode</caption>
            <thead className="bg-cream/70 text-xs tracking-wide text-muted uppercase">
              <tr>
                <th scope="col" rowSpan={2} className="py-3 pr-3 pl-4 text-left font-semibold">Query</th>
                <th scope="col" rowSpan={2} className="px-3 py-3 text-right font-semibold">Relevant</th>
                <th scope="colgroup" colSpan={3} className="px-3 pt-3 text-right font-semibold" style={{ color: SERIES.keyword.color }}>Keyword baseline</th>
                <th scope="colgroup" colSpan={3} className="px-3 pt-3 text-right font-semibold text-terracotta-dark">Ranked TF-IDF</th>
              </tr>
              <tr>
                {MODES.flatMap((mode) =>
                  [`P@${k}`, `R@${k}`, 'RR'].map((label) => (
                    <th key={`${mode}-${label}`} scope="col" className="px-3 pt-1 pb-3 text-right font-semibold">
                      {label}
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {data.queries.map((q) => (
                <QueryRow key={q.id} q={q} k={k} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="setup-heading" className="grid gap-8 lg:grid-cols-2">
        <div>
          <h2 id="setup-heading" className="font-display text-3xl">
            Experimental setup
          </h2>
          <ul className="mt-4 space-y-3 text-sm leading-relaxed text-ink">
            <li>
              <strong className="text-olive">Corpus.</strong> The current search index: {formatNumber(data.index.books)} Book-Crossing records with field weights{' '}
              {(Object.entries(data.index.fieldWeights) as [FieldName, number][]).map(([field, w]) => `${field} ${w}`).join(', ')}.
            </li>
            <li>
              <strong className="text-olive">Candidates.</strong> For every query, all books containing at least one query term (from the inverted index). Both modes rank this same set.
            </li>
            <li>
              <strong className="text-olive">Keyword baseline.</strong> Books ordered by how many distinct query terms they contain; ties are left in catalogue-id order.
            </li>
            <li>
              <strong className="text-olive">Ranked retrieval.</strong> TF-IDF weights (sub-linear tf, smoothed idf) and cosine similarity between the query and each book.
            </li>
            <li>
              <strong className="text-olive">Reproducibility.</strong> Metrics are recomputed from live search results each time; run <code className="rounded bg-linen px-1">npm run evaluate</code> for the same numbers in a terminal.
              Queries are read from the {data.source === 'database' ? 'evaluationQueries collection' : 'bundled data/evaluation/queries.json file'}.
            </li>
          </ul>
        </div>
        <Card className="p-6">
          <h2 className="font-display text-2xl">About the relevance judgments</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink">{data.judgmentNote}</p>
          <p className="mt-3 text-xs text-muted">
            Dataset “{data.datasetName}”, computed {new Date(data.computedAt).toLocaleString('en-GB')} in {data.tookMs} ms.
          </p>
        </Card>
      </section>
    </div>
  );
}

export function EvaluationPage() {
  useDocumentTitle('Search Evaluation');
  const [k, setK] = useState(10);
  const [nonce, setNonce] = useState(0);
  const result = useApi<EvaluationResponse>(`evaluation:${k}:${nonce}`, (signal) =>
    nonce === 0 ? api.evaluation(k, signal) : getJson<EvaluationResponse>(`/api/evaluation?k=${k}&run=${nonce}`, signal),
  );

  return (
    <PageContainer className="py-12">
      <p className="eyebrow">Information Retrieval evaluation</p>
      <h1 className="font-display mt-3 max-w-3xl text-4xl leading-tight sm:text-5xl">How well does the search find the right books?</h1>
      <p className="mt-4 max-w-3xl leading-relaxed text-muted">
        A fixed set of test queries is run through both retrieval modes, and each ranked list is compared with manually prepared relevance judgments. The scores below are
        calculated live from the real search engine — nothing on this page is hard-coded.
      </p>

      <section aria-label="Metric definitions" className="mt-10 grid gap-4 md:grid-cols-3">
        <Metric name={`Precision@${k}`} formula={`P@K = |relevant ∩ top K| / K`}>
          Of the first {k} books shown, how many are relevant? It reflects what a reader sees on the first screen.
        </Metric>
        <Metric name={`Recall@${k}`} formula={`R@K = |relevant ∩ top K| / |relevant|`}>
          What share of all relevant books appears in the first {k}? It is small when a query has many relevant editions.
        </Metric>
        <Metric name="Mean Reciprocal Rank" formula="MRR = (1/|Q|) · Σ 1 / rank of first relevant">
          How soon does the first relevant book appear? 1.0 means first place every time; 0.5 means second place on average.
        </Metric>
      </section>

      <div className="mt-10 flex flex-wrap items-center gap-3 border-y border-linen py-4">
        <label htmlFor="eval-k" className="text-sm font-medium text-olive">
          Cut-off K
        </label>
        <Select id="eval-k" className="w-24" value={String(k)} onChange={(e) => setK(Number(e.target.value))}>
          {[3, 5, 10, 20].map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Select>
        <Button variant="secondary" size="sm" onClick={() => setNonce(Date.now())} disabled={result.status === 'loading'}>
          <RotateCw className={cn(result.status === 'loading' && 'animate-spin')} /> Recalculate
        </Button>
        <span className="text-xs text-muted" aria-live="polite">
          {result.status === 'loading' ? 'Running the evaluation queries…' : result.status === 'success' ? `Last computed ${new Date(result.data.computedAt).toLocaleTimeString('en-GB')}` : ''}
        </span>
      </div>

      <div className="mt-10">
        {result.status === 'error' && <ErrorState error={result.error} onRetry={result.retry} />}
        {result.status === 'loading' && !result.data && (
          <div role="status" aria-label="Loading evaluation" className="space-y-6">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-28 rounded-[var(--radius-card)]" />
              ))}
            </div>
            <Skeleton className="h-80 rounded-[var(--radius-card)]" />
          </div>
        )}
        {result.data && (
          <div className={cn('transition-opacity', result.status === 'loading' && 'opacity-50')}>
            <Dashboard data={result.data} />
          </div>
        )}
      </div>
    </PageContainer>
  );
}
