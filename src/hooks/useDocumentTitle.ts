import { useEffect } from 'react';

export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    document.title = title ? `${title} · The Page Atelier` : 'The Page Atelier — Thoughtfully find your next read';
  }, [title]);
}
