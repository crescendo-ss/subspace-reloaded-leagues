import { inferFormation } from './formation.ts';
import type { Season } from './types.ts';

// A season is stored as one document, and documents written before a field existed do not have it. Every
// document passes through here as it is read, so the rest of the code sees one shape. Add a line when a
// field is added; never assume a stored season has what a new one does.
export function upgrade<T extends Season>(doc: T): T {
  doc.players ??= {};
  doc.salaries ??= {};
  doc.squads ??= [];
  doc.matches ??= [];
  doc.trades ??= [];
  doc.bracket ??= [];
  doc.picks ??= [];
  doc.champion ??= null;
  doc.draft ??= null;
  doc.formation ??= inferFormation(doc);
  // Rulings made before a forfeit was recorded as one: a win awarded with no game played was a forfeit
  for (const m of doc.matches) {
    if (m.result?.source === 'operator') m.result.forfeit ??= !!m.result.winner && !m.result.players.length;
  }
  return doc;
}
