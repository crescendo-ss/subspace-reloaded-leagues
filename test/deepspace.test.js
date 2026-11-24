import { matchScore } from '../src/match-score.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, season } from '../src/league.ts';
import { move, pickValidators, ineligible, blocked, remainingBudget, turnSquad } from '../src/draft.ts';
import { autoPickers } from '../src/autopick.ts';
import { matchupOdds, playoffPicture, seasonDrawRate } from '../src/projection.ts';
import { testStore } from './support/db.js';
import { checkRevision } from '../src/revisions.ts';

const awaitedBuilder = await import('../src/squad-builder.ts');
const op = { id: 99, name: 'Operator', operator: true };
const actor = (id) => ({ id, name: 'Pilot ' + id, operator: false });
function pool(count = 2) {
  const s = season({ name: 'Test', playoffSpots: 3 });
  s.formation.cap = { picks: 3, salary: 30 };
  for (let id = 1; id <= count + 8; id++) {
    apply(s, actor(id), 'enlist');
    apply(s, op, 'salary', { player: id, salary: id === count + 1 ? 16 : 8 });
    if (id <= count) apply(s, op, 'addSquad', { name: 'Squad ' + id, player: id });
  }
  return s;
}
test('regular draft shares salary rules with public choices and keeps immutable pick history', () => {
  const s = pool();
  apply(s, op, 'draft', { format: 'regular', order: 'linear' });
  for (const [c, p] of [
    [1, 3],
    [2, 4],
    [1, 5],
    [2, 6],
  ])
    apply(s, actor(c), 'pick', { player: p });
  const squad = s.squads[0].id;
  assert.match(ineligible(s, squad, 7), /30/);
  // The short form for a pilot's card comes with the sentence, so nothing reads the wording
  assert.equal(blocked(s, squad, 7).brief, 'Over cap');
  assert.equal(blocked(s, squad, 1).brief, 'Already selected');
  assert.throws(() => apply(s, actor(1), 'pick', { player: 7 }), /30/);
  assert.throws(() => apply(s, actor(4), 'pick', { player: 7 }), /captain/);
  assert.throws(() => apply(s, op, 'salary', { player: 7, salary: 1 }), /before the draft/);
  assert.deepEqual(
    s.picks.map((p) => p.player),
    [3, 4, 5, 6],
  );
  apply(s, actor(1), 'skipTurn');
  assert.equal(s.draft.next, s.squads[1].id);
  const validator = () => 'League extension veto';
  pickValidators.push(validator);
  try {
    assert.equal(ineligible(s, s.squads[1].id, 7), validator());
    assert.throws(() => apply(s, actor(2), 'pick', { player: 7 }), /extension veto/);
  } finally {
    pickValidators.pop();
  }
});
test('snake picks record their turn, and best-available auto-pick takes the highest salary the cap allows', () => {
  const s = pool(3);
  apply(s, op, 'draft', { format: 'regular', order: 'snake' });
  const ids = s.squads.map((t) => t.id);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((turn) => turnSquad(s, turn)), [...ids, ...ids.toReversed(), ids[0]]);
  const best = autoPickers.best.choose;
  // Pilot 4 carries the one 16 salary; everyone else is on 8.
  assert.equal(best(s, ids[0]), 4);
  for (let turn = 0; turn < 6; turn++) {
    const squad = s.draft.next;
    assert.equal(squad, turnSquad(s, turn));
    move(s, squad, 'pick', best(s, squad));
  }
  assert.deepEqual(s.picks.map((p) => p.turn), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(s.picks.map((p) => p.squad), [...ids, ...ids.toReversed()]);
  // Squad one holds 16 + 8, so a third 8 would break the 30 cap and there is nobody it may take.
  assert.equal(s.draft.next, ids[0]);
  assert.equal(best(s, ids[0]), undefined);
});
test('operators appoint, replace and remove captains from the pilots who enlisted', () => {
  const s = season({ name: 'Captains' });
  for (let id = 1; id <= 5; id++) apply(s, actor(id), 'enlist');
  // A pilot cannot make themselves a captain, and a captain must have enlisted
  assert.throws(() => apply(s, actor(1), 'addSquad', { player: 1 }), /operator/);
  assert.throws(() => apply(s, op, 'addSquad', { player: 42 }), /signed-up/);
  apply(s, op, 'addSquad', { player: 1 });
  apply(s, op, 'addSquad', { player: 2, name: 'Comets' });
  assert.deepEqual(s.squads.map((t) => [t.name, t.captain]), [['Pilot 1’s squad', 1], ['Comets', 2]]);
  assert.throws(() => apply(s, op, 'addSquad', { player: 1 }), /not on a squad/);
  const [first, second] = s.squads;
  // The captain may rename their own squad; another pilot may not
  apply(s, actor(1), 'renameSquad', { squad: first.id, name: 'Rockets' });
  assert.throws(() => apply(s, actor(3), 'renameSquad', { squad: first.id, name: 'Mine' }), /captain/);
  assert.throws(() => apply(s, op, 'renameSquad', { squad: first.id, name: 'comets' }), /already/);
  // A replacement can come from the squad or from pilots not yet on one; the former captain stays
  apply(s, op, 'reassignCaptain', { squad: first.id, player: 3 });
  assert.deepEqual([first.captain, first.roster], [3, [1, 3]]);
  assert.throws(() => apply(s, op, 'reassignCaptain', { squad: first.id, player: 2 }), /not on a squad/);
  apply(s, op, 'removeSquad', { squad: second.id });
  assert.deepEqual(s.squads.map((t) => t.name), ['Rockets']);
  // An operator can take a pilot out of the season, but not a captain; only an operator may
  assert.throws(() => apply(s, actor(4), 'unenlist', { player: 5 }), /operator/);
  assert.throws(() => apply(s, op, 'unenlist', { player: 3 }), /captain/);
  apply(s, op, 'salary', { player: 5, salary: 9 });
  apply(s, op, 'unenlist', { player: 5 });
  assert.equal(Object.hasOwn(s.players, 5), false);
  assert.equal(Object.hasOwn(s.salaries, 5), false);
  // A former captain who is still on the squad leaves it when removed from the season
  apply(s, op, 'unenlist', { player: 1 });
  assert.deepEqual(first.roster, [3]);
  apply(s, op, 'addSquad', { player: 2 });
  apply(s, op, 'schedule');
  assert.throws(() => apply(s, op, 'removeSquad', { squad: first.id }), /schedule/);
});
test('auction settles only after eligible challengers pass or run out of credits; mock has isolated state', async (t) => {
  const s = pool(3);
  apply(s, op, 'draft', { format: 'auction', budget: 20 });
  const mock = structuredClone(s);
  move(mock, s.squads[0].id, 'nominate', 4, 20);
  assert.equal(mock.picks[0].price, 20);
  assert.equal(s.picks.length, 0);
  apply(s, actor(1), 'nominate', { player: 4, amount: 3 });
  assert.throws(() => apply(s, actor(2), 'bid', { player: 4, amount: 21 }), /can spend/);
  assert.throws(() => apply(s, actor(2), 'bid', { player: 4, amount: 3 }), /Raise/);
  apply(s, actor(2), 'bid', { player: 4, amount: 5 });
  apply(s, actor(3), 'passBid', { player: 4 });
  assert.throws(() => apply(s, actor(3), 'bid', { player: 4, amount: 8 }), /passed/);
  assert.equal(s.picks.length, 0);
  apply(s, actor(1), 'passBid', { player: 4 });
  assert.deepEqual(s.picks[0], { player: 4, price: 5, salary: 16, squad: s.squads[1].id, at: 0 });
  assert.equal(remainingBudget(s, s.squads[1].id), 15);
  assert.equal(s.draft.next, s.squads[1].id);
  const db = await testStore(t);
  await db.insert(s);
  const seen = (await db.read(s.id)).revision;
  await db.edit(s.id, (live) => apply(live, actor(2), 'nominate', { player: 5, amount: 1 }));
  // A bid is checked by the draft against the bid as it stands, so a page one move behind is not turned
  // away for that alone. Ending the draft from a page that far behind still is.
  await db.edit(s.id, (live) => checkRevision(live, actor(3), seen, 'bid', { player: '5' }));
  await assert.rejects(
    db.edit(s.id, (live) => checkRevision(live, op, seen, 'endDraft', {})),
    (e) => e.status === 409,
  );
  // Each pilot's match statistics are also kept as rows, for totals across seasons
  assert.deepEqual(await db.pilotTotals(), []);
});
test('a pilot says at sign-up whether they would captain, and can change their mind while squads form', () => {
  const s = season({ name: 'Volunteers', minPerTeam: 1 });
  apply(s, actor(1), 'enlist', { captain: 'yes' });
  apply(s, actor(2), 'enlist', { captain: 'no' });
  // Signing up without saying, as an older form or the API might, leaves the pilot a pilot
  apply(s, actor(3), 'enlist');
  assert.deepEqual(s.volunteers, [1]);
  apply(s, actor(2), 'volunteer', { captain: 'yes' });
  apply(s, actor(1), 'volunteer', { captain: 'no' });
  assert.deepEqual(s.volunteers, [2]);
  // Saying it twice changes nothing, and only someone signed up can say it
  apply(s, actor(2), 'volunteer', { captain: 'yes' });
  assert.deepEqual(s.volunteers, [2]);
  assert.throws(() => apply(s, actor(9), 'volunteer', { captain: 'yes' }), /Sign up for the season first/);
  // A pilot taken out of the season is no longer on the list
  apply(s, actor(4), 'enlist', { captain: 'yes' });
  apply(s, op, 'unenlist', { player: 4 });
  assert.deepEqual(s.volunteers, [2]);
  // Being willing does not make a captain: the operator still appoints, and may appoint someone else
  apply(s, op, 'addSquad', { player: 2 });
  apply(s, op, 'addSquad', { player: 3 });
  assert.deepEqual(s.squads.map((t) => t.captain), [2, 3]);
  apply(s, op, 'schedule');
  assert.throws(() => apply(s, actor(1), 'volunteer', { captain: 'yes' }), /settled once the schedule is generated/);
});
test('a pilot can withdraw their own sign-up until they are on a squad', () => {
  const s = season({ name: 'Withdrawals', minPerTeam: 1 });
  for (const id of [1, 2, 3]) apply(s, actor(id), 'enlist', { captain: 'yes' });
  apply(s, actor(3), 'withdraw');
  assert.deepEqual([Object.keys(s.players).map(Number), s.volunteers, Object.keys(s.signups).map(Number)], [[1, 2], [1, 2], [1, 2]]);
  assert.throws(() => apply(s, actor(3), 'withdraw'), /have not signed up/);
  apply(s, op, 'addSquad', { player: 1 });
  assert.throws(() => apply(s, actor(1), 'withdraw'), /You are on a squad/);
  // They can sign up again afterwards
  apply(s, actor(3), 'enlist');
  assert.ok(Object.hasOwn(s.players, 3));
});

