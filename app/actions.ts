'use server';
import { cookies } from 'next/headers';
import { refresh, revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { viewer } from './data';
import { deleteLeague, execute, finishSignUp, newLeague, newSeason, setOperator, signUp, signUpIntent, updateLeague } from '@/src/service';
import { configuration } from '@/src/runtime';
import { cookieOptions, demoSession, endSession, intentCookie, sessionCookie } from '@/src/auth';
import { need } from '@/src/league';

export type FormResult = { message: string; error?: boolean };
export async function submitCommand(
  command: string,
  seasonId: string,
  revision: number,
  _previous: FormResult,
  data: FormData,
): Promise<FormResult> {
  const fields: Record<string, string> = {};
  try {
    for (const [key, value] of data) {
      if (key.startsWith('$ACTION_')) continue;
      if (typeof value === 'string') fields[key] = value;
      // A chosen file is read as text into the field of the same name
      else if (value.size) {
        need(value.size <= 4_000_000, 'That file is too large: the limit is 4 MB.');
        fields[key] = await value.text();
      }
    }
    const actor = await viewer();
    if (command === 'create') {
      const { path } = await newSeason(actor, { ...fields, reviewTrades: fields.reviewTrades === 'yes' });
      redirect(path);
    }
    if (command === 'createLeague' || command === 'deleteLeague') {
      const { path } = command === 'createLeague' ? await newLeague(actor, fields) : await deleteLeague(actor, seasonId, fields.confirm);
      // The header lists the leagues on every page, so it is rendered afresh
      revalidatePath('/', 'layout');
      redirect(path);
    }
    if (command === 'saveLeague') {
      await updateLeague(actor, seasonId, fields);
      refresh();
      return { message: 'League updated.' };
    }
    if (command === 'addOperator' || command === 'removeOperator') {
      // A typed profile ID wins over the list, for someone who has not signed in here yet
      await setOperator(actor, seasonId, fields.profile?.trim() || fields.known, command === 'addOperator');
      refresh();
      return { message: command === 'addOperator' ? 'Operator added.' : 'Operator removed.' };
    }
    if (command === 'login' || command === 'logout') {
      const jar = await cookies();
      if (command === 'login') {
        const key = await demoSession(Number(fields.id));
        jar.set(sessionCookie, key, cookieOptions(7 * 86400));
        // Someone who pressed "Sign up" before signing in is signed up now
        await finishSignUp(key, jar.get(intentCookie)?.value);
        jar.set(intentCookie, '', cookieOptions(0));
      } else {
        await endSession(jar.get(sessionCookie)?.value);
        jar.set(sessionCookie, '', cookieOptions(0));
      }
      // Back to where sign-in was asked for; only a path on this site is followed
      redirect(/^\/[a-z0-9/-]*$/.test(fields.next ?? '') ? fields.next : '/');
    }
    // One press signs a pilot up from any page. Someone not signed in is sent to sign in first, and the
    // sign-up is finished when they come back.
    if (command === 'join') {
      const next = /^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(fields.next ?? '') ? fields.next : '/';
      const captain = fields.captain === 'yes';
      if (!actor) {
        (await cookies()).set(intentCookie, signUpIntent(seasonId, captain), cookieOptions(600));
        redirect((configuration().demo ? '/account' : '/auth/login') + '?next=' + encodeURIComponent(next));
      }
      await signUp(actor, seasonId, captain);
      redirect(next);
    }
    if (command === 'propose') {
      const utc = Date.parse(fields.opensAt + 'Z') + Number(fields.utcOffset ?? 0) * 60000;
      need(Number.isFinite(utc), 'Choose a valid check-in time.');
      fields.opensAt = new Date(utc).toISOString();
    }
    await execute(actor, seasonId, revision, command, fields);
    refresh();
    return { message: command === 'enlist' ? 'You are signed up.' : command === 'importSeason' ? 'Season imported.' : command === 'importStats' ? 'Statistics updated.' : 'League updated.' };
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      if (error.status === 409) refresh();
      return { error: true, message: error.message };
    }
    throw error;
  }
}
