const paths = {
  home: <><path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/></>,
  standings: <><path d="M3 20h18M5 16V9h4v7m1 0V4h4v12m1 0v-5h4v5"/></>,
  chart: <><path d="M3 3v17h18M6 15l4-5 4 2 6-7"/></>,
  archive: <><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v12h14V8m-10 4h6"/></>,
  rocket: <><path d="M12 3c2.800 2.400 4.200 5.600 4.200 9v4.500H7.800V12c0-3.400 1.400-6.600 4.200-9z" /><path d="M7.800 12.500 5 15.500V19l2.800-2.500M16.200 12.500 19 15.500V19l-2.800-2.500M10.500 19l1.500 2.500 1.500-2.500" /><circle cx="12" cy="10" r="1.500" /></>,
  crown: <path d="M4 18h16M5 15 3.5 7l5 4L12 5l3.5 6 5-4L19 15z" />,
  menu: <path d="M3 6h18M3 12h18M3 18h18"/>,
  close: <path d="m5 5 14 14M19 5 5 19"/>,
  arrow: <><path d="M4 12h15m-6-6 6 6-6 6" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4m8-4v4" /></>,
  squad: <><path d="m12 3 8 4v6c0 3-4 6-8 8-4-2-8-5-8-8V7z" /><path d="m8 12 4-3 4 3" /></>,
  pilots: <><circle cx="10" cy="8" r="3" /><path d="M3 20v-2a7 7 0 0 1 14 0v2m0-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5" /></>,
  draft: <><path d="m4 7 8-4 8 4-8 4zm0 5 8 4 8-4M4 17l8 4 8-4" /></>,
  mock: <><path d="M5 6h3c4 0 4 12 8 12h4m-4-4 4 4-4 4M5 18h3c1.5 0 2.5-2 3.5-4m2-5C14.6 7 15 6 17 6h3m-4-4 4 4-4 4" /></>,
  trophy: <><path d="M7 4h10v5c0 4-2 7-5 7s-5-3-5-7zM7 6H3v2c0 3 2 5 5 5m9-7h4v2c0 3-2 5-5 5m-4 3v4m-4 1h8" /></>,
};
export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg className="icon" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