test('what is waiting on a captain and on an operator is found from the season', async () => {
  const { waitingOn } = await import('../src/waiting.ts');
  const s = season({ name: 'Waiting', minPerTeam: 1 });
  for (const id of [1, 2, 3, 4, 5]) apply(s, actor(id), 'enlist');
  for (const id of [1, 2, 3]) apply(s, op, 'addSquad', { player: id, name: 'Squad ' + id });
  apply(s, op, 'assign', { player: 4, squad: s.squads[0].id });
  apply(s, op, 'assign', { player: 5, squad: s.squads[1].id });
  apply(s, op, 'schedule');
  s.matches.forEach((m, i) => (m.number = i + 1));
  const [one, two] = s.squads;
  const captain = (id) => ({ id, operator: false });
  // A new schedule: each captain is told about one match that needs a time, not every match of the season
  assert.equal(waitingOn(s, captain(1)).length, 1);
  assert.match(waitingOn(s, captain(1))[0].text, /^Your match with Squad \d needs a time$/);
  // Nothing waits on a pilot, a visitor, or an operator while all is in order
  assert.deepEqual([waitingOn(s, captain(4)), waitingOn(s, null), waitingOn(s, { id: 9, operator: true })], [[], [], []]);
  // A proposal waits on the other captain, not on the one who made it
  const m = s.matches.find((x) => [x.home, x.away].includes(one.id) && [x.home, x.away].includes(two.id));
  apply(s, actor(1), 'propose', { match: m.id, opensAt: new Date(Date.now() + 3600000).toISOString(), minutes: 30 });
  assert.ok(waitingOn(s, captain(2)).some((w) => w.text === 'Squad 1 proposed a time for your match' && w.path === '/matches/' + m.number));
  assert.ok(!waitingOn(s, captain(1)).some((w) => /proposed/.test(w.text)));
  // A trade offered waits on the captain it was offered to
  apply(s, actor(1), 'offer', { give: 4, take: 5 });
  assert.ok(waitingOn(s, captain(2)).some((w) => w.text === 'Squad 1 offered you a trade' && w.path === '/manage'));
  // A match the zone could not decide waits on the operator
  m.proposal = null;
  m.attempts.push({ externalId: 'x', state: 'complete', needsReview: true, booking: { externalId: 'x', opensAt: '', startsBy: '', teams: [] }, desiredTeams: [] });
  assert.deepEqual(waitingOn(s, { id: 9, operator: true }).map((w) => [w.text, w.path]), [['Squad 1 v Squad 2 needs a ruling', '/matches/' + m.number]].map(([text, path]) => [m.home === one.id ? text : 'Squad 2 v Squad 1 needs a ruling', path]));
  // A closed season asks nothing of anyone
  s.closed = true;
  assert.deepEqual(waitingOn(s, captain(2)), []);
});

