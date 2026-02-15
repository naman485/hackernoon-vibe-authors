const cheerio = require('cheerio');

const SEARCH_KEYWORDS = [
  'vibe coding', 'indie hacker', 'solopreneur', 'solo founder',
  'bootstrapped startup', 'side project', 'build in public',
  'solo developer', 'indie developer', 'maker'
];

const TAG_KEYWORDS = [
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
    const state = existingState || {};
    this.authorsMap = new Map(state.authorsMap || []);
    this.authorArticles = new Map(state.authorArticles || []);
    this.processedUrls = new Set(state.processedUrls || []);
    this.processedProfiles = new Set(state.processedProfiles || []);
    this.seenSlugs = new Set(state.seenSlugs || []);
  }

  exportState() {
    return {
      processedUrls: Array.from(this.processedUrls),
      processedProfiles: Array.from(this.processedProfiles),
      seenSlugs: Array.from(this.seenSlugs),
      authorsMap: Array.from(this.authorsMap.entries()),
      authorArticles: Array.from(this.authorArticles.entries())
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
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive',
            'Cache-Control': 'max-age=0'
          }
        });

        if (!response.ok) {
          console.log(`  HTTP ${response.status} for ${url}`);
          if (response.status === 429) {
            await this.delay(5000 * (i + 1));
            continue;
          }
          return null;
        }

        return await response.text();
      } catch (err) {
        console.log(`  Fetch error (attempt ${i + 1}): ${err.message}`);
        await this.delay(2000 * (i + 1));
      }
    }
    return null;
  }

  // Extract __NEXT_DATA__ JSON from HTML
  extractNextData(html) {
    try {
      const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
      if (match) {
        return JSON.parse(match[1]);
      }
    } catch (err) {
      console.log('  Error parsing __NEXT_DATA__:', err.message);
    }
    return null;
  }

  // Get articles from sitemap
  async collectFromSitemap(sitemapUrl, maxArticles = 50) {
    console.log(`  Fetching sitemap: ${sitemapUrl}`);
    const html = await this.fetchPage(sitemapUrl);
    if (!html) return [];

    const articles = [];
    const urlRegex = /<loc>(https:\/\/hackernoon\.com\/[a-z0-9-]+)<\/loc>/g;
    let match;

    while ((match = urlRegex.exec(html)) !== null) {
      const url = match[1];
      const slug = url.replace(HACKERNOON_BASE + '/', '');

      // Skip non-article URLs
      if (slug.includes('/') || slug.startsWith('u-') || slug.startsWith('tagged-')) continue;
      if (this.seenSlugs.has(slug)) continue;
      if (this.processedUrls.has(url)) continue;

      this.seenSlugs.add(slug);
      articles.push({ slug, url });

      if (articles.length >= maxArticles) break;
    }

    console.log(`    Found ${articles.length} new article URLs`);
    return articles;
  }

  // Check if article matches keywords
  matchesKeywords(title, excerpt, tags) {
    const text = `${title} ${excerpt} ${(tags || []).join(' ')}`.toLowerCase();
    return SEARCH_KEYWORDS.some(kw => text.includes(kw.toLowerCase())) ||
           TAG_KEYWORDS.some(tag => text.includes(tag.replace(/-/g, ' ')));
  }

  // Get author and article info from article page
  async getArticleData(articleUrl) {
    if (this.processedUrls.has(articleUrl)) return null;
    this.processedUrls.add(articleUrl);

    const html = await this.fetchPage(articleUrl);
    if (!html) return null;

    const nextData = this.extractNextData(html);
    if (!nextData) return null;

    const pageProps = nextData.props?.pageProps?.data || {};
    const profile = pageProps.profile || {};

    const title = pageProps.title || '';
    const excerpt = pageProps.excerpt || '';
    const tags = pageProps.tags?.map(t => t.slug || t) || [];

    // Check if matches our keywords
    if (!this.matchesKeywords(title, excerpt, tags)) {
      return null;
    }

    if (!profile.handle) return null;

    // Extract website from callToActions if available
    let website = '';
    if (profile.callToActions && Array.isArray(profile.callToActions)) {
      const webCta = profile.callToActions.find(cta =>
        cta.url && cta.active &&
        !cta.url.includes('hackernoon.com') &&
        !cta.url.includes('twitter.com') &&
        !cta.url.includes('linkedin.com') &&
        !cta.url.includes('github.com')
      );
      if (webCta) website = webCta.url;
    }

    // Also check adLink
    if (!website && profile.adLink && !profile.adLink.includes('hackernoon')) {
      website = profile.adLink;
    }

    const matchedKeywords = [];
    for (const kw of SEARCH_KEYWORDS) {
      if (`${title} ${excerpt}`.toLowerCase().includes(kw.toLowerCase())) {
        matchedKeywords.push(kw);
      }
    }
    for (const tag of tags) {
      if (TAG_KEYWORDS.includes(tag)) {
        matchedKeywords.push(tag);
      }
    }

    return {
      handle: profile.handle,
      name: this.cleanName(profile.displayName || profile.handle),
      profileUrl: HACKERNOON_BASE + '/u/' + profile.handle,
      bio: profile.bio || '',
      website,
      articleTitle: title,
      articleUrl,
      matchedKeywords: [...new Set(matchedKeywords)]
    };
  }

  // Get social links from profile page
  async getProfileSocial(profileUrl) {
    if (this.processedProfiles.has(profileUrl)) return null;
    this.processedProfiles.add(profileUrl);

    const html = await this.fetchPage(profileUrl);
    if (!html) return null;

    const $ = cheerio.load(html);
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

    // Also try to get name from profile page
    let name = '';
    const nextData = this.extractNextData(html);
    if (nextData) {
      const profileData = nextData.props?.pageProps?.data || {};
      name = this.cleanName(profileData.displayName || '');
    }

    return { ...social, name };
  }

  async scrape(options = {}) {
    const startTime = Date.now();
    const maxArticlesPerSitemap = options.maxArticlesPerSitemap || 100;
    const sitemapsToCheck = options.sitemapsToCheck || 3;

    console.log(`Starting scrape - Already processed: ${this.processedUrls.size} URLs`);

    const allArticles = [];

    // Get recent sitemaps (most recent first)
    console.log('Phase 1: Fetching articles from sitemaps...');
    const sitemapIndex = await this.fetchPage(`${HACKERNOON_BASE}/sitemap.xml`);
    if (sitemapIndex) {
      const sitemapUrls = [];
      const sitemapRegex = /<loc>(https:\/\/hackernoon\.com\/sitemaps\/sitemap-\d+)<\/loc>/g;
      let match;
      while ((match = sitemapRegex.exec(sitemapIndex)) !== null) {
        sitemapUrls.push(match[1]);
      }

      // Get the most recent sitemaps (highest numbers)
      const recentSitemaps = sitemapUrls.slice(-sitemapsToCheck).reverse();

      for (const sitemapUrl of recentSitemaps) {
        const articles = await this.collectFromSitemap(sitemapUrl, maxArticlesPerSitemap);
        allArticles.push(...articles);
        await this.delay(1000);
      }
    }

    console.log(`Total articles to check: ${allArticles.length}`);

    // Process articles and extract author data
    console.log('Phase 2: Processing articles and finding relevant authors...');
    let newAuthorsCount = 0;
    let processedCount = 0;
    let matchedCount = 0;

    for (const article of allArticles) {
      processedCount++;
      if (processedCount % 20 === 0) {
        console.log(`  Progress: ${processedCount}/${allArticles.length} articles (${matchedCount} matched)`);
      }

      const data = await this.getArticleData(article.url);

      if (data?.handle) {
        matchedCount++;
        const isNewAuthor = !this.authorsMap.has(data.handle);
        if (isNewAuthor) newAuthorsCount++;

        if (!this.authorArticles.has(data.handle)) {
          this.authorArticles.set(data.handle, []);
        }
        this.authorArticles.get(data.handle).push({
          title: data.articleTitle,
          url: data.articleUrl,
          keywords: data.matchedKeywords
        });

        if (!this.authorsMap.has(data.handle)) {
          this.authorsMap.set(data.handle, {
            handle: data.handle,
            name: data.name,
            profileUrl: data.profileUrl,
            bio: data.bio,
            website: data.website,
            keywords: new Set(data.matchedKeywords)
          });
        } else {
          const existing = this.authorsMap.get(data.handle);
          data.matchedKeywords.forEach(kw => existing.keywords.add(kw));
          if (data.website && !existing.website) {
            existing.website = data.website;
          }
        }
      }

      await this.delay(500);
    }

    console.log(`Matched ${matchedCount} articles, found ${newAuthorsCount} new authors`);

    // Get social links for authors
    const authors = Array.from(this.authorsMap.values());
    const authorsNeedingSocial = authors.filter(a => !a.twitter && !a.linkedin && !this.processedProfiles.has(a.profileUrl));

    console.log(`Phase 3: Fetching social links for ${authorsNeedingSocial.length} profiles...`);

    for (const a of authorsNeedingSocial) {
      const social = await this.getProfileSocial(a.profileUrl);

      if (social) {
        a.twitter = social.twitter || '';
        a.linkedin = social.linkedin || '';
        a.github = social.github || '';
        if (social.website && !a.website) {
          a.website = social.website;
        }
        if (social.name && social.name.length > (a.name?.length || 0)) {
          a.name = social.name;
        }
      }
      await this.delay(600);
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
          keywords: x.keywords
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
        articlesMatched: matchedCount,
        totalArticlesProcessed: this.processedUrls.size,
        processingTimeMs: Date.now() - startTime
      },
      state: this.exportState()
    };
  }
}

module.exports = { HackerNoonScraper, SEARCH_KEYWORDS, TAG_KEYWORDS };
