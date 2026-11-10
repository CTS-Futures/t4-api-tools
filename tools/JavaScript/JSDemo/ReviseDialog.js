// ReviseDialog.js - Single-order revise/pull dialog
let currentEditingOrder = null;

// Price type constants (match T4ProtoV2.t4proto.v2.common.PriceType)
const PRICE_TYPE_LIMIT = 1;
const PRICE_TYPE_STOP_MARKET = 2;
const PRICE_TYPE_STOP_LIMIT = 3;

// Match T4ProtoV2.t4proto.v2.common.OrderStatus. A held bracket leg has volume 0 until its trigger fills.
const ORDER_STATUS_HELD = 4;

document.addEventListener('DOMContentLoaded', function () {
    const orderEditOverlay = document.getElementById('orderEditOverlay');
    const closeBtn = document.querySelector('#orderEditOverlay .close-btn');
    const pullOrderBtn = document.getElementById('pullOrderBtn');
    const reviseOrderBtn = document.getElementById('reviseOrderBtn');
    const cancelEditBtn = document.getElementById('cancelEditBtn');
    const addBracketsBtn = document.getElementById('addBracketsBtn');

    if (addBracketsBtn) addBracketsBtn.addEventListener('click', handleAddBrackets);
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


// Brackets can be added to a plain order or to a trigger that is still missing a leg,
// never to a take profit / stop loss leg itself.
function canHaveBracketsAdded(order) {
    const roles = T4ProtoV2.t4proto.v2.common.OCORole;
    const role = order.ocoRole ?? roles.OCO_ROLE_UNDEFINED;
    return role === roles.OCO_ROLE_UNDEFINED || role === roles.OCO_ROLE_TRIGGER;
}

function showOrderEditDialog(order) {
    currentEditingOrder = order;

    const stop = isStopOrder(order);
    const role = getOrderRoleLabel(order);

    const header = document.querySelector('#orderEditOverlay .order-edit-header h3');
    if (header) header.textContent = `Modify ${role} Order`;

    const priceLabel = document.querySelector('label[for="editOrderPrice"]');
    if (priceLabel) priceLabel.textContent = stop ? 'Stop Price:' : 'Limit Price:';

    // V2 volumes are Decimal wrappers; the number input needs the inner value.
    document.getElementById('editOrderVolume').value = order.currentVolume?.value ?? order.currentVolume ?? 0;

    // Use || (not ??) so empty-string protobuf wrapper values fall through.
    const priceVal = stop
        ? (order.currentStopPrice?.value || order.newStopPrice?.value || order.stopPrice?.value || '')
        : (order.currentLimitPrice?.value || order.newLimitPrice?.value || order.limitPrice?.value || '');

    document.getElementById('editOrderPrice').value = priceVal;

    const canAddBrackets = canHaveBracketsAdded(order);
    document.getElementById('editBracketTp').value = '';
    document.getElementById('editBracketSl').value = '';
    document.getElementById('editBracketGroup').style.display = canAddBrackets ? '' : 'none';
    document.getElementById('addBracketsBtn').style.display = canAddBrackets ? '' : 'none';

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

    // Reject cleared/non-numeric fields before they reach the API (a NaN would be
    // sent as a "NaN" volume/price string). Keep the dialog open so the user can fix it.
    const minVolume = currentEditingOrder.status === ORDER_STATUS_HELD ? 0 : 1;
    if (!Number.isFinite(newVolume) || newVolume < minVolume || !Number.isFinite(newPrice)) {
        const msg = 'Revise: enter a positive volume and a valid price.';
        if (window.client?.log) window.client.log(msg, 'error'); else console.error(msg);
        return;
    }

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

async function handleAddBrackets() {
    if (!currentEditingOrder) return;

    const parsePrice = (id) => {
        const text = document.getElementById(id).value.trim();
        return text === '' ? null : parseFloat(text);
    };
    const takeProfit = parsePrice('editBracketTp');
    const stopLoss = parsePrice('editBracketSl');

    const invalid = (value) => value !== null && !Number.isFinite(value);
    if ((takeProfit === null && stopLoss === null) || invalid(takeProfit) || invalid(stopLoss)) {
        const msg = 'Add brackets: enter a valid take profit and/or stop loss price.';
        if (window.client?.log) window.client.log(msg, 'error'); else console.error(msg);
        return;
    }

    try {
        await window.client.addBracketsToOrder(currentEditingOrder, takeProfit, stopLoss);
    } catch (error) {
        console.error('Error adding brackets:', error);
        if (window.client?.log) window.client.log(error.message, 'error');
    }

    hideOrderEditDialog();
}

window.showOrderEditDialog = showOrderEditDialog;
window.hideOrderEditDialog = hideOrderEditDialog;
