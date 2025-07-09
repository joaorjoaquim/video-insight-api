import { UserEntity } from '../entities/User';
import { UserRepository } from '../repositories/user.repository';

export type OAuthProvider = 'google' | 'discord';

interface OAuthUserProfile {
  email: string;
  name: string;
  avatarUrl?: string;
  providerId: string;
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

export class OAuthService {
  private static readonly GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  private static readonly GOOGLE_CLIENT_SECRET =
    process.env.GOOGLE_CLIENT_SECRET;
  private static readonly DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
  private static readonly DISCORD_CLIENT_SECRET =
    process.env.DISCORD_CLIENT_SECRET;
  private static readonly REDIRECT_URI =
    process.env.OAUTH_REDIRECT_URI || 'http://localhost:5000/auth/callback';

  static getOAuthUrl(provider: OAuthProvider): string {
    const baseUrl = this.getProviderBaseUrl(provider);
    const clientId = this.getClientId(provider);
    const scope = this.getScope(provider);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${this.REDIRECT_URI}/${provider}`,
      response_type: 'code',
      scope: scope,
    });

    return `${baseUrl}?${params.toString()}`;
  }

  static async handleOAuthCallback(
    provider: OAuthProvider,
    code: string
  ): Promise<OAuthUserProfile> {
    try {
      // Exchange code for access token
      const accessToken = await this.exchangeCodeForToken(provider, code);

      // Fetch user profile
      const userProfile = await this.fetchUserProfile(provider, accessToken);

      return userProfile;
    } catch (error) {
      throw new Error(
        `OAuth callback failed for ${provider}: ${error.message}`
      );
    }
  }

  private static getProviderBaseUrl(provider: OAuthProvider): string {
    switch (provider) {
      case 'google':
        return 'https://accounts.google.com/o/oauth2/v2/auth';
      case 'discord':
        return 'https://discord.com/api/oauth2/authorize';
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  private static getClientId(provider: OAuthProvider): string {
    switch (provider) {
      case 'google':
        if (!this.GOOGLE_CLIENT_ID) {
          throw new Error('GOOGLE_CLIENT_ID not configured');
        }
        return this.GOOGLE_CLIENT_ID;
      case 'discord':
        if (!this.DISCORD_CLIENT_ID) {
          throw new Error('DISCORD_CLIENT_ID not configured');
        }
        return this.DISCORD_CLIENT_ID;
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

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.getClientId(provider),
        client_secret: clientSecret,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: `${this.REDIRECT_URI}/${provider}`,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    const data = await response.json();
    return data.access_token;
  }

  private static getTokenUrl(provider: OAuthProvider): string {
    switch (provider) {
      case 'google':
        return 'https://oauth2.googleapis.com/token';
      case 'discord':
        return 'https://discord.com/api/oauth2/token';
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  private static getClientSecret(provider: OAuthProvider): string {
    switch (provider) {
      case 'google':
        if (!this.GOOGLE_CLIENT_SECRET) {
          throw new Error('GOOGLE_CLIENT_SECRET not configured');
        }
        return this.GOOGLE_CLIENT_SECRET;
      case 'discord':
        if (!this.DISCORD_CLIENT_SECRET) {
          throw new Error('DISCORD_CLIENT_SECRET not configured');
        }
        return this.DISCORD_CLIENT_SECRET;
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  private static async fetchUserProfile(
    provider: OAuthProvider,
    accessToken: string
  ): Promise<OAuthUserProfile> {
    const userInfoUrl = this.getUserInfoUrl(provider);

    const response = await fetch(userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch user profile from ${provider}`);
    }

    const userInfo = await response.json();

    switch (provider) {
      case 'google':
        return this.parseGoogleUserInfo(userInfo as GoogleUserInfo);
      case 'discord':
        return this.parseDiscordUserInfo(userInfo as DiscordUserInfo);
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
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  private static parseGoogleUserInfo(
    userInfo: GoogleUserInfo
  ): OAuthUserProfile {
    return {
      email: userInfo.email,
      name: userInfo.name,
      avatarUrl: userInfo.picture,
      providerId: userInfo.id,
    };
  }

  private static parseDiscordUserInfo(
    userInfo: DiscordUserInfo
  ): OAuthUserProfile {
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
}
