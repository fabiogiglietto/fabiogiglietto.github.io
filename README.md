# Fabio Giglietto's Academic Website

A Jekyll-powered academic portfolio that writes itself. Pulls from ORCID, Google Scholar, Scopus, Web of Science, GitHub, and social feeds - then uses Gemini AI to synthesize a dynamic "About Me" that reflects what you're teaching, reading, and discussing right now. Automated web mentions discovery finds where you're cited in the wild. Your research presence, always current, zero maintenance.

🌐 **Live Site**: [fabiogiglietto.github.io](https://fabiogiglietto.github.io)

## ✨ Key Features

### 🤖 AI-Powered Content Generation
- **Dynamic Biography**: Weekly AI-generated bio synthesizing publications, teaching, #toread list, social posts, and web mentions into a cohesive narrative
- **Live Research Footprint**: Bio reflects current courses, recent reading interests, and active social media discussions
- **Web Mentions Discovery**: Real-time discovery of third-party research references via Google Search grounding
- **Smart Content Curation**: Intelligent filtering, deduplication, and anti-repetition across all content

### 📊 Multi-Source Data Integration
- **Publications**: Aggregated from ORCID, Google Scholar, Scopus, Web of Science, and Semantic Scholar
- **Social Media**: LinkedIn and Mastodon activity integration
- **Reading List**: Automated sync from [toread repository](https://github.com/fabiogiglietto/toread)
- **Teaching Data**: University course information with AI enhancement

### 🎨 Modern Web Interface
- **Responsive Design**: Optimized for desktop, tablet, and mobile
- **Interactive Carousels**: Instagram-style paper browsing with smooth animations
- **Clean Typography**: Professional academic presentation with excellent readability
- **Accessibility**: WCAG-compliant design with proper semantic markup

### ⚡ Automated Workflows
- **Daily Updates**: Core data collection (publications, social media, web mentions)
- **Weekly Bio Refresh**: AI-generated biography updates every Monday
- **Monthly Teaching Updates**: Course and academic information refresh on the 1st
- **Smart Scheduling**: Optimized API usage with conditional execution

## 🛠️ Technology Stack

- **Frontend**: Jekyll, HTML5, CSS3, JavaScript
- **Backend**: Node.js data collectors and generators
- **AI Integration**: Google Gemini 1.5 Pro for content generation with Google Search grounding
- **APIs**: Multiple academic and social platforms
- **Deployment**: GitHub Pages with automated workflows
- **Hosting**: GitHub Actions for CI/CD

## 🚀 Local Development

### Prerequisites
- Node.js (v18+)
- Ruby (for Jekyll)
- Bundler

### Setup Instructions

1. **Clone the repository**
   ```bash
   git clone https://github.com/fabiogiglietto/fabiogiglietto.github.io.git
   cd fabiogiglietto.github.io
   ```

2. **Install dependencies**
   ```bash
   npm install
   bundle install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your API keys (see API Keys section)
   ```

4. **Collect initial data**
   ```bash
   npm run collect
   ```

5. **Start development server**
   ```bash
   npm run serve
   # or
   bundle exec jekyll serve
   ```

6. **Visit the site**
   - Local: http://localhost:4000
   - Live reload enabled for development

## 🔑 API Keys Configuration

### Required APIs

| Service | Purpose | Frequency |
|---------|---------|-----------|
| **Google Gemini** | Biography generation with web search | Weekly/Daily |
| **Scopus** | Academic publication data | Daily |
| **Web of Science** | Publication metrics | Daily |
| **Semantic Scholar** | Citation data | Daily |
| **LinkedIn** | Professional updates | Daily |
| **Mastodon** | Social media content | Daily |

### Local Development Setup

Create a `.env` file in the project root:

```env
# Required for AI features with Google Search grounding
GEMINI_API_KEY=your-gemini-api-key

# Publication APIs
SCOPUS_API_KEY=your-scopus-key
WOS_API_KEY=your-wos-key
S2_API_KEY=your-semantic-scholar-key

# Social Media APIs (optional)
LINKEDIN_ACCESS_TOKEN=your-linkedin-token
LINKEDIN_PERSON_ID=your-person-id
MASTODON_ACCESS_TOKEN=your-mastodon-token
```

### GitHub Actions Setup

Add these secrets to your repository settings:

1. Navigate to **Settings > Secrets and variables > Actions**
2. Add each API key as a repository secret:
   - `GEMINI_API_KEY`
   - `SCOPUS_API_KEY`
   - `WOS_API_KEY`
   - `S2_API_KEY`
   - `LINKEDIN_ACCESS_TOKEN`
   - `LINKEDIN_PERSON_ID`
   - `MASTODON_ACCESS_TOKEN`

## 📅 Automated Workflows

### Daily Updates (6 AM UTC)
- Publication data collection from all sources
- Social media content aggregation
- Web mentions discovery and filtering
- Social media insights generation

### Weekly Updates (Monday 6 AM UTC)
- AI-generated biography refresh using latest research data
- About Me section content update

### Monthly Updates (1st of month, 6 AM UTC)
- Teaching data regeneration
- Course information updates

### Manual Triggers
All workflows can be triggered manually via GitHub Actions interface for immediate updates.

## 🎯 Content Sections

### 📚 FG's #toread
- **Source**: [toread repository](https://github.com/fabiogiglietto/toread)
- **Features**: Interactive carousel, paper metadata, direct JSON access
- **Updates**: Real-time sync with reading list repository

### 🌐 Recent Web Mentions
- **Source**: Google Search grounding across academic platforms
- **Filtering**: Excludes self-authored content, focuses on third-party references
- **Quality**: Only authoritative sources (universities, journals, conferences)

### 📄 Publications
- **Sources**: ORCID, Google Scholar, Scopus, Web of Science, Semantic Scholar
- **Features**: Deduplication, citation metrics, multiple export formats
- **Updates**: Daily aggregation and intelligent merging

### 🎓 Teaching
- **Source**: University databases with AI enhancement
- **Features**: Course descriptions, academic calendar integration
- **Updates**: Monthly refresh of course information

## 🔧 Available Scripts

```bash
# Data Collection
npm run collect                    # Full data collection
npm run generate-about            # AI biography generation
npm run generate-teaching         # Teaching data generation
npm run generate-social-insights  # Social media analysis

# Development
npm run serve                     # Start Jekyll development server
npm run build                     # Build static site

# Jekyll Commands
bundle exec jekyll serve          # Alternative development server
bundle exec jekyll build          # Alternative build command
```

## 📁 Project Structure

```
fabiogiglietto.github.io/
├── _includes/                    # Jekyll includes
│   ├── generated-about.html      # AI-generated biography
│   ├── web-mentions.html         # Web mentions section
│   ├── toread-papers.html        # Reading list carousel
│   └── ...
├── _layouts/                     # Jekyll layouts
├── _data/                        # Jekyll data files
├── assets/                       # CSS, JS, images
│   ├── css/main.css             # Main stylesheet
│   └── js/main.js               # Site JavaScript
├── scripts/                      # Data collection & generation
│   ├── collectors/              # API data collectors
│   ├── generators/              # Content generators
│   └── collect-all.js           # Main collection script
├── public/data/                  # Generated data files
├── .github/workflows/            # GitHub Actions
└── ...
```

## 🤝 Contributing

This is a personal academic website, but contributions for improvements are welcome:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Google** for Gemini API and Google Search grounding capabilities
- **Jekyll** for the static site generation framework
- **GitHub Pages** for hosting and automation
- Academic APIs (ORCID, Scopus, Web of Science, Semantic Scholar) for publication data
- The academic community for inspiration and best practices

## 📞 Contact

**Fabio Giglietto**
- 🌐 Website: [fabiogiglietto.github.io](https://fabiogiglietto.github.io)
- 📧 Email: fabio.giglietto@uniurb.it
- 🐦 Mastodon: [@fabiogiglietto@aoir.social](https://aoir.social/@fabiogiglietto)
- 🔗 LinkedIn: [fabiogiglietto](https://linkedin.com/in/fabiogiglietto)

---

> 🤖 This website showcases the intersection of academic research and modern web technology, featuring automated content generation and intelligent data aggregation. Built with transparency and open-source principles.