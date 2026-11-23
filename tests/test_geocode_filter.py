from app.api import _name_matches, _within_one_edit


def test_unrelated_fuzzy_results_are_dropped():
    assert not _name_matches("Qwertyville", {"name": "Quartzville"})   # 2 edits
    assert not _name_matches("Hello", {"name": "Helsinki"})
    assert not _name_matches("zzzqx", {"name": "Zaqatala"})


def test_real_names_and_one_typo_are_kept():
    assert _name_matches("Paris", {"name": "Paris"})
    assert _name_matches("par", {"name": "Paris"})
    assert _name_matches("Yangoon", {"name": "Yangon"})            # one typo, 5+ letters
    assert _name_matches("São Paulo", {"name": "Sao Paulo"})       # accents folded
    assert _name_matches("တိုကျို", {"name": "တိုကျို"})
    assert not _name_matches("Yang", {"name": "Bangkok"})


def test_one_edit_helper():
    assert _within_one_edit("abcde", "abcd") and _within_one_edit("abcde", "abXde") and not _within_one_edit("abcde", "aXXde")
