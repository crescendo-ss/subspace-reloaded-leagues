// Every command the site understands, by name. A form names its command with one of these, so a
// misspelt or renamed command is a type error and not a refusal at run time.
//
// Adding a season command: add its name here, a case in `apply` (src/league.ts) and a case in
// `dependencies` (src/revisions.ts). test/commands.test.js fails until all three agree.
export const seasonCommands = [
  // Signing up and the pool
  'enlist', 'volunteer', 'withdraw', 'unenlist', 'prune', 'toggleEnlist',
  // The league's own rules
  'saveRule', 'removeRule',
  // Squads and how they are formed
  'addSquad', 'renameSquad', 'removeSquad', 'reassignCaptain', 'assign', 'form', 'setFormation', 'clearSquads', 'setSquads',
  'drawOrder', 'moveSquad', 'salary', 'salaries', 'importRosters', 'importSeason', 'importStats',
  // The draft
  'draft', 'endDraft', 'undoPick', 'reopenDraft', 'clockOut', 'pick', 'nominate', 'bid', 'passBid', 'skipTurn',
  // Rosters once squads exist
  'kick', 'offer', 'trade',
  // The season
  'schedule', 'playoffSpots', 'playoffs', 'propose', 'decide', 'sync', 'abandon', 'correctMetric', 'rule',
] as const;
export type SeasonCommand = (typeof seasonCommands)[number];
// While a live draft runs, the pool and the rosters belong to it
export const lockedDuringDraft: readonly SeasonCommand[] = ['enlist', 'unenlist', 'prune', 'withdraw', 'volunteer', 'kick', 'trade', 'offer'];
// Commands that are not an edit to one season's record: handled by the service or the server action
export const siteCommands = [
  'create', 'createLeague', 'deleteLeague', 'saveLeague', 'addOperator', 'removeOperator',
  'login', 'logout', 'join', 'closeSeason', 'reopenSeason', 'demoOutcome',
] as const;
export type CommandName = SeasonCommand | (typeof siteCommands)[number];
