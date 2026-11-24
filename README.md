# Subspace Reloaded League

An open-source league coordinator for competitive leagues on Subspace Reloaded. One site hosts several leagues. Each league runs one season at a time and keeps its finished seasons as history. The front page lists the leagues, a league's home shows its season in progress, and each season has its own draft room, schedule, squads, standings and playoff picture. A new installation starts with no leagues; a site admin creates the first one.

The app uses Next.js, TypeScript, Postgres and a dedicated fixture worker. Node.js 24 or newer is required. It is MIT licensed.

## Run locally

```sh
npm ci
npm run db      # starts Postgres in Docker, on port 5435
npm run demo
```

Open **http://127.0.0.1:3000**. Demo mode needs Docker for its Postgres, and keeps its example leagues in a schema of their own (`demo`). To start the demo data again, drop that schema (`npm run db:reset-demo`). Sign in as **Commissioner** for operator tools, choose a captain to manage a squad, or open **Mock draft** as a visitor. Live mode starts with no leagues: a site admin signs in and creates the first league and its season. A season whose draft was held elsewhere can import its rosters.

## Load the completed draft

Open the season's **Draft room → Draft administration** as an operator. Paste a JSON export using the following shape. The example uses fictional pilots and IDs. Use the actual numeric Reloaded profile IDs so sign-in, captain permissions, fixture bookings and results match the right people.

```json
{
  "players": [
    {"id": 101, "name": "North captain", "salary": 12},
    {"id": 202, "name": "South captain", "salary": 11},
    {"id": 303, "name": "Example pilot", "salary": 8}
  ],
  "squads": [
    {"name": "North", "captain": 101, "roster": [101, 303]},
    {"name": "South", "captain": 202, "roster": [202]}
  ],
  "picks": [{"player": 303, "price": 6}]
}
```

Import into a season before creating squads or matches. Include each captain in their own roster. Extra pilots may be left unassigned. The optional picks array records the original selection order and an optional auction price. Omit it if only the final rosters are known. The import validates all entries in a single transaction. After import, generate the round robin in **Manage season**. Both squads need at least four rostered pilots to book a standard 4v4 fixture.

## Import a season played elsewhere

A season that was already played can be loaded whole: squads and draft, every regular-season result with its scoreboard, and the playoffs as they were played. Create an empty season, then open **Manage season → Import a season played elsewhere** as an operator and choose one JSON file. Nothing is changed unless the whole file is accepted, and a mistake is reported with the match it is in.

Check a file first without saving anything:

```sh
node scripts/check-import.ts season.json
```

It prints the standings, bracket and statistics the site would show.

```json
{
  "players": [{ "id": 221, "name": "Green", "salary": 12 }],
  "squads": [{ "name": "North", "captain": 221, "roster": [221, 305] }],
  "picks": [{ "player": 305, "price": 4 }],
  "matches": [
    {
      "round": 1, "home": "North", "away": "South", "winner": "North", "score": [12, 7],
      "startedAt": "2026-09-13T20:09:00Z", "endedAt": "2026-09-13T20:41:00Z",
      "matchId": "svs-league-4v4-8",
      "matchUrl": "https://subspacereloaded.com/matches/svs-league-4v4-8",
      "replayUrl": "https://replays.subspacereloaded.com/replay/match/svs-league-4v4-8",
      "players": [{ "id": 221, "squad": "North", "metrics": { "kills": 4, "deaths": 2 } }]
    },
    { "round": 1, "home": "East", "away": "West", "winner": "East", "score": [12, 0], "reason": "West forfeited" }
  ],
  "playoffs": {
    "bestOf": 3,
    "firstRound": [["North", null], ["South", "East"]],
    "games": [{ "home": "South", "away": "East", "winner": "South", "score": [12, 9] }]
  }
}
```

