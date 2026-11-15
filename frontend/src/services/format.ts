/**
 * A number written the way people write it.
 *
 * 12,663 and not 12663. The same format is used everywhere a figure
 * appears, so two numbers on one screen can be compared at a glance.
 */
export function formatNumber(value: number | string): string {
  if (typeof value === 'number') return value.toLocaleString()
  if (/^\d+$/.test(value)) return Number(value).toLocaleString()
  return value
}
