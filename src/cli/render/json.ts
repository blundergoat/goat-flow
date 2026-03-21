import type { ScanReport } from '../types.js';

export function renderJson(report: ScanReport): string {
  return JSON.stringify(report, null, 2);
}
