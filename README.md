# HackerNoon Vibe Authors API

> Find authors writing about vibe coding, indie hackers, solopreneurs, and bootstrapped startups on HackerNoon

## Try It

```bash
curl -X POST https://hackernoon-vibe-authors.nodeops.app/api/scrape \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "authors": [
      {
        "name": "John Doe",
        "handle": "johndoe",
        "profileUrl": "https://hackernoon.com/u/johndoe",
        "bio": "Indie hacker building in public",
        "twitter": "https://twitter.com/johndoe",
        "linkedin": "https://linkedin.com/in/johndoe",
        "github": "https://github.com/johndoe",
        "website": "https://johndoe.com",
        "matchedKeywords": ["indie hacker", "solopreneur"],
        "sampleArticles": [
          {
            "title": "How I Built My SaaS to $10k MRR",
            "url": "https://hackernoon.com/...",
            "keyword": "indie hacker"
          }
        ]
      }
    ],
    "stats": {
      "totalAuthors": 25,
      "withTwitter": 18,
      "withLinkedIn": 22,
      "withGitHub": 12,
      "withWebsite": 15
    }
  },
  "meta": { "credits": 50, "processingMs": 180000 }
}
```

## API Reference

### `POST /api/scrape`
Runs the scraper and returns author data.

**Request Body (optional):**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| keywords | string[] | No | Custom search keywords |
| tags | string[] | No | Custom HackerNoon tags to crawl |

**Default keywords:** vibe coding, indie hacker, solopreneur, solo founder, bootstrapped startup, side project, build in public, solo developer, indie developer, maker

**Default tags:** indie-hackers, solopreneurship, bootstrapping, side-project, startup-lessons, founders, saas, makers

### `GET /api/results`
Returns cached results from the last scrape.

### `GET /api/status`
Check if a scrape is currently running.

### `GET /api/csv`
Download cached results as a CSV file.

### Error Codes
| Code | Description |
|------|-------------|
| SCRAPE_IN_PROGRESS | A scrape is already running |
| NO_RESULTS | No cached results available |
| SCRAPE_FAILED | Scraping encountered an error |

## Pricing

| Operation | Credits | USD |
|-----------|---------|-----|
| Full scrape | 50 | $0.50 |
| Get cached results | 0 | $0.00 |

> At 10 scrapes/day, this Skill earns **$150/month** for the publisher.

## MCP Integration (AI Agents)

This Skill is auto-discoverable by AI agents via MCP:

```bash
# Fetch tool definition:
curl https://hackernoon-vibe-authors.nodeops.app/mcp-tool.json
```

## Deploy Your Own

```bash
git clone https://github.com/naman485/createos-skill-hackernoon-vibe-authors
cd createos-skill-hackernoon-vibe-authors
npx createos deploy
```

**Important:** This skill requires the Docker runtime on CreateOS due to Puppeteer/Chrome dependencies. Set memory to **1024MB** for reliable operation.

## Tech Stack
- Node.js 20 + Express
- Puppeteer for web scraping
- Deployed on [CreateOS](https://createos.nodeops.network)
