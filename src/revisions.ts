import { need } from './league.ts';
import type { Actor, Season, StoredSeason } from './types.ts';

// A client still submits the revision it read. Each resource records the last
// season revision at which its command-relevant state changed.
export function resourceState(s: Season) {
  const state = new Map<string, string>();
  function record(key: string, value: unknown) {
    state.set(key, JSON.stringify(value));
  }
  record('registration', s.enlistedOpen);
  record('rules', s.rules ?? []);
  record('draft', [s.draft, s.draftFinished, s.salaries, s.picks, s.formation]);
  record('formation', [Object.keys(s.players), s.squads]);
  record(
    'squads',
    s.squads.map((t) => t.id),
  );
  record('schedule', s.matches.length > 0);
  record('seeds', [
    s.bracket.length,
    s.playoffSpots,
    s.matches.filter((m) => !m.series).map((m) => [m.id, m.result?.winner, m.result !== null]),
  ]);
  for (const id of Object.keys(s.players)) record('pilot:' + id, null);
  for (const t of s.squads) {
    record('squad:' + t.id, t);
    for (const id of t.roster) record('pilot:' + id, t.id);
  }
  for (const t of s.trades) record('trade:' + t.id, t);
  // A repeated submission from the same captain must not create a second offer.
  for (const trade of s.trades) record('lastOffer:' + trade.squads[0], trade.id);
  for (const m of s.matches) {
    const a = m.attempts.at(-1);
    record('match:' + m.id, [
      m.home,
      m.away,
      m.proposal,
      m.result,
      m.rulings,
      m.statRulings,
      a?.externalId,
      a?.state,
      a?.resolution,
      a?.opensAt ?? a?.booking.opensAt,
      a?.startsBy ?? a?.booking.startsBy,
      a?.windowJob,
      a?.needsReview,
      a?.rawResult,
    ]);
  }
  return state;
}

export function updateVersions(before: Map<string, string>, season: StoredSeason) {
  const after = resourceState(season);
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
    (key) => before.get(key) !== after.get(key),
  );
  if (!changed.length) return;
  const versions = season.resourceVersions ?? { baseline: season.revision, changed: {} };
  for (const key of changed) versions.changed[key] = season.revision + 1;
  return versions;
}

function dependencies(s: Season, actor: Actor, command: string, p: Record<string, string>): string[] {
  const own = s.squads.find((t) => t.captain === actor.id);
  const roster = (id?: string) => 'squad:' + id;
  const pilot = (id: string | number) => 'pilot:' + Number(id);
  switch (command) {
    case 'enlist':
      return ['registration', pilot(actor.id)];
    case 'volunteer':
      return [pilot(actor.id)];
    case 'withdraw':
      return ['draft', 'formation', pilot(actor.id)];
    case 'unenlist':
      return ['draft', 'formation', pilot(p.player)];
    case 'prune':
      return ['draft', 'formation', ...Object.keys(p).flatMap((key) => (/^pilot-\d+$/.test(key) ? [pilot(key.slice(6))] : []))];
    // Two operators editing the rules at once should each see the other's change first
    case 'saveRule':
    case 'removeRule':
      return ['rules'];
    case 'toggleEnlist':
      return ['registration'];
    case 'addSquad':
      return ['draft', 'schedule', 'squads', pilot(p.player)];
    case 'reassignCaptain':
      return [roster(p.squad), pilot(p.player)];
    case 'renameSquad':
      return [roster(p.squad)];
    case 'removeSquad':
      return ['draft', 'schedule', 'squads', roster(p.squad)];
    case 'assign':
      return ['draft', roster(p.squad), pilot(p.player)];
    case 'kick':
      return [roster(own?.id), pilot(p.player)];
    case 'salary':
    case 'salaries':
    case 'importRosters':
      return ['draft', 'formation', 'schedule'];
    case 'importSeason':
      return ['draft', 'formation', 'schedule', 'squads', 'seeds'];
    // Only numbers on finished scoreboards change, which no other command decides on
    case 'importStats':
      return [];
    case 'playoffSpots':
      return ['seeds'];
    case 'endDraft':
    case 'undoPick':
    case 'reopenDraft':
      return ['draft', 'schedule'];
    // A draft move is checked by the draft itself against the turn and the bid as they stand, so a page
    // that is one move behind is not turned away for that alone
    case 'nominate':
    case 'bid':
    case 'passBid':
    case 'skipTurn':
    case 'pick':
    case 'clockOut':
      return [];
    case 'form':
    case 'draft':
    case 'setFormation':
      return ['draft', 'schedule', 'formation'];
    case 'clearSquads':
    case 'setSquads':
    case 'drawOrder':
    case 'moveSquad':
      return ['draft', 'schedule', 'formation', 'squads'];
    case 'schedule':
      return ['draft', 'squads', 'schedule'];
    case 'playoffs':
      return ['seeds'];
    case 'offer':
      return [
        'lastOffer:' + own?.id,
        roster(own?.id),
        pilot(p.give),
        pilot(p.take),
        roster(s.squads.find((t) => t.roster.includes(Number(p.take)))?.id),
      ];
    case 'trade': {
      const trade = s.trades.find((t) => t.id === p.trade);
      return ['trade:' + p.trade, ...(trade?.squads.map(roster) ?? [])];
    }
    case 'propose':
    case 'decide': {
      const m = s.matches.find((m) => m.id === p.match);
      return ['match:' + p.match, roster(m?.home), roster(m?.away)];
    }
    case 'sync':
    case 'abandon':
    case 'demoOutcome':
    case 'correctMetric':
      return ['match:' + p.match];
    case 'rule': {
      const m = s.matches.find((m) => m.id === p.match);
      // An unbooked forfeit freezes the current rosters for historical credit.
      if (m && !m.rulingRoster && !m.attempts.length)
        return ['match:' + p.match, roster(m.home), roster(m.away)];
      return ['match:' + p.match];
    }
    default:
      need(false, 'Unknown league command.', 404);
  }
}

export function checkRevision(
  s: StoredSeason,
  actor: Actor,
  seen: number,
  command: string,
  params: Record<string, string>,
) {
  const versions = s.resourceVersions;
  const baseline = versions?.baseline ?? s.revision;
  need(
    Number.isSafeInteger(seen) &&
      seen >= baseline &&
      seen <= s.revision &&
      dependencies(s, actor, command, params).every((key) => (versions?.changed[key] ?? baseline) <= seen),
    'This record changed. Refresh and review the latest state.',
    409,
  );
}
