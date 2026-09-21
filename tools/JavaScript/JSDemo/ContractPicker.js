/**
 * Contract Picker Dialog
 * Handles contract selection with search and hierarchical display
 */

class ContractPicker {
    constructor(config) {
        this.config = config;
        this.exchanges = [];
        this.contractsCache = new Map();
        this.expandedExchanges = new Set();
        this.selectedContract = null;
        this.isSearchMode = false;
        this.onContractSelected = null;

        this.dialog = null;
        this.searchInput = null;
        this.exchangesList = null;
        this.loadingIndicator = null;

        // Cached for the lifetime of this dialog to avoid re-fetching on every request
        this._authHeaders = null;
        this._searchDebounceTimer = null;
    }

    async show() {
        return new Promise((resolve) => {
            this.onContractSelected = resolve;
            this.createDialog();
            this.loadExchanges();
        });
    }

    createDialog() {
        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'contract-picker-overlay';
        overlay.innerHTML = `
            <div class="contract-picker-dialog">
                <div class="contract-picker-header">
                    <h3>Select a Contract</h3>
                    <button class="close-btn">&times;</button>
                </div>
                <div class="contract-picker-search">
                    <input type="text" placeholder="Search contracts" class="search-input">
                </div>
                <div class="contract-picker-content">
                    <div class="loading-indicator" style="display: none;">Loading...</div>
                    <div class="exchanges-list"></div>
                </div>
                <div class="contract-picker-footer">
                    <button class="btn btn-cancel">Cancel</button>
                    <button class="btn btn-select" disabled>Select</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        this.dialog = overlay;

        // Get references
        this.searchInput = overlay.querySelector('.search-input');
        this.exchangesList = overlay.querySelector('.exchanges-list');
        this.loadingIndicator = overlay.querySelector('.loading-indicator');

        // Event listeners
        overlay.querySelector('.close-btn').addEventListener('click', () => this.close(null));
        overlay.querySelector('.btn-cancel').addEventListener('click', () => this.close(null));
        overlay.querySelector('.btn-select').addEventListener('click', () => this.selectContract());

        this.searchInput.addEventListener('input', (e) => this.scheduleSearch(e.target.value));

        // Close on overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.close(null);
        });
    }

    async getAuthHeaders() {
        if (this._authHeaders) return this._authHeaders;
        const headers = { 'Content-Type': 'application/json' };
        if (this.config.apiKey) {
            headers['Authorization'] = `APIKey ${this.config.apiKey}`;
        } else {
            const token = await this.getAuthToken();
            if (token) headers['Authorization'] = `Bearer ${token}`;
        }
        this._authHeaders = headers;
        return headers;
    }

    async loadExchanges() {
        this.showLoading(true);

        try {
            const headers = await this.getAuthHeaders();
            const response = await fetch(`${this.config.apiUrl}/markets/exchanges`, { headers });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            this.exchanges = await response.json();
            this.exchanges.sort((a, b) => a.description.localeCompare(b.description));
            this.renderExchanges();

            // Pre-fetch contracts for all exchanges in the background so search and
            // expand are instant after the initial load.
            this.prefetchAllContracts();

        } catch (error) {
            console.error('Error loading exchanges:', error);
            this.exchangesList.innerHTML = '<div class="error">Failed to load exchanges</div>';
        } finally {
            this.showLoading(false);
        }
    }

    prefetchAllContracts() {
        // Fire all requests in parallel; results land in the cache as they arrive.
        this.exchanges.forEach(exchange => {
            if (!this.contractsCache.has(exchange.exchangeId)) {
                this.loadContractsForExchange(exchange.exchangeId);
            }
        });
    }

    async loadContractsForExchange(exchangeId) {
        if (this.contractsCache.has(exchangeId)) {
            return this.contractsCache.get(exchangeId);
        }

        try {
            const headers = await this.getAuthHeaders();
            const response = await fetch(`${this.config.apiUrl}/markets/contracts?exchangeid=${exchangeId}`, { headers });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const contracts = await response.json();
            contracts.sort((a, b) => a.description.localeCompare(b.description));
            this.contractsCache.set(exchangeId, contracts);
            return contracts;

        } catch (error) {
            console.error(`Error loading contracts for exchange ${exchangeId}:`, error);
            return [];
        }
    }

    scheduleSearch(searchTerm) {
        clearTimeout(this._searchDebounceTimer);
        this._searchDebounceTimer = setTimeout(() => this.handleSearch(searchTerm), 300);
    }

    contractMatchesTokens(contract, tokens) {
        const exchange = this.exchanges.find(e => e.exchangeId === contract.exchangeID);
        const fields = [
            contract.description || '',
            contract.contractID || '',
            contract.contractType || '',
            exchange ? exchange.description : '',
            exchange ? exchange.exchangeId : '',
            contract.exchangeID || '',
        ].map(f => f.toLowerCase());
        return tokens.every(token => fields.some(f => f.includes(token)));
    }

    async handleSearch(searchTerm) {
        const trimmed = searchTerm.trim();
        this.isSearchMode = trimmed.length >= 2;

        if (!this.isSearchMode) {
            this.renderExchanges();
            return;
        }

        const tokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean);

        // If the cache is fully populated, search entirely locally — no network round-trip.
        const allCached = this.exchanges.length > 0 &&
            this.exchanges.every(e => this.contractsCache.has(e.exchangeId));

        if (allCached) {
            const results = [];
            this.contractsCache.forEach((contracts, exchangeId) => {
                contracts.forEach(c => {
                    if (this.contractMatchesTokens(c, tokens)) results.push(c);
                });
            });
            this.renderSearchResults(results);
            return;
        }

        // Fall back to the API using the first token (broadest match), then
        // client-side filter the response by all tokens and extra fields.
        try {
            const headers = await this.getAuthHeaders();
            const apiToken = encodeURIComponent(tokens[0]);
            const response = await fetch(
                `${this.config.apiUrl}/markets/contracts/search?search=${apiToken}`,
                { headers }
            );

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const rawResults = await response.json();
            const filtered = rawResults.filter(c => this.contractMatchesTokens(c, tokens));
            this.renderSearchResults(filtered);

        } catch (error) {
            console.error('Error searching contracts:', error);
        }
    }

    renderExchanges() {
        this.exchangesList.innerHTML = '';

        this.exchanges.forEach(exchange => {
            const exchangeDiv = document.createElement('div');
            exchangeDiv.className = 'exchange-item';

            const isExpanded = this.expandedExchanges.has(exchange.exchangeId);

            exchangeDiv.innerHTML = `
                <div class="exchange-header" data-exchange-id="${exchange.exchangeId}">
                    <span class="expand-icon">${isExpanded ? '▼' : '▶'}</span>
                    <span class="exchange-name">${exchange.description}</span>
                </div>
                <div class="contracts-container" style="display: ${isExpanded ? 'block' : 'none'}">
                    <div class="contracts-loading" style="display: none;">Loading contracts...</div>
                    <div class="contracts-list"></div>
                </div>
            `;

            this.exchangesList.appendChild(exchangeDiv);

            // Add click handler for exchange header
            const header = exchangeDiv.querySelector('.exchange-header');
            header.addEventListener('click', () => this.toggleExchange(exchange.exchangeId));

            // Load contracts if already expanded
            if (isExpanded) {
                this.loadAndRenderContracts(exchange.exchangeId);
            }
        });
    }

    renderSearchResults(searchResults) {
        // Group results by exchange, preserving sorted exchange order
        const groupedResults = new Map();
        searchResults.forEach(contract => {
            const key = contract.exchangeID;
            if (!groupedResults.has(key)) groupedResults.set(key, []);
            groupedResults.get(key).push(contract);
        });

        this.exchangesList.innerHTML = '';

        // Render in the same order exchanges are listed (already alphabetically sorted)
        this.exchanges.forEach(exchange => {
            const contracts = groupedResults.get(exchange.exchangeId);
            if (!contracts || contracts.length === 0) return;

            const exchangeDiv = document.createElement('div');
            exchangeDiv.className = 'exchange-item';

            exchangeDiv.innerHTML = `
                <div class="exchange-header expanded">
                    <span class="expand-icon">▼</span>
                    <span class="exchange-name">${exchange.description}</span>
                    <span class="exchange-count">(${contracts.length})</span>
                </div>
                <div class="contracts-container" style="display: block">
                    <div class="contracts-list"></div>
                </div>
            `;

            this.exchangesList.appendChild(exchangeDiv);

            const contractsList = exchangeDiv.querySelector('.contracts-list');
            contracts.forEach(contract => {
                this.renderContract(contractsList, contract, exchange.exchangeId);
            });
        });

        if (groupedResults.size === 0) {
            this.exchangesList.innerHTML = '<div class="no-results">No contracts found</div>';
        }
    }

    async toggleExchange(exchangeId) {
        const exchangeDiv = this.exchangesList.querySelector(`[data-exchange-id="${exchangeId}"]`).parentElement;
        const contractsContainer = exchangeDiv.querySelector('.contracts-container');
        const expandIcon = exchangeDiv.querySelector('.expand-icon');

        if (this.expandedExchanges.has(exchangeId)) {
            // Collapse
            this.expandedExchanges.delete(exchangeId);
            contractsContainer.style.display = 'none';
            expandIcon.textContent = '▶';
        } else {
            // Expand
            this.expandedExchanges.add(exchangeId);
            contractsContainer.style.display = 'block';
            expandIcon.textContent = '▼';

            await this.loadAndRenderContracts(exchangeId);
        }
    }

    async loadAndRenderContracts(exchangeId) {
        const exchangeDiv = this.exchangesList.querySelector(`[data-exchange-id="${exchangeId}"]`).parentElement;
        const contractsList = exchangeDiv.querySelector('.contracts-list');
        const loading = exchangeDiv.querySelector('.contracts-loading');

        if (this.contractsCache.has(exchangeId)) {
            // Already loaded
            contractsList.innerHTML = '';
            this.contractsCache.get(exchangeId).forEach(contract => {
                this.renderContract(contractsList, contract, exchangeId);
            });
            return;
        }

        // Show loading
        loading.style.display = 'block';
        contractsList.innerHTML = '';

        const contracts = await this.loadContractsForExchange(exchangeId);

        // Hide loading
        loading.style.display = 'none';

        // Render contracts
        contracts.forEach(contract => {
            this.renderContract(contractsList, contract, exchangeId);
        });
    }

    renderContract(container, contract, exchangeId) {
        const contractDiv = document.createElement('div');
        contractDiv.className = 'contract-item';
        contractDiv.innerHTML = `
            <span class="contract-name">${contract.description} (${contract.contractID})</span>
        `;

        contractDiv.addEventListener('click', () => {
            this.selectContractItem(exchangeId, contract.contractID, contract.contractType);
        });

        contractDiv.addEventListener('dblclick', () => {
            this.selectContractItem(exchangeId, contract.contractID, contract.contractType);
            this.selectContract();
        });

        container.appendChild(contractDiv);
    }

    selectContractItem(exchangeId, contractId, contractType) {
        // Remove previous selection
        this.exchangesList.querySelectorAll('.contract-item').forEach(item => {
            item.classList.remove('selected');
        });

        // Add selection to current item
        event.target.closest('.contract-item').classList.add('selected');

        this.selectedContract = {
            exchangeId,
            contractId,
            contractType
        };

        // Enable select button
        this.dialog.querySelector('.btn-select').disabled = false;
    }

    selectContract() {
        if (this.selectedContract) {
            this.close(this.selectedContract);
        }
    }

    close(result) {
        if (this.dialog) {
            document.body.removeChild(this.dialog);
            this.dialog = null;
        }

        if (this.onContractSelected) {
            this.onContractSelected(result);
        }
    }

    showLoading(show) {
        if (this.loadingIndicator) {
            this.loadingIndicator.style.display = show ? 'block' : 'none';
        }
    }

    async getAuthToken() {
        // Use the T4APIClient instance for authentication
        if (window.client && window.client.getAuthToken) {
            return await window.client.getAuthToken();
        }
        return null;
    }
}