- **Players, squads and picks** are the same as in the draft import above. Pilots are Reloaded profile IDs.
- **Matches** name their squads. `winner` is a squad's name or `"draw"`; a match without one stays on the schedule as unplayed. `score` is home first and optional: without it the score is worked out from the scoreboard, as for a match played here.
- **A result with a `reason`** is recorded as an operator's ruling, which is how a forfeit or a disqualification goes in. It needs no scoreboard. Add `"forfeit": true` to say the losing squad forfeited, or `false` for a win awarded for another reason; left out, a ruling with a winner and no scoreboard counts as a forfeit.
- **Playoffs** are single elimination. `firstRound` lists the opening pairings from the top of the bracket down, with `null` for a bye, and the number of pairings is a power of two. `games` are in the order played; each is matched to its series by its two squads, either way round.

### Fuller statistics for matches already played

A season imported from another site usually carries only the few figures that site showed. **Manage season → Update match statistics from a file** replaces the pilots' numbers on matches that have already been played, leaving results, scores and line-ups alone. A match is named by the zone's match ID, or by its number on this site, and every pilot listed must already be on that match's scoreboard. Corrections an operator has made stay in force over the new figures.

```json
{ "matches": [{ "matchId": "svs-league-4v4-61", "players": [{ "id": 221, "metrics": { "kills": 4, "deaths": 2, "gunHits": 61, "firesBullet": 480 } }] }] }
```

## Form the squads

A season names how its squads are formed when it is started, and its operator can change that under **Manage season → Squad formation** until a draft has picks or the schedule exists. A league's next season starts with the same method and rules. The methods are in [src/formation.ts](src/formation.ts):

| Method | What happens |
| --- | --- |
| Snake draft | Captains pick in turn in the draft room; the order reverses each round |
| Captains' draft | Captains pick in turn, in the same order every round |
| Auction draft | Captains bid credits for each pilot nominated |
| Random teams | The site makes the squads and deals the pilots at random |
| Balanced teams | The site makes the squads and deals the pilots by salary, then swaps pilots while that brings the squads' totals closer |
| Preset squads | The operator writes the squads out, one to a line, and saves them in one step |

**Random and balanced teams.** Give the number of squads and press **Form squads**. Captains are taken from the pilots who said they were willing, then from the rest; a captain appointed by hand first is kept. **Clear the squads** starts again.

**Preset squads.** One squad to a line: its name, a colon, then its pilots separated by commas, the captain first. A pilot is named as they appear on the site, or by profile ID with a `#` in front. Nothing changes unless every line is accepted, and a squad that keeps its name keeps its address.

```text
Night Shift: Vesper, Drift, Mercury
Void Runners: Sol, Helix, #131
```

**Live drafts.**

1. Appoint a captain for each squad in **Manage season**. Squads pick in the order shown under **Draft order**, which can be drawn at random or set by hand until the draft opens.
2. Set the draft's rules under **Squad formation**. All are optional:
   - **Salaries.** With salaries on, every pilot needs one before the draft opens. With them off, none are needed and no salary rule applies.
   - **Pilots per squad.** A squad that reaches it takes no further part, and the draft ends when every squad is full. In an auction a squad must keep one credit for each further place it has to fill.
   - **Opening cap.** A squad's first so-many picks may total at most so much salary. The founding captain is not counted.
   - **Credits per squad**, for an auction. The default is 100.
   - **Clock, in seconds.** When it runs out, a squad that has not picked is given the highest-salary pilot it may take, or skipped if there is none; in an auction the standing bid wins, and a squad that has not nominated is skipped. To pause a draft that has a clock, finish it and reopen it when everyone is back: the clock starts afresh. The clock itself can be changed while the draft is finished.
3. Open the draft from the **Draft room**. Captains sign in with their Reloaded accounts. The room shows their eligible choices and explains blocked picks, and refreshes within a second or two of anyone's move. In an auction the nominator opens at one or more credits, other captains raise or pass, and passing lasts for that pilot. The high bidder wins as soon as every remaining eligible challenger passes or cannot afford a raise.
4. An operator can act for any squad from the same room, so an absent captain does not stop the draft, and can **undo the last pick**.
5. The draft closes when the pool is empty or every squad is full. Captains may skip a turn; consecutive skips through a full order (two rounds for a snake) close it. An operator can also finish it between selections, and **reopen** it at the turn it had reached until the schedule is generated. Pick order, salaries and winning prices are recorded with the rosters.

