"""Tests for BidOffer enum — verifies values, lookup, and unknown-value handling."""

from t4login.definitions.bid_offer import BidOffer


def test_values() -> None:
    assert BidOffer.Undefined.value == 0
    assert BidOffer.Bid.value == 1
    assert BidOffer.Offer.value == -1


def test_get_known() -> None:
    assert BidOffer.get(1) is BidOffer.Bid
    assert BidOffer.get(-1) is BidOffer.Offer
    assert BidOffer.get(0) is BidOffer.Undefined


def test_get_unknown_returns_undefined() -> None:
    assert BidOffer.get(42) is BidOffer.Undefined
