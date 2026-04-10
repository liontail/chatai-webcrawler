const config = {
  startUrl: 'https://ro-prt.in.th/forum/index.php?app=core&module=search&controller=search&q=Classic&type=forums_topic&search_and_or=or&search_in=titles&sortby=newest',
  knowledgeTag: 'ragnarok-classic-ggt',
  baseUrl: 'https://ro-prt.in.th',
  allowedDomain: 'ro-prt.in.th',
  concurrency: 2,
  rateLimit: 2000,
  retries: 3,
  retryDelay: 2000,
  requestTimeout: 60000,
  outputDir: './output',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  skipExtensions: [
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico',
    '.css', '.js', '.woff', '.woff2', '.ttf', '.eot',
    '.pdf', '.zip', '.rar', '.tar', '.gz',
    '.mp4', '.mp3', '.avi', '.mov', '.wmv'
  ],
  skipPatterns: [
    'login',
    'logout',
    'register',
    'forgot-password',
    'reset-password',
    'account/settings',
    'messenger',
    'notifications',
    'report',
    '\\.xml$',
    '\\.rss$',
    '\\.atom$'
  ],
  filters: {
    eventQuest: {
      enabled: true,
      keywords: ['event quest', 'eventquest', 'event-quest'],
      skipBefore: '2026-04-01' // skip Event Quest topics posted before this month (April 2026)
    },
    classic: {
      enabled: true,
      // Only save topics whose title contains at least one of these keywords (case-insensitive)
      // Empty array = accept all topics from stream (no title filter)
      keywords: ['classic', 'คลาสสิค', 'คลาสสิก', 'ggt', 'classic ro', 'ro classic'],
      // If true, skip topics with NONE of the keywords in title; if false, accept all
      strictTitle: false
    }
  }
}

module.exports = config
