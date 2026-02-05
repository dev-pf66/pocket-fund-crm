import { calculateStaleness } from '../lib/crm-api'

function StalenessBadge({ lead, settings }) {
  if (!lead || !settings) return null

  const { color, days, status } = calculateStaleness(lead, settings)

  if (!days || status === 'no_activity') return null

  const colorClasses = {
    green: 'staleness-green',
    yellow: 'staleness-yellow',
    red: 'staleness-red',
    gray: 'staleness-gray'
  }

  return (
    <span className={`staleness-badge ${colorClasses[color]}`}>
      {days}d
    </span>
  )
}

export default StalenessBadge
