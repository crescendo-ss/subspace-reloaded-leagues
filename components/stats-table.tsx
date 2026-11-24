'use client';
import Link from 'next/link';
import { useState } from 'react';

export type StatColumn = { key: string; label: string; title: string; rate?: boolean; lowIsBetter?: boolean };
export type StatLine = {
  id: string;
  name: string;
  href?: string;
  // What stands beside the name: a pilot's squad
  note?: string;
  // Has played enough games to be ranked on a rate
  qualified: boolean;
  values: (number | null)[];
  text: string[];
};
// A statistics table that sorts by any column. A press on a heading ranks best first; a second press
// reverses it. On a rate, a pilot short of the qualifying games stays below every pilot who has them.
// A long table opens on its first rows, and can be narrowed to one squad.
export function StatsTable({ subject, columns, rows, initial, shortfall, first = 20, search = false }: {
  subject: string;
  columns: StatColumn[];
  rows: StatLine[];
  initial: string;
  // Said on hover over a pilot who has not played enough to be ranked on the sorted rate
  shortfall: string;
  // How many rows show before "Show all"
  first?: number;
  // Offer a field that narrows the table to names containing what is typed
  search?: boolean;
}) {
  const [sort, setSort] = useState({ key: initial, reversed: false });
  const [squad, setSquad] = useState('');
  const [all, setAll] = useState(false);
  const [name, setName] = useState('');
  const wanted = name.trim().toLowerCase();
  const at = Math.max(0, columns.findIndex((c) => c.key === sort.key));
  const column = columns[at];
  const squads = [...new Set(rows.flatMap((row) => (row.note ? [row.note] : [])))].sort();
  const ranked = rows
    .filter((row) => (!squad || row.note === squad) && (!wanted || row.name.toLowerCase().includes(wanted)))
    .sort((a, b) => {
      if (column.rate && a.qualified !== b.qualified) return a.qualified ? -1 : 1;
      const [x, y] = [a.values[at], b.values[at]];
      if ((x === null) !== (y === null)) return x === null ? 1 : -1;
      const best = x !== null && y !== null && x !== y ? (column.lowIsBetter ? x - y : y - x) : 0;
      return (sort.reversed ? -best : best) || a.name.localeCompare(b.name);
    });
  // A few rows over the limit are not worth a button
  // Someone looking for a name sees every match for it
  const cut = !all && !wanted && ranked.length > first + 5 ? first : ranked.length;
  return (
    <>
      {(squads.length > 1 || search) && (
        <div className="table-tools">
          {search && (
            <label>
              Find
              <input type="search" value={name} onChange={(e) => setName(e.target.value)} placeholder={subject + ' name'} aria-label={'Find a ' + subject.toLowerCase() + ' by name'} />
            </label>
          )}
          {squads.length > 1 && (
          <label>
            Squad
            <select value={squad} onChange={(e) => setSquad(e.target.value)}>
              <option value="">All squads</option>
              {squads.map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
          )}
          <span className="push">{ranked.length} {ranked.length === 1 ? subject.toLowerCase() : subject.toLowerCase() + 's'}</span>
        </div>
      )}
      <div className="table-wrap sticky-head">
        <table className="stats-table dense">
          <thead>
            <tr>
              <th scope="col" className="rank-col" aria-label="Rank">#</th>
              <th scope="col">{subject}</th>
              {columns.map((c) => (
                <th key={c.key} scope="col" className="number" aria-sort={c.key === column.key ? (sort.reversed !== !!c.lowIsBetter ? 'ascending' : 'descending') : undefined}>
                  <button type="button" title={c.title} aria-label={c.title + ': sort'}
                    onClick={() => setSort({ key: c.key, reversed: c.key === column.key && !sort.reversed })}>
                    {c.label}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranked.slice(0, cut).map((row, i) => {
              const short = !!column.rate && !row.qualified;
              return (
                <tr key={row.id} className={short ? 'unranked' : undefined} title={short ? shortfall : undefined}>
                  <td className="rank-col">{short ? '–' : i + 1}</td>
                  <th scope="row">
                    {row.href ? <Link href={row.href}>{row.name}</Link> : row.name}
                    {row.note && !squad && <small>{row.note}</small>}
                  </th>
                  {row.text.map((text, j) => (
                    <td key={columns[j].key} className={'number' + (j === at ? ' sorted' : '')}>{text}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {cut < ranked.length && (
        <p className="table-more">
          <button type="button" onClick={() => setAll(true)}>Show all {ranked.length}</button>
        </p>
      )}
    </>
  );
}
