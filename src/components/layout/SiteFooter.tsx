import { Link } from 'react-router';
import { Logo } from './Logo';

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-linen bg-white/60">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr] lg:px-8">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-4 text-sm leading-relaxed text-muted">
            The Page Atelier is a quiet place to search a large book catalogue — ranked by relevance, forgiving of typos, and
            open about how its results are measured.
          </p>
        </div>
        <div>
          <h2 className="font-display text-lg">The collection</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Book records come from the{' '}
            <a className="text-olive underline underline-offset-2 hover:text-sage-dark" href="https://grouplens.org/datasets/book-crossing/" target="_blank" rel="noreferrer">
              Book-Crossing dataset
            </a>{' '}
            collected by Cai-Nicolas Ziegler (2004).
          </p>
        </div>
        <div>
          <h2 className="font-display text-lg">Metadata</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Descriptions, subjects and some covers come from the Google Books API and Open Library where a validated match exists.
            Cover images remain the property of their publishers.
          </p>
        </div>
        <div>
          <h2 className="font-display text-lg">The project</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li>Inverted index · TF-IDF · cosine similarity</li>
            <li>Edit-distance spelling correction</li>
            <li>
              <Link to="/evaluation" className="text-olive underline underline-offset-2 hover:text-sage-dark">
                Precision, recall &amp; MRR evaluation
              </Link>
            </li>
            <li>React · Vite · Vercel · MongoDB Atlas</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-linen">
        <p className="mx-auto max-w-7xl px-4 py-5 text-xs text-muted sm:px-6 lg:px-8">
          The Page Atelier — an Information Retrieval project. Thoughtfully find your next read.
        </p>
      </div>
    </footer>
  );
}
