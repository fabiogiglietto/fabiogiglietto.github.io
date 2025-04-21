# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
This is a GitHub Pages website repository for Fabio Giglietto built with Jekyll and JavaScript.

## Build Commands
- Preview site locally: `bundle exec jekyll serve`
- Build site: `bundle exec jekyll build`
- Run data collection: `node scripts/collect-all.js`

## Code Style Guidelines
- HTML: Use semantic markup, indent with 2 spaces
- CSS: Follow BEM naming convention, use descriptive class names
- JavaScript: 
  - Use ES6+ features
  - Prefer async/await for asynchronous operations
  - Import dependencies at the top of files
  - Use consistent error handling with try/catch blocks

## File Organization
- Page content in root or _pages directory
- Assets (images, CSS, JS) in assets directory
- Components in _includes directory
- Page templates in _layouts directory
- Data in public/data directory
- Collection scripts in scripts/collectors directory

## Best Practices
- Optimize images before adding to repository
- Write descriptive commit messages
- Test all changes locally before pushing
- Document API usage and data collection methods