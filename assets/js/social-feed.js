/**
 * Social Media Feed Functionality
 * 
 * Loads and displays social media posts from Bluesky, Mastodon, and Threads
 * with a tabbed interface.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize the tabs
  initializeTabs();
  
  // Load social media posts
  loadSocialPosts();
});

/**
 * Initialize tabs functionality
 */
function initializeTabs() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      // Remove active class from all buttons and panes
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
      
      // Add active class to clicked button
      button.classList.add('active');
      
      // Get the tab id and activate corresponding pane
      const tabId = button.getAttribute('data-tab');
      document.getElementById(`tab-${tabId}`).classList.add('active');
    });
  });
}

/**
 * Load social media posts from all platforms
 */
async function loadSocialPosts() {
  try {
    // Load all social media data
    const response = await fetch('/public/data/social-media.json');
    
    if (response.ok) {
      const data = await response.json();
      
      // Load posts for each platform
      if (data.platforms.bluesky) {
        displayBlueskyPosts(data.platforms.bluesky.posts);
      }
      
      if (data.platforms.mastodon) {
        displayMastodonPosts(data.platforms.mastodon.posts);
      }
      
      // Threads data would be added in the same pattern
      // For now, we'll use mock data
      displayThreadsPosts(getMockThreadsPosts());
    }
  } catch (error) {
    console.error('Error loading social media data:', error);
    displayErrorState();
  }
}

/**
 * Display Bluesky posts in the feed
 */
function displayBlueskyPosts(posts) {
  const container = document.getElementById('bluesky-feed');
  
  // Clear loading indicator
  container.innerHTML = '';
  
  if (!posts || posts.length === 0) {
    container.innerHTML = '<p class="no-posts">No recent posts available.</p>';
    return;
  }
  
  // Add each post to the container
  posts.forEach(post => {
    container.appendChild(createPostElement({
      platform: 'bluesky',
      name: 'Fabio Giglietto',
      username: 'fabiogiglietto.bsky.social',
      avatar: '/assets/images/profile.jpg',
      content: post.content,
      date: new Date(post.date),
      likes: post.likes,
      reposts: post.reposts,
      url: post.url
    }));
  });
}

/**
 * Display Mastodon posts in the feed
 */
function displayMastodonPosts(posts) {
  const container = document.getElementById('mastodon-feed');
  
  // Clear loading indicator
  container.innerHTML = '';
  
  if (!posts || posts.length === 0) {
    container.innerHTML = '<p class="no-posts">No recent posts available.</p>';
    return;
  }
  
  // Add each post to the container
  posts.forEach(post => {
    container.appendChild(createPostElement({
      platform: 'mastodon',
      name: 'Fabio Giglietto',
      username: '@fabiogiglietto@aoir.social',
      avatar: '/assets/images/profile.jpg',
      content: post.content,
      date: new Date(post.date),
      likes: post.likes,
      reposts: post.reposts,
      url: post.url
    }));
  });
}

/**
 * Display Threads posts in the feed
 */
function displayThreadsPosts(posts) {
  const container = document.getElementById('threads-feed');
  
  // Clear loading indicator
  container.innerHTML = '';
  
  if (!posts || posts.length === 0) {
    container.innerHTML = '<p class="no-posts">No recent posts available.</p>';
    return;
  }
  
  // Add each post to the container
  posts.forEach(post => {
    container.appendChild(createPostElement({
      platform: 'threads',
      name: 'Fabio Giglietto',
      username: '@fabiogiglietto',
      avatar: '/assets/images/profile.jpg',
      content: post.content,
      date: new Date(post.date),
      likes: post.likes,
      replies: post.replies,
      url: post.url,
      media: post.media
    }));
  });
}

/**
 * Create a post element from post data
 */
