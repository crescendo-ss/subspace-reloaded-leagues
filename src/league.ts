import { isActive, isPending, retryable } from './attempts.ts';
import { lockedDuringDraft } from './commands.ts';
import { clockOut, endDraft as closeDraft, move, resumeDraft, startDraft, undoPick } from './draft.ts';
import { importRosters } from './import-rosters.ts';
import { importSeason } from './import-season.ts';
import { importStats } from './import-stats.ts';
import type {
  Season,
  Squad,
  Actor,
  Attempt,
  Trade,
  Match,
  PlayerStats,
  MetricRuling,
  RosterSlot,
  Window,
} from './types.ts';
import { randomUUID } from 'node:crypto';
import { formation, formations, methodOf, methods, shuffle } from './formation.ts';
import { autoPickers, defaultAutoPicker } from './autopick.ts';
import { parseSquads } from './squad-builder.ts';
import { advance, bracket, roundRobin, standings } from './competition.ts';

// Something the person asked for cannot be done, and the message says why. It is shown to them as it is.
export class Refusal extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'Refusal';
    this.status = status;
  }
}
// Something the code itself relies on is not so: a fault here, not the person's doing. It carries no
// status, so it is logged and reported as a server error and never shown as a form message.
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('Invariant broken: ' + message);
}
export function need(condition: unknown, message: string, status = 400): asserts condition {
  if (!condition) throw new Refusal(message, status);
}
function name(value: unknown) {
  need(
    typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 80,
    'Enter a name of 1–80 characters.',
  );
  return value.trim();
}
export function season(input: Record<string, unknown>): Season {
  const playoffSpots = Number(input.playoffSpots ?? 4);
  need(
    Number.isSafeInteger(playoffSpots) && playoffSpots >= 2 && playoffSpots <= 128,
    'Choose 2–128 playoff spots.',
  );
  const format = input.format ?? 'double';
  const bestOf = Number(input.bestOf ?? 3);
  const minPerTeam = Number(input.minPerTeam ?? 4);
  need(
    (format === 'single' || format === 'double') && [1, 3, 5].includes(bestOf),
    'Choose a supported playoff format.',
  );
  need(
    Number.isInteger(minPerTeam) && minPerTeam >= 1 && minPerTeam <= 64,
    'Choose a quorum between 1 and 64.',
  );
  return {
    id: randomUUID(),
    name: name(input.name),
    gameType: name(input.gameType ?? 'svs-league-4v4'),
    format,
    bestOf,
    minPerTeam,
    reviewTrades: input.reviewTrades !== false,
    enlistedOpen: true,
    players: {},
    squads: [],
    matches: [],
    trades: [],
    bracket: [],
    champion: null,
    draft: null,
    salaries: {},
    picks: [],
    formation: formation(input.method),
    playoffSpots,
  };
}
export const freePlayers = (s: Pick<Season, 'squads' | 'players'>) =>
  Object.keys(s.players)
    .map(Number)
    .filter((id) => !s.squads.some((team) => team.roster.includes(id)));
export const current = (m: Match) => m.attempts.at(-1);
export { retryable };
export function wireTeams(s: Season, m: Match) {
  return [m.home, m.away].map((id) => {
    const squad = s.squads.find((t) => t.id === id)!;
    return {
      name: squad.name,
      captainProfileId: squad.captain,
      roster: squad.roster.map((profileId) => ({ profileId })),
    };
  });
}
// A score given with a result, home first. Both numbers or neither, and they must agree with the outcome:
// `leader` is the winning side's position, or null for a draw.
export function ruledScore(home: unknown, away: unknown, leader: 0 | 1 | null): [number, number] | undefined {
  const given = [home, away].map((value) => (value === undefined || value === null || String(value).trim() === '' ? null : Number(value)));
  if (given.every((value) => value === null)) return undefined;
  need(
    given.every((value) => value !== null && Number.isSafeInteger(value) && value >= 0 && value <= 999),
    'Enter both scores as whole numbers, or leave both empty.',
  );
  const score = given as [number, number];
  need(
    leader === null ? score[0] === score[1] : score[leader] > score[1 - leader],
    leader === null ? 'A draw needs level scores.' : 'The winning squad needs the higher score.',
  );
  return score;
}
export function resultRoster(s: Season, m: Match): RosterSlot[] {
  if (m.rulingRoster) return m.rulingRoster;
  const a = current(m);
  const teams = a?.snapshot?.teams ?? a?.sentTeams ?? a?.booking.teams ?? wireTeams(s, m);
  return teams.flatMap((t, i) =>
    ('players' in t ? t.players : t.roster).map((p) => ({ id: p.profileId, squad: [m.home, m.away][i] })),
  );
}

