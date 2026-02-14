const puppeteer = require('puppeteer');

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

class HackerNoonScraper {
  constructor(existingState = {}) {
    this.browser = null;
    this.page = null;

    // Restore state from previous scrapes for continuation
    this.authorsMap = new Map(existingState.authorsMap || []);
    this.authorArticles = new Map(existingState.authorArticles || []);
    this.processedUrls = new Set(existingState.processedUrls || []);
    this.processedProfiles = new Set(existingState.processedProfiles || []);
    this.seenSlugs = new Set(existingState.seenSlugs || []);
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

  async init() {
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process'
      ]
    });
    this.page = await this.browser.newPage();
    await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
    await this.page.setViewport({ width: 1280, height: 800 });
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  cleanName(raw) {
    if (!raw) return '';
    return raw.replace(/^by\s*/i, '').replace(/@[\w-]+/g, '').replace(/\s+/g, ' ').trim();
  }

  async safeGoto(url, retries = 2) {
    for (let i = 0; i <= retries; i++) {
      try {
        await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
        await this.delay(2000);
        return true;
      } catch (err) {
        if (i === retries) return false;
        if (err.message.includes('detached') || err.message.includes('closed')) {
          await this.init();
        }
        await this.delay(2000);
      }
    }
    return false;
  }

  async extractArticles() {
    return this.page.evaluate(() => {
      const results = [];
      const seen = new Set();

      document.querySelectorAll('a[href]').forEach(el => {
        const href = el.getAttribute('href') || '';
        if (!href.startsWith('/') || href.length < 30) return;

        const skip = ['/u/', '/tagged/', '/search', '/signup', '/login', '/company/', '/write'];
        if (skip.some(s => href.includes(s))) return;
        if (!href.includes('-')) return;

        const parts = href.split('/').filter(Boolean);
        if (parts.length !== 1) return;

        const slug = parts[0];
        if (seen.has(slug)) return;
        seen.add(slug);

        let title = el.textContent?.trim() || '';
        const parent = el.closest('div, article, li');
        if (parent) {
          const h = parent.querySelector('h1, h2, h3, h4');
          if (h && h.textContent?.trim().length > title.length) {
            title = h.textContent.trim();
          }
        }

        title = title.replace(/\s+/g, ' ').trim();
        if (title.length >= 15 && title.length <= 250) {
          results.push({ slug, title, url: 'https://hackernoon.com/' + slug });
        }
      });

      return results;
    }).catch(() => []);
  }

  async collectFromSearch(keyword, scrollCount = 5, maxArticles = 15) {
    const url = `${HACKERNOON_BASE}/search?query=${encodeURIComponent(keyword)}`;
    if (!await this.safeGoto(url)) return [];

    await this.delay(2500);

    // Deeper scrolling for more results
    for (let i = 0; i < scrollCount; i++) {
      await this.page.evaluate(() => window.scrollBy(0, 1000));
      await this.delay(600);
    }

    let articles = await this.extractArticles();

    // Filter out already processed
    articles = articles.filter(a => {
      if (this.seenSlugs.has(a.slug)) return false;
      if (this.processedUrls.has(a.url)) return false;
      this.seenSlugs.add(a.slug);
      return true;
    });

    return articles.slice(0, maxArticles).map(a => ({ ...a, keyword, source: 'search' }));
  }

  async collectFromTag(tag, scrollCount = 6, maxArticles = 20) {
    const url = `${HACKERNOON_BASE}/tagged/${tag}`;
    if (!await this.safeGoto(url)) return [];

    await this.delay(2000);

    // Deeper scrolling for more results
    for (let i = 0; i < scrollCount; i++) {
      await this.page.evaluate(() => window.scrollBy(0, 1000));
      await this.delay(500);
    }

    let articles = await this.extractArticles();

    // Filter out already processed
    articles = articles.filter(a => {
      if (this.seenSlugs.has(a.slug)) return false;
      if (this.processedUrls.has(a.url)) return false;
      this.seenSlugs.add(a.slug);
      return true;
    });

    return articles.slice(0, maxArticles).map(a => ({ ...a, keyword: tag, source: 'tag' }));
  }

  async getAuthorFromArticle(article) {
    if (this.processedUrls.has(article.url)) return null;
    this.processedUrls.add(article.url);

    if (!await this.safeGoto(article.url, 1)) return null;

    return this.page.evaluate(() => {
      const title = document.querySelector('h1')?.textContent?.trim() || '';

      for (const link of document.querySelectorAll('a[href^="/u/"]')) {
        const href = link.getAttribute('href') || '';
        const handle = href.replace('/u/', '').split('?')[0].split('/')[0];
        if (handle && handle.length > 1 && handle.length < 50) {
          return {
            handle,
            name: link.textContent?.trim() || handle,
            profileUrl: 'https://hackernoon.com/u/' + handle,
            title
          };
        }
      }
      return null;
    }).catch(() => null);
  }

  async getProfile(profileUrl) {
    // Skip if already processed this profile
    if (this.processedProfiles.has(profileUrl)) return null;
    this.processedProfiles.add(profileUrl);

    if (!await this.safeGoto(profileUrl, 1)) return null;

    return this.page.evaluate(() => {
      let name = document.querySelector('h1')?.textContent?.trim() || '';
      name = name.replace(/^by\s+/i, '').replace(/@\w+/g, '').trim();

      let bio = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';

      const social = { twitter: null, linkedin: null, github: null, website: null };

      document.querySelectorAll('a[href]').forEach(link => {
        const href = link.getAttribute('href') || '';
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
            !['hackernoon', 'twitter', 'x.com', 'linkedin', 'github', 'facebook', 'youtube', 'instagram', 'medium', 'proofofusefulness'].some(x => h.includes(x)) &&
            !social.website) {
          social.website = href;
        }
      });

      return { name, bio, social };
    }).catch(() => null);
  }

  async scrape(options = {}) {
    const startTime = Date.now();
    const keywords = options.keywords || SEARCH_KEYWORDS;
    const tags = options.tags || TAG_PAGES;
    const scrollCount = options.scrollCount || 6;  // Deeper scrolling
    const maxArticlesPerSearch = options.maxArticlesPerSearch || 15;
    const maxArticlesPerTag = options.maxArticlesPerTag || 20;
    const continueMode = options.continueMode !== false; // Default true

    await this.init();

    const allArticles = [];
    const progress = { phase: 'collecting', current: 0, total: keywords.length + tags.length };

    console.log(`Starting scrape - Continue mode: ${continueMode}, Already processed: ${this.processedUrls.size} URLs`);

    // Collect from searches
    for (const kw of keywords) {
      progress.current++;
      console.log(`Searching: "${kw}" (${progress.current}/${progress.total})`);
      const articles = await this.collectFromSearch(kw, scrollCount, maxArticlesPerSearch);
      console.log(`  Found ${articles.length} new articles`);
      allArticles.push(...articles);
      await this.delay(1500);
    }

    // Collect from tags
    for (const tag of tags) {
      progress.current++;
      console.log(`Tag: ${tag} (${progress.current}/${progress.total})`);
      const articles = await this.collectFromTag(tag, scrollCount, maxArticlesPerTag);
      console.log(`  Found ${articles.length} new articles`);
      allArticles.push(...articles);
      await this.delay(1500);
    }

    console.log(`Total new articles to process: ${allArticles.length}`);

    progress.phase = 'extracting';
    progress.current = 0;
    progress.total = allArticles.length;

    // Extract authors
    let newAuthorsCount = 0;
    for (const article of allArticles) {
      progress.current++;
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
      await this.delay(1000);
    }

    console.log(`New authors found: ${newAuthorsCount}, Total authors: ${this.authorsMap.size}`);

    progress.phase = 'profiles';
    const authors = Array.from(this.authorsMap.values());
    progress.current = 0;

    // Only fetch profiles for authors we haven't processed yet
    const authorsNeedingProfile = authors.filter(a => !this.processedProfiles.has(a.profileUrl));
    progress.total = authorsNeedingProfile.length;

    console.log(`Fetching ${authorsNeedingProfile.length} new profiles...`);

    // Get profiles only for new authors
    for (const a of authorsNeedingProfile) {
      progress.current++;
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
      await this.delay(1000);
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

    await this.close();

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
