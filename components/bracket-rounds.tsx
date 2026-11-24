'use client';
import { useState, type ReactNode } from 'react';

// The bracket one round at a time, for screens too narrow for the whole diagram
export function BracketRounds({ rounds, initial }: { rounds: { title: string; content: ReactNode }[]; initial: number }) {
  const [at, setAt] = useState(initial);
  if (!rounds.length) return null;
  const round = rounds[Math.min(at, rounds.length - 1)];
  return (
    <div className="bracket-rounds">
      <div className="round-picker">
        <button type="button" aria-label="Previous round" disabled={at === 0} onClick={() => setAt(at - 1)}>
          ‹
        </button>
        <select aria-label="Round" value={at} onChange={(e) => setAt(Number(e.target.value))}>
          {rounds.map((r, i) => (
            <option key={i} value={i}>
              {r.title}
            </option>
          ))}
        </select>
        <button type="button" aria-label="Next round" disabled={at === rounds.length - 1} onClick={() => setAt(at + 1)}>
          ›
        </button>
      </div>
      <div className="round-series">{round.content}</div>
    </div>
  );
}
