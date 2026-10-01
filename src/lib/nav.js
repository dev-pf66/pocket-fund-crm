/**
 * The left-menu structure, as data.
 *
 * Pure and icon-free (icons are named here and resolved to elements in
 * Layout) so the shape can be tested in the node-environment suite — there is
 * no component-test setup in this repo, and "how many tabs does an analyst
 * see" is exactly the kind of rule that quietly regresses one nav item at a
 * time.
 *
 * SEPT 2026 CONSOLIDATION (Dev's call, superseding the July 2026 decision on
 * Queue only). The menu had grown to 14 items for an analyst and the daily
 * group alone held 7, which made "which page do I use?" a real question. Three
 * changes, none of which deleted a page:
 *
 *   - Today, Notifications and Dashboard became sub-tabs of ONE "Today" entry
 *     (src/pages/TodayWorkspace.jsx). They were three separate answers to
 *     "what should I do today" — Today held the work, Notifications held what
 *     was overdue, Dashboard held whether you were keeping up — and they
 *     overlapped in the data too (Today and Dashboard both read
 *     getMovementWeekOverWeek; Dashboard and Analytics both read
 *     getOutreachStatsByPerson).
 *   - Queue lost its top-level entry. `getOutreachQueue` is "my leads at stage
 *     outreach with no outreach_log row at all", which is a subset of Today's
 *     queue (`getTodayQueue`, untouched-today, ranked) — and Cold Calls has
 *     its own Queue sub-tab for the calling workflow. What it uniquely offered
 *     was import-batch grouping.
 *   - Log became admin-only. It reads getAllOutreachLogs team-wide plus
 *     per-person stats; for a non-admin it self-scopes to that person, which
 *     makes it a weaker Tracker.
 *
 * THE ROUTES FOR ALL THREE STILL EXIST (see App.jsx). Nothing is deleted —
 * deep links, bookmarks and the command palette keep working, and restoring a
 * tab is one line here. The July 2026 decision that Tracker/Queue/Log stay
 * three separate PAGES is intact; what changed is how many of them get
 * top-level billing.
 *
 * The five contact tables (leads, sellers, investors, partners, demos) are
 * untouched — that July decision still stands.
 *
 * OCT 2026: Italy Pipeline added (crm_italy_pipeline) — a sixth, separate
 * buyside table alongside Indian Sellers, holding sellers/buyers/brokers/
 * other ecosystem contacts for Italy in one board with a Type field, rather
 * than one new table per contact type.
 */

/**
 * @param {object} opts
 * @param {boolean} opts.isAdmin
 * @param {{ total?: number, overdue?: number }} [opts.notifications]
 *   Badge counts. They ride on Today now that Notifications is a sub-tab of
 *   it — dropping the nav entry must not drop the only overdue signal in the
 *   chrome.
 */
export function buildNavGroups({ isAdmin = false, notifications = {} } = {}) {
  return [
    {
      label: 'Daily Work',
      items: [
        {
          to: '/today',
          label: 'Today',
          icon: 'Sun',
          badge: notifications.total,
          badgeUrgent: (notifications.overdue ?? 0) > 0
        },
        { to: '/outreach', label: 'Tracker', icon: 'Target' },
        { to: '/cold-calls', label: 'Cold Calls', icon: 'PhoneCall' },
        { to: '/outreach-admin', label: 'Log', icon: 'ClipboardList', show: isAdmin },
      ],
    },
    {
      label: 'Pipelines',
      items: [
        { to: '/pipeline', label: 'Pipeline', icon: 'Users' },
        { to: '/pe-os', label: 'PE OS', icon: 'Presentation' },
        { to: '/sellers', label: 'Indian Sellers', icon: 'Store' },
        { to: '/italy', label: 'Italy Pipeline', icon: 'Globe' },
        { to: '/investors', label: 'Investors', icon: 'Briefcase' },
        { to: '/partners', label: 'Partners', icon: 'Handshake' },
      ],
    },
    {
      label: 'Insights',
      items: [
        { to: '/analytics', label: 'Analytics', icon: 'BarChart3' },
      ],
    },
    {
      label: 'Setup',
      items: [
        { to: '/templates', label: 'Templates', icon: 'Mail', show: isAdmin },
        { to: '/samples', label: 'Sample Deals', icon: 'FileText', show: isAdmin },
        { to: '/admin', label: 'Admin', icon: 'Shield', show: isAdmin },
        { to: '/help', label: 'Help', icon: 'HelpCircle' },
      ],
    },
  ]
    .map(g => ({ ...g, items: g.items.filter(i => i.show !== false) }))
    .filter(g => g.items.length > 0)
}

/** Flat list of every route in the menu, for assertions and the palette. */
export function navRoutes(opts) {
  return buildNavGroups(opts).flatMap(g => g.items.map(i => i.to))
}
