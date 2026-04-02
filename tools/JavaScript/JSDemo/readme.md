# Project Setup

## 1: Install Node through the command line
### MacOS
Use Homebrew to install Node.js:

(If you don't have Homebrew installed, you can install it [here](https://brew.sh/))
```
brew install node
```

### Windows
Download the Node.js installer from the official [website](https://nodejs.org/). 
Run the installer and follow the prompts to complete the installation.

## 2: Create config.js file
In the root directory of the project, copy the `config.template.js` file and name the new file `config.js`. 
This file will hold your configuration settings for the project.

### API Key
If you have an API key, paste that in to the `config.js` file and comment out the credential fields.

### Credentials
If you don't have an API key, you can use your credentials to log in.
Enter the firm, username, password, app name, and app license, then comment out the API key field above.

## 3: Launch the site
Open the terminal window within your IDE or navigate to the project directory in your terminal/command prompt.

Run the following command to launch the site:
```
npx serve .
```

You should get an output similar to this:
```
   ┌───────────────────────────────────────────────────┐
   │                                                   │
   │   Serving!                                        │
   │                                                   │
   │   - Local:            http://localhost:5000       │
   │   - On Your Network:  http://192.168.1.99:5000    │
   │                                                   │
   │   Copied local address to clipboard!              │
   │                                                   │
   └───────────────────────────────────────────────────┘
```

Open the URL provided in the output (e.g., `http://localhost:5000`) in your web browser to access the site.