To add a rule of your own, add a function to `pickValidators` in `src/draft.ts`. It receives the current pool, squad ID and candidate profile ID. Return a reason to block selection, or `undefined` to allow it. Keep validators deterministic and browser-safe: the live server and the mock draft run the same code. To add a pick order, add an entry to `orders` in the same file: a function from the turn number to the seat that acts.

## Playoff picture and odds

The default field is the top four squads. Operators can set the cutoff when creating a season or change it in **Manage season** before playoff seeding. The Playoffs page previews the opening pairings and byes using the official bracket generator. Standings use three points for a win and one for a draw, breaking ties by wins and then squad name.

Qualification odds use 2,000 reproducible Monte Carlo finishes of the remaining regular-season games. The model smooths each squad’s win rate toward even odds and uses the league’s draw frequency with a small prior. Completed outcomes stay fixed. These are estimates of qualification, and percentages may be rounded. When the actual bracket is seeded, its original seeds are frozen. An interactive outcome simulator can be added independently.

## Deploy on Railway

Create a private Railway project with two services: this app and a Railway Postgres database. Connect the service to the league's GitHub repository and production branch. The `npm start` launcher runs the web server and fixture worker together. The tables are created on first start, and Railway's Postgres backups cover the data. [Railway services](https://docs.railway.com/services) · [Volumes](https://docs.railway.com/volumes)

| Service setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Start command | `npm start` |
| Replicas | One |
| Database | Add a Postgres service to the project and set the app's `DATABASE_URL` to a reference to it, such as `${{Postgres.DATABASE_URL}}` |
| Service variables | `HOST=0.0.0.0` |
| Public origin | Set `PUBLIC_ORIGIN` to the exact HTTPS origin used by players and registered with Reloaded. Omit the trailing slash. |

Use Railway's assigned `PORT`. Keep the service running so the worker can deliver bookings between web requests. Set the Reloaded credentials, callback name, and operator profile IDs in the service's Variables tab. Seal the OAuth client secret, fixture API key and webhook signing secret after entering them. Register the `/auth/callback` and `/webhooks/reloaded` URLs under the chosen public origin. [Service variables](https://docs.railway.com/variables)

The public repository only needs the application, lockfile, and placeholder variable names. Manage installation-specific settings on the Railway dashboard. If you want versioned infrastructure, keep `.railway/railway.ts` in a separate private operations repository, link that checkout to the Railway environment, and review `railway config plan` before applying it. The service can still build from the public app repository. [Railway Infrastructure as Code](https://docs.railway.com/infrastructure-as-code)

## Connect a real zone client

1. Ask the Reloaded operator for an OAuth client ID and secret, a Fixtures API key, the allowed game types and quorum, a registered callback name, and its webhook signing secret. Supply your exact OAuth redirect URL, e.g. `https://league.example.org/auth/callback`, and webhook URL, e.g. `https://league.example.org/webhooks/reloaded`. [Registration and OAuth](https://docs.subspacereloaded.com/auth) · [Fixtures API](https://docs.subspacereloaded.com/api)
2. Copy `.env.example` to `.env`. Set `PUBLIC_ORIGIN` to the public HTTPS origin, and fill the `RELOADED_*` values. Put the comma-separated numeric Reloaded profile IDs of your site admins in `OPERATOR_PROFILE_IDS`. Set `SITE_NAME` for your installation. `SITE_TAGLINE` and `SITE_DESCRIPTION` set the few words under the logo and the sentence search engines show; `PUBLIC_ORIGIN` is also the address used in the sitemap and in each page's canonical link.
3. Put an HTTPS reverse proxy in front of the Node process, forwarding to `HOST` and `PORT` (defaults: `127.0.0.1:3000`). The public origin must serve both the UI and the two registered endpoints. The proxy must preserve the webhook request bytes and signature headers.
4. Run `npm ci` and `npm run build`, then run `npm start` under a process supervisor with `DATABASE_URL` pointing at a Postgres database. The launcher starts the production Next.js server and its worker together. Forward the public host to Next.js for form submissions. Back up the database with `pg_dump` or your provider's backups.
5. Sign in as a site admin and choose **Create a league** on the front page. Name its operators under **League settings**, then create its first season. Players sign in with **identity** and **fixtures** consent, then enlist. Select the game type and minimum players per squad permitted by your zone client.

The server exchanges the single-use OAuth code for a stable numeric profile ID and display name. Display names refresh at sign-in. Browser sessions are opaque HTTP-only cookies. Live mode requires all integration credentials. It has no demo identity switch.

## Competition rules

### Data

Everything is stored in Postgres. A season is kept whole as one JSON document, because the league's rules work on a season as a unit, with its league, address and revision beside it. Two things are also kept as rows so they can be read without opening every season: which season owns each fixture attempt, and each pilot's statistics for each match (`match_stats`), which is what totals across seasons are read from. Set `DATABASE_SCHEMA` to keep an installation in a schema other than `public`.

### Leagues and seasons

- **Leagues.** Site admins create leagues from the front page and name each league's operators by Reloaded profile ID under **League settings**. A league operator manages only that league's seasons. Site admins can manage every league. Renaming a league keeps its address.
- **Deleting a league.** A league's operators and the site admins can delete it under **League settings** by typing its name. Its seasons, squads, results and statistics go with it and cannot be recovered. A league cannot be deleted while one of its matches is booked or being played.
- **Captains and pilots.** On a season's **Manage** page, operators appoint captains from the pilots who have enlisted, which creates each captain's squad. They can change a captain, rename or remove a squad before the schedule exists, set draft salaries until the draft starts, and remove a pilot who will not play the season. Enlistment is per season.
- **One season at a time.** A league's next season can be created once the current one has a champion, or after an operator closes it from **Manage season**. A closed season is read-only history. It can be reopened until the league starts another.

Pages use permanent name-based URLs of the form `/league/season/page`, such as `/premiere-pro/premiere-pro-season-one/squads/night-shift`. `/premiere-pro` is the league's home and `/premiere-pro/seasons` lists its seasons. A season's address is unique within its league, and duplicate names get suffixes such as `-2`. A league cannot be named `account`, `api`, `auth`, `leagues`, `seasons` or `webhooks`. Matches are numbered within each season, starting at `/premiere-pro/premiere-pro-season-one/matches/1`. A retry keeps the same match URL, and playoff corrections never reassign a retired number. Earlier `/seasons/...` addresses, including ID-based bookmarks and schedule filters, redirect to the corresponding page in one hop. API commands and Reloaded callbacks continue to use the original IDs.

- **Formation.** Each season has its own pool of enlisted pilots and names how its squads are formed: a snake, captains' or auction draft, random or salary-balanced teams, or squads entered by hand (see **Form the squads** above). Whatever the method, an operator can still place a pilot by hand. Captains may release non-captains to free agency. Trades require the other captain’s consent and, by default, operator approval. A season can waive the operator step.
- **Captain handoff.** From **Manage season → Manage squad captains**, open the squad and assign another rostered pilot. The former captain stays on the roster. The new captain can draft, negotiate matches, approve retries, and manage trades immediately. Pending time proposals from the former captain are withdrawn. Trades involving the promoted pilot are closed because captains cannot be traded. The worker sends the new captain to queued, booked and open fixtures through roster synchronization.
- **Schedule.** The operator generates a single round robin. Each pair plays once, with a bye in odd-sized fields. The captains of each match propose, counter, accept or decline a check-in window. The second captain’s acceptance books the fixture. Acceptance checks both squads against active fixture windows in the season. Windows may touch at their endpoints. Unaccepted proposals do not reserve a slot. Captains can renegotiate a booked window before it opens. Both the existing and proposed windows remain reserved while the agreed change is being sent to the zone. Times display in each visitor’s timezone and travel to the zone in UTC.
- **League rules.** Operators write rules of the league's own under **Manage season → League rules**: a title and a body in Markdown (paragraphs, lists, bold, italic, links), for what the site cannot check, such as eligibility. They are shown first among the season's rules on the Playoffs page and on the league's sign-up page, are never enforced by the site, and carry into the league's next season. Before a draft, **Prune the pool** on the same page removes every ticked pilot from the season in one step; close sign-ups first, since a removed pilot can otherwise sign up again.
- **Standings.** Squads are ranked on their regular-season win–loss record: most wins, then fewest losses; a draw counts as neither. Ties break by head-to-head (most wins in the matches between the squads that are level, repeated among any still level), then kill differential, then squad name. An operator's ruling can set a match's score, home first, for a forfeit or to correct what was reported; a score recorded with a result, by ruling or by import, is shown as the result and is that match's margin in the kill differential. **Statistics** are named figures worked out from the counters the zone reports for each pilot in each match, defined in [src/stats.ts](src/stats.ts): totals such as kills, and rates and ratios such as kills per ten minutes in a ship, gun accuracy and damage exchange. Counters are summed first and divided once, the same way as on Reloaded's own site. The Statistics page shows leaders and a table that sorts by any column, for pilots or squads, over the whole season, the regular season or the playoffs; a pilot needs three games to be ranked on a rate. A match page shows its box score in the same groups. A figure whose counters were never reported is shown as a dash, not a zero. Each pilot has a page in every league they have been part of, at `/<league>/pilots/<profile ID>`, with a line for each season, a league total, a total across the site's leagues, and a log of their matches. A squad's page shows its own figures and its pilots' lines for the matches they played for it. Attribution uses the fixture’s own roster so later trades and display-name changes preserve historical credit.
- **Playoffs.** After all regular-season matches have results, the operator seeds the bracket from the final table. Seeds freeze when playoffs begin. The configured number of squads qualify, with top seeds receiving byes as needed. Choose single or double elimination and best-of-one, three or five at season creation. Each league series game is a separate zone fixture. Choose a single-game zone format when you want the league to manage a best-of series. A drawn game advances neither side. In double elimination, a lower-bracket win over the undefeated finalist triggers a reset series.
- **Rulings.** An operator may record an outcome for an unbooked or resolved match, including a forfeit or a correction. A ruling says whether the losing squad forfeited, and that squad is then named as having forfeited wherever the match is shown; a result the zone itself reports as a forfeit or walkover is shown the same way. Operators can also correct individual pilot metrics against the historical fixture roster. The reason, author, previous rulings and original zone result remain available. Rulings take precedence over delayed callbacks. A correction updates standings and recomputes unplayed playoff games. A ruling that would invalidate an already booked or played downstream playoff game is rejected atomically.

## Booking and callback delivery

League matches have multiple fixture attempts. The app commits the agreed window, roster snapshot and unique external ID to the database before it contacts Reloaded. Its worker resumes pending bookings after restart. A timeout repeats the same `externalId`. A mutually approved retry after cancellation or no-show receives a fresh ID. The zone’s `matchUrl` and `replayUrl` appear on the match page when supplied.

Roster edits enqueue complete replacement teams for booked/open fixtures. A change cannot take either side below the active fixture’s quorum. The worker sends window changes with PATCH and roster changes with PUT, records refusals on the match, backs off after temporary failures and polls active fixtures to recover missed callbacks. Operators can request synchronization from the match page.

The webhook verifies HMAC-SHA256 over the timestamp and original request bytes, enforces five-minute freshness and deduplicates deliveries in the result transaction. Each attempt is looked up by its external ID in an index table, without opening other seasons. Terminal state and timestamps protect against delayed events. The result mapper resolves names through the zone’s fixture snapshot to profile IDs. Ambiguous results appear as **Needs ruling**, with the original document available for inspection. [Fixtures wire contract](https://docs.subspacereloaded.com/openapi/league.yaml) · [OAuth wire contract](https://docs.subspacereloaded.com/openapi/auth.yaml)

## Extend squad formation

A formation method is an entry in `methods` in [src/formation.ts](src/formation.ts): a label, a one-line summary pilots read before signing up, and its kind. A `live` method names the draft it opens; an `instant` method names a dealing strategy; a `manual` method has the operator enter the squads. It then appears wherever a method is chosen.

A dealing strategy is an entry in `formations` in the same file. It receives a copy of the season and the IDs of all unassigned enlisted pilots, and returns exactly one assignment per free pilot. The league validates assignments and applies them atomically. A strategy must not mutate storage, call the network, or reassign existing roster members.

```js
formations.set('rotating', {
  label: 'Rotate through squads',
  assign(season, pilots) {
    return pilots.map((player, index) => ({
      player,
      squad: season.squads[index % season.squads.length].id
    }));
  }
});
```

## Development

Use `npm run demo` for a seeded development server, or `npm run dev` with a configured live client. The launcher starts both processes and stops them together. Rebuild with `npm run build` before starting production.

```sh
npm run typecheck
npm test
```

`npm run test:unit` exercises the framework-independent league and fixture logic. The full suite also builds the production website and runs it with a worker and a simulated Reloaded service. Tests need the Postgres from `npm run db` (or `TEST_DATABASE_URL`); each test works in a schema of its own and removes it afterwards.

Match pages live under `app/[league]/[seasonId]/matches/[matchId]`. A form invokes a server action, which reads the session and calls the league command inside a database transaction that locks the season's row. The JSON endpoints continue to serve API clients. Both entry points accept the season revision the client read. Inside the write transaction, each command checks when its affected records last changed. A stale proposal or roster edit returns HTTP 409 through the JSON API. Unrelated edits, such as closing enlistment while captains negotiate an existing match, can proceed.

**Changing what is stored.** A season is one JSON document. When a field is added, give older documents their value in `upgrade` in [src/upgrade.ts](src/upgrade.ts), which every document passes through as it is read. When a table changes, describe the newest shape in `tables` in [src/store.ts](src/store.ts) and append the statement that gets an existing database there to `migrations`; they run in order when the store opens, and `test/store.test.js` opens a database made by an earlier release.

**Adding a command or a page.** A season command is a name in [src/commands.ts](src/commands.ts), a case in `apply` and a case in `dependencies`; a season page is a folder under `app/[league]/[seasonId]` and an entry in [src/sections.ts](src/sections.ts). `test/commands.test.js` fails until they agree.

| Component | Location |
| --- | --- |
| Season commands, roles, roster and scheduling rules | [src/league.ts](src/league.ts) |
| The name of every command, which forms are type-checked against | [src/commands.ts](src/commands.ts) |
| Formation methods, the draft engine and auto-pick | [src/formation.ts](src/formation.ts), [src/draft.ts](src/draft.ts), [src/autopick.ts](src/autopick.ts) |
| A season's phase, and bringing older stored seasons to today's shape | [src/phase.ts](src/phase.ts), [src/upgrade.ts](src/upgrade.ts) |
| A season's pages, read by the tabs and the sitemap | [src/sections.ts](src/sections.ts) |
| Booking states | [src/attempts.ts](src/attempts.ts) |
| Round robin, playoff progression, standings and performance | [src/competition.ts](src/competition.ts) |
| Fixtures client, durable work processing and callbacks | [src/reloaded.ts](src/reloaded.ts) |
| Postgres storage: seasons, leagues, sessions, delivery receipts, the attempt index and per-match pilot statistics | [src/store.ts](src/store.ts) |
| OAuth and session handling | [app/auth](app/auth/) and [src/auth.ts](src/auth.ts) |
| Pages and reusable React components | [app/[league]](app/%5Bleague%5D/) and [components](components/) |
| Fixture worker entry point | [scripts/worker.ts](scripts/worker.ts) |
| Integration and competition tests | [test](test/) |

Released under the [MIT License](LICENSE).