test('a season names how its squads are formed, and its draft runs under its own rules', () => {
  const s = season({ name: 'Formation', method: 'auction', minPerTeam: 2 });
  assert.deepEqual(s.formation, { method: 'auction', salaries: true, cap: null, credits: 100 });
  assert.equal(season({ name: 'Default' }).formation.method, 'snake');
  assert.equal(season({ name: 'Unknown', method: 'lottery' }).formation.method, 'snake');
  assert.throws(() => apply(s, actor(1), 'setFormation', { method: 'snake' }), /operator/);
  assert.throws(() => apply(s, op, 'setFormation', { method: 'lottery' }), /Choose how squads are formed/);
  assert.throws(() => apply(s, op, 'setFormation', { capPicks: '3', capSalary: '' }), /both parts/);
  assert.throws(() => apply(s, op, 'setFormation', { squadSize: '1' }), /Squad size must be a whole number from 2/);
  apply(s, op, 'setFormation', { method: 'captains', capPicks: '2', capSalary: '10', squadSize: '3', clock: '30', credits: '50' });
  assert.deepEqual(s.formation, { method: 'captains', salaries: true, cap: { picks: 2, salary: 10 }, credits: 50, squadSize: 3, clock: 30 });
  // An empty field clears an option; one that is not sent is left alone
  apply(s, op, 'setFormation', { clock: '', capPicks: '', capSalary: '' });
  assert.deepEqual([s.formation.clock, s.formation.cap, s.formation.squadSize], [undefined, null, 3]);
  apply(s, op, 'setFormation', { capPicks: '1', capSalary: '7' });

  for (let id = 1; id <= 8; id++) apply(s, actor(id), 'enlist');
  for (let id = 1; id <= 8; id++) apply(s, op, 'salary', { player: id, salary: id });
  apply(s, op, 'addSquad', { player: 1, name: 'One' });
  apply(s, op, 'addSquad', { player: 2, name: 'Two' });
  // The order squads pick in can be set or drawn until the draft opens
  apply(s, op, 'moveSquad', { squad: s.squads[1].id, to: 1 });
  assert.deepEqual(s.squads.map((t) => t.name), ['Two', 'One']);
  apply(s, op, 'moveSquad', { squad: s.squads[1].id, to: 1 });
  apply(s, op, 'drawOrder');
  assert.deepEqual(s.squads.map((t) => t.name).sort(), ['One', 'Two']);
  s.squads.sort((a, b) => a.captain - b.captain);
  const [one, two] = s.squads.map((t) => t.id);

  // The draft that opens is the method's: the same order every round
  apply(s, op, 'draft');
  assert.deepEqual([s.draft.format, s.draft.order, s.draft.next], ['regular', 'linear', one]);
  assert.throws(() => apply(s, op, 'setFormation', { clock: '20' }), /Finish the live draft first/);
  // The season's own cap: a first pick of at most seven salary
  assert.throws(() => apply(s, actor(1), 'pick', { player: 8 }), /first pick may have at most 7 salary/);
  apply(s, actor(1), 'pick', { player: 5 });
  // An operator acts for a squad whose captain is away, and a move says which turn it is for
  assert.throws(() => apply(s, actor(3), 'pick', { player: 6, squad: two }), /Only a captain can draft/);
  assert.throws(() => apply(s, op, 'pick', { player: 6, squad: two, turn: 0 }), /moved on/);
  apply(s, op, 'pick', { player: 6, squad: two, turn: 1 });
  assert.deepEqual(s.picks.map((p) => [p.squad, p.player, p.turn]), [[one, 5, 0], [two, 6, 1]]);
  // Taking back the last pick returns the pilot and the turn
  apply(s, op, 'undoPick');
  assert.deepEqual([s.picks.length, s.squads[1].roster, s.draft.pick, s.draft.next], [1, [2], 1, two]);
  apply(s, actor(2), 'pick', { player: 4 });
  // Squads fill to three: once both are full the draft is over, with pilots left in the pool
  apply(s, actor(1), 'pick', { player: 3 });
  assert.throws(() => apply(s, actor(1), 'pick', { player: 7 }), /Wait for your squad/);
  apply(s, actor(2), 'pick', { player: 6 });
  assert.deepEqual([s.draft, s.draftFinished, s.squads.map((t) => t.roster.length)], [null, true, [3, 3]]);
  assert.throws(() => apply(s, op, 'draft'), /Reopen it/);
  // Undoing after the end reopens the draft at that pick; finishing by hand can be reopened too
  apply(s, op, 'undoPick');
  assert.deepEqual([s.draftFinished, s.draft.next, s.draft.pick], [false, two, 3]);
  apply(s, op, 'endDraft');
  assert.deepEqual([s.draft, s.draftFinished], [null, true]);
  apply(s, op, 'reopenDraft');
  assert.deepEqual([s.draft.next, s.draft.pick], [two, 3]);
  // With a clock, time can only be called once it has run out; the squad is then picked for
  assert.throws(() => apply(s, actor(1), 'clockOut'), /no clock/);
  s.formation.clock = 30;
  assert.throws(() => apply(s, actor(1), 'clockOut'), /still running/);
  assert.throws(() => apply(s, actor(7), 'clockOut'), /captain or an operator/);
  s.draft.since = Date.now() - 31000;
  apply(s, actor(1), 'clockOut');
  assert.deepEqual([s.draft, s.squads[1].roster], [null, [2, 4, 8]]);
});

