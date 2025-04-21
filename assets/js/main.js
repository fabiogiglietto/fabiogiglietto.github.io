/**
 * Main JavaScript file for Fabio Giglietto's website
 */

document.addEventListener('DOMContentLoaded', () => {
  // Add mobile navigation toggle
  const setupMobileNav = () => {
    const navToggle = document.querySelector('.mobile-nav-toggle');
    const navLinks = document.querySelector('.nav-links');
    
    if (navToggle) {
      navToggle.addEventListener('click', () => {
        navLinks.classList.toggle('nav-active');
        navToggle.setAttribute(
          'aria-expanded', 
          navToggle.getAttribute('aria-expanded') === 'true' ? 'false' : 'true'
        );
        
        // Toggle hamburger icon
        const hamburger = navToggle.querySelector('.hamburger-icon');
        hamburger.classList.toggle('is-active');
      });
    }
    
    // Close mobile nav when clicking outside
    document.addEventListener('click', (e) => {
      if (navLinks && 
          navLinks.classList.contains('nav-active') && 
          !e.target.closest('.site-nav')) {
        navLinks.classList.remove('nav-active');
        navToggle.setAttribute('aria-expanded', 'false');
        navToggle.querySelector('.hamburger-icon').classList.remove('is-active');
      }
    });
  };
  
  // Add scroll behavior for header
  const setupHeaderScroll = () => {
    const header = document.querySelector('.site-header');
    if (header) {
      const toggleHeaderClass = () => {
        if (window.scrollY > 50) {
          header.classList.add('scrolled');
        } else {
          header.classList.remove('scrolled');
        }
      };
      
      window.addEventListener('scroll', toggleHeaderClass);
      toggleHeaderClass(); // Check initial state
    }
  };

  // Initialize any dynamic content loaders
  const initDynamicContent = async () => {
    // Load latest GitHub activity if on the home page
    const githubSection = document.querySelector('.github-activity');
    if (githubSection) {
      try {
        const response = await fetch('/public/data/github.json');
        if (response.ok) {
          const data = await response.json();
          updateGitHubActivity(data, githubSection);
        }
      } catch (error) {
        console.error('Error loading GitHub data:', error);
      }
    }
    
    // Load publications data if it exists
    const publicationsSection = document.querySelector('.recent-publications');
    if (publicationsSection) {
      try {
        const response = await fetch('/public/data/scholar.json');
        if (response.ok) {
          const data = await response.json();
          if (data.publications) {
            updateRecentPublications(data.publications, publicationsSection);
          }
        }
      } catch (error) {
        console.error('Error loading publications data:', error);
      }
    }
  };

  // Update GitHub activity section with dynamic data
  const updateGitHubActivity = (data, container) => {
    if (data.repositories && data.repositories.length > 0) {
      // Sort repositories by most recently updated
      const recentRepos = data.repositories
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
        .slice(0, 3);
        
      let html = '<h3 class="section-title">Recent GitHub Activity</h3>';
      html += '<ul class="github-repos">';
      
      recentRepos.forEach(repo => {
        html += `
          <li class="github-repo">
            <h4><a href="${repo.url}" target="_blank" rel="noopener">${repo.name}</a></h4>
            <p>${repo.description || 'No description available'}</p>
            <div class="repo-meta">
              <span><i class="fas fa-star"></i> ${repo.stars}</span>
              <span><i class="fas fa-code-branch"></i> ${repo.forks}</span>
              ${repo.language ? `<span><i class="fas fa-circle"></i> ${repo.language}</span>` : ''}
              <span><i class="fas fa-history"></i> Updated ${formatDate(repo.updated_at)}</span>
            </div>
          </li>
        `;
      });
      
      html += '</ul>';
      html += '<div class="section-more"><a href="https://github.com/fabiogiglietto" class="btn btn-outline">View GitHub Profile</a></div>';
      
      container.innerHTML = html;
    }
  };
  
  // Update recent publications from Scholar data
  const updateRecentPublications = (publications, container) => {
    if (publications && publications.length > 0) {
      const publicationsList = container.querySelector('.publications-list');
      if (publicationsList) {
        publicationsList.innerHTML = '';
        
        // Sort by year and take the 5 most recent
        const recentPublications = publications
          .sort((a, b) => parseInt(b.year || '0') - parseInt(a.year || '0'))
          .slice(0, 5);
          
        recentPublications.forEach(pub => {
          const pubEl = document.createElement('div');
          pubEl.className = 'publication-item';
          pubEl.innerHTML = `
            <h3 class="publication-title">${pub.title}</h3>
            <p class="publication-authors">${pub.authors}</p>
            <p class="publication-venue">${pub.venue || ''} ${pub.year ? `, ${pub.year}` : ''}</p>
            <div class="publication-links">
              ${pub.url ? `<a href="${pub.url}" class="publication-link" target="_blank">View</a>` : ''}
              ${pub.citations ? `<span class="publication-citation-count"><i class="fas fa-quote-right"></i> ${pub.citations} citations</span>` : ''}
            </div>
          `;
          publicationsList.appendChild(pubEl);
        });
      }
    }
  };
  
  // Helper to format dates
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 7) {
      return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    } else if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
    } else if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return `${months} month${months > 1 ? 's' : ''} ago`;
    } else {
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    }
  };

  // Initialize all components
  setupMobileNav();
  setupHeaderScroll();
  initDynamicContent();

  // Add animation for elements as they scroll into view
  const setupScrollAnimations = () => {
    const options = {
      root: null,
      rootMargin: '0px',
      threshold: 0.1
    };

    const observer = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('animate-in');
          observer.unobserve(entry.target);
        }
      });
    }, options);

    document.querySelectorAll('.animate-on-scroll').forEach(el => {
      observer.observe(el);
    });
  };
  
  // Set up scroll animations if the browser supports IntersectionObserver
  if ('IntersectionObserver' in window) {
    setupScrollAnimations();
  }
});