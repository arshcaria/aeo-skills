# aeo-skills

Personal AI agent skills.

## Directory Layout

- `skills/<skill-directory>/SKILL.md`: skill entrypoint
- `skills/<skill-directory>/scripts/`: helper scripts used by the skill
- `skills/<skill-directory>/references/`: supporting reference docs

## Skills

- `skills/fund-holdings-skill/`: fetch historical Chinese mutual fund holdings from Eastmoney and export Excel workbooks.
- `skills/export-bgee-visible-save/`: parse BGEE or SoD saves and export player-visible party data to a timestamped CSV.