test('an auction holds back a credit for each place still to fill, and a clock sells to the standing bid', () => {
  const s = season({ name: 'Auction', method: 'auction', minPerTeam: 2 });
  apply(s, op, 'setFormation', { credits: '10', squadSize: '3', salaries: 'no' });
  for (let id = 1; id <= 7; id++) apply(s, actor(id), 'enlist');
  apply(s, op, 'addSquad', { player: 1 });
  apply(s, op, 'addSquad', { player: 2 });
  // Without salaries a draft needs none
  apply(s, op, 'draft');
  assert.equal(s.draft.format, 'auction');
  // Two places to fill: nine of the ten credits may go on the first
  assert.throws(() => apply(s, actor(1), 'nominate', { player: 3, amount: 10 }), /can spend/);
  apply(s, actor(1), 'nominate', { player: 3, amount: 4 });
  apply(s, actor(2), 'bid', { player: 3, amount: 5 });
  assert.throws(() => apply(s, actor(1), 'clockOut'), /no clock/);
  s.formation.clock = 20;
  s.draft.since = Date.now() - 21000;
  apply(s, op, 'clockOut');
  assert.deepEqual(s.picks.map((p) => [p.player, p.price, p.salary]), [[3, 5, 0]]);
  // The pick can be taken back, which returns to the turn the pilot was nominated on
  apply(s, op, 'undoPick');
  assert.deepEqual([s.picks.length, s.draft.pick, s.draft.lot], [0, 0, null]);
});

