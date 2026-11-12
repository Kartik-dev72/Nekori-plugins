import { fetchApi } from '@libs/fetch';
import { defaultCover } from '@libs/defaultCover';
import { Filters } from '@libs/filterInputs';
import { NovelStatus } from '@libs/novelStatus';
import { NekoriBasePlugin } from '@nekori/plugin';
import { ContentType, ContentWarning } from '@nekori/pluginMetadata';
import { load as loadCheerio } from 'cheerio';

import { Plugin } from '@/types/plugin';

const SITE = 'https://www.canghaishuge.com';
const BOOK_PATH = '/shuohaodangxiansanzhuixuniludeshenxian/';
const BOOK_TITLE = '说好当闲散赘婿，你陆地神仙？';
const ENGLISH_TITLE =
  'You Promised to Be an Idle Son-in-Law, How Could You Become a Land Immortal?';
const AUTHOR = '卫四月';

function normalizePath(input: string): string {
  try {
    const url = new URL(input, SITE);
    return `${url.pathname}${url.search}`;
  } catch {
    return input.startsWith('/') ? input : `/${input}`;
  }
}

function absoluteUrl(input: string | undefined): string {
  if (!input) return defaultCover;
  try {
    return new URL(input, SITE).toString();
  } catch {
    return defaultCover;
  }
}

function chapterNumberFromTitle(title: string, fallback: number): number {
  const match = title.match(/第\s*(\d+)\s*章/);
  return match ? Number(match[1]) : fallback;
}

function cleanChapterHtml($: ReturnType<typeof loadCheerio>, root: any): string {
  const $content = $(root).clone();

  $content
    .find(
      'script, style, iframe, noscript, .ads, .ad, .advert, .advertisement, ' +
        '.chapter-nav, .read-nav, .bottom-nav, .comment, .comments, ' +
        '.recommend, .recommend-box, .footer, .share, .copyright',
    )
    .remove();

  $content.find('a').each((_, element) => {
    const text = $(element).text().trim();
    const href = ($(element).attr('href') || '').trim();
    if (
      /上一章|下一章|章节目录|返回目录|加入书架|下载|广告|推荐阅读/.test(text) ||
      /javascript:|#/.test(href)
    ) {
      $(element).remove();
    }
  });

  $content.find('[style]').each((_, element) => {
    const style = ($(element).attr('style') || '').toLowerCase();
    if (
      style.includes('display:none') ||
      style.includes('display: none') ||
      style.includes('visibility:hidden')
    ) {
      $(element).remove();
    }
  });

  return $content.html()?.trim() || '';
}

class CanghaiShugePlugin extends NekoriBasePlugin {
  id = 'canghai-shuge';
  name = '沧海书阁';
  icon = 'icon.png';
  site = SITE;
  version = '1.0.0';
  minApiVersion = 1;
  contentType = ContentType.NOVEL;
  contentWarning = ContentWarning.SAFE;

