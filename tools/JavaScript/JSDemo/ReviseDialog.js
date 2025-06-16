// ReviseDialog.js - Fixed version
let currentEditingOrder = null;

// Wait for DOM to be fully loaded before attaching event listeners
document.addEventListener('DOMContentLoaded', function() {
    // Get dialog element references
    const orderEditOverlay = document.getElementById('orderEditOverlay');
    const closeBtn = document.querySelector('#orderEditOverlay .close-btn');
    const pullOrderBtn = document.getElementById('pullOrderBtn');
    const reviseOrderBtn = document.getElementById('reviseOrderBtn');
    const cancelEditBtn = document.getElementById('cancelEditBtn');

    // Attach event listeners
    if (closeBtn) closeBtn.addEventListener('click', hideOrderEditDialog);
    if (pullOrderBtn) pullOrderBtn.addEventListener('click', handleOrderPull);
    if (reviseOrderBtn) reviseOrderBtn.addEventListener('click', handleOrderRevise);
    if (cancelEditBtn) cancelEditBtn.addEventListener('click', hideOrderEditDialog);

    // Close on overlay click
    if (orderEditOverlay) {
        orderEditOverlay.addEventListener('click', (e) => {
            if (e.target === orderEditOverlay) {
                hideOrderEditDialog();
            }
        });
    }
});

function showOrderEditDialog(order) {
    currentEditingOrder = order;

    // Set current values
    document.getElementById('editOrderVolume').value = order.currentVolume;
    document.getElementById('editOrderPrice').value = order.currentLimitPrice ? order.currentLimitPrice.value : '';

    // Show dialog
    document.getElementById('orderEditOverlay').style.display = 'flex';
}

function hideOrderEditDialog() {
    document.getElementById('orderEditOverlay').style.display = 'none';
    currentEditingOrder = null;
}

function handleOrderPull() {
    if (currentEditingOrder) {
        console.log('Pulling order:', currentEditingOrder.uniqueId);

        // Call client method to pull order
        try {
            window.client.pullOrder(currentEditingOrder.uniqueId);
        } catch (error) {
            console.error('Error pulling order:', error);
        }

        hideOrderEditDialog();
    }
}

function handleOrderRevise() {
    if (currentEditingOrder) {
        const newVolume = parseInt(document.getElementById('editOrderVolume').value);
        const newPrice = parseFloat(document.getElementById('editOrderPrice').value);

        console.log('Revising order:', currentEditingOrder.uniqueId, {
            volume: newVolume,
            price: newPrice
        });

        // Call client method to revise order
        try {
            window.client.reviseOrder(currentEditingOrder.uniqueId, newVolume, newPrice, 'limit');
        } catch (error) {
            console.error('Error revising order:', error);
        }

        hideOrderEditDialog();
    }
}

// Make functions available globally
window.showOrderEditDialog = showOrderEditDialog;
window.hideOrderEditDialog = hideOrderEditDialog;