import logger from '../config/logger';

export type GitHubRepo = 'web' | 'api';
export type GitHubAction = 'star' | 'fork';

const REPOS: Record<GitHubRepo, { owner: string; name: string }> = {
  web: {
    owner: process.env.GITHUB_REPO_OWNER_WEB || process.env.GITHUB_REPO_OWNER || 'joaorjoaquim',
    name: process.env.GITHUB_REPO_NAME_WEB || 'video-insight-web',
  },
  api: {
    owner: process.env.GITHUB_REPO_OWNER_API || process.env.GITHUB_REPO_OWNER || 'joaorjoaquim',
    name: process.env.GITHUB_REPO_NAME_API || 'video-insight-api',
  },
};

const CREDITS_REWARD: Record<GitHubAction, number> = {
  star: 5,
  fork: 10,
};

function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_API_TOKEN;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function hasStarred(username: string, owner: string, repo: string): Promise<boolean> {
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = `https://api.github.com/repos/${owner}/${repo}/stargazers?per_page=${perPage}&page=${page}`;
    const res = await fetch(url, { headers: githubHeaders() });

    if (!res.ok) {
      logger.warn({ status: res.status, owner, repo, username }, 'github_stargazers_fetch_failed');
      throw new Error(`GitHub API error: ${res.status}`);
    }

    const stargazers: Array<{ login: string }> = await res.json();

    if (stargazers.length === 0) return false;

    const found = stargazers.some((s) => s.login.toLowerCase() === username.toLowerCase());
    if (found) return true;
    if (stargazers.length < perPage) return false;

    page++;
  }
}

async function hasForked(username: string, owner: string, repo: string): Promise<boolean> {
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = `https://api.github.com/repos/${owner}/${repo}/forks?per_page=${perPage}&page=${page}`;
    const res = await fetch(url, { headers: githubHeaders() });

    if (!res.ok) {
      logger.warn({ status: res.status, owner, repo, username }, 'github_forks_fetch_failed');
      throw new Error(`GitHub API error: ${res.status}`);
    }

    const forks: Array<{ owner: { login: string } }> = await res.json();

    if (forks.length === 0) return false;

    const found = forks.some((f) => f.owner.login.toLowerCase() === username.toLowerCase());
    if (found) return true;
    if (forks.length < perPage) return false;

    page++;
  }
}

export async function verifyGitHubAction(
  username: string,
  action: GitHubAction,
  repo: GitHubRepo
): Promise<boolean> {
  const { owner, name } = REPOS[repo];

  logger.info({ username, action, repo: `${owner}/${name}` }, 'github_action_verify_start');

  try {
    if (action === 'star') {
      return await hasStarred(username, owner, name);
    } else {
      return await hasForked(username, owner, name);
    }
  } catch (err) {
    logger.error({ err, username, action, repo }, 'github_action_verify_error');
    throw err;
  }
}

export function getCreditsForAction(action: GitHubAction): number {
  return CREDITS_REWARD[action];
}

export function getClaimFlag(
  action: GitHubAction,
  repo: GitHubRepo
): 'githubStarClaimedWeb' | 'githubForkClaimedWeb' | 'githubStarClaimedApi' | 'githubForkClaimedApi' {
  if (action === 'star' && repo === 'web') return 'githubStarClaimedWeb';
  if (action === 'fork' && repo === 'web') return 'githubForkClaimedWeb';
  if (action === 'star' && repo === 'api') return 'githubStarClaimedApi';
  return 'githubForkClaimedApi';
}
