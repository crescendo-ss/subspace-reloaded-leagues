import Link from 'next/link';
import { noIndex } from '@/app/seo';
import { viewer } from '@/app/data';
import { Field, SignInPrompt } from '@/components/league';
import { configuration } from '@/src/runtime';
import { CommandForm } from '@/components/interactive';
export const metadata = { title: 'Create a league', ...noIndex };
export default async function NewLeague() {
  const actor = await viewer();
  return (
    <div className="form-page">
      <Link className="back-link" href="/">All leagues</Link>
      <h1>Create a league</h1>
      {actor?.admin ? (
        <CommandForm command="createLeague" label="Create league" weight="primary">
          <Field name="name" label="League name" maxLength={60} />
          <Field name="tagline" label="Short description" maxLength={120} required={false} placeholder="4v4 draft league" />
        </CommandForm>
      ) : actor ? (
        <p>You are signed in, but only site admins can create a league.</p>
      ) : (
        <SignInPrompt demo={configuration().demo} next="/leagues/new" title="Sign in to create a league">
          This page is for site admins.
        </SignInPrompt>
      )}
    </div>
  );
}
