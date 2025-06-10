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
<<<<<<< HEAD
<<<<<<< HEAD
    appLicense: 'your_app_license_guid',

    // Which product to load market data for.
    mdExchangeId: 'CME_Eq',
    mdContractId: 'ES',

    // Optional
    priceFormat: 2  /* 0: Decimal, 1: Real (Hint: Use Real if you ES price has a decimal like 6030.75, Decimal otherwise.) */
=======
    appLicense: 'your_app_license_guid'
>>>>>>> 462b3ae (Creating a JavaScript example.)
=======
    appLicense: 'your_app_license_guid',

    // Optional
    priceFormat: 2  /* 0: Decimal, 1: Real (Hint: Use Real if you ES price has a decimal like 6030.75, Decimal otherwise.) */
>>>>>>> f06ebb3 (Added price format to the login message.)
};