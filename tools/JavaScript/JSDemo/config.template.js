// T4 API Configuration Template
// Copy this file to config.js and update with your actual credentials

const T4_CONFIG = {
    // Connection URLs - T4 Simulator
    wsUrl: 'wss://wss-sim.t4login.com/v1',
    apiUrl: 'https://api-sim.t4login.com',

    // Option 1: API Key
    apiKey: 'your_api_key',

    // Option 2: Credentials
    firm: 'your_firm',
    userName: 'your_username',
    password: 'your_password',
    appName: 'your_app_name',
    appLicense: 'your_app_license_guid',

    // Option 3: SSO / OIDC via the official Auth0 SPA SDK.
    // When this block is set, "Connect via SSO" runs the full Universal Login
    // redirect flow instead of showing the paste-a-token dialog.
    // appName + appLicense above are still required for the SSO LoginRequest.
    oauth: {
        domain:   'YOUR_TENANT.us.auth0.com',  // Auth0 tenant domain
        clientId: 'YOUR_SPA_CLIENT_ID',        // registered SPA application client id
        scope:    'openid email profile',
        // redirectUri: 'https://localhost:8443', // defaults to location.origin
        // audience:    'https://your-api-identifier', // optional (Auth0 API audience)
    },

    // Which product to load market data for.
    mdExchangeId: 'CME_Eq',
    mdContractId: 'ES',

    // Optional
    priceFormat: 2  /* 0: Decimal, 1: Real (Hint: Use Real if you ES price has a decimal like 6030.75, Decimal otherwise.) */
};