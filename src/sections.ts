// The pages of a season, in one place. The tab row, the season picker, the sitemap and the list of names
// a season may not take all read this, so a new page is one entry and a folder under app/[league]/[seasonId].
// test/commands.test.js checks the folders and this list agree.
//   tab      it has a tab of its own, in this order
//   sitemap  it is a public page worth listing for search engines
//   under    a page reached from another, whose tab stays lit while it is open
export type SeasonSection = { route: string; label: string; tab?: boolean; sitemap?: boolean; under?: string };
export const seasonSections: SeasonSection[] = [
  { route: 'schedule', label: 'Schedule', tab: true, sitemap: true },
  { route: 'standings', label: 'Standings', tab: true, sitemap: true },
  { route: 'squads', label: 'Squads', tab: true, sitemap: true },
  { route: 'draft', label: 'Draft room', tab: true, sitemap: true },
  { route: 'playoffs', label: 'Playoffs', tab: true, sitemap: true },
  { route: 'stats', label: 'Statistics', tab: true, sitemap: true },
  { route: 'matches', label: 'Match', under: 'schedule' },
  { route: 'mock', label: 'Mock draft', under: 'draft' },
  { route: 'manage', label: 'Manage season' },
];
// The tab a page lights: its own, or the one it is reached from
export const tabOf = (route: string) => seasonSections.find((section) => section.route === route)?.under ?? route;
