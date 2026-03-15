# 3-line-diary-scheduler

Automated Bluesky posting scheduler for Chinese 3-Line Diary, powered by Notion and GitHub Actions.

## Overview

This repository manages the automated workflow for posting daily Chinese diary entries to Bluesky. Content is managed in Notion, and GitHub Actions handles scheduled posting.

## Architecture
```
Notion (Questions / Answers / Words DBs)
  ↓ GitHub Actions (daily cron at 21:00 JST)
  ↓ Fetch answers where Scheduled At <= now AND Posted = false
  ↓ Post to Bluesky
  ↓ Update Notion (Posted = true, Bluesky URI, Posted At)
```

## Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `NOTION_TOKEN` | Notion Integration token |
| `NOTION_ANSWERS_DB_ID` | Notion Answers database ID |
| `BLUESKY_HANDLE` | Bluesky handle (e.g. `en0ki.bsky.social`) |
| `BLUESKY_APP_PASSWORD` | Bluesky App Password |

## Workflows

### `post.yml` — Scheduled Posting

Runs daily at 12:00 UTC (21:00 JST). Fetches all answers where:
- `Scheduled At` is in the past
- `Posted` is unchecked

Posts each to Bluesky and updates Notion accordingly.

Can also be triggered manually via `workflow_dispatch`.

### `migrate.yml` — Data Migration (one-time, already completed)

Manual trigger only. Used to migrate existing data from Supabase CSV exports to Notion.

To reuse: place CSV files in the `data/` directory before running:
- `data/questions_rows.csv`
- `data/answers_rows.csv`

## Post Format
```
質問: {question_zh}

回答:
{answer_zh}

書きたかったこと:
{intended_ja}

#中国語3行日記 #中文学习 #3行日记
#enoki_Day{day_number}[_term{term}]
```

## Local Development
```bash
npm install

# Run post script locally
NOTION_TOKEN=xxx NOTION_ANSWERS_DB_ID=xxx BLUESKY_HANDLE=xxx BLUESKY_APP_PASSWORD=xxx npm run post
```