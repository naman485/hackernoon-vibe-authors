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

// Store results and state in memory (for demo; use DB in production)
let cachedResults = null;
let lastScrapeTime = null;
let scrapeInProgress = false;
let scraperState = null;  // Persisted state for continuation
let scrapeHistory = [];   // Track scrape runs
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
      { method: 'GET', path: '/api/status', description: 'Check scrape job status' },
      { method: 'GET', path: '/api/csv', description: 'Download results as CSV' },
      { method: 'GET', path: '/dashboard', description: 'View results in UI' }
    ],
    dashboard: '/dashboard',
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

// GET /dashboard - Data viewer UI
app.get('/dashboard', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HackerNoon Vibe Authors - Dashboard</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 100%);
      color: #e4e4e7;
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 1400px; margin: 0 auto; }

    /* Header */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 30px;
      flex-wrap: wrap;
      gap: 20px;
    }
    .header h1 {
      font-size: 1.8rem;
      background: linear-gradient(90deg, #8b5cf6, #06b6d4);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .header-actions { display: flex; gap: 10px; }
    .btn {
      padding: 10px 20px;
      border: none;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      font-size: 0.9rem;
    }
    .btn-primary {
      background: linear-gradient(90deg, #8b5cf6, #7c3aed);
      color: white;
    }
    .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 4px 20px rgba(139, 92, 246, 0.4); }
    .btn-secondary {
      background: #27272a;
      color: #e4e4e7;
      border: 1px solid #3f3f46;
    }
    .btn-secondary:hover { background: #3f3f46; }
    .btn-danger {
      background: #dc2626;
      color: white;
    }
    .btn-danger:hover { background: #b91c1c; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Stats Cards */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: rgba(39, 39, 42, 0.6);
      backdrop-filter: blur(10px);
      border: 1px solid #3f3f46;
      border-radius: 12px;
      padding: 20px;
    }
    .stat-card .label { color: #a1a1aa; font-size: 0.85rem; margin-bottom: 8px; }
    .stat-card .value { font-size: 2rem; font-weight: 700; color: #fff; }
    .stat-card .icon { font-size: 1.5rem; float: right; opacity: 0.5; }

    /* Search & Filter */
    .toolbar {
      display: flex;
      gap: 15px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .search-box {
      flex: 1;
      min-width: 250px;
      padding: 12px 16px;
      background: #27272a;
      border: 1px solid #3f3f46;
      border-radius: 8px;
      color: #e4e4e7;
      font-size: 0.95rem;
    }
    .search-box:focus { outline: none; border-color: #8b5cf6; }
    .search-box::placeholder { color: #71717a; }

    /* Table */
    .table-container {
      background: rgba(39, 39, 42, 0.6);
      backdrop-filter: blur(10px);
      border: 1px solid #3f3f46;
      border-radius: 12px;
      overflow: hidden;
    }
    table { width: 100%; border-collapse: collapse; }
    th {
      background: #18181b;
      padding: 14px 16px;
      text-align: left;
      font-weight: 600;
      color: #a1a1aa;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      cursor: pointer;
      user-select: none;
    }
    th:hover { color: #8b5cf6; }
    td {
      padding: 14px 16px;
      border-top: 1px solid #27272a;
      font-size: 0.9rem;
    }
    tr:hover td { background: rgba(139, 92, 246, 0.05); }

    /* Social Links */
    .social-links { display: flex; gap: 8px; }
    .social-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      background: #27272a;
      border-radius: 6px;
      color: #a1a1aa;
      text-decoration: none;
      transition: all 0.2s;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .social-link:hover { background: #8b5cf6; color: white; }
    .social-link.twitter:hover { background: #1da1f2; }
    .social-link.linkedin:hover { background: #0077b5; }
    .social-link.github:hover { background: #333; }
    .social-link.website:hover { background: #10b981; }
    .social-link.disabled { opacity: 0.3; pointer-events: none; }

    /* Author Info */
    .author-name {
      font-weight: 600;
      color: #fff;
      text-decoration: none;
    }
    .author-name:hover { color: #8b5cf6; }
    .author-handle { color: #71717a; font-size: 0.8rem; }
    .author-bio {
      color: #a1a1aa;
      font-size: 0.85rem;
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .keywords {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .keyword {
      background: rgba(139, 92, 246, 0.2);
      color: #a78bfa;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
    }

    /* Status */
    .status-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 15px 0;
      color: #71717a;
      font-size: 0.85rem;
      flex-wrap: wrap;
      gap: 10px;
    }
    .status-indicator {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
    }
    .status-dot.scraping {
      background: #f59e0b;
      animation: pulse 1s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #71717a;
    }
    .empty-state h3 { color: #a1a1aa; margin-bottom: 10px; }

    /* Loading */
    .loading {
      display: flex;
      justify-content: center;
      padding: 40px;
    }
    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid #27272a;
      border-top-color: #8b5cf6;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Responsive */
    @media (max-width: 768px) {
      .header h1 { font-size: 1.4rem; }
      th, td { padding: 10px 12px; font-size: 0.8rem; }
      .author-bio { max-width: 150px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <h1>HackerNoon Vibe Authors</h1>
      <div class="header-actions">
        <button class="btn btn-danger" onclick="resetData()" title="Clear all data and start fresh">Reset</button>
        <button class="btn btn-secondary" onclick="downloadCSV()">Download CSV</button>
        <button class="btn btn-primary" id="scrapeBtn" onclick="startScrape()">Continue Scrape</button>
      </div>
    </header>

    <div class="stats-grid" id="statsGrid">
      <div class="stat-card">
        <div class="icon">👥</div>
        <div class="label">Total Authors</div>
        <div class="value" id="totalAuthors">-</div>
      </div>
      <div class="stat-card">
        <div class="icon">🆕</div>
        <div class="label">New This Run</div>
        <div class="value" id="newAuthors">-</div>
      </div>
      <div class="stat-card">
        <div class="icon">📄</div>
        <div class="label">URLs Processed</div>
        <div class="value" id="processedUrls">-</div>
      </div>
      <div class="stat-card">
        <div class="icon">🔄</div>
        <div class="label">Scrape Runs</div>
        <div class="value" id="scrapeRuns">-</div>
      </div>
      <div class="stat-card">
        <div class="icon">🐦</div>
        <div class="label">With Twitter</div>
        <div class="value" id="withTwitter">-</div>
      </div>
      <div class="stat-card">
        <div class="icon">💼</div>
        <div class="label">With LinkedIn</div>
        <div class="value" id="withLinkedIn">-</div>
      </div>
    </div>

    <div class="toolbar">
      <input type="text" class="search-box" id="searchBox" placeholder="Search authors, bios, keywords..." oninput="filterTable()">
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th onclick="sortTable('name')">Author</th>
            <th onclick="sortTable('bio')">Bio</th>
            <th>Social Links</th>
            <th onclick="sortTable('keywords')">Keywords</th>
          </tr>
        </thead>
        <tbody id="authorsTable">
          <tr><td colspan="4" class="loading"><div class="spinner"></div></td></tr>
        </tbody>
      </table>
    </div>

    <div class="status-bar">
      <div class="status-indicator">
        <span class="status-dot" id="statusDot"></span>
        <span id="statusText">Loading...</span>
      </div>
      <div id="lastUpdate">-</div>
    </div>
  </div>

  <script>
    let authors = [];
    let sortField = 'name';
    let sortAsc = true;

    async function loadData() {
      try {
        // Check status first
        const statusRes = await fetch('/api/status');
        const status = await statusRes.json();

        updateStatus(status.data);

        if (!status.data.hasCachedResults) {
          document.getElementById('authorsTable').innerHTML =
            '<tr><td colspan="4" class="empty-state"><h3>No Data Yet</h3><p>Click "Run Scrape" to find authors</p></td></tr>';
          return;
        }

        // Load results
        const res = await fetch('/api/results');
        const data = await res.json();

        if (data.success) {
          authors = data.data.authors;
          updateStats(data.data.stats, status.data);
          renderTable();
          document.getElementById('lastUpdate').textContent =
            'Last updated: ' + new Date(data.meta.cachedAt).toLocaleString();
        }
      } catch (err) {
        console.error(err);
        document.getElementById('authorsTable').innerHTML =
          '<tr><td colspan="4" class="empty-state"><h3>Error loading data</h3></td></tr>';
      }
    }

    function updateStats(stats, statusData = {}) {
      document.getElementById('totalAuthors').textContent = stats.totalAuthors || 0;
      document.getElementById('newAuthors').textContent = stats.newAuthorsThisRun || 0;
      document.getElementById('withTwitter').textContent = stats.withTwitter || 0;
      document.getElementById('withLinkedIn').textContent = stats.withLinkedIn || 0;
      document.getElementById('processedUrls').textContent = statusData.processedUrls || stats.totalArticlesProcessed || 0;
      document.getElementById('scrapeRuns').textContent = statusData.scrapeRuns || 0;
    }

    function updateStatus(status) {
      const dot = document.getElementById('statusDot');
      const text = document.getElementById('statusText');
      const btn = document.getElementById('scrapeBtn');

      if (status.scrapeInProgress) {
        dot.className = 'status-dot scraping';
        text.textContent = 'Scraping in progress...';
        btn.disabled = true;
        btn.textContent = 'Scraping...';
        setTimeout(loadData, 5000);
      } else {
        dot.className = 'status-dot';
        if (status.hasState && status.processedUrls > 0) {
          text.textContent = 'Ready (' + status.processedUrls + ' URLs cached)';
          btn.textContent = 'Continue Scrape';
        } else {
          text.textContent = 'Ready - No previous data';
          btn.textContent = 'Start Scrape';
        }
        btn.disabled = false;
      }
    }

    function renderTable() {
      const search = document.getElementById('searchBox').value.toLowerCase();
      let filtered = authors.filter(a =>
        a.name?.toLowerCase().includes(search) ||
        a.bio?.toLowerCase().includes(search) ||
        a.matchedKeywords?.some(k => k.toLowerCase().includes(search))
      );

      filtered.sort((a, b) => {
        let valA = a[sortField] || '';
        let valB = b[sortField] || '';
        if (sortField === 'keywords') {
          valA = a.matchedKeywords?.join(',') || '';
          valB = b.matchedKeywords?.join(',') || '';
        }
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      });

      if (filtered.length === 0) {
        document.getElementById('authorsTable').innerHTML =
          '<tr><td colspan="4" class="empty-state"><h3>No matching authors</h3></td></tr>';
        return;
      }

      document.getElementById('authorsTable').innerHTML = filtered.map(a => \`
        <tr>
          <td>
            <a href="\${a.profileUrl}" target="_blank" class="author-name">\${a.name || a.handle}</a>
            <div class="author-handle">@\${a.handle}</div>
          </td>
          <td><div class="author-bio" title="\${a.bio || ''}">\${a.bio || '-'}</div></td>
          <td>
            <div class="social-links">
              <a href="\${a.twitter || '#'}" target="_blank" class="social-link twitter \${a.twitter ? '' : 'disabled'}" title="Twitter">X</a>
              <a href="\${a.linkedin || '#'}" target="_blank" class="social-link linkedin \${a.linkedin ? '' : 'disabled'}" title="LinkedIn">in</a>
              <a href="\${a.github || '#'}" target="_blank" class="social-link github \${a.github ? '' : 'disabled'}" title="GitHub">GH</a>
              <a href="\${a.website || '#'}" target="_blank" class="social-link website \${a.website ? '' : 'disabled'}" title="Website">🌐</a>
            </div>
          </td>
          <td>
            <div class="keywords">
              \${(a.matchedKeywords || []).map(k => \`<span class="keyword">\${k}</span>\`).join('')}
            </div>
          </td>
        </tr>
      \`).join('');
    }

    function filterTable() { renderTable(); }

    function sortTable(field) {
      if (sortField === field) {
        sortAsc = !sortAsc;
      } else {
        sortField = field;
        sortAsc = true;
      }
      renderTable();
    }

    async function startScrape() {
      const btn = document.getElementById('scrapeBtn');
      btn.disabled = true;
      btn.textContent = 'Starting...';

      try {
        fetch('/api/scrape', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        setTimeout(loadData, 2000);
      } catch (err) {
        alert('Failed to start scrape');
        btn.disabled = false;
        btn.textContent = 'Run Scrape';
      }
    }

    function downloadCSV() {
      window.location.href = '/api/csv';
    }

    async function resetData() {
      if (!confirm('This will clear all scraped data and start fresh. Continue?')) return;

      try {
        await fetch('/api/reset', { method: 'POST' });
        authors = [];
        document.getElementById('totalAuthors').textContent = '0';
        document.getElementById('newAuthors').textContent = '0';
        document.getElementById('processedUrls').textContent = '0';
        document.getElementById('scrapeRuns').textContent = '0';
        document.getElementById('withTwitter').textContent = '0';
        document.getElementById('withLinkedIn').textContent = '0';
        document.getElementById('authorsTable').innerHTML =
          '<tr><td colspan="4" class="empty-state"><h3>Data Cleared</h3><p>Click "Continue Scrape" to start fresh</p></td></tr>';
        document.getElementById('lastUpdate').textContent = 'Data reset';
      } catch (err) {
        alert('Failed to reset data');
      }
    }

    // Initial load
    loadData();
  </script>
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
      cachedAuthorsCount: cachedResults?.authors?.length || 0,
      hasState: scraperState !== null,
      processedUrls: scraperState?.processedUrls?.length || 0,
      processedProfiles: scraperState?.processedProfiles?.length || 0,
      scrapeRuns: scrapeHistory.length,
      lastRunNewAuthors: cachedResults?.stats?.newAuthorsThisRun || 0
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

// POST /api/scrape - Run scraper (supports continuation)
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
    const { keywords, tags, continueMode = true, reset = false } = req.body || {};

    // Reset state if requested
    if (reset) {
      scraperState = null;
      cachedResults = null;
      scrapeHistory = [];
      console.log('State reset - starting fresh');
    }

    // Create scraper with existing state for continuation
    const scraper = new HackerNoonScraper(continueMode ? scraperState : null);

    const results = await scraper.scrape({
      keywords: keywords || SEARCH_KEYWORDS,
      tags: tags || TAG_PAGES,
      continueMode
    });

    // Save state for next continuation
    scraperState = results.state;
    cachedResults = results;
    lastScrapeTime = new Date().toISOString();

    // Track history
    scrapeHistory.push({
      time: lastScrapeTime,
      newAuthors: results.stats.newAuthorsThisRun,
      totalAuthors: results.stats.totalAuthors,
      articlesProcessed: results.stats.articlesProcessed
    });

    res.json({
      success: true,
      data: results,
      meta: {
        credits: 50,
        processingMs: Date.now() - startMs,
        continued: continueMode && scraperState !== null,
        runNumber: scrapeHistory.length
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

// POST /api/reset - Clear all cached data and state
app.post('/api/reset', (req, res) => {
  scraperState = null;
  cachedResults = null;
  scrapeHistory = [];
  lastScrapeTime = null;

  res.json({
    success: true,
    data: { message: 'All data and state cleared' },
    meta: { credits: 0, processingMs: 0 }
  });
});

// GET /api/history - Get scrape run history
app.get('/api/history', (req, res) => {
  res.json({
    success: true,
    data: {
      runs: scrapeHistory,
      totalRuns: scrapeHistory.length,
      hasState: scraperState !== null,
      processedUrls: scraperState?.processedUrls?.length || 0,
      processedProfiles: scraperState?.processedProfiles?.length || 0
    },
    meta: { credits: 0, processingMs: 0 }
  });
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
