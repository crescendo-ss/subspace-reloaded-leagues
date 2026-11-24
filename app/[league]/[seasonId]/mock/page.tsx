import { loadLeaguePage, type LeaguePage } from '@/app/data';
import { seasonMetadata } from '@/app/seo';
import { MockDraft } from '@/components/mock-draft';
import type { DraftPool } from '@/src/draft';
export const generateMetadata = (props: LeaguePage) =>
  seasonMetadata(props, 'mock', 'Mock draft', ({ season: s }) =>
    'Practise the ' + s.name + ' draft: pick for one squad while the others pick automatically, with the season’s pilots and salaries.');
export default async function MockPage(props: LeaguePage) {
  const { season: s } = await loadLeaguePage(props, 'mock');
  const squads = s.squads.map((t) => ({ ...t, roster: [t.captain] }));
  const players = Object.fromEntries(
    Object.entries(s.players).filter(
      ([id]) => Number.isSafeInteger(s.salaries[+id]) || squads.some((t) => t.captain === +id),
    ),
  );
  const practice = squads.length < 2 || Object.keys(players).length <= squads.length;
  // The mock runs under the season's own draft rules, without its clock
  const rules = { ...s.formation, clock: undefined };
  const pool: DraftPool = practice
    ? {
        squads: [
          { id: 'north', name: 'Practice North', captain: 1, roster: [1] },
          { id: 'south', name: 'Practice South', captain: 2, roster: [2] },
        ],
        players: {
          1: 'North captain',
          2: 'South captain',
          3: 'Comet',
          4: 'Nova',
          5: 'Flare',
          6: 'Echo',
          7: 'Scout',
          8: 'Orbit',
          9: 'Lumen',
          10: 'Vega',
        },
        salaries: { 1: 0, 2: 0, 3: 14, 4: 12, 5: 11, 6: 9, 7: 8, 8: 7, 9: 6, 10: 5 },
        picks: [],
        draft: null,
        formation: rules,
      }
    : { squads, players, salaries: s.salaries, picks: [], draft: null, formation: rules };
  return (
    <>
      <h1>Mock draft</h1>
      <MockDraft key={s.id} initial={pool} practice={practice} />
    </>
  );
}
