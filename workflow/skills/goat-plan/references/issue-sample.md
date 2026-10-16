---
goat-flow-reference-version: "1.18.0"
---
# ISSUE.md Worked Sample

Read this when `issue-format.md` → Worked sample points here: before writing an ISSUE brief, and when checking a draft against the target shape.

Illustrative placeholder for shape only, never repository evidence; every name and number below is invented. The brief describes a made-up home-services booking product whose automated calls remind customers about technician appointments; its quoted call wording, issue numbers and counts exist only to show the shape. Treat it as the shape, not content to copy.

Measured on 2026-10-16: 65 non-blank lines, about 1,500 words in all and about 800 outside tables and headings; the eight task minutes sum to 214, shown as "About 3.5 hours".

## Worked sample

```markdown
# Outbound voice reminders: natural calls, a branch-first opening and a no-call simulator

## Outcome

After this work a reminder call sounds like the branch calling. It says which branch is calling and about which appointment, answers where it is, what kind it is and how long, always asks whether the customer can keep it, and reads numbers and dates the way a person would. Office staff can try the whole conversation from a page on the admin site without a phone. The review follow-ups from #4860 are fixed along the way. Source: #4821 and PR #4860.

## At a glance

| Question | Answer |
|---|---|
| How long will it take? | About 3.5 hours of agent work: 214 minutes of likely estimates, waiting on people excluded |
| What must ship? | Runtime, prompt and spoken-script fixes, the branch-first script, appointment facts, two-way only, the simulator, the deploy note |
| What is left out? | Opt-out checks before customers are called; the EU model profile; a form hint on Branch information |
| Biggest risk? | Two migrations and a new admin-site page require sign-off before they are written |
| When do we stop? | When a voice-only change leaks into SMS reminders, or the simulator requires a production call link |
| How is it proven? | Unit tests in both languages, static analysis, live-model runs, a simulator walkthrough, and a real call rated on the four conversational classes |
| What happens first? | A one-request live probe of a silence prompt then an answer, then the runtime fixes |

## What problem are we solving

- Customers hear a call that never says which branch is calling, misreads numbers and dates, and loses their answer after a pause.
- Office staff can only hear a conversation by dialling a tester's phone, and a branch can turn Voice on without any answer being recorded.

## Who benefits and how

- **Customers** hear which branch is calling, get where, what kind and how long answered, and have their yes or no saved.
- **Branches** get a working branch-first script the moment Voice is on, and every reminder records the customer's answer.
- **Office staff** can hear and demo a call from a browser without ringing anyone or touching a real reminder.
- **Whoever deploys** knows the one call that can go wrong and why.

## Requirements

- The seeded script names the branch, customer, technician and date and time, then asks for confirmation; a region with no template still gets it.
- Every contact number the branch supplies is spoken digit by digit in goodbyes and the agent's facts.
- The greeting survives the whole call, a pause then an answer still saves it, and a wrong-number reply is never saved as the customer's.
- On request the agent gives the address, appointment type and length, answers a question asked with a yes, and refuses other records.
- Every voice reminder asks for a keep-or-cancel answer; one-way mode is gone and queued reminders are converted.
- Names are spoken in title case and the date-only term as words, with SMS text unchanged.
- An admin-site page runs the conversation on the real model with a synthetic fixture, no call and no reminder write.
- The deploy order and its known gap are in the outbound guide.

## Tasks

Eight tasks totalling 214 minutes of likely estimates, about 3.5 hours of agent work.

- [ ] Probe silence then answer, then fix the runtime: numbers, pinned greeting, history hygiene, token cap and retry. = 30 min
- [ ] Rewrite the call prompt: wrong number outranks an answer, a yes with a question gets answered, garbled speech asks again. = 28 min
- [ ] Fix the spoken script: names through script values, date-only and legacy terms as words, test and guide tidy-ups. = 30 min
- [ ] Seed the default voice script and move the seeded wording to a branch-first opening. = 20 min
- [ ] Build the admin-site outbound simulator page and remove the demo tool. = 30 min
- [ ] Give the call the address, appointment type and length, answered on request. = 28 min
- [ ] Make every voice reminder two-way and remove the one-way path, with queued reminders converted. = 28 min
- [ ] Write the deploy note, update the decision record, and prove both suites and the walkthrough. = 20 min

## What each task gives the user

- A customer who pauses, hears a 1300 number, or talks for a while still has their yes or no saved.
- A stranger's words can no longer change a customer's appointment, and a customer who says yes and asks about parking gets both answered.
- Names and dates are read the way a person says them, whatever the branch stored and whichever date term its script uses.
- Every branch that turns Voice on gets a working script that says which branch is calling before it asks anything.
- Office staff can hear how a call goes, and demo it, from a browser without ringing anyone or touching a real reminder.
- A customer can ask where the appointment is, what kind it is and how long, and get the answer instead of a phone number.
- Every voice reminder records the customer's answer, so no call asks the question and then throws the answer away.
- Whoever deploys knows the one call that can go wrong and why, and the guide describes what actually shipped.

## Before and After Goals

Before is what a customer, branch or office staff member gets today; after is what they get once that task ships. Rows follow the task order.

| Change | Before | After |
|---|---|---|
| Runtime fixes: pauses, numbers, memory, retries | A customer who pauses once and then says "yes" may hear "Sorry, I can't continue this call", and nothing is saved. A 1300 number is read as "one thousand three hundred". On a long call the agent can forget the appointment it opened with. | The pause is handled and the yes is saved. Every number is read digit by digit. The agent remembers the opening for the whole call, and a model hiccup is retried once instead of ending the call. |
| Prompt rewrite: priorities, mixed turns, garbled speech | "Wrong number, I can't make it" is saved as the customer's cancellation. "Yes, where do I park?" ends with a goodbye and no parking answer. A garbled line can count as an unsure answer and use up a re-ask. | A wrong number gets an apology and nothing is saved. The yes is recorded and parking is answered in the goodbye. Garbled speech gets "Sorry, I didn't catch that" and the question again. |
| Spoken script: names and date terms | A customer "Mrs Sam Smith" booked with "Sam Lee" hears "Sam Smith" and "Sam Lee". A script using the date-only term hears "14-Oct-2026". | Titles and names come out as stored, and every date term is spoken as "Wednesday the 14th of October". |
| Seeded branch-first script | The call opens "Hi [customer], I'm calling to confirm your appointment with [technician] on [date]" and never says which branch. A region with no template of its own cannot place calls at all. | The call opens "Hello, this is [branch] calling for [customer] about your appointment with [technician] on [date]", and every region has a script. |
| Admin-site simulator page | To hear a conversation, someone dials a tester's phone. The only no-call check prints pass counts, not words. | Office staff open a page, pick a scenario or type replies, and read every word the agent would say, with no call made and no reminder touched. |
| Appointment facts in the call | "What's the address?" or "How long is it?" gets "the branch can help with that, call them on..." | The address, whether it is on site, by phone or by video, and the length are answered on request; other records are still refused. |
| Two-way only | A branch can tick Voice without Two-Way Response; the call still asks "can you confirm" and the customer's yes goes nowhere. | Every voice reminder asks and records the answer; the extra tick is gone and queued reminders are converted. |
| Deploy note and final proof | Nothing says a call dialled during the deploy hears the error goodbye, and the guide still quotes test counts from 8 October. | The guide states the deploy order, the one known gap and this plan's proof, and one real call has been rated on the four conversational classes. |

## Out of scope

- Opt-out checks before calls reach real customers: the tester list still rings; that gate belongs to the rollout ticket.
- The EU model profile: no EU testing region exists yet; a backlog item covers one EU simulator run.
- A form hint on what Branch information may say to a caller: a form change tracked separately.
```