  private async fetchPage(url: string): Promise<string> {
    const response = await fetchApi(
      url.startsWith('http') ? url : new URL(url, SITE).toString(),
      {
        headers: {
          Referer: `${SITE}/`,
          'User-Agent':
            'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Canghai Shuge returned HTTP ${response.status}: ${url}`);
    }

    return response.text();
  }

  private novelItem(): Plugin.NovelItem {
    return {
      name: BOOK_TITLE,
      path: BOOK_PATH,
      cover: defaultCover,
    };
  }

  async popularNovels(
    pageNo: number,
    _options: Plugin.PopularNovelsOptions<Filters>,
  ): Promise<Plugin.NovelItem[]> {
    return pageNo === 1 ? [this.novelItem()] : [];
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1) return [];

    const query = searchTerm.trim().toLowerCase();
    if (!query) return [this.novelItem()];

    const aliases = [
      BOOK_TITLE.toLowerCase(),
      ENGLISH_TITLE.toLowerCase(),
      AUTHOR.toLowerCase(),
      'idle son-in-law',
      'land immortal',
      '闲散赘婿',
      '陆地神仙',
      '卫四月',
    ];

    return aliases.some(alias => alias.includes(query) || query.includes(alias))
      ? [this.novelItem()]
      : [];
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const path = normalizePath(novelPath);
    const html = await this.fetchPage(new URL(path, SITE).toString());
    const $ = loadCheerio(html);

    const title =
      $('h1').first().text().trim() ||
      $('meta[property="og:title"]').attr('content') ||
      BOOK_TITLE;

    const cover =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="og:image"]').attr('content') ||
      $('.book-img img, .book-cover img, .cover img, .novel-cover img')
        .first()
        .attr('data-src') ||
      $('.book-img img, .book-cover img, .cover img, .novel-cover img')
        .first()
        .attr('src');

    const summary =
      $('.book-intro, .book-introduction, .intro, .description, .book-desc')
        .first()
        .text()
        .trim() ||
      $('meta[name="description"]').attr('content') ||
      '中文原版小说，来源：沧海书阁。';

    const chapters: Plugin.ChapterItem[] = [];
    const seen = new Set<string>();

    $('a[href]').each((_, element) => {
      const $link = $(element);
      const href = ($link.attr('href') || '').trim();
      if (!href) return;

      const fullUrl = absoluteUrl(href);
      let url: URL;

      try {
        url = new URL(fullUrl);
      } catch {
        return;
      }

      if (url.hostname !== new URL(SITE).hostname) return;
      if (!url.pathname.startsWith(BOOK_PATH)) return;
      if (!/\/\d+\.html$/i.test(url.pathname)) return;

      const chapterPath = `${url.pathname}${url.search}`;
      if (seen.has(chapterPath)) return;
      seen.add(chapterPath);

      const chapterTitle =
        $link.attr('title')?.trim() || $link.text().replace(/\s+/g, ' ').trim();
      if (!chapterTitle || !/第\s*\d+\s*章/.test(chapterTitle)) return;

      const fallback = Number(url.pathname.match(/\/(\d+)\.html$/)?.[1] || 0);
      chapters.push({
        name: chapterTitle,
        path: chapterPath,
        chapterNumber: chapterNumberFromTitle(chapterTitle, fallback),
      });
    });

    chapters.sort((a, b) => {
      const numberDifference = (a.chapterNumber || 0) - (b.chapterNumber || 0);
      return numberDifference || a.path.localeCompare(b.path);
    });

    if (!chapters.length) {
      throw new Error(
        'No chapters were found in the book catalogue. The site layout may have changed.',
      );
    }

    return {
      path,
      name: title.replace(/\s*[-|]\s*沧海书阁.*$/i, '').trim() || BOOK_TITLE,
      author: AUTHOR,
      cover: absoluteUrl(cover),
      genres: '仙侠, 仙侠修真',
      status: NovelStatus.Ongoing,
      summary,
      chapters,
    };
  }

  async parseChapter(chapterPath: string): Promise<Plugin.ChapterContent> {
    const path = normalizePath(chapterPath);
    const html = await this.fetchPage(new URL(path, SITE).toString());
    const $ = loadCheerio(html);

    const selectors = [
      '#chapter-content',
      '#chapterContent',
      '.chapter-content',
      '.chapterContent',
      '.read-content',
      '.readContent',
      '.book-content',
      '.bookcontent',
      '.txt',
      '#content',
      'article .content',
      'article',
      'main',
    ];

    let chapterHtml = '';

    for (const selector of selectors) {
      const candidates = $(selector).toArray();
      for (const candidate of candidates) {
        const text = $(candidate).text().replace(/\s+/g, ' ').trim();
        if (text.length > 300) {
          const cleaned = cleanChapterHtml($, candidate);
          if (cleaned.length > chapterHtml.length) chapterHtml = cleaned;
        }
      }
      if (chapterHtml.length > 500) break;
    }

    if (!chapterHtml || chapterHtml.length < 100) {
      throw new Error(
        'Could not locate the chapter text. The site may have changed its reader layout.',
      );
    }

    const chapterTitle =
      $('h1').first().text().trim() ||
      $('title').first().text().trim() ||
      'Canghai Shuge';

    return {
      state: 'ready',
      type: 'novel',
      html: `<article class="canghai-chapter"><h2>${chapterTitle}</h2>${chapterHtml}</article>`,
    };
  }

  resolveUrl(path: string, isNovel?: boolean): string {
    const normalized = normalizePath(path);
    if (isNovel && !normalized.startsWith(BOOK_PATH)) {
      return new URL(BOOK_PATH, SITE).toString();
    }
    return new URL(normalized, SITE).toString();
  }
}

export default new CanghaiShugePlugin();
