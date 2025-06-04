/**
 * Expiry Picker Dialog
 * Handles expiry selection with hierarchical display
 */

class ExpiryPicker {
    constructor(config, exchangeId, contractId) {
        this.config = config;
        this.exchangeId = exchangeId;
        this.contractId = contractId;
        this.groupsCache = new Map();
        this.marketsCache = new Map();
        this.expandedGroups = new Set();
        this.selectedExpiry = null;
        this.onExpirySelected = null;

        this.dialog = null;
        this.groupsList = null;
        this.loadingIndicator = null;
    }

    async show() {
        return new Promise((resolve) => {
            this.onExpirySelected = resolve;
            this.createDialog();
            this.loadGroups();
        });
    }

    createDialog() {
        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'expiry-picker-overlay';
        overlay.innerHTML = `
            <div class="expiry-picker-dialog">
                <div class="expiry-picker-header">
                    <h3>Select Expiry</h3>
                    <button class="close-btn">&times;</button>
                </div>
                <div class="expiry-picker-content">
                    <div class="loading-indicator" style="display: none;">Loading...</div>
                    <div class="groups-list"></div>
                </div>
                <div class="expiry-picker-footer">
                    <button class="btn btn-cancel">Cancel</button>
                    <button class="btn btn-select" disabled>Select</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        this.dialog = overlay;

        // Get references
        this.groupsList = overlay.querySelector('.groups-list');
        this.loadingIndicator = overlay.querySelector('.loading-indicator');

        // Event listeners
        overlay.querySelector('.close-btn').addEventListener('click', () => this.close(null));
        overlay.querySelector('.btn-cancel').addEventListener('click', () => this.close(null));
        overlay.querySelector('.btn-select').addEventListener('click', () => this.selectExpiry());

        // Close on overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.close(null);
        });
    }

    async loadGroups() {
        this.showLoading(true);

        try {
            const headers = { 'Content-Type': 'application/json' };

            if (this.config.apiKey) {
                headers['Authorization'] = `APIKey ${this.config.apiKey}`;
            } else {
                const token = await this.getAuthToken();
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }
            }

            const response = await fetch(
                `${this.config.apiUrl}/markets/picker/groups?exchangeid=${this.exchangeId}&contractid=${this.contractId}`,
                { headers }
            );

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const groups = await response.json();
            this.groupsCache.set('root', groups);
            this.renderGroups(groups);

        } catch (error) {
            console.error('Error loading groups:', error);
            this.groupsList.innerHTML = '<div class="error">Failed to load expiry groups</div>';
        } finally {
            this.showLoading(false);
        }
    }

    async loadMarketsForGroup(strategyType, expiryDate) {
        const cacheKey = `${strategyType}_${expiryDate || 'none'}`;

        if (this.marketsCache.has(cacheKey)) {
            return this.marketsCache.get(cacheKey);
        }

        try {
            const headers = { 'Content-Type': 'application/json' };

            if (this.config.apiKey) {
                headers['Authorization'] = `APIKey ${this.config.apiKey}`;
            } else {
                const token = await this.getAuthToken();
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }
            }

            let url = `${this.config.apiUrl}/markets/picker?exchangeid=${this.exchangeId}&contractid=${this.contractId}&strategytype=${strategyType}`;

            // Only include expirydate if strategytype is not "None"
            if (strategyType !== 'None' && expiryDate) {
                url += `&expirydate=${expiryDate}`;
            }

            const response = await fetch(url, { headers });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const markets = await response.json();
            this.marketsCache.set(cacheKey, markets);
            return markets;

        } catch (error) {
            console.error(`Error loading markets for group ${strategyType}:`, error);
            return [];
        }
    }

    renderGroups(groups, parentElement = null) {
        const container = parentElement || this.groupsList;
        container.innerHTML = '';

        groups.forEach(group => {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'group-item';

            const isExpanded = this.expandedGroups.has(group.strategyType);
            const displayName = this.getStrategyTypeDisplayName(group.strategyType);

            groupDiv.innerHTML = `
                <div class="group-header" data-strategy-type="${group.strategyType}" data-expiry-date="${group.expiryDate || ''}">
                    <span class="expand-icon">${isExpanded ? '▼' : '▶'}</span>
                    <span class="group-name">${displayName}</span>
                </div>
                <div class="markets-container" style="display: ${isExpanded ? 'block' : 'none'}">
                    <div class="markets-loading" style="display: none;">Loading markets...</div>
                    <div class="markets-list"></div>
                </div>
            `;

            container.appendChild(groupDiv);

            // Add click handler for group header
            const header = groupDiv.querySelector('.group-header');
            header.addEventListener('click', () => this.toggleGroup(group.strategyType, group.expiryDate));

            // Load markets if already expanded
            if (isExpanded) {
                this.loadAndRenderMarkets(group.strategyType, group.expiryDate, groupDiv);
            }
        });
    }

    async toggleGroup(strategyType, expiryDate) {
        const groupKey = strategyType;
        const groupDiv = this.groupsList.querySelector(`[data-strategy-type="${strategyType}"]`).parentElement;
        const marketsContainer = groupDiv.querySelector('.markets-container');
        const expandIcon = groupDiv.querySelector('.expand-icon');

        if (this.expandedGroups.has(groupKey)) {
            // Collapse
            this.expandedGroups.delete(groupKey);
            marketsContainer.style.display = 'none';
            expandIcon.textContent = '▶';
        } else {
            // Expand
            this.expandedGroups.add(groupKey);
            marketsContainer.style.display = 'block';
            expandIcon.textContent = '▼';

            await this.loadAndRenderMarkets(strategyType, expiryDate, groupDiv);
        }
    }

    async loadAndRenderMarkets(strategyType, expiryDate, groupDiv) {
        const marketsList = groupDiv.querySelector('.markets-list');
        const loading = groupDiv.querySelector('.markets-loading');

        const cacheKey = `${strategyType}_${expiryDate || 'none'}`;
        if (this.marketsCache.has(cacheKey)) {
            // Already loaded
            marketsList.innerHTML = '';
            this.marketsCache.get(cacheKey).forEach(market => {
                this.renderMarket(marketsList, market);
            });
            return;
        }

        // Show loading
        loading.style.display = 'block';
        marketsList.innerHTML = '';

        const markets = await this.loadMarketsForGroup(strategyType, expiryDate);

        // Hide loading
        loading.style.display = 'none';

        // Render markets
        markets.forEach(market => {
            this.renderMarket(marketsList, market);
        });
    }

    renderMarket(container, market) {
        const marketDiv = document.createElement('div');
        marketDiv.className = 'market-item';

        // Format the display text
        const displayText = this.formatMarketDisplay(market);

        marketDiv.innerHTML = `
            <span class="market-name">${displayText}</span>
        `;

        marketDiv.addEventListener('click', () => {
            this.selectMarketItem(market);
        });

        marketDiv.addEventListener('dblclick', () => {
            this.selectMarketItem(market);
            this.selectExpiry();
        });

        container.appendChild(marketDiv);
    }

    formatMarketDisplay(market) {
        // Just show the market ID for now
        return market.marketID || 'Unknown Market';
    }

    getStrategyTypeDisplayName(strategyType) {
        const strategyTypeMap = {
            'None': 'Outright',
            'CalendarSpread': 'Calendar Spread',
            'RtCalendarSpread': 'RT Calendar Spread',
            'InterContractSpread': 'Inter Contract Spread',
            'Butterfly': 'Butterfly',
            'Condor': 'Condor',
            'DoubleButterfly': 'Double Butterfly',
            'Horizontal': 'Horizontal',
            'Bundle': 'Bundle',
            'MonthVsPack': 'Month vs Pack',
            'Pack': 'Pack',
            'PackSpread': 'Pack Spread',
            'PackButterfly': 'Pack Butterfly',
            'BundleSpread': 'Bundle Spread',
            'Strip': 'Strip',
            'Crack': 'Crack',
            'TreasurySpread': 'Treasury Spread',
            'Crush': 'Crush',
            'ThreeWay': 'Three Way',
            'ThreeWayStraddleVsCall': 'Three Way Straddle vs Call',
            'ThreeWayStraddleVsPut': 'Three Way Straddle vs Put',
            'Box': 'Box',
            'XmasTree': 'Christmas Tree',
            'ConditionalCurve': 'Conditional Curve',
            'Double': 'Double',
            'HorizontalStraddle': 'Horizontal Straddle',
            'IronCondor': 'Iron Condor',
            'Ratio1X2': 'Ratio 1x2',
            'Ratio1X3': 'Ratio 1x3',
            'Ratio2X3': 'Ratio 2x3',
            'RiskReversal': 'Risk Reversal',
            'StraddleStrip': 'Straddle Strip',
            'Straddle': 'Straddle',
            'Strangle': 'Strangle',
            'Vertical': 'Vertical',
            'JellyRoll': 'Jelly Roll',
            'IronButterfly': 'Iron Butterfly',
            'Guts': 'Guts',
            'Generic': 'Generic',
            'Diagonal': 'Diagonal'
        };

        return strategyTypeMap[strategyType] || strategyType;
    }

    selectMarketItem(market) {
        // Remove previous selection
        this.groupsList.querySelectorAll('.market-item').forEach(item => {
            item.classList.remove('selected');
        });

        // Add selection to current item
        event.target.closest('.market-item').classList.add('selected');

        this.selectedExpiry = {
            exchangeId: this.exchangeId,
            contractId: this.contractId,
            marketId: market.marketID,
            expiryDate: market.expiryDate,
            description: market.description
        };

        // Enable select button
        this.dialog.querySelector('.btn-select').disabled = false;
    }

    selectExpiry() {
        if (this.selectedExpiry) {
            this.close(this.selectedExpiry);
        }
    }

    close(result) {
        if (this.dialog) {
            document.body.removeChild(this.dialog);
            this.dialog = null;
        }

        if (this.onExpirySelected) {
            this.onExpirySelected(result);
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