test('squads are dealt at random or by salary, entered by hand, and cleared to start again', () => {
  const s = season({ name: 'Dealt', method: 'balanced', minPerTeam: 2 });
  for (let id = 1; id <= 9; id++) apply(s, actor(id), 'enlist', { captain: id === 8 || id === 9 ? 'yes' : 'no' });
  for (let id = 1; id <= 9; id++) apply(s, op, 'salary', { player: id, salary: id });
  assert.throws(() => apply(s, op, 'draft'), /without a draft/);
  assert.throws(() => apply(s, op, 'form'), /how many squads/);
  assert.throws(() => apply(s, op, 'form', { squads: '1' }), /2–64 squads/);
  apply(s, op, 'form', { squads: '3' });
  // Captains come from the pilots who were willing, then from the rest
  assert.deepEqual(s.squads.map((t) => t.captain).slice(0, 2), [8, 9]);
  assert.deepEqual(s.squads.map((t) => [t.name, t.roster.length]), [['Squad 1', 3], ['Squad 2', 3], ['Squad 3', 3]]);
  const totals = s.squads.map((t) => t.roster.reduce((sum, id) => sum + id, 0));
  assert.ok(Math.max(...totals) - Math.min(...totals) <= 2, 'salary totals are close: ' + totals);
  assert.throws(() => apply(s, op, 'form', { squads: '2' }), /already 3 squads/);
  apply(s, op, 'clearSquads');
  assert.deepEqual(s.squads, []);
  // At random: every pilot placed once, squads even
  apply(s, op, 'setFormation', { method: 'random' });
  apply(s, op, 'form', { squads: '4' });
  assert.deepEqual([s.squads.length, new Set(s.squads.flatMap((t) => t.roster)).size, s.squads.map((t) => t.roster.length).sort()], [4, 9, [2, 2, 2, 3]]);
  assert.ok(s.squads.every((t) => t.roster.includes(t.captain)));

  // By hand: one squad to a line, captain first. A squad that keeps its name keeps its identity.
  apply(s, op, 'setFormation', { method: 'manual' });
  const kept = s.squads[0].id;
  apply(s, op, 'setSquads', { data: 'squad 1: Pilot 3, pilot 1, #2\n\nNorth: Pilot 4,Pilot 5' });
  assert.deepEqual(s.squads.map((t) => [t.name, t.captain, t.roster]), [['squad 1', 3, [3, 1, 2]], ['North', 4, [4, 5]]]);
  assert.equal(s.squads[0].id, kept);
  for (const [data, message] of [
    ['', /at least one squad/],
    ['No colon here', /Line 1: start with the squad’s name and a colon/],
    ['A: Pilot 1\nA: Pilot 2', /Line 2: two squads are called A/],
    ['A: Pilot 1\nB: Pilot 1', /Line 2: Pilot 1 is already on A/],
    ['A: Nobody', /Line 1: Nobody has not signed up/],
    ['A:', /Line 1: A has no pilots/],
  ])
    assert.throws(() => apply(s, op, 'setSquads', { data }), message);
  // A refused edit leaves the squads as they were
  assert.equal(s.squads.length, 2);
  // What is written out reads back the same
  const { squadsText } = awaitedBuilder;
  assert.equal(squadsText(s), 'squad 1: Pilot 3, Pilot 1, Pilot 2\nNorth: Pilot 4, Pilot 5');
  apply(s, op, 'setSquads', { data: squadsText(s) });
  assert.deepEqual(s.squads.map((t) => t.roster), [[3, 1, 2], [4, 5]]);
  // Once the schedule exists the squads are no longer rewritten
  apply(s, op, 'schedule');
  assert.throws(() => apply(s, op, 'setSquads', { data: 'A: Pilot 1' }), /closes when the schedule/);
  assert.throws(() => apply(s, op, 'clearSquads'), /closes when the schedule/);
  assert.throws(() => apply(s, op, 'setFormation', { method: 'snake' }), /settled/);
});

