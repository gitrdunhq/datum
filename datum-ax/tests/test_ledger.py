from datum_ax.data.state.ledger import LibSQLLedger

def test_libsql_ledger():
    ledger = LibSQLLedger(":memory:")
    ledger.record_node("plan", "sonnet", 100, 50, 1.5)
    
    records = ledger.get_trace()
    assert len(records) == 1
    assert records[0]["node"] == "plan"
    assert records[0]["model_id"] == "sonnet"
    assert records[0]["input_tokens"] == 100
    assert records[0]["output_tokens"] == 50
    assert records[0]["duration_s"] == 1.5