export function withCorrections(players: PlayerStats[], changes: MetricRuling[] = []) {
  const rows = new Map(players.map((p) => [p.id, structuredClone(p)]));
  for (const { id, squad, metric, value } of changes) {
    const row = rows.get(id) ?? { id, squad, metrics: {} };
    row.metrics = { ...row.metrics, [metric]: value };
    rows.set(id, row);
  }
  return [...rows.values()];
}
// During a PATCH both windows are reserved until Reloaded confirms which one applies.
function ensureWindowAvailable(s: Season, match: Match, requested: Window) {
  for (const other of s.matches) {
    if (other.id === match.id || other.result) continue;
    const shared = [other.home, other.away].find((id) => id === match.home || id === match.away);
    const attempt = current(other);
    if (!shared || !isActive(attempt))
      continue;
    const confirmed = {
      opensAt: attempt.opensAt ?? attempt.booking.opensAt,
      startsBy: attempt.startsBy ?? attempt.booking.startsBy,
    };
    for (const window of [confirmed, attempt.windowJob]) {
      if (
        window &&
        Date.parse(requested.opensAt) < Date.parse(window.startsBy) &&
        Date.parse(window.opensAt) < Date.parse(requested.startsBy)
      ) {
        const squad = s.squads.find((t) => t.id === shared)!;
        need(
          false,
          squad.name +
            ' already has a fixture from ' +
            window.opensAt +
            ' to ' +
            window.startsBy +
            '. Choose another check-in window.',
          409,
        );
      }
    }
  }
}
function rosterChanged(s: Season) {
  for (const m of s.matches) {
    const a = current(m);
    if (m.result || !isPending(a)) continue;
    const teams = wireTeams(s, m);
    need(
      teams.every((t) => t.roster.length >= s.minPerTeam),
      'This would leave a booked fixture below quorum.',
    );
    if (JSON.stringify(a.desiredTeams) !== JSON.stringify(teams)) {
      a.desiredTeams = teams;
      a.rosterError = null;
    }
  }
}
function commitTrade(s: Season, t: Trade) {
  const [a, b] = t.squads.map((id) => s.squads.find((x) => x.id === id)!);
  const [p, q] = t.players;
  need(
    a.roster.includes(p) && b.roster.includes(q) && p !== a.captain && q !== b.captain,
    'The proposed players are no longer available.',
  );
  a.roster[a.roster.indexOf(p)] = q;
  b.roster[b.roster.indexOf(q)] = p;
  t.state = 'completed';
  rosterChanged(s);
}
export const ruleLimits = { count: 20, body: 4000 };
// A pilot can be taken out of a season while nothing on its record names them. `who` is how the refusal
// names them: the bulk form says which pilot stopped it.
function removable(s: Season, id: number, who: string) {
  need(!s.squads.some((t) => t.captain === id), who + ' is a captain. Change the captain or remove the squad first.');
  need(
    !s.picks.some((pick) => pick.player === id) && !s.matches.some((match) => match.result?.players.some((player) => player.id === id)),
    who + ' has been drafted or has played this season, so they stay on its record. Their captain can release them from the squad.',
  );
}
function remove(s: Season, id: number) {
  const squad = s.squads.find((t) => t.roster.includes(id));
  if (squad) squad.roster = squad.roster.filter((x) => x !== id);
  for (const trade of s.trades) {
    if (['offered', 'review'].includes(trade.state) && trade.players.includes(id)) trade.state = 'declined';
  }
  delete s.players[id];
  delete s.salaries[id];
  if (s.signups) delete s.signups[id];
  volunteer(s, id, false);
}
function volunteer(s: Season, id: number, willing: boolean) {
  const others = (s.volunteers ?? []).filter((x) => x !== id);
  s.volunteers = willing ? [...others, id] : others;
}
function assign(s: Season, id: number, squad: Squad | undefined) {
  need(squad && freePlayers(s).includes(id), 'Choose a signed-up free agent and a squad.');
  squad.roster.push(id);
}
export function apply(s: Season, actor: Actor | null, cmd: string, p: Record<string, string> = {}) {
  need(actor?.id, 'Sign in to continue.', 401);
  const operator = () => need(actor.operator, 'League operator access required.', 403);
  const team = s.squads.find((t) => t.id === p.squad);
  const mine = s.squads.find((t) => t.captain === actor.id);
  const m = s.matches.find((x) => x.id === p.match);
  const setup = () => need(!s.matches.length, 'Squad formation closes when the schedule is generated.');

  if (s.draft && (lockedDuringDraft as readonly string[]).includes(cmd))
    need(false, 'The player pool and rosters are locked during the draft.');
  switch (cmd) {
    // Signing up says whether the pilot would captain a squad, which is what the operators choose captains from
    case 'enlist':
      need(s.enlistedOpen, 'Sign-ups are closed.');
      if (!Object.hasOwn(s.players, actor.id)) (s.signups ??= {})[actor.id] = new Date().toISOString();
      s.players[actor.id] = actor.name;
      if (p.captain !== undefined) volunteer(s, actor.id, p.captain === 'yes');
      return;
    // A signed-up pilot can change their mind about captaining while squads are still being formed
    case 'volunteer':
      need(Object.hasOwn(s.players, actor.id), 'Sign up for the season first.');
      need(!s.matches.length, 'Captains are settled once the schedule is generated.');
      volunteer(s, actor.id, p.captain === 'yes');
      return;
    // A pilot takes their own name off the list, while they are not yet on a squad or on the season's record
    case 'withdraw': {
      const id = actor.id;
      need(Object.hasOwn(s.players, id), 'You have not signed up for this season.');
      need(!s.squads.some((t) => t.roster.includes(id)), 'You are on a squad. Ask your captain or an operator to release you.');
      need(
        !s.picks.some((pick) => pick.player === id) && !s.matches.some((match) => match.result?.players.some((player) => player.id === id)),
        'You have been drafted or have played this season, so you stay on its record.',
      );
      delete s.players[id];
      delete s.salaries[id];
      if (s.signups) delete s.signups[id];
      volunteer(s, id, false);
      return;
    }
    // An operator takes a pilot out of the season: someone who signed up and will not play it after all.
    // Enlistment is per season, so this says nothing about the league's other seasons.
    case 'unenlist': {
      operator();
      const id = Number(p.player);
      need(Object.hasOwn(s.players, id), 'Choose a pilot who has signed up.');
      removable(s, id, 'This pilot');
      remove(s, id);
      rosterChanged(s);
      return;
    }
    // Pruning the pool: an operator takes out every pilot ticked, in one step. Nobody is removed unless all
    // of them can be.
    case 'prune': {
      operator();
      const ids = Object.keys(p).flatMap((key) => {
        const id = Number(key.match(/^pilot-(\d+)$/)?.[1]);
        return id ? [id] : [];
      });
      need(ids.length, 'Tick at least one pilot to remove.');
      for (const id of ids) {
        need(Object.hasOwn(s.players, id), 'Pilot ' + id + ' has not signed up.');
        removable(s, id, s.players[id]);
      }
      for (const id of ids) remove(s, id);
      rosterChanged(s);
      return;
    }
    // A rule of the league's own: a title and what it says. Given an existing rule it replaces it.
    case 'saveRule': {
      operator();
      const title = name(p.title);
      const body = String(p.body ?? '').replace(/\r\n?/g, '\n').trim();
      need(body.length > 0 && body.length <= ruleLimits.body, 'Write the rule in up to ' + ruleLimits.body.toLocaleString('en-US') + ' characters.');
      const rules = (s.rules ??= []);
      const existing = p.rule ? rules.find((rule) => rule.id === p.rule) : undefined;
      need(!p.rule || existing, 'This rule has been removed.');
      need(!rules.some((rule) => rule !== existing && rule.title.toLowerCase() === title.toLowerCase()), 'Another rule already has this title.');
      if (existing) Object.assign(existing, { title, body });
      else {
        need(rules.length < ruleLimits.count, 'A season carries up to ' + ruleLimits.count + ' rules of its own.');
        rules.push({ id: randomUUID(), title, body });
      }
      return;
    }
    case 'removeRule':
      operator();
      need(s.rules?.some((rule) => rule.id === p.rule), 'This rule has been removed.');
      s.rules = (s.rules ?? []).filter((rule) => rule.id !== p.rule);
      return;
    case 'toggleEnlist':
      operator();
      s.enlistedOpen = !s.enlistedOpen;
      return;
    // Appointing a captain creates their squad. A name can be given now or left to be set later.
    case 'addSquad': {
      operator();
      setup();
      need(!s.draft, 'Finish the draft before adding another squad.');
      const id = Number(p.player);
      need(freePlayers(s).includes(id), 'Choose a signed-up pilot who is not on a squad as captain.');
      const label = name(p.name?.trim() ? p.name : s.players[id] + '’s squad');
      need(
        !s.squads.some((x) => x.name.toLowerCase() === label.toLowerCase()),
        'A squad already uses this name.',
      );
      s.squads.push({ id: randomUUID(), name: label, captain: id, roster: [id] });
      return;
    }
    case 'renameSquad': {
      need(
        team && (actor.operator || team.captain === actor.id),
        'Only an operator or the squad’s captain can rename it.',
        403,
      );
      const label = name(p.name);
      need(
        !s.squads.some((x) => x !== team && x.name.toLowerCase() === label.toLowerCase()),
        'A squad already uses this name.',
      );
      team.name = label;
      return;
    }
    // Withdrawing a captain before squads are filled removes the squad and frees its pilots.
    case 'removeSquad': {
      operator();
      setup();
      need(team, 'Choose a squad.');
      need(!s.draft && !s.picks.some((pick) => pick.squad === team.id), 'A squad that has drafted cannot be removed.');
      s.squads = s.squads.filter((x) => x !== team);
      s.trades = s.trades.filter((trade) => !trade.squads.includes(team.id));
      return;
    }
    // The new captain is someone on the squad, or an enlisted pilot who is not on any squad yet.
    case 'reassignCaptain': {
      operator();
      const player = Number(p.player);
      const joining = freePlayers(s).includes(player);
      need(
        team && team.captain !== player && (team.roster.includes(player) || joining),
        'Choose another pilot on this squad, or a signed-up pilot who is not on a squad.',
      );
      if (joining) {
        need(!s.draft, 'Finish the active draft first.');
        team.roster.push(player);
      }
      team.captain = player;
      for (const match of s.matches) {
        if (match.proposal?.by === team.id) match.proposal = null;
      }
      // A captain cannot be traded. Close affected offers so they cannot revive
      // later if the same pilot changes roles again.
      for (const trade of s.trades) {
        if (['offered', 'review'].includes(trade.state) && trade.players.includes(player))
          trade.state = 'declined';
      }
      rosterChanged(s);
      return;
    }
    case 'assign':
      operator();
      need(!s.draft, 'Finish the active draft first.');
      assign(s, Number(p.player), team);
      rosterChanged(s);
      return;
    // Deals the free pilots onto squads in one step. Given a number of squads it makes them first, taking
    // captains from the pilots who said they were willing and then from the rest.
    case 'form': {
      operator();
      setup();
      need(!s.draft, 'Finish the live draft first.');
      const dealer = p.method ?? methodOf(s).deal ?? 'even';
      const strategy = formations.get(dealer);
      need(strategy, 'Unknown formation method.');
      if (String(p.squads ?? '').trim()) {
        const count = Number(p.squads);
        need(Number.isSafeInteger(count) && count >= 2 && count <= 64, 'Choose 2–64 squads.');
        need(count >= s.squads.length, 'There are already ' + s.squads.length + ' squads. Clear them to start again with fewer.');
        const free = dealer === 'random' ? shuffle(freePlayers(s)) : freePlayers(s);
        need(free.length >= count - s.squads.length, 'There are not enough free pilots to captain that many squads.');
        const willing = new Set(s.volunteers ?? []);
        const candidates = [...free.filter((id) => willing.has(id)), ...free.filter((id) => !willing.has(id))];
        for (const id of candidates.slice(0, count - s.squads.length)) {
          let n = s.squads.length + 1;
          while (s.squads.some((t) => t.name.toLowerCase() === 'squad ' + n)) n++;
          s.squads.push({ id: randomUUID(), name: 'Squad ' + n, captain: id, roster: [id] });
        }
      }
      need(s.squads.length >= 2, 'Say how many squads to make, or appoint at least two captains first.');
      const pilots = freePlayers(s);
      const assignments = strategy.assign(structuredClone(s), [...pilots]);
      need(assignments.length === pilots.length, 'Strategy must assign every free pilot.');
      for (const pick of assignments)
        assign(
          s,
          pick.player,
          s.squads.find((x) => x.id === pick.squad),
        );
      return;
    }
    case 'salary': {
      operator();
      const id = Number(p.player),
        salary = Number(p.salary);
      need(
        !s.draft &&
          !s.draftFinished &&
          Object.hasOwn(s.players, id) &&
          String(p.salary ?? '').trim() &&
          Number.isSafeInteger(salary) &&
          salary >= 0,
        'Choose a signed-up pilot and a nonnegative whole-number salary before the draft.',
      );
      s.salaries[id] = salary;
      return;
    }
    // Every pilot's salary in one form: a field per pilot, named for their profile. An empty field leaves
    // that pilot as they were.
    case 'salaries': {
      operator();
      need(!s.draft && !s.draftFinished, 'Salaries can be changed until the draft starts.');
      const changes: [number, number][] = [];
      for (const [key, value] of Object.entries(p as Record<string, string>)) {
        const id = Number(key.match(/^pilot-(\d+)$/)?.[1]);
        if (!id || String(value ?? '').trim() === '') continue;
        const salary = Number(value);
        need(Object.hasOwn(s.players, id), 'Pilot ' + id + ' has not signed up.');
        need(Number.isSafeInteger(salary) && salary >= 0, s.players[id] + ' needs a nonnegative whole-number salary.');
        changes.push([id, salary]);
      }
      for (const [id, salary] of changes) s.salaries[id] = salary;
      return;
    }
    case 'importRosters':
      operator();
      importRosters(s, p.data);
      return;
    case 'importSeason':
      operator();
      importSeason(s, p.data, actor);
      return;
    case 'importStats':
      operator();
      importStats(s, p.data);
      return;
    case 'playoffSpots':
      operator();
      need(
        !s.bracket.length && Number.isSafeInteger(+p.spots) && +p.spots >= 2 && +p.spots <= 128,
        'Choose 2–128 qualifiers before seeding.',
      );
      s.playoffSpots = +p.spots;
      return;
    // The draft a season opens is the one its formation method names. Asking for a format outright still
    // works, for a league that changes its mind on the day.
    case 'draft': {
      operator();
      setup();
      need(!s.draftFinished, 'The draft is complete. Reopen it to carry on.');
      const method = methodOf(s);
      need(p.format || method.draft, 'This season forms its squads without a draft. Change how squads are formed first.');
      startDraft(s, p.format ?? method.draft!.format, Number(p.budget ?? s.formation.credits ?? 100), p.order ?? method.draft?.order ?? 'snake');
      return;
    }
    case 'endDraft':
      operator();
      closeDraft(s);
      s.draftFinished = true;
      return;
    // An operator takes back the last pick, or reopens a draft that ended, until the schedule exists
    case 'undoPick':
      operator();
      setup();
      undoPick(s);
      s.draftFinished = false;
      return;
    case 'reopenDraft':
      operator();
      setup();
      need(freePlayers(s).length, 'Every pilot is on a squad, so there is no one left to draft.');
      resumeDraft(s);
      s.draftFinished = false;
      return;
    // Anyone at the draft may call time. The engine refuses until the clock has really run out.
    case 'clockOut':
      need(actor.operator || mine, 'Only a captain or an operator can call time.', 403);
      clockOut(s, autoPickers[defaultAutoPicker].choose);
      if (!s.draft) s.draftFinished = true;
      return;
    case 'pick':
    case 'nominate':
    case 'bid':
    case 'passBid':
    case 'skipTurn': {
      // A captain acts for their own squad. An operator may act for any, so one absent captain cannot
      // stop the draft.
      const acting = actor.operator && p.squad ? team : mine;
      need(acting, 'Only a captain can draft.', 403);
      // These are checked against the draft as it stands, not the page they were sent from. A pick, a
      // nomination or a skip says which turn it was meant for, so it cannot land on a later one.
      if (cmd !== 'bid' && cmd !== 'passBid' && p.turn !== undefined)
        need(Number(p.turn) === s.draft?.pick, 'The draft has moved on. Look again and choose.', 409);
      move(s, acting.id, cmd, Number(p.player), Number(p.amount));
      if (!s.draft) s.draftFinished = true;
      return;
    }
    // Squads stand in draft order: the first picks first. It can be drawn or set until the draft opens.
    case 'drawOrder':
    case 'moveSquad': {
      operator();
      need(!s.draft && !s.picks.length && !s.matches.length, 'The draft order is settled once the draft opens.');
      if (cmd === 'drawOrder') shuffle(s.squads);
      else {
        const to = Number(p.to) - 1;
        need(team && Number.isSafeInteger(to) && to >= 0 && to < s.squads.length, 'Choose a squad and a place in the order.');
        s.squads.splice(s.squads.indexOf(team), 1);
        s.squads.splice(to, 0, team);
      }
      return;
    }
    // How this season's squads are formed, and the rules its draft runs under. The method is settled once
    // a draft has picks or the schedule exists; after that only the clock may change.
    case 'setFormation': {
      operator();
      need(!s.draft, 'Finish the live draft first.');
      const next = { ...s.formation };
      if (p.method !== undefined && p.method !== next.method) {
        need(Object.hasOwn(methods, p.method), 'Choose how squads are formed.');
        need(!s.matches.length && !s.picks.length, 'How squads are formed is settled once a draft has picks or the schedule exists.');
        next.method = p.method;
        // Whatever was tried under the old method and left no picks is not this method's draft
        s.draftFinished = false;
        s.lastDraft = null;
      }
      // An empty field clears the option; a missing one leaves it as it was
      const whole = (value: string | undefined, label: string, min: number, max: number) => {
        if (value === undefined) return undefined;
        if (!String(value).trim()) return null;
        const n = Number(value);
        need(Number.isSafeInteger(n) && n >= min && n <= max, label + ' must be a whole number from ' + min + ' to ' + max.toLocaleString('en-US') + '.');
        return n;
      };
      if (p.salaries !== undefined) next.salaries = p.salaries !== 'no';
      const credits = whole(p.credits, 'Auction credits', 1, 1e6);
      if (credits !== undefined) next.credits = credits ?? 100;
      const size = whole(p.squadSize, 'Squad size', Math.max(2, s.minPerTeam), 64);
      if (size !== undefined) next.squadSize = size ?? undefined;
      const clock = whole(p.clock, 'The clock', 5, 3600);
      if (clock !== undefined) next.clock = clock ?? undefined;
      const capPicks = whole(p.capPicks, 'The opening cap’s picks', 1, 20),
        capSalary = whole(p.capSalary, 'The opening cap’s salary', 1, 1e6);
      if (capPicks !== undefined || capSalary !== undefined) {
        need((capPicks ?? null) === null ? (capSalary ?? null) === null : (capSalary ?? null) !== null, 'Give both parts of the opening cap, or leave both empty.');
        next.cap = capPicks && capSalary ? { picks: capPicks, salary: capSalary } : null;
      }
      const rules = (f: typeof next) => JSON.stringify({ ...f, clock: 0 });
      need(!s.picks.length || rules(next) === rules(s.formation), 'Once the draft has picks, only its clock can change.');
      s.formation = next;
      return;
    }
    // Starting again before a draft or a schedule: every squad is dissolved and its pilots are free
    case 'clearSquads':
      operator();
      setup();
      need(!s.draft && !s.picks.length, 'These squads were drafted. Take back the picks, or change them by trades and releases.');
      s.squads = [];
      s.trades = [];
      s.draftFinished = false;
      s.lastDraft = null;
      return;
    // Squads entered by hand, all at once: see src/squad-builder.ts for the text
    case 'setSquads':
      operator();
      setup();
      need(!s.draft && !s.picks.length, 'These squads were drafted. Change them by trades and releases.');
      s.squads = parseSquads(s, String(p.data ?? ''), (message) => need(false, message) as never);
      s.trades = [];
      return;
    case 'kick': {
      need(
        mine && mine.roster.includes(Number(p.player)) && mine.captain !== Number(p.player),
        'Choose a non-captain from your own roster.',
        403,
      );
      mine.roster = mine.roster.filter((x) => x !== Number(p.player));
      rosterChanged(s);
      return;
    }
    case 'offer': {
      const give = Number(p.give),
        take = Number(p.take);
      const other = s.squads.find((t) => t.roster.includes(take));
      need(
        mine &&
          other &&
          other !== mine &&
          mine.roster.includes(give) &&
          give !== mine.captain &&
          take !== other.captain,
        'Choose one non-captain from each squad.',
      );
      s.trades.push({
        id: randomUUID(),
        squads: [mine.id, other.id],
        players: [give, take],
        state: 'offered',
      });
      return;
    }
    case 'trade': {
      const t = s.trades.find((x) => x.id === p.trade);
      need(t && ['offered', 'review'].includes(t.state), 'This trade is closed.');
      if (t.state === 'offered') need(mine?.id === t.squads[1], 'The receiving captain must decide.', 403);
      else operator();
      need(['accept', 'decline'].includes(p.decision), 'Unknown trade decision.');
      if (p.decision === 'decline') t.state = 'declined';
      else if (t.state === 'offered' && s.reviewTrades) t.state = 'review';
      else commitTrade(s, t);
      return;
    }
    case 'schedule':
      operator();
      setup();
      need(!s.draft && s.squads.length >= 2, 'Finish forming at least two squads first.');
      s.matches = roundRobin(s.squads.map((t) => t.id));
      return;
    case 'playoffs':
      operator();
      need(
        !s.bracket.length && s.matches.length && s.matches.every((x) => x.result),
        'Resolve all regular-season matches first.',
      );
      s.bracket = bracket(
        standings(s)
          .slice(0, s.playoffSpots)
          .map((t) => t.id),
        s.format,
      );
      advance(s);
      return;
    case 'propose': {
      need(m && mine && [m.home, m.away].includes(mine.id), 'Only a captain in this match can do that.', 403);
      const a = current(m);
      need(
        !m.result && (!a || retryable(a) || a.state === 'booked' || a.state === 'refused'),
        'The current fixture cannot be scheduled again.',
      );
      need(!a?.windowJob, 'A window change is in progress.');
      const opens = Date.parse(p.opensAt);
      const minutes = Number(p.minutes);
      need(
        Number.isFinite(opens) &&
          opens > Date.now() &&
          Number.isInteger(minutes) &&
          minutes > 0 &&
          minutes <= 1440,
        'Choose a future check-in window of up to 24 hours.',
      );
      m.proposal = {
        id: randomUUID(),
        by: mine.id,
        opensAt: new Date(opens).toISOString(),
        startsBy: new Date(opens + minutes * 60000).toISOString(),
        attempt: a?.externalId ?? null,
        state: a?.state ?? null,
      };
      return;
    }
    case 'decide': {
      need(m && mine && [m.home, m.away].includes(mine.id), 'Only a captain in this match can do that.', 403);
      const offer = m.proposal,
        a = current(m);
      need(
        offer && offer.id === p.proposal && offer.by !== mine.id && !m.result,
        'The opposing captain must decide on the current proposal.',
      );
      need(['accept', 'decline'].includes(p.decision), 'Unknown decision.');
      if (p.decision === 'decline') {
        m.proposal = null;
        return;
      }
      need(offer.opensAt > new Date().toISOString(), 'This proposal has expired.');
      need(
        offer.attempt === (a?.externalId ?? null) && offer.state === (a?.state ?? null),
        'Fixture status changed. Propose a new window.',
      );
      const teams = wireTeams(s, m);
      need(
        teams.every((t) => t.roster.length >= s.minPerTeam),
        'Both squads must meet the season quorum.',
      );
      ensureWindowAvailable(s, m, offer);
      m.proposal = null;
      if (a?.state === 'booked') {
        a.windowJob = { opensAt: offer.opensAt, startsBy: offer.startsBy };
        a.windowError = null;
      } else {
        const externalId = m.id + '-' + (m.attempts.length + 1);
        m.attempts.push({
          externalId,
          state: 'queued',
          desiredTeams: teams,
          booking: {
            externalId,
            gameType: s.gameType,
            minPerTeam: s.minPerTeam,
            teams,
            opensAt: offer.opensAt,
            startsBy: offer.startsBy,
          },
        });
      }
      return;
    }
    // An operator gives up on a booking the zone will not take or no longer knows, so the match can be
    // arranged again or ruled on. Whatever the zone later says about that booking is ignored.
    case 'abandon': {
      operator();
      need(m, 'Match not found.');
      const a = current(m);
      need(!m.result && isPending(a), 'There is no booking in progress to abandon.');
      need(a!.state === 'queued' || a!.error || a!.windowError || a!.rosterError, 'This booking is in order. Abandon one only when the zone keeps failing it.');
      Object.assign(a!, { state: 'cancelled', resolution: 'abandoned', windowJob: null, syncRequested: false, after: 0 });
      m.proposal = null;
      return;
    }
    case 'sync':
      operator();
      need(m && current(m), 'No fixture to synchronize.');
      current(m)!.syncRequested = true;
      current(m)!.rosterError = null;
      current(m)!.windowError = null;
      return;
    case 'correctMetric': {
      operator();
      need(m?.result, 'Record a match outcome before correcting statistics.');
      const pilot = resultRoster(s, m).find((row) => row.id === Number(p.player));
      need(pilot, 'Choose a pilot from this fixture’s roster.');
      const metric = name(p.metric);
      const value = Number(p.value);
      need(
        p.value !== null && String(p.value).trim() && Number.isFinite(value),
        'Enter a numeric metric value.',
      );
      const reason = name(p.reason);
      const change = { ...pilot, metric, value, reason, by: actor.id, at: new Date().toISOString() };
      (m.statRulings ??= []).push(change);
      m.result.players = withCorrections(m.result.players, [change]);
      return;
    }
    case 'rule': {
      operator();
      need(m, 'Match not found.');
      const winner = p.winner === 'draw' ? null : p.winner;
      need(winner === null || [m.home, m.away].includes(winner), 'Choose a squad in this match.');
      const reason = name(p.reason);
      const a = current(m);
      need(
        !a || ['complete', 'no_show', 'cancelled', 'refused'].includes(a.state),
        'Wait for the in-flight fixture to resolve.',
      );
      // The operator may also set the score, home first: for a forfeit, or to correct what was reported
      const score = ruledScore(p.homeScore, p.awayScore, winner === null ? null : winner === m.home ? 0 : 1);
      m.rulingRoster ??= resultRoster(s, m);
      // Whether the losing squad gave the match up. A draw has no loser, so it is never a forfeit.
      const forfeit = winner !== null && [true, 'true', 'on', 'yes'].includes(p.forfeit);
      m.rulings.push({ by: actor.id, at: new Date().toISOString(), winner, reason, ...(score && { score }), forfeit });
      m.result = {
        winner,
        players: m.result?.players ?? a?.mappedPlayers ?? [],
        source: 'operator',
        recordedAt: new Date().toISOString(),
        ...(score && { score }),
        forfeit,
      };
      m.proposal = null;
      advance(s);
      return;
    }
    default:
      need(false, 'Unknown league command.', 404);
  }
}
