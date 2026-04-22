const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const WIDTH = 1200;
const HEIGHT = 630;

/** Wrap text to fit within maxWidth, returning array of lines */
function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function generateCard(title, outputPath) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // Cream paper background
  ctx.fillStyle = '#f3ead4';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Subtle paper texture — horizontal ruled lines
  ctx.strokeStyle = 'rgba(201, 189, 154, 0.3)';
  ctx.lineWidth = 0.5;
  for (let y = 80; y < HEIGHT - 80; y += 32) {
    ctx.beginPath();
    ctx.moveTo(60, y);
    ctx.lineTo(WIDTH - 60, y);
    ctx.stroke();
  }

  // Top vermillion accent bar
  ctx.fillStyle = '#c2371f';
  ctx.fillRect(0, 0, WIDTH, 5);

  // Section mark ornament
  ctx.font = 'italic 28px Georgia, serif';
  ctx.fillStyle = '#8a7a62';
  ctx.fillText('§', 80, 120);

  // Vermillion rule under ornament
  ctx.fillStyle = '#c2371f';
  ctx.fillRect(80, 135, 40, 2);

  // Title — italic serif style
  const maxTextWidth = 1000;
  ctx.font = 'italic 52px Georgia, serif';
  ctx.fillStyle = '#1a1612';
  const lines = wrapText(ctx, title, maxTextWidth);
  const lineHeight = 68;
  const titleBlockHeight = lines.length * lineHeight;
  const startY = Math.max(220, 310 - titleBlockHeight / 2);
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], 80, startY + i * lineHeight);
  }

  // Author line
  ctx.font = '20px Monaco, monospace';
  ctx.fillStyle = '#8a7a62';
  ctx.fillText('Arun Lakshman Ravichandran', 80, 520);

  // URL
  ctx.font = '18px Monaco, monospace';
  ctx.fillStyle = '#c2371f';
  ctx.fillText('arunlakshman.info', 80, 555);

  // Bottom vermillion accent bar
  ctx.fillStyle = '#c2371f';
  ctx.fillRect(0, HEIGHT - 5, WIDTH, 5);

  // Write PNG
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(outputPath, buf);
}

function getBlogPosts(blogDir) {
  if (!fs.existsSync(blogDir)) return [];
  return fs.readdirSync(blogDir)
    .filter(f => f.endsWith('.md') || f.endsWith('.mdx'))
    .map(f => {
      const content = fs.readFileSync(path.join(blogDir, f), 'utf8');
      const { data } = matter(content);
      const slug = data.slug || f.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.mdx?$/, '');
      return { title: data.title || slug, slug };
    });
}

module.exports = function socialCardsPlugin(context) {
  const outDir = path.join(context.siteDir, 'static', 'img', 'social-cards');
  return {
    name: 'social-cards',

    async loadContent() {
      const blogDir = path.join(context.siteDir, 'blog');
      const posts = getBlogPosts(blogDir);

      // Static pages
      const pages = [
        { title: "Arun's Blog", slug: '_default' },
        { title: 'About', slug: 'about' },
        { title: 'Flink Reads', slug: 'flink-reads' },
      ];

      const all = [...pages, ...posts];
      for (const { title, slug } of all) {
        const out = path.join(outDir, `${slug}.png`);
        if (!fs.existsSync(out)) {
          await generateCard(title, out);
        }
      }
      return all;
    },

    async contentLoaded({ content, actions }) {
      // No route creation needed — we just inject head tags via postBuild
    },

    async postBuild({ outDir: buildDir, content }) {
      // Copy generated cards into build output
      const srcDir = outDir;
      const destDir = path.join(buildDir, 'img', 'social-cards');
      if (fs.existsSync(srcDir)) {
        fs.mkdirSync(destDir, { recursive: true });
        for (const f of fs.readdirSync(srcDir)) {
          fs.copyFileSync(path.join(srcDir, f), path.join(destDir, f));
        }
      }

      // Inject og:image into each HTML file
      const baseUrl = context.siteConfig.url;
      const htmlFiles = findHtmlFiles(buildDir);
      for (const htmlFile of htmlFiles) {
        const rel = path.relative(buildDir, path.dirname(htmlFile));
        const segments = rel.split(path.sep).filter(Boolean);
        // Determine which social card to use
        let slug = segments[0] || '_default';
        // Check if a card exists for this slug
        const cardPath = path.join(destDir, `${slug}.png`);
        if (!fs.existsSync(cardPath)) slug = '_default';

        const cardUrl = `${baseUrl}/img/social-cards/${slug}.png`;
        let html = fs.readFileSync(htmlFile, 'utf8');
        // Replace existing og:image
        html = html.replace(
          /(<meta[^>]*property="og:image"[^>]*content=")[^"]*(")/,
          `$1${cardUrl}$2`
        );
        // Replace existing twitter:image
        html = html.replace(
          /(<meta[^>]*name="twitter:image"[^>]*content=")[^"]*(")/,
          `$1${cardUrl}$2`
        );
        fs.writeFileSync(htmlFile, html);
      }
    },
  };
};

function findHtmlFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findHtmlFiles(full));
    else if (entry.name === 'index.html') results.push(full);
  }
  return results;
}
