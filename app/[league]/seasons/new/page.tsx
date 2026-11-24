import Link from 'next/link';
import { noIndex } from '@/app/seo';
import { loadLeagueHome } from '@/app/data';
import { Field, Select, SignInPrompt } from '@/components/league';
import { CommandForm } from '@/components/interactive';
import { methods } from '@/src/formation';
export const metadata = { title: 'Start a new season', ...noIndex };
export default async function NewSeason({ params }: { params: Promise<{ league: string }> }) {
  // `season` is the league's latest: a new season starts with the way that one formed its squads
  const { actor, league, seasons, season: last, demo } = await loadLeagueHome(params);
  const active = seasons.find((entry) => !entry.over);
  return (
    <div className="form-page">
      <Link className="back-link" href={'/' + league.slug}>Back to {league.name}</Link>
      <h1>Start a new season</h1>
      {actor?.operator && active ? (
        <p>
          {active.name} is still in progress. A league runs one season at a time: finish it, or close it from its{' '}
          <Link href={'/' + league.slug + '/' + active.slug + '/manage'}>season management page</Link>, before starting another.
        </p>
      ) : actor?.operator ? (
        <CommandForm command="create" label="Create season" fields={{ league: league.id }} weight="primary">
          <Field name="name" label="Season name" maxLength={80} />
          <Field name="gameType" label="Game type" defaultValue="svs-league-4v4" />
          <Field
            name="minPerTeam"
            label="Minimum pilots per squad at check-in"
            type="number"
            min={1}
            max={64}
            defaultValue={4}
          />
          <Field
            name="playoffSpots"
            label="Playoff qualifiers"
            type="number"
            min={2}
            max={128}
            defaultValue={4}
          />
          <Select
            name="method"
            label="Squads are formed by"
            defaultValue={last?.formation.method}
            items={Object.entries(methods).map(([id, method]) => [id, method.label])}
          />
          <Select
            name="format"
            label="Playoff bracket"
            items={[
              ['double', 'Double elimination'],
              ['single', 'Single elimination'],
            ]}
          />
          <Select
            name="bestOf"
            label="Playoff series length"
            items={[
              [3, 'Best of three'],
              [5, 'Best of five'],
              [1, 'Single game'],
            ]}
          />
          <Select
            name="reviewTrades"
            label="Trade approval"
            items={[
              ['yes', 'Both captains and operator'],
              ['no', 'Both captains'],
            ]}
          />
        </CommandForm>
      ) : actor ? (
        <p>You are signed in, but only this league’s operators can start a season.</p>
      ) : (
        <SignInPrompt demo={demo} next={'/' + league.slug + '/seasons/new'} title="Sign in to start a season">
          This page is for the league’s operators.
        </SignInPrompt>
      )}
    </div>
  );
}
