# /data/seed — Sample data for development

This folder is committed to version control so new developers get working
reference data on first checkout, even though the runtime JSON files in
the parent `/data` folder are gitignored.

## What's in here

The JSON files in this folder are a **snapshot** of the output produced
by `npm run seed` against the original `Tiger_Team_Projects.xlsx`. They
reflect the state of the migrated data at the time the snapshot was
taken, with names like `Min` and `Josh` left as plain strings (Step 2
will resolve them to user IDs).

| File                     | Contents                                  |
| ------------------------ | ----------------------------------------- |
| `projects.json`          | 7 projects (Tiger Team migration)         |
| `tasks.json`             | 20 tasks                                  |
| `ideas.json`             | `[]` (none in the source spreadsheet)     |
| `users.json`             | `[]` (Step 2 populates this)              |
| `notifications.json`     | `[]`                                      |
| `decisions.json`         | `[]`                                      |
| `templates.json`         | `[]`                                      |
| `settings.json`          | `{}` (defaults applied at read time)      |
| `users-to-invite.json`   | 6 names collected from the spreadsheet    |

## How to use these files

The seed snapshot is a reference, not the runtime store. The application
reads from `/data/*.json` (one level up). Two reasonable workflows:

**(1) Re-run the seed.** Preferred when the source spreadsheet has changed.

```bash
npm run seed
```

This wipes and rewrites every runtime file from the live spreadsheet.

**(2) Hand-copy the snapshot.** Useful when you want quick sample data
without touching the spreadsheet:

```bash
cp data/seed/*.json data/
```

## Refreshing this snapshot

If the source spreadsheet changes and you want the committed snapshot to
reflect it, run the seed and then copy the runtime files back here:

```bash
npm run seed
cp data/{projects,tasks,ideas,users,notifications,decisions,templates,settings}.json data/seed/
```
