# Anchors pytest rootdir and sys.path to this directory so `from calculator
# import add` resolves regardless of invoking cwd (the fixture is later nested
# inside datum-local, whose own pyproject.toml would otherwise win rootdir).
