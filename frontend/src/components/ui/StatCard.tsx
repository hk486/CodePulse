import { metricColor } from '../../services/palette'
import { formatNumber } from '../../services/format'

interface StatCardProps {
  /** What the number is. */
  label: string
  /** The number itself. */
  value: string | number
  /** The metric the rule above the card is coloured by. */
  metric: string
  /** A line that says what the number compares to. */
  trend?: string
  /** The number is a problem, so it wears the critical colour. */
  emphasis?: boolean
  /** Stagger, in milliseconds, for the entrance. */
  delay?: number
}

/**
 * One number, its label, and what it compares to.
 *
 * The rule above the card is the signature of the product: a metric keeps
 * its colour across screens, so amber always means reports and violet
 * always means findings. It is the one place the chrome carries a hue.
 */
export function StatCard({
  label,
  value,
  metric,
  trend,
  emphasis = false,
  delay,
}: StatCardProps) {
  return (
    <div className="kpi-card" style={delay ? { animationDelay: `${delay}ms` } : undefined}>
      <div
        className="h-[3px] w-7 rounded-full mb-3"
        style={{ backgroundColor: metricColor(metric) }}
      />
      <p className="kpi-label">{label}</p>
      <p className={`kpi-value ${emphasis ? 'text-severity-critical' : ''}`}>
        {formatNumber(value)}
      </p>
      {trend && <p className="kpi-trend">{trend}</p>}
    </div>
  )
}
