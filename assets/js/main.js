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
    
    // Initialize teaching page content if we're on the teaching page
    if (document.querySelector('.teaching-page')) {
      initTeachingPage();
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
  
  // Initialize teaching page content
  const initTeachingPage = async () => {
    try {
      // First try to fetch teaching data from dedicated teaching.json
      let response = await fetch('/public/data/teaching.json');
      let teachingData = null;
      
      if (response.ok) {
        // Use the dedicated teaching data file
        teachingData = await response.json();
        updateTeachingPage(teachingData);
      } else {
        // Fall back to university.json if teaching.json isn't available
        console.log('Teaching data file not found, falling back to university data');
        response = await fetch('/public/data/university.json');
        
        if (response.ok) {
          const data = await response.json();
          if (data.teaching) {
            teachingData = data.teaching;
            updateTeachingPage(teachingData);
          }
        }
      }
      
      if (!teachingData) {
        console.error('No teaching data available');
      }
    } catch (error) {
      console.error('Error loading teaching data:', error);
    }
  };
  
  // Initialize social media insights
  const initSocialMediaInsights = async () => {
    try {
      // Check if the social media insights section exists on the page
      const insightsSection = document.querySelector('.social-media-insights');
      if (!insightsSection) return;
      
      // Try to fetch insights data
      const response = await fetch('/public/data/social-media-insights.json');
      if (response.ok) {
        const insights = await response.json();
        updateSocialMediaInsights(insights, insightsSection);
      }
    } catch (error) {
      console.error('Error loading social media insights:', error);
    }
  };
  
  // Update social media insights with data
  const updateSocialMediaInsights = (insights, container) => {
    // Update summary
    const summaryEl = container.querySelector('.insights-summary p');
    if (summaryEl) {
      summaryEl.textContent = insights.overallSummary;
    }
    
    // Update metrics
    const metricsCards = container.querySelectorAll('.metric-card');
    if (metricsCards.length >= 3) {
      const totalFollowersEl = metricsCards[0].querySelector('.metric-value');
      const avgEngagementEl = metricsCards[1].querySelector('.metric-value');
      const topPlatformEl = metricsCards[2].querySelector('.metric-value');
      
      if (totalFollowersEl) {
        totalFollowersEl.textContent = insights.engagementMetrics.totalFollowers.toLocaleString();
      }
      
      if (avgEngagementEl) {
        avgEngagementEl.textContent = insights.engagementMetrics.averageEngagementRate + '%';
      }
      
      if (topPlatformEl) {
        topPlatformEl.textContent = insights.engagementMetrics.mostEngagingPlatform;
      }
    }
    
    // Update content themes
    const themesList = container.querySelector('.themes-list');
    if (themesList && insights.contentThemes) {
      themesList.innerHTML = '';
      insights.contentThemes.forEach(theme => {
        const themeEl = document.createElement('li');
        themeEl.className = 'theme-item';
        themeEl.innerHTML = `<span class="theme-name">${theme.theme}:</span> ${theme.description}`;
        themesList.appendChild(themeEl);
      });
    }
    
    // Update recommendations
    const recommendationsList = container.querySelector('.recommendations-list');
    if (recommendationsList && insights.recommendations) {
      recommendationsList.innerHTML = '';
      insights.recommendations.forEach(rec => {
        const recEl = document.createElement('li');
        recEl.className = 'recommendation-item';
        recEl.textContent = rec;
        recommendationsList.appendChild(recEl);
      });
    }
    
    // Update top performing content
    const contentGrid = container.querySelector('.top-content-grid');
    if (contentGrid && insights.topPerformingContent) {
      contentGrid.innerHTML = '';
      insights.topPerformingContent.forEach(item => {
        const cardEl = document.createElement('div');
        cardEl.className = 'content-card';
        
        // Get platform icon
        const platformIcon = getPlatformIcon(item.platform);
        
        cardEl.innerHTML = `
          <p class="content-text">"${item.content}"</p>
          <div class="content-meta">
            <span class="platform-name"><i class="${platformIcon}"></i> ${capitalizeFirstLetter(item.platform)}</span>
            <span class="engagement-rate">${item.engagementRate}% engagement</span>
          </div>
        `;
        contentGrid.appendChild(cardEl);
      });
    }
  };
  
  // Get platform icon class
  const getPlatformIcon = (platform) => {
    const icons = {
      twitter: 'fab fa-x-twitter',
      bluesky: 'fa-solid fa-cloud',
      mastodon: 'fab fa-mastodon',
      linkedin: 'fab fa-linkedin',
      threads: 'fab fa-threads'
    };
    
    return icons[platform.toLowerCase()] || 'fas fa-globe';
  };
  
  // Capitalize first letter
  const capitalizeFirstLetter = (string) => {
    return string.charAt(0).toUpperCase() + string.slice(1);
  };
  
  // Update teaching page with data from university.json
  const updateTeachingPage = (teachingData) => {
    // Update courses sections if we have course data
    if (teachingData.courses && teachingData.courses.length > 0) {
      // Get course containers
      const currentCoursesSection = document.querySelector('.current-courses .courses-grid');
      const pastCoursesSection = document.querySelector('.past-courses .courses-grid');
      
      if (currentCoursesSection && pastCoursesSection) {
        // Clear existing content
        currentCoursesSection.innerHTML = '';
        pastCoursesSection.innerHTML = '';
        
        // Add each course to the appropriate section
        teachingData.courses.forEach(course => {
          const courseHtml = createCourseCard(course);
          if (course.current) {
            currentCoursesSection.innerHTML += courseHtml;
          } else {
            pastCoursesSection.innerHTML += courseHtml;
          }
        });
      }
    }
    
    // Update office hours section if available
    if (teachingData.office_hours) {
      const officeHoursSection = document.querySelector('.office-hours-content');
      if (officeHoursSection) {
        officeHoursSection.textContent = teachingData.office_hours;
      }
    }
    
    // Update tutorials section if available
    if (teachingData.tutorials && teachingData.tutorials.length > 0) {
      const tutorialsList = document.querySelector('.tutorials-list');
      if (tutorialsList) {
        tutorialsList.innerHTML = '';
        
        teachingData.tutorials.forEach(tutorial => {
          const tutorialHtml = `
            <li class="tutorial-item">
              <h3 class="tutorial-title">
                ${tutorial.url ? 
                  `<a href="${tutorial.url}" target="_blank">${tutorial.title}</a>` : 
                  tutorial.title}
              </h3>
              <p class="tutorial-description">${tutorial.description}</p>
            </li>
          `;
          tutorialsList.innerHTML += tutorialHtml;
        });
      }
    }
    
    // Update supervision section if available
    if (teachingData.supervision) {
      const supervisionSection = document.querySelector('.supervision-content');
      if (supervisionSection) {
        supervisionSection.textContent = teachingData.supervision;
      }
    }
  };
  
  // Create HTML for a course card
  const createCourseCard = (course) => {
    return `
      <div class="course-card">
        <h3 class="course-title">${course.title}</h3>
        <p class="course-code">${course.code}</p>
        <p class="course-description">${course.description}</p>
        <div class="course-details">
          <p><strong>Level:</strong> ${course.level}</p>
          <p><strong>Academic Year:</strong> ${course.academic_year}</p>
          <p><strong>Credits:</strong> ${course.credits} CFU</p>
          ${course.schedule ? `<p><strong>Schedule:</strong> ${course.schedule}</p>` : ''}
        </div>
        ${course.syllabus_url ? 
          `<a href="${course.syllabus_url}" class="course-link" target="_blank">View Syllabus</a>` : 
          ''}
      </div>
    `;
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
  initSocialMediaInsights();

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
  } else {
    // For browsers that don't support IntersectionObserver,
    // immediately show all animated elements
    document.querySelectorAll('.animate-on-scroll').forEach(el => {
      el.classList.add('animate-in');
    });
  }
  
  // Force all animations to complete after 1 second regardless,
  // in case any animation is stuck
  setTimeout(() => {
    document.querySelectorAll('.animate-on-scroll').forEach(el => {
      el.classList.add('animate-in');
    });
  }, 1000);
});