export class BravuneClient {
  private readonly baseUrl: string;
  private idToken = '';
  private idTokenExpiresAt = 0;

  constructor(private readonly requestToken?: string, baseUrl = process.env.API_BASE_URL ?? 'http://localhost:3000') {
    this.baseUrl = baseUrl;
  }

  private async getIdToken(): Promise<string> {
    if (this.requestToken) return this.requestToken;
    if (process.env.BRAVUNE_API_TOKEN) return process.env.BRAVUNE_API_TOKEN;

    const apiKey = process.env.FIREBASE_WEB_API_KEY;
    const refreshToken = process.env.FIREBASE_REFRESH_TOKEN;
    if (!apiKey || !refreshToken) return '';

    if (this.idToken && Date.now() < this.idTokenExpiresAt - 60_000) return this.idToken;

    const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    if (!response.ok) throw new Error('Could not refresh the Firebase sign-in token.');

    const tokens = await response.json() as { id_token: string; expires_in: string };
    this.idToken = tokens.id_token;
    this.idTokenExpiresAt = Date.now() + Number(tokens.expires_in) * 1000;
    return this.idToken;
  }

  async request(path: string, method = 'GET', body?: unknown) {
    const token = await this.getIdToken();
    const baseUrl = this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`;
    const requestUrl = new URL(path.replace(/^\/+/, ''), baseUrl);
    const response = await fetch(requestUrl, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json() as { data?: unknown; error?: { message?: string } };
    if (!response.ok) throw new Error(result.error?.message ?? `Bravune API returned ${response.status}`);
    return result.data;
  }
}
