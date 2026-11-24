import type { NextConfig } from 'next';
// A season import uploads one JSON file with every match's scoreboard, which is larger than the 1 MB default
const config: NextConfig = { agentRules: false, devIndicators: false, experimental: { serverActions: { bodySizeLimit: '5mb' } } };
export default config;
