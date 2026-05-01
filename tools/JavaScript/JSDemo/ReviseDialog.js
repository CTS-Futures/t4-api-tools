// ReviseDialog.js - Single-order revise/pull dialog
let currentEditingOrder = null;

// Price type constants (match T4Proto.t4proto.v1.common.PriceType)
const PRICE_TYPE_LIMIT = 1;
const PRICE_TYPE_STOP_MARKET = 2;
const PRICE_TYPE_STOP_LIMIT = 3;

document.addEventListener('DOMContentLoaded', function () {
    const orderEditOverlay = document.getElementById('orderEditOverlay');
    const closeBtn = document.querySelector('#orderEditOverlay .close-btn');
    const pullOrderBtn = document.getElementById('pullOrderBtn');
    const reviseOrderBtn = document.getElementById('reviseOrderBtn');
    const cancelEditBtn = document.getElementById('cancelEditBtn');

    if (closeBtn) closeBtn.addEventListener('click', hideOrderEditDialog);
    if (pullOrderBtn) pullOrderBtn.addEventListener('click', handleOrderPull);
    if (reviseOrderBtn) reviseOrderBtn.addEventListener('click', handleOrderRevise);
    if (cancelEditBtn) cancelEditBtn.addEventListener('click', hideOrderEditDialog);

    if (orderEditOverlay) {
        orderEditOverlay.addEventListener('click', (e) => {
            if (e.target === orderEditOverlay) {
                hideOrderEditDialog();
            }
        });
    }
});

function isStopOrder(order) {
    return order.priceType === PRICE_TYPE_STOP_LIMIT
        || order.priceType === PRICE_TYPE_STOP_MARKET;
}

function getOrderRoleLabel(order) {
    const tag = order.activationData
        || order.instructionExtra?.activationData
        || '';
    if (tag === 'SL' || tag === 'SL-TRAIL') return 'Stop Loss';
    if (isStopOrder(order)) return 'Stop';
    if (order.activationType === 1 && order.priceType === PRICE_TYPE_LIMIT
        && order.orderLink && order.orderLink !== 0) {
        return 'Take Profit';
    }
    return 'Limit';
}


function showOrderEditDialog(order) {
    currentEditingOrder = order;

    const stop = isStopOrder(order);
    const role = getOrderRoleLabel(order);

    const header = document.querySelector('#orderEditOverlay .order-edit-header h3');
    if (header) header.textContent = `Modify ${role} Order`;

    const priceLabel = document.querySelector('label[for="editOrderPrice"]');
    if (priceLabel) priceLabel.textContent = stop ? 'Stop Price:' : 'Limit Price:';

    document.getElementById('editOrderVolume').value = order.currentVolume ?? 0;

    // Use || (not ??) so empty-string protobuf wrapper values fall through.
    const priceVal = stop
        ? (order.currentStopPrice?.value || order.newStopPrice?.value || order.stopPrice?.value || '')
        : (order.currentLimitPrice?.value || order.newLimitPrice?.value || order.limitPrice?.value || '');

    document.getElementById('editOrderPrice').value = priceVal;

    document.getElementById('orderEditOverlay').style.display = 'flex';
}

function hideOrderEditDialog() {
    document.getElementById('orderEditOverlay').style.display = 'none';
    currentEditingOrder = null;
}

function handleOrderPull() {
    if (!currentEditingOrder) return;
    try {
        window.client.pullOrder(currentEditingOrder.uniqueId);
    } catch (error) {
        console.error('Error pulling order:', error);
    }
    hideOrderEditDialog();
}

function handleOrderRevise() {
    if (!currentEditingOrder) return;

    const newVolume = parseInt(document.getElementById('editOrderVolume').value);
    const newPrice = parseFloat(document.getElementById('editOrderPrice').value);
    const stop = isStopOrder(currentEditingOrder);

    try {
        window.client.reviseOrder(
            currentEditingOrder.uniqueId,
            newVolume,
            newPrice,
            stop ? 'stop' : 'limit'
        );
    } catch (error) {
        console.error('Error revising order:', error);
    }

    hideOrderEditDialog();
}

window.showOrderEditDialog = showOrderEditDialog;
window.hideOrderEditDialog = hideOrderEditDialog;