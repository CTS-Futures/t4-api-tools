// SSO login for JSDemo, backed by the official Auth0 SPA SDK (auth0-spa-js).
//
// The SDK is loaded from the Auth0 CDN in index.html and exposed as the global
// `auth0`. This file is a thin wrapper that keeps a small, stable interface for
// DemoPage.js — login(), handleRedirectCallback() — and hands back the raw
// id_token, which is what T4's SSO LoginRequest expects.
//
// All OAuth/OIDC mechanics (PKCE, state/nonce, the code exchange, token caching,
// silent renewal) are handled by the SDK — we never build those by hand.
//
// The Auth0 application must be a Single Page Application ("none" token-endpoint
// auth) with these URLs registered for the app origin (default https://localhost:8443/):
//   - Allowed Callback URLs : the redirectUri (defaults to location.origin)
//   - Allowed Logout URLs   : location.origin
//   - Allowed Web Origins   : location.origin

class OidcClient {
    constructor(cfg) {
        if (!cfg || (!cfg.domain && !cfg.authority) || !cfg.clientId) {
            throw new Error('oauth config requires at least { domain (or authority), clientId }');
        }
        // Auth0 wants a bare domain ("tenant.us.auth0.com"); accept a full issuer
        // URL in `authority` too and strip the scheme/trailing slash.
        this.domain      = (cfg.domain || cfg.authority).replace(/^https?:\/\//, '').replace(/\/+$/, '');
        this.clientId    = cfg.clientId;
        // Must exactly match an Allowed Callback URL. The Auth0 quickstart uses
        // location.origin (e.g. https://localhost:8443), which Auth0 matches
        // against the registered https://localhost:8443/.
        this.redirectUri = cfg.redirectUri || window.location.origin;
        this.scope       = cfg.scope || 'openid email profile';
        this.audience    = cfg.audience || null;   // optional Auth0 API audience
        this._client     = null;
    }

    // Lazily create the underlying Auth0 client (createAuth0Client is async).
    async _ensure() {
        if (this._client) return this._client;
        if (typeof auth0 === 'undefined' || !auth0.createAuth0Client) {
            throw new Error('Auth0 SPA SDK not loaded — check the auth0-spa-js <script> in index.html.');
        }
        const authorizationParams = { redirect_uri: this.redirectUri, scope: this.scope };
        if (this.audience) authorizationParams.audience = this.audience;

        this._client = await auth0.createAuth0Client({
            domain:   this.domain,
            clientId: this.clientId,
            authorizationParams,
        });
        return this._client;
    }

    // Step 1 — redirect to the Auth0 Universal Login (hosted) screen.
    // Navigates away; nothing after this runs until Auth0 redirects back.
    async login() {
        const client = await this._ensure();
        await client.loginWithRedirect();
    }

    // Step 2 — run on page load. If we came back from Auth0 (?code&state), the SDK
    // completes the exchange; then, if authenticated, return the raw id_token.
    // Returns { idToken, accessToken } or null when there's nothing to do.
    async handleRedirectCallback() {
        const search = window.location.search;

        if (search.includes('error=')) {
            const p = new URLSearchParams(search);
            this._stripQuery();
            throw new Error(`SSO provider error: ${p.get('error')} — ${p.get('error_description') || ''}`);
        }

        const client = await this._ensure();

        if (search.includes('code=') && search.includes('state=')) {
            await client.handleRedirectCallback();
            this._stripQuery();
        }

        if (!(await client.isAuthenticated())) return null;

        // The SDK exposes the raw JWT via getIdTokenClaims().__raw.
        const claims  = await client.getIdTokenClaims();
        const idToken = claims && claims.__raw;
        if (!idToken) return null;

        return { idToken, accessToken: null };
    }

    // Optional: end the Auth0 session too (JSDemo's Disconnect only drops the WS).
    async logout() {
        const client = await this._ensure();
        await client.logout({ logoutParams: { returnTo: window.location.origin } });
    }

    _stripQuery() {
        window.history.replaceState({}, document.title,
            window.location.origin + window.location.pathname);
    }
}
