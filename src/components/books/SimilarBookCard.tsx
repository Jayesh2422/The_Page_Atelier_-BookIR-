import type { SimilarHit } from '../../../lib/types';
import { BookCard } from './BookCard';

export function SimilarBookCard({ hit, eager }: { hit: SimilarHit; eager?: boolean }) {
  return (
    <BookCard
      book={hit.book}
      eager={eager}
      showDescription={false}
      score={{ label: 'Similarity', value: hit.similarity.toFixed(2), title: 'Cosine similarity of the two books’ TF-IDF vectors (0–1)' }}
      footer={
        hit.reasons.length > 0 && (
          <ul className="space-y-1 text-xs leading-snug text-muted">
            {hit.reasons.slice(0, 2).map((reason) => (
              <li key={reason.kind}>
                <span className="font-medium text-ink">{reason.label}</span>
                {!reason.label.startsWith('Same author') && <>: {reason.terms.join(', ')}</>}
              </li>
            ))}
          </ul>
        )
      }
    />
  );
}
