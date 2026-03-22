import type { Fragment, FragmentPhase } from './types.js';
import { foundationFragments } from './fragments/foundation.js';
import { standardFragments } from './fragments/standard.js';
import { fullFragments } from './fragments/full.js';
import { antiPatternFragments } from './fragments/anti-patterns.js';

const allFragments: Fragment[] = [
  ...foundationFragments,
  ...standardFragments,
  ...fullFragments,
  ...antiPatternFragments,
];

const fragmentMap = new Map<string, Fragment>(
  allFragments.map(f => [f.key, f]),
);

export function getFragment(key: string): Fragment | undefined {
  return fragmentMap.get(key);
}

export function getFragmentsByPhase(phase: FragmentPhase): Fragment[] {
  return allFragments.filter(f => f.phase === phase);
}

export function getAllFragments(): Fragment[] {
  return allFragments;
}

export function getFragmentKeys(): string[] {
  return [...fragmentMap.keys()];
}

export function hasFragment(key: string): boolean {
  return fragmentMap.has(key);
}
