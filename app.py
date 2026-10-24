"""VoiceKhata's first milestone: a simple, confirmation-based ledger UI."""
import streamlit as st

from ledger import add_transaction, connect, customer_balances, list_transactions

st.set_page_config(page_title="VoiceKhata", page_icon="🧾", layout="wide")
st.title("🧾 VoiceKhata")
st.caption("A simple digital khata for small shops — first MVP")

connection = connect()

with st.sidebar:
    st.header("Add a transaction")
    st.write("Review the details and press **Save transaction** to record it.")
    with st.form("transaction_form", clear_on_submit=True):
        kind_label = st.selectbox(
            "Transaction type",
            ["Credit sale (customer owes you)", "Payment received", "Shop expense"],
        )
        customer = st.text_input(
            "Customer / name",
            help="For shop expenses, enter a label such as 'Electricity'.",
        )
        amount = st.number_input("Amount (₹)", min_value=0.01, value=100.0, step=10.0)
        note = st.text_input("Note (optional)", placeholder="e.g. 2 kg rice")
        confirmed = st.checkbox("I have checked these details")
        submitted = st.form_submit_button("Save transaction", type="primary")

    if submitted:
        if not confirmed:
            st.error("Please confirm the details before saving.")
        else:
            kind_map = {
                "Credit sale (customer owes you)": "credit_sale",
                "Payment received": "payment_received",
                "Shop expense": "cash_expense",
            }
            try:
                add_transaction(connection, customer, kind_map[kind_label], amount, note)
                st.success("Transaction saved.")
                st.rerun()
            except ValueError as error:
                st.error(str(error))

balances = customer_balances(connection)
credit_total = sum(max(balance, 0) for balance in balances.values())

col1, col2 = st.columns(2)
col1.metric("Customers tracked", len(balances))
col2.metric("Total outstanding", f"₹{credit_total:,.2f}")

st.subheader("Customer balances")
if balances:
    st.dataframe(
        [{"Customer": name, "Balance due (₹)": round(balance, 2)}
         for name, balance in balances.items()],
        use_container_width=True,
        hide_index=True,
    )
else:
    st.info("No customer balances yet. Add a transaction from the sidebar.")

st.subheader("Recent transactions")
transactions = list_transactions(connection)
if transactions:
    st.dataframe(
        [
            {
                "ID": row["id"],
                "Date": row["created_at"],
                "Name": row["customer"],
                "Type": row["kind"].replace("_", " ").title(),
                "Amount (₹)": row["amount_paise"] / 100,
                "Note": row["note"],
            }
            for row in transactions
        ],
        use_container_width=True,
        hide_index=True,
    )
else:
    st.info("Your saved transactions will appear here.")

connection.close()
