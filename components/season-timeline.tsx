import { methodOf } from '@/src/formation';
import Link from 'next/link';
import type { SeasonView } from '@/src/service';
import { layoutBracket } from '@/src/bracket-layout';

type Stage = {
  key: string;
  label: string;
  href: string;
  state: 'done' | 'current' | 'next';
  detail: string;
  // How far along each part of the stage is, from 0 to 1. A regular season has a part for each round.
  parts: number[];
  // Share of the timeline's width
  weight: number;
};

// The season from sign-ups to champion as one line: what is finished, where it stands now, and what is left.
export function seasonStages(s: SeasonView): Stage[] {
  const base = s.base;
  const pilots = Object.keys(s.players).length;
  const rostered = new Set(s.squads.flatMap((t) => t.roster));
  const unpicked = Object.keys(s.players).filter((id) => !rostered.has(+id)).length;
  const regular = s.matches.filter((m) => !m.series);
  const played = regular.filter((m) => m.result).length;
  const rounds = [...new Set(regular.map((m) => m.round))].sort((a, b) => a - b);
  const openRound = rounds.find((r) => regular.some((m) => m.round === r && !m.result));
  const seasonDone = regular.length > 0 && played === regular.length;
  const drafted = !!s.draftFinished || regular.length > 0;
  // A season that names a draft as its method has a draft stage from the start; any other has one only
  // if a draft was in fact run
  const drafting = !!s.draft || s.picks.length > 0 || (!drafted && methodOf(s).kind === 'live');
  const series = layoutBracket(s.bracket).flatMap((lane) => lane.cards.filter((card) => card.kind === 'series'));
  const decided = series.filter((card) => card.winner).length;
  const champion = s.champion ? s.squads.find((t) => t.id === s.champion) : undefined;
  const stages: Stage[] = [
    {
      key: 'signups',
      label: 'Sign-ups',
      href: base,
      state: drafted || s.draft ? 'done' : 'current',
      detail: drafted || s.draft ? pilots + ' pilots' : (s.enlistedOpen ? 'Open' : 'Closed') + ' · ' + pilots + ' signed up',
      parts: [drafted || s.draft ? 1 : 0],
      weight: 1,
    },
    {
      key: 'draft',
      // Squads may be drafted or simply assigned, so the stage is only called a draft once one is under way
      label: drafting ? 'Draft' : 'Squads',
      href: base + (drafting ? '/draft' : '/squads'),
      state: drafted ? 'done' : s.draft ? 'current' : 'next',
      detail: drafted
        ? s.picks.length
          ? s.picks.length + ' picks'
          : s.squads.length + ' squads formed'
        : s.draft
          ? 'Pick ' + (s.picks.length + 1) + ' of ' + (s.picks.length + unpicked)
          : 'To be formed',
      parts: [drafted ? 1 : s.draft ? s.picks.length / Math.max(1, s.picks.length + unpicked) : 0],
      weight: 1,
    },
    {
      key: 'regular',
      label: 'Regular season',
      href: base + '/schedule',
      state: seasonDone ? 'done' : regular.length ? 'current' : 'next',
      detail: seasonDone
        ? regular.length + ' matches played'
        : regular.length
          ? 'Round ' + openRound + ' of ' + rounds.length + ' · ' + played + ' of ' + regular.length + ' matches played'
          : 'Schedule to come',
      parts: rounds.length
        ? rounds.map((r) => {
            const games = regular.filter((m) => m.round === r);
            return games.filter((m) => m.result).length / games.length;
          })
        : [0],
      weight: 2.6,
    },
    {
      key: 'playoffs',
      label: 'Playoffs',
      href: base + '/playoffs',
      state: s.champion ? 'done' : s.bracket.length || seasonDone ? 'current' : 'next',
      detail: s.champion
        ? series.length + ' series played'
        : s.bracket.length
          ? decided + ' of ' + series.length + ' series decided'
          : seasonDone
            ? 'Awaiting seeding'
            : 'Top ' + s.playoffSpots + ' qualify',
      parts: series.length ? series.map((card) => (card.winner ? 1 : 0)) : [s.champion ? 1 : 0],
      weight: 1.6,
    },
    {
      key: 'champion',
      label: 'Champion',
      href: champion ? base + '/squads/' + champion.slug : base + '/playoffs',
      state: champion ? 'done' : 'next',
      detail: champion ? champion.name : 'To be decided',
      parts: [champion ? 1 : 0],
      weight: 1,
    },
  ];
  // Between stages, such as squads formed but no schedule yet, the next stage is where the season stands
  // A closed season is not at any stage: what was under way when it closed is left as it was
  if (s.closed) for (const stage of stages) if (stage.state === 'current') stage.state = 'next';
  if (!champion && !s.closed && !stages.some((stage) => stage.state === 'current'))
    stages.find((stage) => stage.state === 'next')!.state = 'current';
  return stages;
}

export function SeasonTimeline({ s }: { s: SeasonView }) {
  const stages = seasonStages(s);
  return (
    <section className="season-timeline" aria-label="Season progress">
      <ol style={{ gridTemplateColumns: stages.map((stage) => 'minmax(0, ' + stage.weight + 'fr)').join(' ') }}>
        {stages.map((stage) => (
          <li key={stage.key} data-state={stage.state} aria-current={stage.state === 'current' ? 'step' : undefined}>
            <span className="timeline-track" aria-hidden="true">
              {stage.parts.map((part, i) => (
                <i key={i} style={{ ['--fill' as string]: Math.round(part * 100) + '%' }} />
              ))}
            </span>
            <span className="timeline-label">
              <Link href={stage.href}>{stage.label}</Link>
              {stage.state === 'current' && <small>Now</small>}
              {stage.state === 'done' && <small className="timeline-done">Done</small>}
            </span>
            <span className="timeline-detail">{stage.detail}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
