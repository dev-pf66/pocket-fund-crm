-- Help article for the Indian Sellers buyside pipeline.
-- Idempotent: refreshes the article on re-run (no unique constraint on title,
-- so delete-then-insert the known row).

DELETE FROM crm_help_articles WHERE category = 'sellers' AND title = 'Using the Indian Sellers Pipeline';

INSERT INTO crm_help_articles (title, category, content, order_index) VALUES
('Using the Indian Sellers Pipeline', 'sellers', E'# Using the Indian Sellers Pipeline

The **Indian Sellers** board (under *Pipelines* in the sidebar) tracks Indian businesses we are meeting with to potentially acquire — the buyside/Kautilya side.

> It is deliberately **separate from the sales Pipeline**. Sellers are acquisition targets, not sales leads, so they never appear in the sales funnel, outreach tracker, or reply-rate/conversion metrics. Keep buyers in *Pipeline*, sellers here.

## The stages

| Stage | Meaning |
|---|---|
| **Sourced** | Found the business, not yet contacted |
| **Contacted** | First outreach sent |
| **Intro Call** | Intro/discovery call booked or done |
| **Evaluating** | Reviewing the business (financials, fit) |
| **LOI/Offer** | Letter of intent / offer on the table |
| **Acquired** | Deal closed |
| **Passed** | Not pursuing |

Drag a card between columns to move it (on mobile, use the *Move to* dropdown on each card).

## Adding a seller

Click **Add Seller** (top right) and fill in what you have — only the contact name is required. Useful fields: business name, industry, location, **asking price**, **revenue / SDE**, meeting date, and an **owner** (assign the teammate running the deal).

## Follow-ups

Set a **Next Follow-up** date on any seller. Anything due today or overdue shows up in the orange banner at the top of the board — click **Show only due** to work through them.

## Who can see it

The whole team shares this board — everyone sees and edits every seller, so keep notes current.', 1);

-- Verify:
-- SELECT title, category FROM crm_help_articles WHERE category = 'sellers';
