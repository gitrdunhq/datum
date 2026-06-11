from datum.structural_fingerprint import collapse_fingerprint_groups, structural_fingerprint


def test_basic_py_fingerprint():
    content = "import os\nimport sys\n\ndef main():\n    pass\n"
    result = structural_fingerprint(content, "app.py")
    assert result == "py:s:2:1:import os"


def test_no_filename_defaults_empty_ext():
    content = "x = 1\n"
    result = structural_fingerprint(content)
    assert result == ":s:0:0:x = 1"


def test_bucket_medium():
    content = "\n".join(f"x_{i} = {i}" for i in range(30)) + "\n"
    result = structural_fingerprint(content, "data.py")
    assert result.startswith("py:m:")


def test_bucket_large():
    content = "\n".join(f"x_{i} = {i}" for i in range(100)) + "\n"
    result = structural_fingerprint(content, "big.py")
    assert result.startswith("py:l:")


def test_bucket_xlarge():
    content = "\n".join(f"x_{i} = {i}" for i in range(250)) + "\n"
    result = structural_fingerprint(content, "huge.py")
    assert result.startswith("py:xl:")


def test_syntax_error_fallback():
    content = "import os\nfrom sys import path\ndef foo(:\n    pass\nclass Bar:\n    x = 1\n"
    result = structural_fingerprint(content, "bad.py")
    parts = result.split(":")
    assert parts[0] == "py"
    assert parts[1] == "s"
    assert parts[2] == "2"
    assert parts[3] == "2"
    assert parts[4] == "import os"


def test_empty_content():
    result = structural_fingerprint("", "empty.txt")
    assert result == "txt:s:0:0:"


def test_first_line_truncation():
    long_line = "x" * 80
    content = long_line + "\n"
    result = structural_fingerprint(content, "t.py")
    assert result.endswith(":" + "x" * 40)


def test_collapse_singleton():
    entries = [("only.py", "x = 1\n")]
    result = collapse_fingerprint_groups(entries)
    assert result == ["only.py"]


def test_collapse_duplicate_pair():
    entries = [("a.py", "x = 1\n"), ("b.py", "x = 1\n")]
    result = collapse_fingerprint_groups(entries)
    assert len(result) == 1
    assert result[0] == "a.py (+1 more with same shape: b.py)"


def test_collapse_large_group_truncation():
    entries = [(f"t{i}.py", "x = 1\n") for i in range(9)]
    result = collapse_fingerprint_groups(entries)
    assert len(result) == 1
    assert "+3 more" in result[0]
    names_in_parens = result[0].split(": ", 1)[1].rstrip(")")
    listed = [n.strip() for n in names_in_parens.replace("+3 more", "").split(",") if n.strip()]
    assert len(listed) == 5


def test_collapse_preserves_order():
    entries = [
        ("first.py", "import os\n"),
        ("second.py", "x = 1\n"),
        ("third.py", "import os\n"),
    ]
    result = collapse_fingerprint_groups(entries)
    assert len(result) == 2
    assert result[0].startswith("first.py")
    assert result[1] == "second.py"
