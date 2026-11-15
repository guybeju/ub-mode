from demo.board import place, alpha

def test_place():
    b = [[0]*3 for _ in range(3)]
    assert place(b, 1, 1)[1][1] == 1

def test_alpha():
    assert alpha([1, 2, 3]) == 6

def test_place_rejects_outside():
    b = [[0]*3 for _ in range(3)]
    assert place(b, -1, 0) is None
    assert place(b, 3, 0) is None
    assert place(b, 0, 3) is None
