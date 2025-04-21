/**
 * GitHub data collector
 * 
 * Fetches repository and contribution data from GitHub API
 */

// Use dynamic import for ESM module
let Octokit;
async function importOctokit() {
  const { Octokit: OctokitClass } = await import('@octokit/rest');
  Octokit = OctokitClass;
}

async function collect() {
  console.log('Collecting GitHub data...');
  
  // Import Octokit first
  await importOctokit();
  
  // Create Octokit client with GitHub token
  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN
  });
  
  // Replace with actual GitHub username
  const username = 'fabiogiglietto';
  
  try {
    // Get user profile
    const { data: profile } = await octokit.users.getByUsername({
      username
    });
    
    // Get repositories
    const { data: repos } = await octokit.repos.listForUser({
      username,
      sort: 'updated',
      per_page: 100
    });
    
    // Get contribution data (last year's commit activity for top repos)
    const topRepos = repos
      .filter(repo => !repo.fork)
      .sort((a, b) => b.stargazers_count - a.stargazers_count)
      .slice(0, 5);
    
    const repoActivity = await Promise.all(
      topRepos.map(async (repo) => {
        try {
          const { data: commitActivity } = await octokit.repos.getCommitActivityStats({
            owner: username,
            repo: repo.name
          });
          
          return {
            name: repo.name,
            description: repo.description,
            url: repo.html_url,
            stars: repo.stargazers_count,
            forks: repo.forks_count,
            activity: commitActivity
          };
        } catch (error) {
          console.warn(`Error fetching activity for ${repo.name}:`, error.message);
          return {
            name: repo.name,
            description: repo.description,
            url: repo.html_url,
            stars: repo.stargazers_count,
            forks: repo.forks_count,
            activity: null
          };
        }
      })
    );
    
    return {
      profile: {
        login: profile.login,
        name: profile.name,
        bio: profile.bio,
        company: profile.company,
        blog: profile.blog,
        location: profile.location,
        avatar_url: profile.avatar_url,
        followers: profile.followers,
        following: profile.following
      },
      repositories: repos.map(repo => ({
        name: repo.name,
        description: repo.description,
        url: repo.html_url,
        language: repo.language,
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        created_at: repo.created_at,
        updated_at: repo.updated_at
      })),
      activity: repoActivity,
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error fetching GitHub data:', error.message);
    throw error;
  }
}

module.exports = { collect };