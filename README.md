# Arun's Blog

Personal blog and website by [Arun Lakshman Ravichandran](https://www.linkedin.com/in/arun-laksh/) — writing about distributed systems, stream processing, and concurrent programming.

Built with [Docusaurus](https://docusaurus.io/) and styled with [Tailwind CSS](https://tailwindcss.com/).

## Development

**Prerequisites:** Node.js >= 20

```bash
# Install dependencies
yarn

# Start local dev server (hot-reloads on changes)
yarn start

# Production build
yarn build

# Preview production build locally
yarn serve
```

## Project Structure

```
blog/           → Blog posts (Markdown/MDX)
src/
  pages/        → Static pages (About, Flink Reads, etc.)
  css/          → Custom styles
static/img/     → Images and favicon
```

## Writing a New Post

Add a Markdown file under `blog/` following the naming convention `YYYY-MM-DD-slug.md`. Include front matter at the top:

```markdown
---
title: Your Post Title
authors: [Arun]
tags: [distributed-systems, concurrency]
---

Post content here...

<!--truncate-->

Rest of the post...
```

## Deployment

```bash
yarn deploy
```

## License

Content and code are copyright Arun Lakshman Ravichandran.
