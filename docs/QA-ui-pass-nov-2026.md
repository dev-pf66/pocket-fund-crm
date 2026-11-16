# CRM test list: UI pass, Nov 2026 (for Sidharth)

Everything below is live on https://pocket-fund-crm.vercel.app. It was checked with fake data;
nobody has clicked through it with real leads yet. That's what this list is for.

**Before you start**
- Hard-reload once (Cmd+Shift+R) so you're on the new version.
- This is the live CRM, so every click is real. For anything that moves or edits a lead, use a
  throwaway lead: **Pipeline → Add Lead → name it `TEST — Sidharth`**, assign it to yourself, and
  **Archive** it (lead page → Archive) when you're done. Don't delete it.
- Moving a stage can create a Sage task, so use the test lead for those steps.
- For anything that's wrong: a screenshot, the page, what you clicked, and what you expected.
  One line each is enough.

## 1. Cold Calls (most important)
1. Cold Calls → Call Mode. Log a real dial by pressing an outcome key (1–0) or clicking an outcome.
   **Expect:** a toast with the name and outcome, and the **next lead loads by itself**. (Before
   the fix, the screen stayed on the same lead and a second press logged the call twice.)
2. Click **Do not call** on a lead you really shouldn't call. **Expect:** a toast, then the next
   lead loads.
3. Cold Calls → Funnel. **Expect:** the "When they pick up" and "Daily volume" charts show
   **bars**, not just hour labels.

## 2. Pipeline board
4. Click a card. **Expect:** a popup with the lead's fields and an **Open full page** button.
5. In the popup, change one field on the test lead and click **Update Lead**. **Expect:** it
   saves and the board refreshes. Reopen it: only your change is different.
6. Type something in the popup, then press **Esc**. **Expect:** it asks before throwing your
   edit away.
7. Drag the test lead to another column. **Expect:** it moves. If a move ever fails, you should
   see a red error toast, not a silent snap-back.
8. Column headers: a coloured dot, the stage name and a grey count, the same on every board.
9. Follow-up badges on cards: **"2d overdue"** (red), **"Due today"** (amber), **"In 3d"**. A
   follow-up further out shows no badge on the card, but it's still on the lead page.
10. **On your phone:** the Pipeline header buttons and the search row wrap instead of running off
    the edge, and each card has a **Move to** dropdown at the bottom. Move the test lead with it.

## 3. Lead page
11. The stage is next to the name at the top. Click it, pick a new stage, and it saves **as soon
    as you pick** (no need to click away).
12. **Log activity** at the top opens the activity form further down and scrolls to it.
13. **Delete** is a plain grey button, no longer red.

## 4. Today and Notifications
14. Today: the buttons on each row line up in straight columns, including rows without a
    LinkedIn.
15. **Dead** is grey until you hover over it.
16. Touched on a lead in **Follow-ups due**, then open that lead. **Expect:** its next follow-up
    is **30 days from today**, with the note "30-day check-in". (If the lead is on a cadence, it
    moves to the cadence's next step instead.)
17. Touched on a lead whose follow-up is weeks away. **Expect:** that date **stays as it was**.
18. Notifications: follow-up rows have **+1d / +1w / +30d** (the old ✕ is gone).
19. Numbers tab: after test 16, your **F/U done** count should be one higher.

## 5. The other boards (Sellers, Partners, Italy, PE OS, Investors)
20. Same column headers and follow-up badges as the Pipeline.
21. **No trash icon** on cards. To delete, tick the card and use Delete in the bar that appears.
    (Skip actually deleting anything real.)
22. Save an edit on a seller or partner. **Expect:** the board **doesn't blank** to a spinner
    afterwards.
23. Search boxes and dropdowns look like normal styled inputs, not plain browser boxes.
24. Investors: a **Passed** status is grey, not red.

## 6. Everywhere
25. Press **Tab** a few times on any page. **Expect:** a clear blue outline shows which button is
    selected.
26. Small grey labels are easy to read.
27. The purple Lead Terminal button is now a small tab in the bottom-right corner and doesn't
    cover any buttons. Ctrl+T still opens it.

When you're done, archive `TEST — Sidharth`.
