from average import average


def test_average_of_numbers():
    assert average([1, 2, 3]) == 2


def test_empty_list_returns_zero():
    """The docstring promises 0. The code raises ZeroDivisionError."""
    assert average([]) == 0