test('an operator prunes the pool in one step, and no one goes unless everyone ticked can', () => {
  const s = season({ name: 'Pruning', minPerTeam: 1 });
  for (const id of [1, 2, 3, 4, 5, 6]) apply(s, actor(id), 'enlist', { captain: id === 4 ? 'yes' : 'no' });
  apply(s, op, 'addSquad', { player: 1, name: 'Rockets' });
  apply(s, op, 'assign', { player: 2, squad: s.squads[0].id });
  apply(s, op, 'salary', { player: 4, salary: 7 });
  const tick = (...ids) => Object.fromEntries(ids.map((id) => ['pilot-' + id, 'on']));
  assert.throws(() => apply(s, actor(1), 'prune', tick(3)), /operator/);
  assert.throws(() => apply(s, op, 'prune', {}), /Tick at least one/);
  // A captain among those ticked stops the whole removal, and the refusal names them
  assert.throws(() => apply(s, op, 'prune', tick(3, 1, 4)), /Pilot 1 is a captain/);
  assert.throws(() => apply(s, op, 'prune', tick(3, 77)), /Pilot 77 has not signed up/);
  assert.deepEqual(Object.keys(s.players).map(Number), [1, 2, 3, 4, 5, 6]);
  // Free pilots and squad members go together, with their salaries and their answers about captaining
  apply(s, op, 'prune', tick(2, 3, 4));
  assert.deepEqual([Object.keys(s.players).map(Number), s.squads[0].roster, s.volunteers, s.salaries[4]], [[1, 5, 6], [1], [], undefined]);
  // The pool is locked while a draft runs
  apply(s, op, 'addSquad', { player: 5 });
  for (const id of [1, 5, 6]) apply(s, op, 'salary', { player: id, salary: 1 });
  apply(s, op, 'draft');
  assert.throws(() => apply(s, op, 'prune', tick(6)), /locked during the draft/);
});

