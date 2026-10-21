import { Link } from 'react-router';
import { PageContainer } from '@/components/layout/Layout';
import { SearchBar } from '@/components/search/SearchBar';
import { Button } from '@/components/ui/button';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export function NotFoundPage() {
  useDocumentTitle('Page not found');
  return (
    <PageContainer className="py-24 text-center">
      <p className="eyebrow">404</p>
      <h1 className="font-display mt-4 text-5xl">This page is missing from the shelf.</h1>
      <p className="mx-auto mt-4 max-w-lg text-muted">The address may be mistyped, or the page may have moved. Try a search instead.</p>
      <SearchBar className="mx-auto mt-8 max-w-xl" />
      <Button asChild variant="secondary" className="mt-8">
        <Link to="/">Return home</Link>
      </Button>
    </PageContainer>
  );
}
