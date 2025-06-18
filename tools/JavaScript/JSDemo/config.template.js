// T4 API Configuration Template
// Copy this file to config.js and update with your actual credentials

const T4_CONFIG = {
    // Connection URLs - T4 Simulator
    wsUrl: 'wss://wss-sim.t4login.com/v1',
    apiUrl: 'https://api-sim.t4login.com',

    // Option 1: API Key
    apiKey: '',

    // Option 2: Credentials
    firm: 'CTS',
    userName: 'JGarner',
    password: 'Temp123$',
     appName: 'T4WebSite',
    appLicense: '81CE8199-0D41-498C-8A0B-EC5510A395F4',

    // Optional
    priceFormat: 2  /* 0: Decimal, 1: Real (Hint: Use Real if you ES price has a decimal like 6030.75, Decimal otherwise.) */
};