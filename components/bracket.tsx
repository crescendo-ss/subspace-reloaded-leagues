import type { CSSProperties, ReactNode } from 'react';
import { layoutBracket, titleSeries, type BracketCard, type BracketNode } from '@/src/bracket-layout';
import { BracketRounds } from './bracket-rounds';

// Draws a playoff structure as a bracket: one lane for the winners' side and final, one for the losers' side.
// It is given only the series graph and how to show a squad, so it serves any format the graph can describe.
export function Bracket({
  series,
  name,
  seed,
  games,
  bestOf,
  champion,
}: {
  series: BracketNode[];
  name: (squad: string) => ReactNode;
  seed?: (squad: string) => number | undefined;
  // Links to a series' games, shown under its two squads
  games?: (series: string) => ReactNode;
  bestOf?: number;
  // The season's champion: their winning series is the one gold card in the bracket
  champion?: string | null;
}) {
  const lanes = layoutBracket(series);
  const draw = (card: BracketCard, style?: CSSProperties) => {
    const score = card.node.score ?? [];
    const started = card.kind === 'series' && (!!card.winner || score.some((n) => n > 0));
    const footer = card.kind === 'series' && games?.(card.node.id);
    return (
      <article key={card.node.id} className={'bracket-series' + (card.kind === 'bye' ? ' bye' : '') + (champion && card.winner === champion && card.node.id === titleSeries(series)?.id ? ' title' : '')} style={style}>
        {card.kind === 'series' && (
          <header>
            <span>Series {card.number}</span>
            <span>
              {card.winner
                ? 'Decided'
                : started
                  ? 'In progress'
                  : card.node.stage === 'Reset'
                    ? 'If needed'
                    : bestOf
                      ? 'Best of ' + bestOf
                      : ''}
            </span>
          </header>
        )}
        {card.slots.map((slot, i) =>
          slot.kind === 'squad' ? (
            <div
              key={i}
              className="bracket-side"
              data-result={card.winner ? (card.winner === slot.id ? 'won' : 'lost') : undefined}
            >
              {seed?.(slot.id) !== undefined && (
                <span className="seed" aria-label={'Seed ' + seed(slot.id)}>
                  {seed(slot.id)}
                </span>
              )}
              <span className="bracket-name">{name(slot.id)}</span>
              {card.kind === 'bye' && <span className="bracket-note">Bye</span>}
              {started && <b aria-label={'Games won: ' + (score[i] ?? 0)}>{score[i] ?? 0}</b>}
            </div>
          ) : slot.kind === 'pending' ? (
            <div key={i} className="bracket-side" data-kind="pending">
              {slot.take === 'winner' ? 'Winner' : 'Loser'} of series {slot.series}
            </div>
          ) : null,
        )}
        {footer && <footer>{footer}</footer>}
      </article>
    );
  };
  // For narrow screens: the same series grouped into rounds, in the order they are played
  const drawn = lanes.flatMap((lane) => lane.cards.filter((card) => card.kind !== 'empty').map((card) => ({ lane, card })));
  const rounds = series.flatMap((node) => {
    const first = drawn.find(({ card }) => card.node.stage === node.stage && card.node.round === node.round);
    if (first?.card.node.id !== node.id) return [];
    const { lane, card } = first;
    const title = lane.columns[card.column].title;
    const cards = lane.cards.filter((c) => c.column === card.column && c.kind !== 'empty');
    return [
      {
        title: lane.key === 'lower' && !title.startsWith('Losers') ? 'Losers’ ' + title.toLowerCase() : title,
        open: cards.some((c) => c.kind === 'series' && !c.winner),
        content: cards.map((c) => draw(c)),
      },
    ];
  });
  const current = rounds.findIndex((round) => round.open);
  return (
    <div className="bracket" style={{ ['--bracket-columns' as string]: Math.max(1, ...lanes.map((lane) => lane.columns.length)) }}>
      {lanes.map((lane) => (
        <section key={lane.key} className="bracket-lane" aria-label={lane.title}>
          {lanes.length > 1 && <h3>{lane.title}</h3>}
          <div className="bracket-scroll">
            <div
              className="bracket-grid"
              style={{ gridTemplateColumns: lane.columns.map(() => 'var(--bracket-column)').join(' var(--bracket-gap) ') }}
            >
              {lane.columns.map((column, i) => (
                <div key={i} className="bracket-round" style={{ gridColumn: 2 * i + 1, gridRow: 1 }}>
                  {column.title}
                </div>
              ))}
              {lane.links.map((link, i) => (
                <span
                  key={i}
                  className="bracket-link"
                  data-turn={link.turn}
                  aria-hidden="true"
                  style={{ gridColumn: 2 * link.column + 2, gridRow: link.rows[0] + 1 + ' / ' + (link.rows[1] + 2) }}
                />
              ))}
              {lane.cards.map((card) =>
                card.kind === 'empty'
                  ? null
                  : draw(card, { gridColumn: 2 * card.column + 1, gridRow: card.rows[0] + 1 + ' / ' + (card.rows[1] + 2) }),
              )}
            </div>
          </div>
        </section>
      ))}
      <BracketRounds rounds={rounds.map(({ title, content }) => ({ title, content }))} initial={current < 0 ? Math.max(0, rounds.length - 1) : current} />
    </div>
  );
}
