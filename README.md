# GitHub Activity Tracker

A static, serverless dashboard that counts public GitHub commits per UTC day.

The page uses GitHub's public REST API without a PAT or OAuth flow. Enter an owner/org slug and repository name, or paste a GitHub repository URL. The dashboard tracks the longer window of:

- the last 90 UTC days
- the full repository lifetime since `created_at`

## Run locally

```sh
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Test

```sh
npm test
```

## Deploy

The app is plain static files, so GitHub Pages can serve it directly from the `main` branch root.

## Notes

- Unauthenticated GitHub API requests are rate limited. Very large or old repositories can require many paginated requests.
- Counts are grouped by the commit object's committer date in UTC, falling back to author date if needed.
- Empty repositories return zero commits across the selected date range.
