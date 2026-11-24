'use client';
import { startTransition, useEffect, useRef, useActionState, useState, type ReactNode } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Icon } from './symbols';
import { submitCommand } from '@/app/actions';
import type { CommandName } from '@/src/commands';
import { seasonSections, tabOf } from '@/src/sections';

export function CommandForm({
  seasonId = '',
  revision = 0,
  command,
  label,
  children,
  fields = {},
  weight = 'default',
}: {
  seasonId?: string;
  revision?: number;
  command: CommandName;
  label: string;
  children?: ReactNode;
  fields?: Record<string, string>;
  // 'signup' is the site's one moving button: see button.signup in the stylesheet
  weight?: 'primary' | 'default' | 'quiet' | 'danger' | 'signup';
}) {
  const [result, action, pending] = useActionState(submitCommand.bind(null, command, seasonId, revision), {
    message: '',
  });
  const form = useRef<HTMLFormElement>(null);
  // A form that went through starts afresh. One that was refused keeps what was typed, so it can be
  // corrected, and stays marked as being edited.
  useEffect(() => {
    if (!form.current || result.error || !result.message) return;
    form.current.reset();
    delete form.current.dataset.editing;
  }, [result]);
  return (
    <form
      ref={form}
      className="form-grid"
      data-command={command}
      // Without scripts the browser submits to the action. With them the form is sent from here, because
      // React empties a form it submits itself, whether or not the server accepted it.
      action={action}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => action(data));
      }}
      onChange={(e) => {
        e.currentTarget.dataset.editing = 'true';
      }}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input type="hidden" key={name} name={name} value={value} />
      ))}
      {children}
      <button className={weight === 'default' ? undefined : weight} disabled={pending}>
        {pending ? 'Saving…' : label}
      </button>
      {result.message && (
        <p role="status" className={result.error ? 'notice error' : 'notice'}>
          {result.message}
        </p>
      )}
    </form>
  );
}

