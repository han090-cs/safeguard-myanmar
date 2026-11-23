from gazetteer import search_places


def test_villages_only_match_from_the_start_of_the_name():
    for r in search_places("ကြီး", 20):
        if r["type"] == "Village":
            assert r["name"].replace("​", "").startswith("ကြီး")


def test_one_entry_per_name_and_region():
    r = search_places("မဲဇလီ", 20)
    keys = [(x["name"].replace("​", ""), x["region"]) for x in r]
    assert len(keys) == len(set(keys))


def test_towns_still_match_anywhere():
    assert any(x["type"] == "Town" and x["name"] == "ပုသိမ်" for x in search_places("ပုသိမ်", 8))
