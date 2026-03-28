from app.services.audit_anchoring import _merkle_root


def test_merkle_root_deterministic():
    leaves = ["a" * 64, "b" * 64, "c" * 64]
    r1 = _merkle_root(leaves)
    r2 = _merkle_root(leaves)
    assert r1 == r2
    assert len(r1) == 64


def test_merkle_root_empty():
    root = _merkle_root([])
    assert isinstance(root, str)
    assert len(root) == 64