function createPostElement(post) {
  const postElement = document.createElement('div');
  postElement.className = 'post-card';
  
  // Format the date
  const formattedDate = formatDate(post.date);
  
  // Build post HTML
  postElement.innerHTML = `
    <div class="post-header">
      <img src="${post.avatar}" alt="${post.name}" class="post-avatar">
      <div class="post-author">
        <span class="post-name">${post.name}</span>
        <span class="post-username">${post.username}</span>
      </div>
      <span class="post-date">${formattedDate}</span>
    </div>
    <div class="post-content">${formatPostContent(post.content, post.platform)}</div>
    ${post.media ? `<div class="post-media"><img src="${post.media}" alt="Post media"></div>` : ''}
    <div class="post-actions">
      ${post.likes ? `<span class="post-action"><i class="fas fa-heart"></i> ${post.likes}</span>` : ''}
      ${post.reposts ? `<span class="post-action"><i class="fas fa-retweet"></i> ${post.reposts}</span>` : ''}
      ${post.replies ? `<span class="post-action"><i class="fas fa-reply"></i> ${post.replies}</span>` : ''}
      <a href="${post.url}" class="post-action" target="_blank"><i class="fas fa-external-link-alt"></i> View</a>
    </div>
  `;
  
  return postElement;
}

/**
 * Format post content based on platform (handle links, mentions, hashtags)
 */
function formatPostContent(content, platform) {
  // Convert URLs to links
  content = content.replace(
    /(https?:\/\/[^\s]+)/g, 
    '<a href="$1" target="_blank">$1</a>'
  );
  
  // Format hashtags
  content = content.replace(
    /#(\w+)/g, 
    '<a href="https://bsky.app/search?q=%23$1" target="_blank">#$1</a>'
  );
  
  // Format mentions based on platform
  if (platform === 'bluesky') {
    content = content.replace(
      /@(\w+)/g, 
      '<a href="https://bsky.app/profile/$1" target="_blank">@$1</a>'
    );
  } else if (platform === 'mastodon') {
    content = content.replace(
      /@(\w+)@(\w+\.\w+)/g, 
      '<a href="https://$2/@$1" target="_blank">@$1@$2</a>'
    );
  } else if (platform === 'threads') {
    content = content.replace(
      /@(\w+)/g, 
      '<a href="https://www.threads.net/@$1" target="_blank">@$1</a>'
    );
  }
  
  return content;
}

/**
 * Format a date for display
 */
function formatDate(date) {
  const now = new Date();
  const diffTime = Math.abs(now - date);
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays < 1) {
    const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
    if (diffHours < 1) {
      const diffMinutes = Math.floor(diffTime / (1000 * 60));
      return `${diffMinutes}m ago`;
    }
    return `${diffHours}h ago`;
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

/**
 * Display error state in the feed containers
 */
function displayErrorState() {
  const containers = [
    document.getElementById('bluesky-feed'),
    document.getElementById('mastodon-feed'),
    document.getElementById('threads-feed')
  ];
  
  containers.forEach(container => {
    if (container) {
      container.innerHTML = '<p class="error-state">Unable to load posts. Please try again later.</p>';
    }
  });
}

/**
 * Get mock Threads posts for demonstration
 */
function getMockThreadsPosts() {
  return [
    {
      id: 'th1',
      content: 'Excited to share our new research on coordinated inauthentic behavior across multiple platforms! #ComputationalSocialScience #Disinformation',
      date: '2025-04-19T08:45:00Z',
      likes: 78,
      replies: 12,
      url: 'https://www.threads.net/@fabiogiglietto/post/123456789',
      media: 'https://via.placeholder.com/500x300/f1f5f9/1e293b?text=Research+Visualization'
    },
    {
      id: 'th2',
      content: 'Registration is now open for our summer workshop on digital methods for social media research. Limited spots available!',
      date: '2025-04-16T13:20:00Z',
      likes: 42,
      replies: 5,
      url: 'https://www.threads.net/@fabiogiglietto/post/123456788'
    },
    {
      id: 'th3',
      content: 'New paper out today in the Journal of Computational Social Science on detecting coordinated link sharing behavior. Thanks to my amazing co-authors @researcherA and @researcherB',
      date: '2025-04-14T09:15:00Z',
      likes: 65,
      replies: 8,
      url: 'https://www.threads.net/@fabiogiglietto/post/123456787'
    }
  ];
}