export function CheckInTime() {
  const [local, setLocal] = useState(false),
    [offset, setOffset] = useState(0);
  useEffect(() => setLocal(true), []);
  return (
    <>
      <label>
        Opens at ({local ? 'your local time' : 'UTC'})
        <input
          type="datetime-local"
          required
          name="opensAt"
          onChange={(e) => setOffset(new Date(e.target.value).getTimezoneOffset() || 0)}
        />
      </label>
      <input type="hidden" name="utcOffset" value={offset} />
    </>
  );
}
// `dateOnly` is for what has already happened: the day is enough, and the exact time is in the hover text.
export function LocalTime({ iso, weekday = false, dateOnly = false }: { iso?: string | null; weekday?: boolean; dateOnly?: boolean }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!iso) return <>Awaiting scheduling</>;
  const date = new Date(iso);
  if (dateOnly) {
    const day = ready
      ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
      : iso.slice(0, 10);
    return <time dateTime={iso} title={ready ? date.toLocaleString() : undefined}>{day}</time>;
  }
  const value = ready
    ? date.toLocaleString(undefined, {
        weekday: weekday ? 'short' : undefined,
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      })
    : date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  return <time dateTime={iso}>{value}</time>;
}
// A running countdown to a check-in window, with the exact local time under it. It ticks each second
// in the browser; the page as first served shows only the time, so the two always agree.
export function CheckInCountdown({ iso, proposed = false }: { iso: string; proposed?: boolean }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = now === null ? null : Math.floor((Date.parse(iso) - now) / 1000);
  const parts: [number, string, string][] =
    left === null || left <= 0
      ? []
      : [
          [Math.floor(left / 86400), 'd', 'days'],
          [Math.floor(left / 3600) % 24, 'h', 'hours'],
          [Math.floor(left / 60) % 60, 'm', 'minutes'],
          [left % 60, 's', 'seconds'],
        ];
  // Leading zero units are dropped: no "0d" a few hours out
  const shown = parts.slice(Math.max(0, parts.findIndex(([value]) => value > 0)));
  return (
    <span className="feature-time">
      <small>{left !== null && left <= 0 ? 'Check-in' : proposed ? 'Proposed check-in in' : 'Check-in opens in'}</small>
      {left === null ? (
        <span className="countdown" aria-hidden="true">–</span>
      ) : left <= 0 ? (
        <span className="countdown">Open now</span>
      ) : (
        <span className="countdown" role="timer" aria-label={shown.slice(0, 3).map(([value, , unit]) => value + ' ' + unit).join(', ')}>
          {shown.map(([value, unit], i) => (
            <span key={unit} aria-hidden="true">
              <b>{i === 0 ? value : String(value).padStart(2, '0')}</b>
              {unit}
            </span>
          ))}
        </span>
      )}
      <LocalTime iso={iso} weekday />
    </span>
  );
}
export function CompletionTime({ iso }: { iso: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const date = new Date(iso);
  const minutes = now === null ? null : Math.max(0, Math.floor((now - date.getTime()) / 60000));
  const relative = minutes === null ? date.toISOString().slice(0, 10)
    : minutes === 0 ? 'just now'
    : minutes < 60 ? minutes + ' min ago'
    : minutes < 1440 ? Math.floor(minutes / 60) + ' hr ago'
    : minutes < 10080 ? Math.floor(minutes / 1440) + (minutes < 2880 ? ' day ago' : ' days ago')
    : 'on ' + date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return <time dateTime={iso} title={now === null ? iso : date.toLocaleString()}>{relative}</time>;
}

export function SeasonNav({
  league,
  slug,
  seasons,
  tools,
  past,
}: {
  // The league's address and name, then the season's address within it
  league: { slug: string; name: string };
  slug: string;
  tools?: string;
  seasons: { slug: string; name: string }[];
  // The season is over and kept as history
  past?: boolean;
}) {
  const path = usePathname(),
    router = useRouter(),
    base = '/' + league.slug + '/' + slug;
  useEffect(() => {
    // Preserve links to matches and squads shared before the App Router migration.
    const [view, detail] = location.hash.slice(1).split('/');
    const old: Record<string, string> = {
      overview: '',
      match: 'matches',
      squad: 'squads',
      schedule: 'schedule',
      manage: 'manage',
      squads: 'squads',
      stats: 'stats',
      standings: 'standings',
      playoffs: 'playoffs',
    };
    if (Object.hasOwn(old, view)) {
      const suffix = detail
        ? ['match', 'squad'].includes(view)
          ? '/' + encodeURIComponent(detail)
          : '?view=' + encodeURIComponent(detail)
        : '';
      router.replace(base + (old[view] ? '/' + old[view] : '') + suffix);
    }
    function refresh() {
      if (
        !document.hidden &&
        !document.querySelector('form[data-editing="true"]') &&
        !document.activeElement?.closest('form')
      )
        router.refresh();
    }
    const timer = setInterval(refresh, 15000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [base, router]);
  const active = path.slice(base.length + 1).split('/')[0];
  // The league is named in the header, so this bar names only the season. With one season there is
  // nothing to pick, and a name that repeats the league's is not printed again beside it.
  return (
    <>
      <div className="season-context">
        {seasons.length === 1 ? (
          <div><strong>{seasons[0].name}</strong></div>
        ) : (
          <label>
            <span className="eyebrow">Season</span>
            <select
              aria-label="Select season"
              value={slug}
              onChange={(e) => {
                // Another season is opened on the same page where it has one of its own
                const section = active === 'manage' ? '' : tabOf(active);
                router.push('/' + league.slug + '/' + e.target.value + (section ? '/' + section : ''));
              }}
            >
              {seasons.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {past && <span className="past-tag">Past season</span>}
      </div>
    </>
  );
}

const destinations = seasonSections.filter((section) => section.tab).map((section) => [section.route, section.label] as const);
// `settings` is set for a viewer who may open the league's settings
export type NavLeague = {
  slug: string;
  name: string;
  current?: string;
  settings?: boolean;
  over?: boolean;
  draftless?: boolean;
  // For the person signed in: their page for running things, how much is waiting on them, and their squad
  tools?: 'manage' | 'captain';
  waiting?: number;
  me?: { squad?: string };
};

// The header's league menu: the league being viewed, opening to a list of every league the site hosts.
// The links are always in the page, hidden until the menu opens, and following one closes it.
export function LeagueNav({ leagues }: { leagues: NavLeague[] }) {
  const params = useParams<{ league?: string }>();
  const pathname = usePathname();
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const open = openedFor === pathname;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpenedFor(null);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  const here = leagues.find((league) => league.slug === params.league);
  if (!leagues.length) return null;
  return (
    <div className="league-menu" ref={box}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { setOpenedFor(null); box.current?.querySelector('button')?.focus(); } }}>
      <button type="button" className="league-menu-button" aria-expanded={open} aria-controls="league-menu-list"
        onClick={() => setOpenedFor(open ? null : pathname)}>
        <span>{here?.name ?? 'Leagues'}</span>
      </button>
      <nav className="league-menu-list" id="league-menu-list" aria-label="Leagues" hidden={!open}>
        {leagues.map((league) => (
          <Link key={league.slug} href={'/' + league.slug} onClick={() => setOpenedFor(null)}
            aria-current={league.slug !== params.league ? undefined : pathname === '/' + league.slug ? 'page' : 'true'}>
            {league.name}
          </Link>
        ))}
        <Link className="league-menu-all" href="/" onClick={() => setOpenedFor(null)} aria-current={pathname === '/' ? 'page' : undefined}>All leagues</Link>
      </nav>
    </div>
  );
}

// Inside a league, a row of tabs holds its pages: the season's on the left, the league's own on the right.
// The row stays in view while the page scrolls.
export function SectionTabs({ leagues }: { leagues: NavLeague[] }) {
  const params = useParams<{ league?: string; seasonId?: string }>();
  const pathname = usePathname();
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // On a narrow screen the row scrolls sideways; bring the tab for this page into view
    const box = row.current,
      tab = box?.querySelector<HTMLElement>('[aria-current="page"]');
    if (box && tab) box.scrollLeft = tab.offsetLeft - (box.clientWidth - tab.offsetWidth) / 2;
  }, [pathname]);
  const league = leagues.find((l) => l.slug === params.league);
  if (!league) return null;
  const home = '/' + league.slug;
  const season = params.seasonId || league.current;
  const base = home + '/' + encodeURIComponent(season ?? '');
  const section = pathname.startsWith(base + '/') ? pathname.slice(base.length + 1).split('/')[0] : '';
  const shown = tabOf(section);
  const current = (here: boolean) => (here ? 'page' : undefined);
  // What is known about the league's newest season applies when that is the season in view
  const latest = season === league.current;
  // The role's own page is for the league's newest season, wherever in the league the person is
  const toolsAt = league.current ? home + '/' + encodeURIComponent(league.current) + '/manage' : null;
  return (
    <nav className="section-tabs" aria-label={league.name}>
      <div className="section-tabs-inner" ref={row}>
        <Link href={home} aria-current={current(pathname === home)}>Home</Link>
        {season && destinations.filter(([route]) => route !== 'draft' || !(latest && league.draftless)).map(([route, label]) => (
          <Link key={route} href={base + '/' + route} aria-current={current(shown === route)}>{label}</Link>
        ))}
        <span className="tabs-league">
          {season && <Link href={base} aria-current={current(pathname === base)}>{latest && !league.over ? 'Overview' : 'Review'}</Link>}
          <Link href={home + '/seasons'} aria-current={current(pathname === home + '/seasons')}>All seasons</Link>
          <Link href={home + '/champions'} aria-current={current(pathname === home + '/champions')}>Champions</Link>
          {league.settings && <Link href={home + '/manage'} aria-current={current(pathname === home + '/manage')}>League settings</Link>}
          {league.tools && toolsAt && (
            <Link href={toolsAt} aria-current={current(pathname === toolsAt)}>
              {league.tools === 'manage' ? 'Manage season' : 'Captain tools'}
              {league.waiting ? <b className="tab-count" aria-label={league.waiting + ' waiting on you'}>{league.waiting}</b> : null}
            </Link>
          )}
        </span>
      </div>
    </nav>
  );
}

// Signing in is single sign-on with the visitor's Subspace Reloaded account: one press goes to Reloaded and
// comes back signed in. The local demo has no Reloaded to ask, so it opens its account picker instead.
export function AccountLink({ name, id, demo, leagues = [] }: { name?: string; id?: number; demo: boolean; leagues?: NavLeague[] }) {
  const pathname = usePathname();
  const params = useParams<{ league?: string }>();
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const open = openedFor === pathname;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpenedFor(null);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  const suffix = pathname && pathname !== '/' && !pathname.startsWith('/account') ? '?next=' + encodeURIComponent(pathname) : '';
  if (!name)
    return (
      <a className="button" href={(demo ? '/account' : '/auth/login') + suffix}
        title={demo ? 'Choose a local demo account' : 'Sign in with your Reloaded account'}>Sign in</a>
    );
  // The chip opens the signed-in pilot's own places: in the league being viewed if they are part of it,
  // otherwise in the first league they are part of.
  const league = leagues.find((l) => l.slug === params.league && (l.me || l.tools)) ?? leagues.find((l) => l.me || l.tools);
  const base = league?.current ? '/' + league.slug + '/' + encodeURIComponent(league.current) : null;
  const close = () => setOpenedFor(null);
  return (
    <div className="account-menu" ref={box}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { close(); box.current?.querySelector('button')?.focus(); } }}>
      <button type="button" className="account-chip" aria-expanded={open} aria-controls="account-menu-list" title={demo ? 'Demo account' : 'Reloaded account'}
        onClick={() => setOpenedFor(open ? null : pathname)}>
        <span className="account-initial" aria-hidden="true">{name[0]?.toUpperCase()}</span>
        <strong>{name}</strong>
      </button>
      <nav className="league-menu-list account-menu-list" id="account-menu-list" aria-label="Your pages" hidden={!open}>
        {league && <span className="menu-label">{league.name}</span>}
        {league?.me && id && <Link href={'/' + league.slug + '/pilots/' + id} onClick={close}>Your record</Link>}
        {league?.me?.squad && base && <Link href={base + '/squads/' + league.me.squad} onClick={close}>Your squad</Link>}
        {league?.me?.squad && base && <Link href={base + '/schedule?view=mine'} onClick={close}>Your matches</Link>}
        {league?.tools && base && (
          <Link href={base + '/manage'} onClick={close}>
            {league.tools === 'manage' ? 'Manage season' : 'Captain tools'}
            {league.waiting ? <b className="tab-count" aria-label={league.waiting + ' waiting on you'}>{league.waiting}</b> : null}
          </Link>
        )}
        <Link className="league-menu-all" href={'/account' + suffix} onClick={close}>Account</Link>
        <CommandForm command="logout" label="Sign out" fields={{ next: '/' }} weight="quiet" />
      </nav>
    </div>
  );
}

// Keeps a page that many people act on at once, such as a live draft, in step: it asks for the season's
// revision every second or so and refreshes the page when someone else has changed it. What a person has
// typed and not sent is theirs and stays.
export function LiveRevision({ season, revision, every = 1500 }: { season: string; revision: number; every?: number }) {
  const router = useRouter();
  useEffect(() => {
    let busy = false;
    const timer = setInterval(async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const response = await fetch('/api/revision?season=' + encodeURIComponent(season), { cache: 'no-store' });
        if (response.ok && (await response.json()).revision !== revision) router.refresh();
      } catch {
        // The next tick tries again
      } finally {
        busy = false;
      }
    }, every);
    return () => clearInterval(timer);
  }, [season, revision, every, router]);
  return null;
}
