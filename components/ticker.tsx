'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { LocalTime } from './interactive';
import type { TickerItem } from './ticker-items';

// The list is rendered twice so the strip loops without a gap; the copy is hidden from assistive technology.
// Inside a league it carries that league's activity; elsewhere it carries every league's, each item named.
export function Ticker({ feeds }: { feeds: { slug: string; name: string; items: TickerItem[] }[] }) {
  const [paused, setPaused] = useState(false);
  const { league } = useParams<{ league?: string }>();
  const own = feeds.find((feed) => feed.slug === league);
  const items: (TickerItem & { league?: string })[] = own
    ? own.items
    : feeds.flatMap((feed) => feed.items.slice(0, 6).map((item) => ({ ...item, key: feed.slug + ':' + item.key, league: feeds.length > 1 ? feed.name : undefined })));
  // One or two items would loop with a wide gap between them, which looks broken; the strip waits for three
  if (items.length < 3) return null;
  const characters = items.reduce((n, i) => n + (i.tag + i.text + (i.figure ?? '') + (i.tail ?? '')).length + (i.time ? 26 : 8), 0);
  // About three characters a second: slow enough to read an item without waiting on it
  const seconds = Math.max(50, Math.round(characters / 3));
  const list = (copy: boolean) => (
    <ul aria-hidden={copy || undefined}>
      {items.map((item) => (
        <li key={item.key} data-tone={item.tone}>
          <Link href={item.href} tabIndex={copy ? -1 : undefined}>
            {item.league && <span className="ticker-league">{item.league}</span>}
            <span className="ticker-tag">{item.tag}</span>
            <span>{item.text}</span>
            {item.figure && <b>{item.figure}</b>}
            {item.tail && <span>{item.tail}</span>}
            {item.time && <LocalTime iso={item.time} />}
          </Link>
        </li>
      ))}
    </ul>
  );
  return (
    <aside className="ticker" aria-label="League activity" data-paused={paused}>
      <div className="ticker-window">
        <div className="ticker-track" style={{ animationDuration: seconds + 's' }}>
          {list(false)}
          {list(true)}
        </div>
      </div>
      <button type="button" className="ticker-toggle" aria-pressed={paused} aria-label="Pause the activity ticker"
        onClick={() => setPaused(!paused)}>
        <svg aria-hidden="true" viewBox="0 0 14 14" fill="currentColor">
          {paused ? <path d="M3 1.5v11l9-5.5z" /> : <path d="M2.5 1.5h3v11h-3zm6 0h3v11h-3z" />}
        </svg>
      </button>
    </aside>
  );
}
