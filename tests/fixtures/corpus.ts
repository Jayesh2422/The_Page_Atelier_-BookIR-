import type { IndexableDocument } from '../../lib/ir/indexer.js';

/** A small hand-made corpus with known term statistics. */
export const CORPUS: IndexableDocument[] = [
  { id: 'A1', fields: { title: 'Harry Potter and the Goblet of Fire', author: 'J. K. Rowling', publisher: 'Scholastic' } },
  { id: 'A2', fields: { title: 'Harry Potter and the Chamber of Secrets', author: 'J. K. Rowling', publisher: 'Scholastic' } },
  { id: 'B1', fields: { title: 'Invasion', author: 'Eric L. Harry', publisher: 'Jove Books' } },
  { id: 'C1', fields: { title: 'Programming Python', author: 'Mark Lutz', publisher: "O'Reilly", description: 'A deep tutorial on the Python programming language.' } },
  { id: 'C2', fields: { title: 'Learning Python', author: 'Mark Lutz', publisher: "O'Reilly" } },
  { id: 'D1', fields: { title: 'Monty Python and the Holy Grail', author: 'Graham Chapman', publisher: 'Methuen' } },
  { id: 'E1', fields: { title: 'The Fellowship of the Ring', author: 'J. R. R. Tolkien', publisher: 'Houghton Mifflin', categories: ['Fantasy'] } },
  { id: 'E2', fields: { title: 'The Two Towers', author: 'J. R. R. Tolkien', publisher: 'Houghton Mifflin', categories: ['Fantasy'] } },
  { id: 'F1', fields: { title: 'Potter and Clay: A Ceramics Handbook', author: 'Susan Peterson', publisher: 'Prentice Hall' } },
  { id: 'G1', fields: { title: 'The', author: null, publisher: null } },
];
