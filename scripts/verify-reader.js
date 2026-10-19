// 正式页（读者视角）核验：不带登录态打开已发布文章，按「读者能感知的那一层」取证。
//
// 由来：2026-10-19 三平台发布时用它验百家号正式页——数的是 table 的 innerText 而不是 <table> 元素、
// 是 img.naturalWidth 而不是 <img> 个数、是代码块内部换行数/前景背景对比度而不是「有没有 pre」。
// 判据出处见全局 AGENTS.md 的「验证要验到读者能感知的那一层」。
//
// 用法：
//   npm i -D playwright     # 本仓库不含依赖，需要时现装（用本机已装的 Chrome，走 channel: 'chrome'）
//   node scripts/verify-reader.js <文章URL> [输出目录]
//   VERIFY_OUT=<输出目录> node scripts/verify-reader.js <文章URL>
//
// 输出：stdout 打印 JSON，同时落盘 <输出目录>/reader-verify.json 与 reader-top.png / reader-mid.png。
// 默认输出目录 <cwd>/verify-out（不入库路径，别指到 docs/ 里）。
//
// 注意：代码块候选选择器偏百家号（[data-bjh-box] 等），换平台时按该平台的 DOM 改 SELECTORS。
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const SELECTORS = '[data-bjh-box], .codeBlock, pre, .bjh-code, .code-block, [class*="codeBlock"]';
const URL0 = process.argv[2];
const OUT = path.resolve(process.env.VERIFY_OUT || process.argv[3] || path.join(process.cwd(), 'verify-out'));

if (!URL0) {
  console.error('usage: node scripts/verify-reader.js <article-url> [out-dir]');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 1280, height: 1000 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  });
  const page = await ctx.newPage();
  await page.goto(URL0, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4000);

  const v = await page.evaluate((SEL) => {
    // WCAG 相对亮度 / 对比度：读者看不清代码的前提就是前景背景贴在一起（公众号那次 1.1:1）
    const lum = (css) => {
      const m = (css || '').match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b] = m[1].split(',').slice(0, 3).map((x) => parseFloat(x) / 255);
      const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const contrast = (fg, bg) => {
      const a = lum(fg), b = lum(bg);
      if (a == null || b == null) return null;
      const hi = Math.max(a, b), lo = Math.min(a, b);
      return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
    };

    const text = document.body.innerText;
    const tables = [...document.querySelectorAll('table')];
    const imgs = [...document.querySelectorAll('img')];
    const heads = [...document.querySelectorAll('h1,h2,h3,h4')].map((h) => h.tagName);
    const cands = [...document.querySelectorAll(SEL)].filter((e) => (e.innerText || '').trim().length > 0);

    const codeInfo = cands.slice(0, 30).map((e) => {
      const cs = getComputedStyle(e);
      let bg = cs.backgroundColor, el = e;
      for (let k = 0; k < 8 && el; k++) {
        const b = getComputedStyle(el).backgroundColor;
        if (b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') { bg = b; break; }
        el = el.parentElement;
      }
      const lines = (e.innerText || '').split('\n').length;
      return {
        tag: e.tagName, cls: (e.className || '').toString().slice(0, 50),
        lines,
        len: (e.innerText || '').length,
        color: cs.color, bg,
        contrast: contrast(cs.color, bg),
        singleLine: lines === 1 && (e.innerText || '').length > 80, // 长内容却只有一行 = 换行被压平
        font: cs.fontFamily.slice(0, 30),
        head: (e.innerText || '').slice(0, 30).replace(/\n/g, ' / '),
      };
    });

    return {
      title: document.title,
      h1: heads.filter((t) => t === 'H1').length,
      h2: heads.filter((t) => t === 'H2').length,
      h3: heads.filter((t) => t === 'H3').length,
      headings: heads.length,
      tables: tables.length,
      // 表格要读格子里的字，不是数字符串元素：空壳表格 innerText 极短
      tableInfo: tables.map((t) => ({ rows: t.rows.length, len: t.innerText.length, head: t.innerText.slice(0, 30).replace(/\n/g, '|') })),
      emptyTables: tables.filter((t) => t.innerText.replace(/\s/g, '').length === 0).length,
      imgs: imgs.length,
      imgOk: imgs.filter((i) => i.naturalWidth > 0).length,
      imgDetail: imgs.map((i) => ({ nw: i.naturalWidth, src: i.src.slice(0, 60) })).slice(0, 12),
      codeCandidates: cands.length,
      codeSingleLine: codeInfo.filter((c) => c.singleLine).length,
      codeLowContrast: codeInfo.filter((c) => c.contrast != null && c.contrast < 3).length,
      codeInfo,
      hasFence: /```/.test(text),
      hasMdImg: /!\[/.test(text),
      hasMdLink: /\]\(/.test(text),
      textLen: text.length,
      bodyHead: text.slice(0, 200).replace(/\n+/g, ' / '),
    };
  }, SELECTORS);

  // 复制测试：选中第一个代码容器，看剪贴板拿到的还是不是多行（读者要复制去跑）
  v.copySelection = await page.evaluate((SEL) => {
    const el = document.querySelector(SEL);
    if (!el) return { err: 'no code el' };
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    const t = s.toString();
    return { len: t.length, lines: t.split('\n').length, head: t.slice(0, 60) };
  }, SELECTORS);

  v.checks = {
    imagesAllLoaded: v.imgs > 0 && v.imgOk === v.imgs,
    noEmptyTables: v.emptyTables === 0,
    noResidualMarkdown: !v.hasFence && !v.hasMdImg && !v.hasMdLink,
    codeBlocksMultiLine: v.codeSingleLine === 0,
  };

  console.log(JSON.stringify(v, null, 1));
  fs.writeFileSync(path.join(OUT, 'reader-verify.json'), JSON.stringify(v, null, 2), 'utf8');
  await page.screenshot({ path: path.join(OUT, 'reader-top.png') });
  await page.evaluate(() => window.scrollTo(0, 1500));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, 'reader-mid.png') });
  await browser.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
