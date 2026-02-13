const express = require('express');
const cors = require('cors');
const { HackerNoonScraper, SEARCH_KEYWORDS, TAG_PAGES } = require('./lib/scraper');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// CORS headers for all responses
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Store results in memory (for demo; use DB in production)
let cachedResults = null;
let lastScrapeTime = null;
let scrapeInProgress = false;
const startTime = Date.now();

// GET / - Service info
app.get('/', (req, res) => {
  res.json({
    name: 'hackernoon-vibe-authors',
    version: '1.0.0',
    description: 'Scrapes HackerNoon to find authors writing about vibe coding, indie hackers, solopreneurs, and related topics',
    pricing: { credits: 50, usd: '$0.50' },
    endpoints: [
      { method: 'POST', path: '/api/scrape', description: 'Start a new scrape job' },
      { method: 'GET', path: '/api/results', description: 'Get cached scrape results' },
      { method: 'GET', path: '/api/status', description: 'Check scrape job status' }
    ],
    docs: '/docs',
    health: '/health',
    mcp: '/mcp-tool.json',
    defaultKeywords: SEARCH_KEYWORDS,
    defaultTags: TAG_PAGES
  });
});

// GET /health - Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: '1.0.0',
    scrapeInProgress,
    lastScrapeTime,
    hasCachedResults: !!cachedResults
  });
});