test('operators write the league’s own rules, and only operators', () => {
  const s = season({ name: 'Rules' });
  const body = 'Players must have played 20 ranked 4v4 games in the month before the draft.';
  assert.throws(() => apply(s, actor(1), 'saveRule', { title: 'Eligibility', body }), /operator/);
  assert.throws(() => apply(s, op, 'saveRule', { title: '', body }), /name of 1–80/);
  assert.throws(() => apply(s, op, 'saveRule', { title: 'Eligibility', body: '  ' }), /Write the rule/);
  assert.throws(() => apply(s, op, 'saveRule', { title: 'Eligibility', body: 'x'.repeat(4001) }), /4,000 characters/);
  apply(s, op, 'saveRule', { title: ' Eligibility ', body: body + '\r\n\r\n- one\r\n' });
  apply(s, op, 'saveRule', { title: 'Conduct', body: 'Be decent.' });
  assert.deepEqual(s.rules.map((rule) => [rule.title, rule.body]), [['Eligibility', body + '\n\n- one'], ['Conduct', 'Be decent.']]);
  assert.throws(() => apply(s, op, 'saveRule', { title: 'eligibility', body }), /already has this title/);
  // Saving with a rule's id replaces it in place; its own title is not a clash
  const [first, second] = s.rules.map((rule) => rule.id);
  apply(s, op, 'saveRule', { rule: first, title: 'Eligibility', body: 'Twenty games.' });
  assert.throws(() => apply(s, op, 'saveRule', { rule: first, title: 'Conduct', body: 'x' }), /already has this title/);
  assert.deepEqual(s.rules.map((rule) => [rule.id, rule.body]), [[first, 'Twenty games.'], [second, 'Be decent.']]);
  assert.throws(() => apply(s, actor(1), 'removeRule', { rule: first }), /operator/);
  apply(s, op, 'removeRule', { rule: first });
  assert.throws(() => apply(s, op, 'saveRule', { rule: first, title: 'Eligibility', body }), /has been removed/);
  assert.throws(() => apply(s, op, 'removeRule', { rule: first }), /has been removed/);
  assert.deepEqual(s.rules.map((rule) => rule.title), ['Conduct']);
  for (let i = 1; i < 20; i++) apply(s, op, 'saveRule', { title: 'Rule ' + i, body: 'x' });
  assert.throws(() => apply(s, op, 'saveRule', { title: 'One too many', body: 'x' }), /up to 20 rules/);
});

