import type { ScanReport } from '../types.js';

/** Serialise a scan report to pretty-printed JSON */
export function renderJson(report: ScanReport): string {
  return JSON.stringify(report, null, 2);
}
