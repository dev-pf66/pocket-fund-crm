import { Sun, Bell, LayoutDashboard } from 'lucide-react'
import { useSessionState } from '../hooks/useSessionState'
import Today from './Today'
import Notifications from './Notifications'
import Dashboard from './Dashboard'

/**
 * "Today" — one entry in the left menu, three sub-tabs.
 *
 * Today, Notifications and Dashboard were three separate top-level tabs
 * answering one question between them: Today held the work, Notifications held
 * what was overdue, Dashboard held whether you were keeping up. Seven items in
 * the daily group made "which page do I use?" a real question, and three of
 * them were this.
 *
 * DELIBERATELY A SHELL, NOT A REWRITE. Each sub-tab mounts the existing page
 * component untouched — 1,900 lines of working surface (including the Sept 2026
 * derived notification feed) does not need to be merged line-by-line to stop
 * being three menu entries. The three routes still exist in App.jsx too, so
 * deep links keep working and splitting them back out is one line in
 * src/lib/nav.js.
 *
 * Only the active sub-tab is mounted, so this loads exactly the data the old
 * single page did — switching tabs fetches, opening the page does not fetch
 * three times.
 *
 * NO BADGE ON THE NOTIFICATIONS SUB-TAB, deliberately. The count now rides on
 * the "Today" entry in the left menu (src/lib/nav.js), which is on screen at
 * the same time as these sub-tabs — so a badge here would duplicate a number
 * sitting an inch to its left. It would also cost a second
 * `useNotificationCount`, and that hook derives the entire feed on mount, on
 * focus, on every change event and every 5 minutes. Two of them on the app's
 * busiest page is the kind of quiet doubling nobody notices.
 */

const TABS = [
  { key: 'today', label: 'Today', Icon: Sun, Component: Today },
  { key: 'alerts', label: 'Notifications', Icon: Bell, Component: Notifications },
  { key: 'numbers', label: 'Numbers', Icon: LayoutDashboard, Component: Dashboard },
]

function TodayWorkspace() {
  const [tab, setTab] = useSessionState('tw:tab', 'today')

  const active = TABS.find(t => t.key === tab) ?? TABS[0]
  const ActiveView = active.Component

  return (
    <div>
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab ${active.key === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            <t.Icon size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
            {t.label}
          </button>
        ))}
      </div>

      <ActiveView />
    </div>
  )
}

export default TodayWorkspace