test('an operator sets every pilot’s salary in one step, until the draft starts', () => {
  const s = season({ name: 'Salaries' });
  for (const id of [1, 2, 3]) apply(s, actor(id), 'enlist');
  apply(s, op, 'salaries', { 'pilot-1': '12', 'pilot-2': '', 'pilot-3': '0', revision: '1' });
  // An empty field leaves a pilot as they were, and zero is a salary
  assert.deepEqual([s.salaries[1], s.salaries[2], s.salaries[3]], [12, undefined, 0]);
  // One bad entry and nothing in the form is applied
  assert.throws(() => apply(s, op, 'salaries', { 'pilot-1': '5', 'pilot-2': '-3' }), /Pilot 2 needs a nonnegative whole-number salary/);
  assert.throws(() => apply(s, op, 'salaries', { 'pilot-1': '5', 'pilot-9': '4' }), /Pilot 9 has not signed up/);
  assert.equal(s.salaries[1], 12);
  assert.throws(() => apply(s, actor(1), 'salaries', { 'pilot-1': '99' }), /operator/);
  apply(s, op, 'addSquad', { player: 1 });
  apply(s, op, 'addSquad', { player: 2 });
  apply(s, op, 'salaries', { 'pilot-2': '7' });
  apply(s, op, 'draft', { format: 'regular', order: 'snake' });
  assert.throws(() => apply(s, op, 'salaries', { 'pilot-3': '9' }), /until the draft starts/);
});
test('historical import preserves identities, salaries and supplied pick order atomically', () => {
  const s = season({ name: 'Premiere Pro Season One' });
  const data = {
    players: [1, 2, 3, 4].map((id) => ({ ...actor(id), salary: id })),
    squads: [
      { name: 'North', captain: 1, roster: [1, 3] },
      { name: 'South', captain: 2, roster: [2, 4] },
    ],
    picks: [
      { player: 4, price: 5 },
      { player: 3, price: 2 },
    ],
  };
  const run = (d) => apply(s, op, 'importRosters', { data: JSON.stringify(d) });
  assert.throws(() => run({ ...data, picks: [{ player: 4 }, { player: 4 }] }), /distinct/);
  assert.equal(s.squads.length, 0);
  assert.throws(() => apply(s, actor(1), 'importRosters', { data: JSON.stringify(data) }), /operator/);
  run(data);
  assert.equal(s.squads[0].captain, 1);
  assert.equal(s.salaries[3], 3);
  assert.deepEqual(
    s.picks.map((p) => p.player),
    [4, 3],
  );
  assert.equal(s.draftFinished, true);
  assert.throws(() => run(data), /Import before/);
  apply(s, op, 'schedule');
  assert.equal(s.matches.length, 1);
});
test('projection, cutoff, byes, and locked official seeds agree', () => {
  const s = pool(5);
  apply(s, op, 'schedule');
  const initial = playoffPicture(s);
  assert.equal(initial.opening.length, 2);
  assert.equal(initial.opening.flat().filter((x) => x === null).length, 1);
  assert.deepEqual(initial.chances, playoffPicture(s).chances);
  assert.ok(Math.abs([...initial.chances.values()].reduce((a, b) => a + b) - 3) < 1e-9);
  for (const m of s.matches) apply(s, op, 'rule', { match: m.id, winner: m.home, reason: 'test' });
  const final = playoffPicture(s);
  apply(s, op, 'playoffs');
  assert.deepEqual(playoffPicture(s).opening, final.opening);
  assert.deepEqual(playoffPicture(s).chances, final.chances);
  assert.equal(final.table.filter((t) => final.chances.get(t.id) === 1).length, 3);
  assert.throws(() => apply(s, op, 'playoffSpots', { spots: 5 }), /before seeding/);
});

test('match forecast includes draws and reverses with the matchup', () => {
  const empty = { played: 0, wins: 0, draws: 0 };
  assert.deepEqual(matchupOdds(empty, empty, seasonDrawRate([])), { home: .45, draw: .1, away: .45 });
  const a = { played: 4, wins: 3, draws: 1 }, b = { played: 4, wins: 0, draws: 1 };
  const draw = seasonDrawRate([a, b]);
  const odds = matchupOdds(a, b, draw);
  assert.equal(draw, 2 / 14);
  assert.ok(odds.home > odds.away);
  assert.equal(odds.away, matchupOdds(b, a, draw).home);
  assert.ok(Math.abs(odds.home + odds.draw + odds.away - 1) < 1e-12);
});

test('4v4 scores use opposing lives lost, respect time limits and preserve missing scores', () => {
  const report = { outcome: 'elimination', rankedTeams: [['A'], ['B']], perPlayer: { A: { deaths: 8 }, B: { deaths: 12 } } };
  const m = { home: 'a', away: 'b', attempts: [{ booking: {}, rawResult: report }], result: {
    source: 'reloaded', winner: 'a', players: [
      { squad: 'a', metrics: { kills: 11, deaths: 8 } }, { squad: 'b', metrics: { kills: 7, deaths: 12 } },
    ],
  } };
  const score = () => matchScore(m, 'svs-league-4v4');
  assert.deepEqual(score(), [12, 8]);
  m.result.players[1].metrics.deaths = 9;
  report.outcome = 'time_limit';
  assert.deepEqual(score(), [9, 8]);
  m.result.winner = null;
  m.result.players[1].metrics.deaths = 8;
  assert.deepEqual(score(), [8, 8]);
  assert.equal(matchScore(m, 'other-mode'), null);
  delete m.result.players[0].metrics.deaths;
  assert.equal(score(), null);
  m.result = null;
  assert.equal(score(), null);
});
