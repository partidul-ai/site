# Writing quiz questions

Every question in `questions/*.jsonl` must follow every rule below. Check each one when writing or reviewing a question. The schema is in [README.md](README.md).

## The question

1. **About the person, not facts.** Ask about their experience, satisfaction, priorities, expectations, trade-offs or trust. Never "what percentage…", never a question with a correct answer.
2. **Anyone can answer.** If it doesn't apply to everyone (no children, no car, retired, lives abroad…), add an `na` option. We know only county and age, so there are no screening questions.
3. **One subject.** No "și" / "sau" joining two subjects ("drumurile și transportul public").
4. **Neutral.** No loaded words or leading framing. Both "good" and "bad" answers are respectable.
5. **No parties, politicians or vote intention.** Ask about institutions, outcomes and trust. Measures may be named ("CASS pe pensii").
6. **General, not local.** No named county, city, hospital or road. "Localitatea ta" / "județul tău" is fine.
7. **Concrete.** Give a time window where it matters ("în ultimele 12 luni"). No vague "în general" unless it's a general-mood question.
8. **Clear to everyone.** Everyday words a person with no special education understands on first read. No jargon, no bureaucratic phrasing, no double negatives. Under ~30 words, second person singular ("tu"), gender-inclusive where needed ("mulțumit(ă)").
9. **Orderings say the order.** A question that asks to rank says by what and in which direction ("de la cel mai important la cel mai puțin important").

## The answer options

10. **One answer per option.** Never two levels in one label ("deloc sau puțin", "zilnic sau aproape zilnic"): make them separate options.
11. **Zero is an option.** If the true answer can be none or never, offer "Niciunul" / "Niciodată" as its own option, separate from "Aproape niciunul" / "Rar". Don't assume at least one.
12. **No "cam".** Write "Lunar", "Mare", not "Cam lunar", "Cam mare". It is colloquial and blurs the levels.
13. **Exhaustive, no overlap.** Ranges don't share boundaries. Include "Altceva" or "Nu știu" where needed. 2–8 options.

## Form

14. **Correct Romanian.** Comma-below ș ț (not cedilla ş ţ), Romanian quotes „…” if any.
15. **Countable.** Prefer structured types. `text` only where open answers add something the others can't (max 2 per domain).
16. **Grounded.** It comes from something in the wiki page: a problem, a change, a regional difference, a debate. `wiki.sources` lists the source numbers it relies on.
