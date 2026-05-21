import { createHmac } from 'crypto';
import { UserEntity } from '../entities/User';
import { UserRepository } from '../repositories/user.repository';

export type OAuthProvider = 'google' | 'discord' | 'github';

interface OAuthUserProfile {
  email: string;
  name: string;
  avatarUrl?: string;
  providerId: string;
  githubUsername?: string;
  githubId?: string;
}

interface GoogleUserInfo {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

interface DiscordUserInfo {
  id: string;
  email: string;
  username: string;
  avatar?: string;
}

interface GitHubUserInfo {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url?: string;
}

export class OAuthService {
  private static readonly GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  private static readonly GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  private static readonly DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
  private static readonly DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
  private static readonly GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
  private static readonly GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
  private static readonly REDIRECT_BASE_URL =
    process.env.OAUTH_REDIRECT_BASE_URL || 'https://api.summaryvideos.com/auth/callback';

  static getOAuthUrl(provider: OAuthProvider): string {
    const baseUrl = this.getProviderBaseUrl(provider);
    const clientId = this.getClientId(provider);
    const scope = this.getScope(provider);
    const redirectUri = `${this.REDIRECT_BASE_URL}/${provider}`;

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scope,
    });

    return `${baseUrl}?${params.toString()}`;
  }

  static getLinkUrl(provider: OAuthProvider, userId: number): string {
    const baseUrl = this.getProviderBaseUrl(provider);
    const clientId = this.getClientId(provider);
    const scope = this.getScope(provider);
    const redirectUri = `${this.REDIRECT_BASE_URL}/${provider}`;

    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET env var is required');
    const iat = Math.floor(Date.now() / 1000);
    const sigPayload = `${userId}:link:${iat}`;
    const sig = createHmac('sha256', secret).update(sigPayload).digest('hex');

    const statePayload = Buffer.from(
      JSON.stringify({ userId, mode: 'link', iat, sig })
    ).toString('base64url');

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scope,
      state: statePayload,
    });

    return `${baseUrl}?${params.toString()}`;
  }

  static decodeLinkState(state: string): { userId: number; mode: string } | null {
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8'));
      if (!decoded.userId || decoded.mode !== 'link') return null;
      if (typeof decoded.userId !== 'number' || typeof decoded.iat !== 'number') return null;
      if (Math.floor(Date.now() / 1000) - decoded.iat > 600) return null;

      const secret = process.env.JWT_SECRET;
      if (!secret) throw new Error('JWT_SECRET env var is required');
      const sigPayload = `${decoded.userId}:link:${decoded.iat}`;
      const expectedSig = createHmac('sha256', secret).update(sigPayload).digest('hex');
      if (decoded.sig !== expectedSig) return null;

      return decoded;
    } catch {
      return null;
    }
  }

  static async handleOAuthCallback(
    provider: OAuthProvider,
    code: string
  ): Promise<OAuthUserProfile> {
    try {
      const accessToken = await this.exchangeCodeForToken(provider, code);
      return this.fetchUserProfile(provider, accessToken);
    } catch (error) {
      throw new Error(`OAuth callback failed for ${provider}: ${error.message}`);
    }
  }

  private static getProviderBaseUrl(provider: OAuthProvider): string {
    switch (provider) {
      case 'google':
        return 'https://accounts.google.com/o/oauth2/v2/auth';
      case 'discord':
        return 'https://discord.com/api/oauth2/authorize';
      case 'github':
        return 'https://github.com/login/oauth/authorize';
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  private static getClientId(provider: OAuthProvider): string {
    switch (provider) {
      case 'google':
        if (!this.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID not configured');
        return this.GOOGLE_CLIENT_ID;
      case 'discord':
        if (!this.DISCORD_CLIENT_ID) throw new Error('DISCORD_CLIENT_ID not configured');
        return this.DISCORD_CLIENT_ID;
      case 'github':
        if (!this.GITHUB_CLIENT_ID) throw new Error('GITHUB_CLIENT_ID not configured');
        return this.GITHUB_CLIENT_ID;
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  private static getScope(provider: OAuthProvider): string {
    switch (provider) {
      case 'google':
        return 'openid email profile';
      case 'discord':
        return 'identify email';
      case 'github':
        return 'read:user user:email';
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  private static async exchangeCodeForToken(
    provider: OAuthProvider,
    code: string
  ): Promise<string> {
    const tokenUrl = this.getTokenUrl(provider);
    const clientSecret = this.getClientSecret(provider);

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    // GitHub requires Accept: application/json to get JSON response
    if (provider === 'github') {
      headers['Accept'] = 'application/json';
    }

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers,
      body: new URLSearchParams({
        client_id: this.getClientId(provider),
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${this.REDIRECT_BASE_URL}/${provider}`,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(`Token exchange error: ${data.error_description || data.error}`);
    }

    return data.access_token;
  }

  private static getTokenUrl(provider: OAuthProvider): string {
    switch (provider) {
      case 'google':
        return 'https://oauth2.googleapis.com/token';
      case 'discord':
        return 'https://discord.com/api/oauth2/token';
      case 'github':
        return 'https://github.com/login/oauth/access_token';
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  private static getClientSecret(provider: OAuthProvider): string {
    switch (provider) {
      case 'google':
        if (!this.GOOGLE_CLIENT_SECRET) throw new Error('GOOGLE_CLIENT_SECRET not configured');
        return this.GOOGLE_CLIENT_SECRET;
      case 'discord':
        if (!this.DISCORD_CLIENT_SECRET) throw new Error('DISCORD_CLIENT_SECRET not configured');
        return this.DISCORD_CLIENT_SECRET;
      case 'github':
        if (!this.GITHUB_CLIENT_SECRET) throw new Error('GITHUB_CLIENT_SECRET not configured');
        return this.GITHUB_CLIENT_SECRET;
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  private static async fetchUserProfile(
    provider: OAuthProvider,
    accessToken: string
  ): Promise<OAuthUserProfile> {
    const userInfoUrl = this.getUserInfoUrl(provider);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };

    if (provider === 'github') {
      headers['Accept'] = 'application/vnd.github+json';
      headers['X-GitHub-Api-Version'] = '2022-11-28';
    }

    const response = await fetch(userInfoUrl, { headers });

    if (!response.ok) {
      throw new Error(`Failed to fetch user profile from ${provider}`);
    }

    const userInfo = await response.json();

    switch (provider) {
      case 'google':
        return this.parseGoogleUserInfo(userInfo as GoogleUserInfo);
      case 'discord':
        return this.parseDiscordUserInfo(userInfo as DiscordUserInfo);
      case 'github':
        return this.parseGitHubUserInfo(userInfo as GitHubUserInfo, accessToken);
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  private static getUserInfoUrl(provider: OAuthProvider): string {
    switch (provider) {
      case 'google':
        return 'https://www.googleapis.com/oauth2/v2/userinfo';
      case 'discord':
        return 'https://discord.com/api/users/@me';
      case 'github':
        return 'https://api.github.com/user';
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  private static parseGoogleUserInfo(userInfo: GoogleUserInfo): OAuthUserProfile {
    return {
      email: userInfo.email,
      name: userInfo.name,
      avatarUrl: userInfo.picture,
      providerId: userInfo.id,
    };
  }

  private static parseDiscordUserInfo(userInfo: DiscordUserInfo): OAuthUserProfile {
    const avatarUrl = userInfo.avatar
      ? `https://cdn.discordapp.com/avatars/${userInfo.id}/${userInfo.avatar}.png`
      : undefined;

    return {
      email: userInfo.email,
      name: userInfo.username,
      avatarUrl,
      providerId: userInfo.id,
    };
  }

  private static async parseGitHubUserInfo(
    userInfo: GitHubUserInfo,
    accessToken: string
  ): Promise<OAuthUserProfile> {
    let email = userInfo.email;

    // GitHub may not expose email publicly — fetch from emails endpoint
    if (!email) {
      const emailsRes = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      if (emailsRes.ok) {
        const emails: Array<{ email: string; primary: boolean; verified: boolean }> =
          await emailsRes.json();
        const primary = emails.find((e) => e.primary && e.verified);
        email = primary?.email || emails[0]?.email || null;
      }
    }

    if (!email) {
      throw new Error('GitHub account has no accessible email address');
    }

    return {
      email,
      name: userInfo.name || userInfo.login,
      avatarUrl: userInfo.avatar_url,
      providerId: String(userInfo.id),
      githubUsername: userInfo.login,
      githubId: String(userInfo.id),
    };
  }
}
