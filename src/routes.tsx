import type { RouteObject } from 'react-router';
import { Layout } from '@/components/layout/Layout';
import { BookDetailsPage } from '@/pages/BookDetailsPage';
import { EvaluationPage } from '@/pages/EvaluationPage';
import { ExplorePage } from '@/pages/ExplorePage';
import { HomePage } from '@/pages/HomePage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { SearchResultsPage } from '@/pages/SearchResultsPage';
import { SimilarBooksPage } from '@/pages/SimilarBooksPage';

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'explore', element: <ExplorePage /> },
      { path: 'search', element: <SearchResultsPage /> },
      { path: 'books/:id', element: <BookDetailsPage /> },
      { path: 'books/:id/similar', element: <SimilarBooksPage /> },
      { path: 'evaluation', element: <EvaluationPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