// GET /docs - Documentation
app.get('/docs', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>HackerNoon Vibe Authors API</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'IBM Plex Mono', monospace;
      background: #0d1117;
      color: #c9d1d9;
      max-width: 900px;
      margin: 0 auto;
      padding: 40px 20px;
      line-height: 1.6;
    }
    h1 { color: #58a6ff; border-bottom: 1px solid #30363d; padding-bottom: 10px; }
    h2 { color: #8b949e; margin-top: 40px; }
    code {
      background: #161b22;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.9em;
    }
    pre {
      background: #161b22;
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
      border: 1px solid #30363d;
    }
    .endpoint {
      background: #161b22;
      padding: 20px;
      border-radius: 8px;
      margin: 20px 0;
      border-left: 3px solid #58a6ff;
    }
    .method {
      background: #238636;
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-weight: bold;
      font-size: 0.85em;
    }
    .method.post { background: #8957e5; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    th, td { text-align: left; padding: 10px; border-bottom: 1px solid #30363d; }
    th { color: #8b949e; }
    .note { background: #161b22; padding: 15px; border-radius: 8px; border-left: 3px solid #f0883e; margin: 20px 0; }
  </style>
</head>
<body>
  <h1>HackerNoon Vibe Authors API</h1>
  <p>Find authors writing about vibe coding, indie hackers, solopreneurs, and related topics on HackerNoon.</p>

  <h2>Quick Start</h2>
  <pre>curl -X POST https://your-app.nodeops.app/api/scrape \\
  -H "Content-Type: application/json" \\
  -d '{}'</pre>

  <h2>Endpoints</h2>

  <div class="endpoint">
    <span class="method post">POST</span> <code>/api/scrape</code>
    <p>Start a new scrape job. Returns author data when complete.</p>
    <h4>Request Body (optional):</h4>
    <table>
      <tr><th>Field</th><th>Type</th><th>Description</th></tr>
      <tr><td>keywords</td><td>string[]</td><td>Custom search keywords</td></tr>
      <tr><td>tags</td><td>string[]</td><td>Custom tag pages to crawl</td></tr>
    </table>
    <h4>Example:</h4>
    <pre>curl -X POST /api/scrape -H "Content-Type: application/json" \\
  -d '{"keywords": ["vibe coding", "indie hacker"]}'</pre>
  </div>

  <div class="endpoint">
    <span class="method">GET</span> <code>/api/results</code>
    <p>Get cached results from the last scrape.</p>
  </div>

  <div class="endpoint">
    <span class="method">GET</span> <code>/api/status</code>
    <p>Check if a scrape is in progress.</p>
  </div>

  <h2>Response Format</h2>
  <pre>{
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
        "sampleArticles": [...]
      }
    ],
    "stats": { ... }
  },
  "meta": { "credits": 50, "processingMs": 120000 }
}</pre>

  <div class="note">
    <strong>Note:</strong> Scraping takes 2-5 minutes depending on the number of keywords and articles found.
  </div>

  <h2>Pricing</h2>
  <table>
    <tr><th>Operation</th><th>Credits</th><th>USD</th></tr>
    <tr><td>Full scrape</td><td>50</td><td>$0.50</td></tr>
  </table>

  <h2>MCP Integration</h2>
  <pre>GET /mcp-tool.json</pre>
  <p>Fetch the MCP tool definition for AI agent integration.</p>
</body>
</html>`);
});

// GET /mcp-tool.json - MCP tool definition
app.get('/mcp-tool.json', (req, res) => {
  res.json({
    name: 'scrape_hackernoon_authors',
    description: 'Scrapes HackerNoon to find authors writing about vibe coding, indie hackers, solopreneurs, bootstrapped startups, and related topics. Returns author profiles with social links and sample articles.',
    inputSchema: {
      type: 'object',
      properties: {
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Search keywords to find relevant articles (default: vibe coding, indie hacker, solopreneur, etc.)'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'HackerNoon tag pages to crawl (default: indie-hackers, solopreneurship, bootstrapping, etc.)'
        }
      },
      required: []
    },
    endpoint: 'POST /api/scrape',
    pricing: {
      credits: 50,
      usd: 0.50
    }
  });
});

// GET /api/status - Check scrape status
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    data: {
      scrapeInProgress,
      lastScrapeTime,
      hasCachedResults: !!cachedResults,
      cachedAuthorsCount: cachedResults?.authors?.length || 0
    },
    meta: { credits: 0, processingMs: 0 }
  });
});

// GET /api/results - Get cached results
app.get('/api/results', (req, res) => {
  if (!cachedResults) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'NO_RESULTS',
        message: 'No cached results available. Run POST /api/scrape first.'
      }
    });
  }

  res.json({
    success: true,
    data: cachedResults,
    meta: {
      credits: 0,
      processingMs: 0,
      cachedAt: lastScrapeTime
    }
  });
});

// POST /api/scrape - Run scraper
app.post('/api/scrape', async (req, res) => {
  if (scrapeInProgress) {
    return res.status(409).json({
      success: false,
      error: {
        code: 'SCRAPE_IN_PROGRESS',
        message: 'A scrape is already in progress. Please wait.'
      }
    });
  }

  const startMs = Date.now();
  scrapeInProgress = true;

  try {
    const { keywords, tags } = req.body || {};

    const scraper = new HackerNoonScraper();
    const results = await scraper.scrape({
      keywords: keywords || SEARCH_KEYWORDS,
      tags: tags || TAG_PAGES
    });

    cachedResults = results;
    lastScrapeTime = new Date().toISOString();

    res.json({
      success: true,
      data: results,
      meta: {
        credits: 50,
        processingMs: Date.now() - startMs
      }
    });

  } catch (error) {
    console.error('Scrape error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SCRAPE_FAILED',
        message: error.message || 'Scraping failed'
      }
    });
  } finally {
    scrapeInProgress = false;
  }
});

// GET /api/csv - Download results as CSV
app.get('/api/csv', (req, res) => {
  if (!cachedResults) {
    return res.status(404).json({
      success: false,
      error: { code: 'NO_RESULTS', message: 'No cached results. Run POST /api/scrape first.' }
    });
  }

  const headers = ['Author Name', 'Handle', 'Profile URL', 'Bio', 'Twitter/X', 'LinkedIn', 'GitHub', 'Website', 'Matched Keywords', 'Sample Articles'];
  const rows = cachedResults.authors.map(a => [
    a.name,
    a.handle,
    a.profileUrl,
    `"${(a.bio || '').replace(/"/g, '""')}"`,
    a.twitter || '',
    a.linkedin || '',
    a.github || '',
    a.website || '',
    `"${a.matchedKeywords?.join(', ') || ''}"`,
    `"${a.sampleArticles?.map(s => s.title + ' - ' + s.url).join(' | ') || ''}"`
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=hackernoon_authors_${new Date().toISOString().split('T')[0]}.csv`);
  res.send(csv);
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An internal error occurred'
    }
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 HackerNoon Vibe Authors API running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Docs:   http://localhost:${PORT}/docs`);
  console.log(`   MCP:    http://localhost:${PORT}/mcp-tool.json`);
});

module.exports = app;
