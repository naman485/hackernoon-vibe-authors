const cheerio = require('cheerio');

const SEARCH_KEYWORDS = [
  'vibe coding', 'indie hacker', 'solopreneur', 'solo founder',
  'bootstrapped startup', 'side project', 'build in public',
  'solo developer', 'indie developer', 'maker'
];

const TAG_PAGES = [
  'indie-hackers', 'solopreneurship', 'bootstrapping', 'side-project',
  'startup-lessons', 'founders', 'saas', 'makers'
];

const HACKERNOON_BASE = 'https://hackernoon.com';

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

class HackerNoonScraper {
  constructor(existingState) {
    // Restore state from previous scrapes for continuation
    const state = existingState || {};
    this.authorsMap = new Map(state.authorsMap || []);
    this.authorArticles = new Map(state.authorArticles || []);
    this.processedUrls = new Set(state.processedUrls || []);
    this.processedProfiles = new Set(state.processedProfiles || []);
    this.seenSlugs = new Set(state.seenSlugs || []);
  }

  // Export state for persistence
  exportState() {
    return {
      processedUrls: Array.from(this.processedUrls),
      processedProfiles: Array.from(this.processedProfiles),
      seenSlugs: Array.from(this.seenSlugs),
      authorsMap: Array.from(this.authorsMap.entries()),
      authorArticles: Array.from(this.authorArticles.entries()).map(([k, v]) => [k, v])
    };
  }

  delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  }

  cleanName(raw) {
    if (!raw) return '';
    return raw.replace(/^by\s*/i, '').replace(/@[\w-]+/g, '').replace(/\s+/g, ' ').trim();
  }

  async fetchPage(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': this.getRandomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Cache-Control': 'max-age=0'
          }
        });

        if (!response.ok) {
          console.log(`  HTTP ${response.status} for ${url}`);
          if (response.status === 429) {
            // Rate limited - wait longer
            await this.delay(5000 * (i + 1));
            continue;
          }
          return null;
        }

        const html = await response.text();
        return cheerio.load(html);
      } catch (err) {
        console.log(`  Fetch error (attempt ${i + 1}): ${err.message}`);
        await this.delay(2000 * (i + 1));
      }
    }
    return null;
  }

  extractArticlesFromPage($) {
    const results = [];
    const seen = new Set();

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!href.startsWith('/') || href.length < 20) return;

      const skip = ['/u/', '/tagged/', '/search', '/signup', '/login', '/company/', '/write', '/c/', '/about'];
      if (skip.some(s => href.includes(s))) return;
      if (!href.includes('-')) return;

      const parts = href.split('/').filter(Boolean);
      if (parts.length !== 1) return;

      const slug = parts[0];
      if (seen.has(slug)) return;
      seen.add(slug);

      // Get title from the element or parent
      let title = $(el).text().trim();
      const parent = $(el).closest('div, article, li');
      if (parent.length) {
        const h = parent.find('h1, h2, h3, h4').first();
        if (h.length && h.text().trim().length > title.length) {
          title = h.text().trim();
        }
      }

      title = title.replace(/\s+/g, ' ').trim();
      if (title.length >= 10 && title.length <= 300) {
        results.push({ slug, title, url: HACKERNOON_BASE + '/' + slug });
      }
    });

    return results;
  }

  async collectFromSearch(keyword, maxArticles = 15) {
    const url = `${HACKERNOON_BASE}/search?query=${encodeURIComponent(keyword)}`;
    console.log(`  Fetching search: ${keyword}`);

    const $ = await this.fetchPage(url);
    if (!$) return [];

    let articles = this.extractArticlesFromPage($);

    // Filter out already processed
    articles = articles.filter(a => {
      if (this.seenSlugs.has(a.slug)) return false;
      if (this.processedUrls.has(a.url)) return false;
      this.seenSlugs.add(a.slug);
      return true;
    });

    console.log(`    Found ${articles.length} new articles`);
    return articles.slice(0, maxArticles).map(a => ({ ...a, keyword, source: 'search' }));
  }

  async collectFromTag(tag, maxArticles = 20) {
    const url = `${HACKERNOON_BASE}/tagged/${tag}`;
    console.log(`  Fetching tag: ${tag}`);

    const $ = await this.fetchPage(url);
    if (!$) return [];

    let articles = this.extractArticlesFromPage($);

    // Filter out already processed
    articles = articles.filter(a => {
      if (this.seenSlugs.has(a.slug)) return false;
      if (this.processedUrls.has(a.url)) return false;
      this.seenSlugs.add(a.slug);
      return true;
    });

    console.log(`    Found ${articles.length} new articles`);
    return articles.slice(0, maxArticles).map(a => ({ ...a, keyword: tag, source: 'tag' }));
  }

  async getAuthorFromArticle(article) {
    if (this.processedUrls.has(article.url)) return null;
    this.processedUrls.add(article.url);

    const $ = await this.fetchPage(article.url);
    if (!$) return null;

    // Find author link
    let authorHandle = null;
    let authorName = null;

    $('a[href^="/u/"]').each((_, el) => {
      if (authorHandle) return;
      const href = $(el).attr('href') || '';
      const handle = href.replace('/u/', '').split('?')[0].split('/')[0];
      if (handle && handle.length > 1 && handle.length < 50) {
        authorHandle = handle;
        authorName = $(el).text().trim() || handle;
      }
    });

    if (!authorHandle) return null;

    const title = $('h1').first().text().trim() || '';

    return {
      handle: authorHandle,
      name: authorName,
      profileUrl: HACKERNOON_BASE + '/u/' + authorHandle,
      title
    };
  }

  async getProfile(profileUrl) {
    if (this.processedProfiles.has(profileUrl)) return null;
    this.processedProfiles.add(profileUrl);

    const $ = await this.fetchPage(profileUrl);
    if (!$) return null;

    let name = $('h1').first().text().trim() || '';
    name = name.replace(/^by\s+/i, '').replace(/@\w+/g, '').trim();

    let bio = $('meta[name="description"]').attr('content') || '';

    const social = { twitter: null, linkedin: null, github: null, website: null };

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const h = href.toLowerCase();

      if ((h.includes('twitter.com/') || h.includes('x.com/')) && !h.includes('hackernoon') && !social.twitter) {
        social.twitter = href;
      }
      if (h.includes('linkedin.com/') && !social.linkedin) {
        social.linkedin = href;
      }
      if (h.includes('github.com/') && !h.includes('hackernoon') && !social.github) {
        social.github = href;
      }
      if (href.startsWith('http') &&
          !['hackernoon', 'twitter', 'x.com', 'linkedin', 'github', 'facebook', 'youtube', 'instagram', 'medium'].some(x => h.includes(x)) &&
          !social.website) {
        social.website = href;
      }
    });

    return { name, bio, social };
  }

  async scrape(options = {}) {
    const startTime = Date.now();
    const keywords = options.keywords || SEARCH_KEYWORDS;
    const tags = options.tags || TAG_PAGES;
    const maxArticlesPerSearch = options.maxArticlesPerSearch || 15;
    const maxArticlesPerTag = options.maxArticlesPerTag || 20;

    console.log(`Starting scrape - Already processed: ${this.processedUrls.size} URLs`);

    const allArticles = [];

    // Collect from searches
    console.log('Phase 1: Searching keywords...');
    for (const kw of keywords) {
      const articles = await this.collectFromSearch(kw, maxArticlesPerSearch);
      allArticles.push(...articles);
      await this.delay(1500); // Be nice to the server
    }

    // Collect from tags
    console.log('Phase 2: Crawling tags...');
    for (const tag of tags) {
      const articles = await this.collectFromTag(tag, maxArticlesPerTag);
      allArticles.push(...articles);
      await this.delay(1500);
    }

    console.log(`Total new articles to process: ${allArticles.length}`);

    // Extract authors
    console.log('Phase 3: Extracting authors from articles...');
    let newAuthorsCount = 0;
    let processedCount = 0;

    for (const article of allArticles) {
      processedCount++;
      if (processedCount % 10 === 0) {
        console.log(`  Progress: ${processedCount}/${allArticles.length} articles`);
      }

      const author = await this.getAuthorFromArticle(article);

      if (author?.handle) {
        const isNewAuthor = !this.authorsMap.has(author.handle);
        if (isNewAuthor) newAuthorsCount++;

        if (!this.authorArticles.has(author.handle)) {
          this.authorArticles.set(author.handle, []);
        }
        this.authorArticles.get(author.handle).push({
          title: author.title || article.title,
          url: article.url,
          keyword: article.keyword
        });

        if (!this.authorsMap.has(author.handle)) {
          this.authorsMap.set(author.handle, {
            handle: author.handle,
            name: this.cleanName(author.name),
            profileUrl: author.profileUrl,
            keywords: new Set([article.keyword])
          });
        } else {
          this.authorsMap.get(author.handle).keywords.add(article.keyword);
        }
      }
      await this.delay(800);
    }

    console.log(`New authors found: ${newAuthorsCount}, Total authors: ${this.authorsMap.size}`);

    // Get profiles for new authors
    const authors = Array.from(this.authorsMap.values());
    const authorsNeedingProfile = authors.filter(a => !a.bio && !this.processedProfiles.has(a.profileUrl));

    console.log(`Phase 4: Fetching ${authorsNeedingProfile.length} profiles...`);

    for (const a of authorsNeedingProfile) {
      const profile = await this.getProfile(a.profileUrl);

      if (profile) {
        a.bio = profile.bio?.replace(/\s+/g, ' ').trim() || '';
        a.twitter = profile.social.twitter || '';
        a.linkedin = profile.social.linkedin || '';
        a.github = profile.social.github || '';
        a.website = profile.social.website || '';

        if (profile.name && profile.name.length > (a.name?.length || 0)) {
          a.name = this.cleanName(profile.name);
        }
      }
      await this.delay(800);
    }

    // Finalize all authors
    const finalAuthors = authors.map(a => {
      const arts = this.authorArticles.get(a.handle) || [];
      return {
        handle: a.handle,
        name: a.name && a.name.length >= 2 ? a.name : a.handle,
        profileUrl: a.profileUrl,
        bio: a.bio || '',
        twitter: a.twitter || '',
        linkedin: a.linkedin || '',
        github: a.github || '',
        website: a.website || '',
        sampleArticles: arts.slice(0, 5).map(x => ({
          title: x.title,
          url: x.url,
          keyword: x.keyword
        })),
        matchedKeywords: Array.from(a.keywords || [])
      };
    });

    console.log(`Scrape complete! Total authors: ${finalAuthors.length}`);

    return {
      authors: finalAuthors,
      stats: {
        totalAuthors: finalAuthors.length,
        newAuthorsThisRun: newAuthorsCount,
        withTwitter: finalAuthors.filter(a => a.twitter).length,
        withLinkedIn: finalAuthors.filter(a => a.linkedin).length,
        withGitHub: finalAuthors.filter(a => a.github).length,
        withWebsite: finalAuthors.filter(a => a.website).length,
        articlesProcessed: allArticles.length,
        totalArticlesProcessed: this.processedUrls.size,
        processingTimeMs: Date.now() - startTime
      },
      state: this.exportState()
    };
  }
}

module.exports = { HackerNoonScraper, SEARCH_KEYWORDS, TAG_PAGES };
