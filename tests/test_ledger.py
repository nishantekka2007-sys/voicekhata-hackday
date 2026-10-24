import pytest

from ledger import add_transaction, connect, customer_balances, list_transactions


def test_credit_sale_and_payment_update_balance(tmp_path):
    connection = connect(tmp_path / "test.db")
    add_transaction(connection, "Ramesh", "credit_sale", 500, "Rice")
    add_transaction(connection, "Ramesh", "payment_received", 200, "Part payment")

    assert customer_balances(connection) == {"Ramesh": 300.0}
    assert len(list_transactions(connection)) == 2
    connection.close()


def test_cash_expense_does_not_change_customer_balance(tmp_path):
    connection = connect(tmp_path / "test.db")
    add_transaction(connection, "Ramesh", "credit_sale", 500)
    add_transaction(connection, "Electricity", "cash_expense", 100)

    assert customer_balances(connection) == {"Ramesh": 500.0}
    connection.close()


@pytest.mark.parametrize(
    "customer,kind,amount",
    [
        ("", "credit_sale", 100),
        ("Ramesh", "unknown", 100),
        ("Ramesh", "credit_sale", 0),
        ("Ramesh", "payment_received", -10),
    ],
)
def test_invalid_transaction_is_rejected(tmp_path, customer, kind, amount):
    connection = connect(tmp_path / "test.db")
    with pytest.raises(ValueError):
        add_transaction(connection, customer, kind, amount)
    assert list_transactions(connection) == []
    connection.close()
