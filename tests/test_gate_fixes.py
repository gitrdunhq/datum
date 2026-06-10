from datum.gate import check_questions_answered


def test_multiline_answer_not_flagged():
    content = "### Q1: What is this?\n[Answer]:\nThis is the answer."
    errors = check_questions_answered(content)
    assert len(errors) == 0


def test_inline_answer_not_flagged():
    content = "### Q1: What is this?\n[Answer]: This is the answer."
    errors = check_questions_answered(content)
    assert len(errors) == 0


def test_empty_answer_flagged():
    content = "### Q1: What is this?\n[Answer]:\n\n\n"
    errors = check_questions_answered(content)
    assert len(errors) == 1
    assert "Q1" in errors[0]


def test_blank_lines_then_answer_not_flagged():
    content = "### Q1: What is this?\n[Answer]:\n\nThis is the answer."
    errors = check_questions_answered(content)
    assert len(errors) == 0
