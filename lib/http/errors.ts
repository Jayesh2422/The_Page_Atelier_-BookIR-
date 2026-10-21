/** Errors that are safe to show to clients. Anything else is reported as a generic 500. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  badRequest: (message: string) => new AppError(400, 'BAD_REQUEST', message),
  notFound: (message: string) => new AppError(404, 'NOT_FOUND', message),
  methodNotAllowed: () => new AppError(405, 'METHOD_NOT_ALLOWED', 'This endpoint only supports GET requests.'),
  databaseNotConfigured: () =>
    new AppError(503, 'DATABASE_NOT_CONFIGURED', 'The catalogue database is not configured. Set MONGODB_URI on the server (see README → MongoDB Atlas setup).'),
  databaseUnavailable: () =>
    new AppError(503, 'DATABASE_UNAVAILABLE', 'The catalogue database could not be reached. Please try again shortly.'),
  indexNotBuilt: () =>
    new AppError(503, 'INDEX_NOT_BUILT', 'The search index has not been built yet. Import the dataset and run `npm run build:index`.'),
};
